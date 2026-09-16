(function (CET) {
  const { CONFIG } = CET;
  const u = CET.utils;
  const sp = CET.sp;
  const lists = CONFIG.lists;
  const F = CONFIG.fields;
  const fr = () => CET.fieldResolver;

  function fieldToText(sourceList, field, value) {
    if (u.isBlank(value)) return '';
    if (field === 'CyberPM' || field === 'DSS_PM' || field === 'ProjectPM' || field === 'Owner') {
      return u.personLogin(value);
    }
    if (field.includes('Date') || field === 'Month' || field === 'BlockedSince') {
      return u.toDateKey(value);
    }
    if (field === 'BudgetMM' || field === 'MMConsumed') {
      return u.normalizeNumber(value, 2);
    }
    if (Array.isArray(value)) {
      return value
        .map((v) => fieldToText(sourceList, field, v))
        .filter(Boolean)
        .sort()
        .join(';');
    }
    if (typeof value === 'object' && value.results) {
      return fieldToText(sourceList, field, value.results);
    }
    if (field === 'OldValue' || field === 'NewValue' || field === 'StatusReason' || field === 'Text') {
      return u.plainText(value);
    }
    return String(value).trim();
  }

  function rawFieldValue(beforeRaw, field) {
    if (!beforeRaw) return undefined;
    if (beforeRaw[field] !== undefined) return beforeRaw[field];
    const idField = field.endsWith('Id') ? field : `${field}Id`;
    if (beforeRaw[idField] !== undefined) return beforeRaw[idField];
    return fr().getRawField(beforeRaw, field, field);
  }

  function payloadFieldValue(payload, beforeRaw, field) {
    if (payload[field] !== undefined) return payload[field];
    const idField = field.endsWith('Id') ? field : `${field}Id`;
    if (payload[idField] !== undefined) return payload[idField];
    return rawFieldValue(beforeRaw, field);
  }

  async function writeChangeLogRows(rows, state) {
    for (const row of rows) {
      const enriched = attachChangedBy(row, state);
      await sp.createRecord(lists.changeLog, enriched);
    }
  }

  function attachChangedBy(row, state) {
    const user = state?.currentUser;
    if (user?.Id) {
      row[`${F.changeLog.changedBy}Id`] = user.Id;
    }
    return row;
  }

  function buildChangeRow(projectNumber, sourceList, itemId, itemLabel, field, oldVal, newVal, changeType) {
    return {
      [F.changeLog.projectNumber]: projectNumber,
      [F.changeLog.sourceList]: sourceList,
      [F.changeLog.itemId]: itemId,
      [F.changeLog.itemLabel]: itemLabel,
      [F.changeLog.field]: field,
      [F.changeLog.oldValue]: oldVal,
      [F.changeLog.newValue]: newVal,
      [F.changeLog.changeType]: changeType,
      [F.changeLog.changedOn]: new Date().toISOString(),
      [F.changeLog.suppressed]: false,
    };
  }

  async function updateDerivedProjectFields(projectId, state) {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;

    const subs = state.submissions
      .filter((s) => s.projectId === projectId && !s.actualDate && s.submissionStatus !== 'Cancelled')
      .sort((a, b) => (a.plannedDate || 0) - (b.plannedDate || 0));

    const next = subs[0] || null;
    const notes = state.notes
      .filter((n) => n.projectId === projectId)
      .sort((a, b) => (b.noteDate || 0) - (a.noteDate || 0));
    const latest = notes[0];

    let blockedSince = project.blockedSince;
    if (project.status === 'Blocked-client' && !blockedSince) {
      blockedSince = u.startOfTodayRiyadh();
    } else if (project.status !== 'Blocked-client') {
      blockedSince = null;
    }

    const ragResult = CET.rag.computeRAG(project, state.submissions, state.efforts);

    const payload = {};
    payload[F.projects.nextSubmissionDate] = next && next.plannedDate ? next.plannedDate.toISOString() : null;
    payload[F.projects.nextSubmissionType] = next ? next.type : '';
    payload[F.projects.latestNote] = latest ? u.plainText(latest.text).slice(0, 200) : '';
    payload[F.projects.blockedSince] = blockedSince ? blockedSince.toISOString() : null;
    payload[F.projects.rag] = ragResult.rag;

    await sp.updateRecord(lists.projects, projectId, payload);

    project.nextSubmissionDate = next ? next.plannedDate : null;
    project.nextSubmissionType = next ? next.type : '';
    project.latestNote = latest ? u.plainText(latest.text).slice(0, 200) : '';
    project.blockedSince = blockedSince;
    project.rag = ragResult.rag;
    project.ragReason = ragResult.reason;
  }

  function resolveProjectId(sourceList, logId, payload, beforeRaw, state) {
    if (sourceList === 'Projects') return logId;
    if (payload[F.submissions?.projectId]) return Number(payload[F.submissions.projectId]);
    if (payload[F.effortLog?.projectId]) return Number(payload[F.effortLog.projectId]);
    if (payload[F.notes?.projectId]) return Number(payload[F.notes.projectId]);
    if (payload.ProjectId) return Number(payload.ProjectId);
    if (beforeRaw) {
      const fromSub = CET.normalize.getLookupId(beforeRaw, F.submissions.projectId, F.submissions.project);
      if (fromSub) return fromSub;
    }
    return null;
  }

  async function saveItem(options) {
    const {
      sourceList,
      listTitle,
      itemId,
      payload,
      beforeRaw,
      projectNumber,
      itemLabel,
      isCreate,
      state,
    } = options;

    const tracked = CONFIG.trackedFields[sourceList] || [];
    const changes = [];

    if (!isCreate) {
      tracked.forEach((field) => {
        const touched =
          field in payload ||
          `${field}Id` in payload ||
          Object.keys(payload).some((k) => k.startsWith(field));
        if (!touched && beforeRaw) return;

        const oldText = fieldToText(sourceList, field, rawFieldValue(beforeRaw, field));
        const newText = fieldToText(sourceList, field, payloadFieldValue(payload, beforeRaw, field));
        if (oldText !== newText) {
          changes.push(
            buildChangeRow(projectNumber, sourceList, itemId, itemLabel, field, oldText, newText, 'Update')
          );
        }
      });
    }

    if (!isCreate && !changes.length) return { saved: false };

    const runUpdate = async () => {
      if (isCreate) {
        const result = await sp.createRecord(listTitle, payload);
        return result.data?.Id || result.data?.ID;
      }
      await sp.updateRecord(listTitle, itemId, payload);
      return itemId;
    };

    let newId;
    try {
      newId = await runUpdate();
    } catch (err) {
      try {
        newId = await runUpdate();
      } catch (err2) {
        throw err2;
      }
    }

    const logId = isCreate ? newId : itemId;
    if (isCreate) {
      await writeChangeLogRows(
        [buildChangeRow(projectNumber, sourceList, logId, itemLabel, '(all)', '', 'Created', 'Create')],
        state
      );
    } else if (changes.length) {
      await writeChangeLogRows(
        changes.map((c) => ({ ...c, [F.changeLog.itemId]: logId })),
        state
      );
    }

    const pid = resolveProjectId(sourceList, logId, payload, beforeRaw, state);

    if (pid && state) {
      const p = state.projects.find((x) => x.id === pid);
      if (p) {
        if (sourceList === 'Projects') {
          if (payload[F.projects.status] !== undefined) p.status = payload[F.projects.status];
          if (payload[F.projects.statusReason] !== undefined) p.statusReason = payload[F.projects.statusReason];
          if (payload[F.projects.stage] !== undefined) p.stage = payload[F.projects.stage];
        }
        await updateDerivedProjectFields(pid, state);
      }
    }

    return { saved: true, id: logId };
  }

  async function createProject(payload, state) {
    const projectNumber = payload[F.projects.projectNumber] || 'TBD-001';
    const title = payload[F.projects.title] || 'New project';
    const result = await saveItem({
      sourceList: 'Projects',
      listTitle: lists.projects,
      itemId: null,
      payload,
      beforeRaw: null,
      projectNumber,
      itemLabel: title,
      isCreate: true,
      state,
    });
    return result.id;
  }

  async function createNote(project, payload, state) {
    const text = payload[F.notes.text] || '';
    const result = await sp.createRecord(lists.notes, payload);
    const newId = result.data?.Id || result.data?.ID;
    await writeChangeLogRows(
      [
        buildChangeRow(
          project.projectNumber,
          'Notes',
          newId,
          'Note',
          'Text',
          '',
          String(text).slice(0, 200),
          'Create'
        ),
      ],
      state
    );
    await updateDerivedProjectFields(project.id, state);
    return newId;
  }

  async function deleteClosedProject(project, state) {
    if (!['Closed', 'Not awarded'].includes(project.status)) {
      throw new Error('Only Closed or Not awarded projects can be deleted.');
    }

    const subs = state.submissions.filter((s) => s.projectId === project.id);
    const efforts = state.efforts.filter((e) => e.projectId === project.id);

    for (const s of subs) {
      await sp.deleteRecord(lists.submissions, s.id);
      await writeChangeLogRows(
        [buildChangeRow(project.projectNumber, 'Submissions', s.id, s.type, '(item)', '', '', 'Delete')],
        state
      );
    }
    for (const e of efforts) {
      await sp.deleteRecord(lists.effortLog, e.id);
    }

    await sp.deleteRecord(lists.projects, project.id);
    await writeChangeLogRows(
      [buildChangeRow(project.projectNumber, 'Projects', project.id, project.title, '(item)', '', '', 'Delete')],
      state
    );
  }

  CET.save = {
    saveItem,
    createProject,
    createNote,
    updateDerivedProjectFields,
    deleteClosedProject,
    fieldToText,
    writeChangeLogRows,
    buildChangeRow,
  };
})(window.CyberEffortsTracker);
