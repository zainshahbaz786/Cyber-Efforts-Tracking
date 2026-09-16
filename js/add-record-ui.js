(function (CET) {
  const F = CET.CONFIG.fields;
  const lists = CET.CONFIG.lists;
  const choices = CET.CONFIG.choices;
  const u = CET.utils;

  let handlers = {};
  let activeStep = 1;
  let selectedProjectId = null;

  function $(id) {
    return document.getElementById(id);
  }

  function fillSelect(sel, items, getValue, getLabel, placeholder) {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '';
    if (placeholder) {
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = placeholder;
      sel.appendChild(ph);
    }
    items.forEach((item) => {
      const o = document.createElement('option');
      o.value = getValue(item);
      o.textContent = getLabel(item);
      sel.appendChild(o);
    });
    if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
    else if (selectedProjectId) sel.value = String(selectedProjectId);
  }

  function populateChoiceSelect(sel, values, selected) {
    if (!sel) return;
    sel.innerHTML = values
      .map((v) => `<option value="${u.escapeHtml(v)}"${v === selected ? ' selected' : ''}>${u.escapeHtml(v)}</option>`)
      .join('');
  }

  function setStep(step) {
    activeStep = step;
    document.querySelectorAll('[data-add-step]').forEach((el) => {
      el.classList.toggle('hidden', Number(el.dataset.addStep) !== step);
    });
    document.querySelectorAll('[data-add-step-nav]').forEach((btn) => {
      const n = Number(btn.dataset.addStepNav);
      btn.classList.toggle('is-active', n === step);
      btn.setAttribute('aria-current', n === step ? 'step' : 'false');
    });
    const hint = $('add-record-step-hint');
    if (hint) {
      const texts = {
        1: 'Start here — every other record links to a project.',
        2: 'Add one or more milestones / submission deadlines for the project.',
        3: 'Log man-months by person and month (SharePoint EffortLog list).',
        4: 'Optional notes for risks, decisions, and updates.',
        5: 'ChangeLog rows are written automatically when you save — do not add them manually.',
      };
      hint.textContent = texts[step] || '';
    }
  }

  function refreshProjectPickers(state) {
    const projects = [...state.projects].sort((a, b) =>
      String(a.projectNumber).localeCompare(String(b.projectNumber))
    );
    const label = (p) => `${p.projectNumber} — ${u.plainText(p.title).slice(0, 48)}`;
    ['add-sub-project', 'add-effort-project', 'add-note-project'].forEach((id) => {
      fillSelect($(id), projects, (p) => String(p.id), label, 'Select a project…');
    });
    const statusEl = $('add-record-project-status');
    if (statusEl && selectedProjectId) {
      const p = projects.find((x) => x.id === selectedProjectId);
      statusEl.textContent = p
        ? `Working on: ${p.projectNumber} (ID ${p.id}). RAG is computed automatically after saves.`
        : '';
    }
  }

  function initStaticSelects() {
    populateChoiceSelect($('add-proj-stage'), choices.stage, 'Pre-Concept');
    populateChoiceSelect($('add-proj-status'), choices.status, 'Active');
    populateChoiceSelect($('add-proj-cyber-prov'), choices.cyberProvisioned, 'Not assessed');
    populateChoiceSelect($('add-sub-type'), choices.submissionType, choices.submissionType[0]);
    populateChoiceSelect($('add-sub-status'), choices.submissionStatus, 'Planned');
    populateChoiceSelect($('add-note-category'), choices.noteCategory, 'Internal');
  }

  function toggleStatusReason() {
    const status = $('add-proj-status')?.value;
    const wrap = $('add-proj-status-reason-wrap');
    if (!wrap) return;
    const need = ['Blocked-client', 'On hold'].includes(status);
    wrap.classList.toggle('hidden', !need);
    const input = $('add-proj-status-reason');
    if (input) input.required = need;
  }

  function bindStepNav() {
    document.querySelectorAll('[data-add-step-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = Number(btn.dataset.addStepNav);
        if (step > 1 && !selectedProjectId) {
          CET.ui.showToast('Create or select a project in step 1 first.', true);
          setStep(1);
          return;
        }
        setStep(step);
      });
    });
  }

  async function buildProjectPayload(formData) {
    const status = formData.get('status') || 'Active';
    const reason = formData.get('statusReason') || '';
    if (['Blocked-client', 'On hold'].includes(status) && u.isBlank(reason)) {
      throw new Error('Status reason is required when status is Blocked-client or On hold.');
    }

    const payload = {
      [F.projects.projectNumber]: formData.get('projectNumber') || 'TBD-001',
      [F.projects.title]: formData.get('title'),
      [F.projects.client]: formData.get('client') || '',
      [F.projects.stage]: formData.get('stage') || 'Pre-Concept',
      [F.projects.status]: status,
      [F.projects.cyberProvisioned]: formData.get('cyberProvisioned') || 'Not assessed',
    };
    if (!u.isBlank(reason)) {
      payload[F.projects.statusReason] = reason;
    }
    const budgetRaw = formData.get('budgetMM');
    if (budgetRaw !== null && String(budgetRaw).trim() !== '') {
      payload[F.projects.budgetMM] = Number(budgetRaw);
    }

    Object.assign(
      payload,
      await CET.projectUI.buildPersonPayload(F.projects.projectPM, formData.get('projectPM'), false)
    );
    Object.assign(
      payload,
      await CET.projectUI.buildPersonPayload(F.projects.dssPM, formData.get('projectOwner'), true)
    );
    Object.assign(
      payload,
      await CET.projectUI.buildPersonPayload(F.projects.cyberPM, formData.get('cyberPM'), true)
    );
    return payload;
  }

  async function onSubmitProject(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const description = String(formData.get('description') || '').trim();
    try {
      CET.ui.setLoading(true, 'Creating project…');
      const payload = await buildProjectPayload(formData);
      const id = await CET.save.createProject(payload, handlers.getState());
      await handlers.reloadData();
      selectedProjectId = id;
      await CET.save.updateDerivedProjectFields(id, handlers.getState());

      if (description) {
        const project = handlers.getState().projects.find((p) => p.id === id);
        if (project) {
          const notePayload = {
            [F.notes.projectId]: id,
            [F.notes.noteDate]: new Date().toISOString(),
            [F.notes.category]: 'Internal',
            [F.notes.text]: description,
          };
          const user = handlers.getState().currentUser;
          if (user?.Id) notePayload[`${F.notes.author}Id`] = user.Id;
          await CET.save.createNote(project, notePayload, handlers.getState());
          await handlers.reloadData();
        }
      }

      refreshProjectPickers(handlers.getState());
      form.reset();
      initStaticSelects();
      toggleStatusReason();
      CET.ui.showToast('Project created. ChangeLog entry added automatically.');
      setStep(2);
      if (handlers.onSaved) handlers.onSaved();
    } catch (err) {
      CET.ui.showToast(err.message || 'Could not create project', true);
    } finally {
      CET.ui.setLoading(false);
    }
  }

  async function onSubmitSubmission(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const projectId = Number(formData.get('projectId') || selectedProjectId);
    const project = handlers.getState().projects.find((p) => p.id === projectId);
    if (!project) {
      CET.ui.showToast('Select a project first.', true);
      return;
    }
    const planned = formData.get('plannedDate');
    if (!planned) {
      CET.ui.showToast('Due date is required.', true);
      return;
    }

    const desc = String(formData.get('description') || '').trim();
    const notes = String(formData.get('notes') || '').trim();
    const description = [desc, notes].filter(Boolean).join('\n\n');

    const payload = {
      [F.submissions.projectId]: projectId,
      [F.submissions.type]: formData.get('type'),
      [F.submissions.plannedDate]: new Date(planned).toISOString(),
      [F.submissions.submissionStatus]: formData.get('submissionStatus') || 'Planned',
      [F.submissions.description]: description,
      [F.submissions.reference]: formData.get('reference') || '',
    };
    Object.assign(
      payload,
      await CET.projectUI.buildPersonPayload(F.submissions.owner, formData.get('owner'), false)
    );

    try {
      CET.ui.setLoading(true, 'Adding submission…');
      await CET.save.saveItem({
        sourceList: 'Submissions',
        listTitle: lists.submissions,
        itemId: null,
        payload,
        beforeRaw: null,
        projectNumber: project.projectNumber,
        itemLabel: payload[F.submissions.type],
        isCreate: true,
        state: handlers.getState(),
      });
      await handlers.reloadData();
      await CET.save.updateDerivedProjectFields(projectId, handlers.getState());
      form.querySelector('[name=plannedDate]').value = '';
      form.querySelector('[name=description]').value = '';
      form.querySelector('[name=notes]').value = '';
      form.querySelector('[name=reference]').value = '';
      CET.ui.showToast('Submission added (ChangeLog created automatically).');
      if (handlers.onSaved) handlers.onSaved();
    } catch (err) {
      CET.ui.showToast(err.message || 'Could not add submission', true);
    } finally {
      CET.ui.setLoading(false);
    }
  }

  async function onSubmitEffort(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const projectId = Number(formData.get('projectId') || selectedProjectId);
    const project = handlers.getState().projects.find((p) => p.id === projectId);
    if (!project) {
      CET.ui.showToast('Select a project first.', true);
      return;
    }
    const monthStr = formData.get('month');
    if (!monthStr) {
      CET.ui.showToast('Month is required.', true);
      return;
    }
    const [y, m] = monthStr.split('-');
    const monthDate = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toISOString();
    const mm = Number(formData.get('mmConsumed'));
    if (!Number.isFinite(mm)) {
      CET.ui.showToast('Enter man-months as a number.', true);
      return;
    }

    const payload = {
      [F.effortLog.projectId]: projectId,
      [F.effortLog.month]: monthDate,
      [F.effortLog.mmConsumed]: mm,
    };
    Object.assign(
      payload,
      await CET.projectUI.buildPersonPayload(F.effortLog.person, formData.get('person'), false)
    );

    const comments = String(formData.get('comments') || '').trim();
    const activity = String(formData.get('activity') || '').trim();

    try {
      CET.ui.setLoading(true, 'Adding effort…');
      await CET.save.saveItem({
        sourceList: 'EffortLog',
        listTitle: lists.effortLog,
        itemId: null,
        payload,
        beforeRaw: null,
        projectNumber: project.projectNumber,
        itemLabel: monthStr,
        isCreate: true,
        state: handlers.getState(),
      });

      if (comments || activity) {
        const lines = [];
        if (activity) lines.push(`Activity: ${activity}`);
        if (comments) lines.push(comments);
        const notePayload = {
          [F.notes.projectId]: projectId,
          [F.notes.noteDate]: new Date().toISOString(),
          [F.notes.category]: 'Internal',
          [F.notes.text]: `Effort log note (${monthStr})\n${lines.join('\n')}`,
        };
        const user = handlers.getState().currentUser;
        if (user?.Id) notePayload[`${F.notes.author}Id`] = user.Id;
        await CET.save.createNote(project, notePayload, handlers.getState());
      }

      await handlers.reloadData();
      await CET.save.updateDerivedProjectFields(projectId, handlers.getState());
      form.querySelector('[name=mmConsumed]').value = '';
      form.querySelector('[name=comments]').value = '';
      form.querySelector('[name=activity]').value = '';
      CET.ui.showToast('Effort record added (ChangeLog created automatically).');
      if (handlers.onSaved) handlers.onSaved();
    } catch (err) {
      CET.ui.showToast(err.message || 'Could not add effort', true);
    } finally {
      CET.ui.setLoading(false);
    }
  }

  async function onSubmitNote(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const projectId = Number(formData.get('projectId') || selectedProjectId);
    const project = handlers.getState().projects.find((p) => p.id === projectId);
    if (!project) {
      CET.ui.showToast('Select a project first.', true);
      return;
    }
    const title = String(formData.get('noteTitle') || '').trim();
    const body = String(formData.get('noteText') || '').trim();
    if (!body && !title) {
      CET.ui.showToast('Enter a note description.', true);
      return;
    }
    const text = title ? `${title}\n\n${body}`.trim() : body;

    const payload = {
      [F.notes.projectId]: projectId,
      [F.notes.noteDate]: new Date().toISOString(),
      [F.notes.category]: formData.get('category') || 'Internal',
      [F.notes.text]: text,
    };
    const user = handlers.getState().currentUser;
    if (user?.Id) payload[`${F.notes.author}Id`] = user.Id;

    try {
      CET.ui.setLoading(true, 'Adding note…');
      await CET.save.createNote(project, payload, handlers.getState());
      await handlers.reloadData();
      form.reset();
      populateChoiceSelect($('add-note-category'), choices.noteCategory, 'Internal');
      fillSelect($('add-note-project'), handlers.getState().projects, (p) => String(p.id), (p) => `${p.projectNumber} — ${u.plainText(p.title).slice(0, 48)}`, 'Select a project…');
      if (selectedProjectId) $('add-note-project').value = String(selectedProjectId);
      CET.ui.showToast('Note added (ChangeLog created automatically).');
      if (handlers.onSaved) handlers.onSaved();
    } catch (err) {
      CET.ui.showToast(err.message || 'Could not add note', true);
    } finally {
      CET.ui.setLoading(false);
    }
  }

  function onUseExistingProject() {
    const sel = $('add-record-existing-project');
    const id = sel?.value ? Number(sel.value) : null;
    if (!id) {
      CET.ui.showToast('Choose a project from the list.', true);
      return;
    }
    selectedProjectId = id;
    refreshProjectPickers(handlers.getState());
    CET.ui.showToast('Project selected for steps 2–4.');
    setStep(2);
  }

  function bindForms() {
    $('form-add-record-project')?.addEventListener('submit', onSubmitProject);
    $('form-add-record-submission')?.addEventListener('submit', onSubmitSubmission);
    $('form-add-record-effort')?.addEventListener('submit', onSubmitEffort);
    $('form-add-record-note')?.addEventListener('submit', onSubmitNote);
    $('add-proj-status')?.addEventListener('change', toggleStatusReason);
    $('btn-add-record-use-project')?.addEventListener('click', onUseExistingProject);

    ['add-sub-project', 'add-effort-project', 'add-note-project'].forEach((id) => {
      $(id)?.addEventListener('change', (e) => {
        selectedProjectId = e.target.value ? Number(e.target.value) : selectedProjectId;
        refreshProjectPickers(handlers.getState());
      });
    });
  }

  function bind(h) {
    handlers = h;
    initStaticSelects();
    toggleStatusReason();
    bindStepNav();
    bindForms();
    setStep(1);
  }

  function refresh(state) {
    refreshProjectPickers(state);
    fillSelect(
      $('add-record-existing-project'),
      [...state.projects].sort((a, b) => String(a.projectNumber).localeCompare(String(b.projectNumber))),
      (p) => String(p.id),
      (p) => `${p.projectNumber} — ${u.plainText(p.title).slice(0, 56)}`,
      'Use an existing project…'
    );
    const user = state.currentUser;
    const authorHint = $('add-note-author-hint');
    if (authorHint && user) {
      authorHint.textContent = user.Title || user.Email || 'Current signed-in user';
    }
  }

  CET.addRecordUI = { bind, refresh, setStep };
})(window.CyberEffortsTracker);
