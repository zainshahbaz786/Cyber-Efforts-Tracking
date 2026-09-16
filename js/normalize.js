(function (CET) {
  const { CONFIG } = CET;
  const u = CET.utils;
  const F = CONFIG.fields;
  const r = () => CET.fieldResolver;

  function unwrapPerson(value) {
    if (value && typeof value === 'object' && Array.isArray(value.results)) return value.results;
    if (typeof value === 'number') return { Title: `User #${value}` };
    if (Array.isArray(value) && value.every((x) => typeof x === 'number')) {
      return value.map((id) => ({ Title: `User #${id}` }));
    }
    return value;
  }

  function rawVal(raw, section, logicalKey) {
    const internal = F[section][logicalKey];
    return r().getRawField(raw, logicalKey, internal);
  }

  function lookupId(raw, section, logicalKey) {
    const f = F[section];
    return r().getLookupIdFromRaw(raw, logicalKey, f[logicalKey], f.project || f[logicalKey]);
  }

  function personVal(raw, section, logicalKey) {
    const internal = F[section][logicalKey];
    let val = r().getRawField(raw, logicalKey, internal);
    if (val === undefined) {
      const idField = internal.endsWith('Id') ? internal : `${internal}Id`;
      val = r().getRawField(raw, `${logicalKey}Id`, idField);
    }
    return unwrapPerson(val);
  }

  function getLookupId(item, idField, lookupField) {
    if (item[idField] != null) return Number(item[idField]);
    if (item[lookupField] && item[lookupField].Id != null) return Number(item[lookupField].Id);
    return null;
  }

  function normalizeProject(raw) {
    return {
      id: raw.Id,
      projectNumber: u.displayOr(rawVal(raw, 'projects', 'projectNumber'), 'TBD'),
      title: u.displayOr(rawVal(raw, 'projects', 'title'), '(Untitled)'),
      client: u.displayOr(rawVal(raw, 'projects', 'client'), 'Unassigned'),
      stage: u.displayOr(rawVal(raw, 'projects', 'stage'), ''),
      status: u.displayOr(rawVal(raw, 'projects', 'status'), ''),
      statusReason: u.plainText(rawVal(raw, 'projects', 'statusReason') || ''),
      blockedSince: u.parseDateOnly(rawVal(raw, 'projects', 'blockedSince')),
      cyberProvisioned: u.isBlank(rawVal(raw, 'projects', 'cyberProvisioned'))
        ? 'Not assessed'
        : String(rawVal(raw, 'projects', 'cyberProvisioned')).trim(),
      cyberPM: personVal(raw, 'projects', 'cyberPM'),
      cyberPMDisplay: u.displayOr(u.personDisplay(personVal(raw, 'projects', 'cyberPM')), 'Unassigned'),
      dssPM: personVal(raw, 'projects', 'dssPM'),
      dssPMDisplay: u.displayOr(u.personDisplay(personVal(raw, 'projects', 'dssPM')), 'Unassigned'),
      projectPM: personVal(raw, 'projects', 'projectPM'),
      projectPMDisplay: u.displayOr(u.personDisplay(personVal(raw, 'projects', 'projectPM')), 'Unassigned'),
      budgetMM:
        rawVal(raw, 'projects', 'budgetMM') != null ? Number(rawVal(raw, 'projects', 'budgetMM')) : null,
      nextSubmissionDate: u.parseDateOnly(rawVal(raw, 'projects', 'nextSubmissionDate')),
      nextSubmissionType: u.displayOr(rawVal(raw, 'projects', 'nextSubmissionType'), ''),
      rag: u.displayOr(rawVal(raw, 'projects', 'rag'), 'Grey'),
      latestNote: u.plainText(rawVal(raw, 'projects', 'latestNote') || ''),
      _raw: raw,
    };
  }

  function normalizeSubmission(raw) {
    const planned = u.parseDateOnly(rawVal(raw, 'submissions', 'plannedDate'));
    const actual = u.parseDateOnly(rawVal(raw, 'submissions', 'actualDate'));
    const owner = personVal(raw, 'submissions', 'owner');
    return {
      id: raw.Id,
      projectId: lookupId(raw, 'submissions', 'projectId') || lookupId(raw, 'submissions', 'project'),
      type: u.displayOr(rawVal(raw, 'submissions', 'type'), ''),
      description: u.displayOr(rawVal(raw, 'submissions', 'description'), ''),
      plannedDate: planned,
      actualDate: actual,
      submissionStatus: u.displayOr(rawVal(raw, 'submissions', 'submissionStatus'), 'Planned'),
      owner,
      ownerDisplay: u.displayOr(u.personDisplay(owner), 'Unassigned'),
      reference: u.displayOr(rawVal(raw, 'submissions', 'reference'), ''),
      _raw: raw,
    };
  }

  function normalizeEffort(raw) {
    const person = personVal(raw, 'effortLog', 'person');
    return {
      id: raw.Id,
      projectId: lookupId(raw, 'effortLog', 'projectId') || lookupId(raw, 'effortLog', 'project'),
      month: u.parseDateOnly(rawVal(raw, 'effortLog', 'month')),
      person,
      personDisplay: u.displayOr(u.personDisplay(person), 'Unassigned'),
      mmConsumed:
        rawVal(raw, 'effortLog', 'mmConsumed') != null ? Number(rawVal(raw, 'effortLog', 'mmConsumed')) : 0,
      _raw: raw,
    };
  }

  function normalizeNote(raw) {
    const author = personVal(raw, 'notes', 'author');
    return {
      id: raw.Id,
      projectId: lookupId(raw, 'notes', 'projectId') || lookupId(raw, 'notes', 'project'),
      noteDate: u.parseDateOnly(rawVal(raw, 'notes', 'noteDate')),
      author,
      authorDisplay: u.displayOr(u.personDisplay(author), ''),
      category: u.displayOr(rawVal(raw, 'notes', 'category'), 'Internal'),
      text: u.plainText(rawVal(raw, 'notes', 'text') || ''),
      _raw: raw,
    };
  }

  function normalizeChange(raw) {
    const changedBy = personVal(raw, 'changeLog', 'changedBy');
    const itemIdRaw = rawVal(raw, 'changeLog', 'itemId');
    return {
      id: raw.Id,
      projectNumber: u.displayOr(rawVal(raw, 'changeLog', 'projectNumber'), ''),
      sourceList: u.displayOr(rawVal(raw, 'changeLog', 'sourceList'), ''),
      itemId: itemIdRaw != null ? Number(itemIdRaw) : null,
      itemLabel: u.displayOr(rawVal(raw, 'changeLog', 'itemLabel'), ''),
      field: u.displayOr(rawVal(raw, 'changeLog', 'field'), ''),
      oldValue: u.plainText(rawVal(raw, 'changeLog', 'oldValue') || ''),
      newValue: u.plainText(rawVal(raw, 'changeLog', 'newValue') || ''),
      changeType: u.displayOr(rawVal(raw, 'changeLog', 'changeType'), ''),
      changedOn: u.parseDateOnly(rawVal(raw, 'changeLog', 'changedOn')),
      changedBy,
      changedByDisplay: u.displayOr(u.personDisplay(changedBy), ''),
      suppressed:
        rawVal(raw, 'changeLog', 'suppressed') === true ||
        rawVal(raw, 'changeLog', 'suppressed') === 'Yes',
      _raw: raw,
    };
  }

  CET.normalize = {
    project: normalizeProject,
    submission: normalizeSubmission,
    effort: normalizeEffort,
    note: normalizeNote,
    change: normalizeChange,
    getLookupId,
  };
})(window.CyberEffortsTracker);
