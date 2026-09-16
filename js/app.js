(function (CET) {
  const ui = CET.ui;
  const data = CET.data;
  const F = CET.CONFIG.fields;
  const lists = CET.CONFIG.lists;
  const save = CET.save;

  CET.appState = {
    weekOffset: 0,
    chartFilter: null,
    visibleColumns: ui.defaultColumns(),
    currentProjectId: null,
    mainTab: 'dashboard',
  };

  function showView(name) {
    document.querySelectorAll('.view-panel[data-view]').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.view !== name);
    });
  }

  function closeProjectDrawer() {
    const drawer = ui.$('project-drawer');
    if (drawer) {
      drawer.classList.add('hidden');
      drawer.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('drawer-open');
    CET.appState.currentProjectId = null;
  }

  function bindProjectDrawer() {
    const backdrop = ui.$('project-drawer-backdrop');
    const closeBtn = ui.$('project-drawer-close');
    if (backdrop) backdrop.addEventListener('click', closeProjectDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeProjectDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ui.$('project-drawer')?.classList.contains('hidden')) {
        closeProjectDrawer();
      }
    });
  }

  function projectHandlers() {
    return {
      onBack: closeProjectDrawer,
      onSaveOverview: handleOverviewSave,
      onDeleteProject: handleDeleteProject,
      onAddSubmission: handleAddSubmission,
      onMarkSubmitted: handleMarkSubmitted,
      onAddEffort: handleAddEffort,
      onAddNote: handleAddNote,
      onUpdateSubmission: handleUpdateSubmission,
      onUpdateEffort: handleUpdateEffort,
    };
  }

  function renderProjectInDrawer(id) {
    const project = data.getProjectById(id);
    if (!project) return;
    const titleEl = ui.$('project-drawer-title');
    if (titleEl) {
      titleEl.textContent = `${project.projectNumber} — ${CET.utils.plainText(project.title)}`;
    }
    CET.projectUI.renderProjectPage(project, data.state, projectHandlers());
  }

  function goToProjectsWithFilter(filter) {
    CET.appState.chartFilter = filter;
    navigateTo('projects');
  }

  function navigateTo(tab) {
    CET.appState.mainTab = tab;
    location.hash = `#${tab}`;
  }

  function refreshExportMeta() {
    const bounds = CET.utils.getRiyadhWeekBounds(new Date(), CET.appState.weekOffset);
    const gen = ui.$('export-meta');
    if (gen) {
      gen.textContent = `Week: ${CET.utils.formatWeekLabel(bounds)} · Generated ${CET.utils.formatDateTimeRiyadh(
        new Date()
      )} (Riyadh)`;
    }
  }

  function refreshDashboard() {
    const state = data.state;
    ui.renderKPIs(CET.analytics.computeKPIs(state));

    const bounds = CET.utils.getRiyadhWeekBounds(new Date(), CET.appState.weekOffset);
    const sections = CET.changePanel.buildChangeSections(state.changes, state.efforts, bounds);
    ui.renderChangePanel(sections, CET.utils.formatWeekLabel(bounds), (projectNumber) => {
      const p = data.getProjectByNumber(projectNumber);
      if (p) openProject(p.id);
    });

    ui.renderOverdueTable(CET.analytics.overdueRows(state), openProject);
    ui.renderNext14Table(CET.analytics.next14DaysRows(state), openProject);
    refreshExportMeta();
  }

  function refreshProjects() {
    const state = data.state;
    ui.renderFilterChips(CET.appState.chartFilter, () => {
      CET.appState.chartFilter = null;
      refreshProjects();
    });
    ui.renderProjectTable(
      state.projects,
      state.efforts,
      ui.getTableFilters(),
      state.currentUser,
      openProject,
      handleInlineEdit
    );
  }

  function refreshInsights() {
    CET.insightsUI.render(data.state, {
      onFilter: (filter) => goToProjectsWithFilter(filter),
      onOpenProject: (id) => openProject(id),
    });
  }

  function refreshAddRecord() {
    CET.addRecordUI.refresh(data.state);
  }

  function refreshCurrentView() {
    const tab = CET.appState.mainTab;
    if (tab === 'dashboard') refreshDashboard();
    else if (tab === 'projects') refreshProjects();
    else if (tab === 'insights') refreshInsights();
    else if (tab === 'add-record') refreshAddRecord();
  }

  function openProject(id) {
    CET.appState.currentProjectId = Number(id);
    const drawer = ui.$('project-drawer');
    if (drawer) {
      drawer.classList.remove('hidden');
      drawer.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('drawer-open');
    renderProjectInDrawer(Number(id));
  }

  function validateStatusReason(status, reason) {
    if (['Blocked-client', 'On hold'].includes(status) && CET.utils.isBlank(reason)) {
      ui.showToast('Status reason is required when status is Blocked-client or On hold.', true);
      return false;
    }
    return true;
  }

  async function handleInlineEdit(el) {
    const id = Number(el.dataset.id);
    const field = el.dataset.edit;
    const project = data.getProjectById(id);
    if (!project) return;

    try {
      ui.setLoading(true, 'Saving…');
      let payload = {};
      const value = el.value;

      if (field === 'status') {
        const reasonEl = document.querySelector(`input[data-edit="statusReason"][data-id="${id}"]`);
        const reason = reasonEl ? reasonEl.value : project.statusReason;
        if (!validateStatusReason(value, reason)) return;
        payload[F.projects.status] = value;
      } else if (field === 'statusReason') {
        payload[F.projects.statusReason] = value;
      } else if (field === 'cyberProvisioned') {
        payload[F.projects.cyberProvisioned] = value;
      } else if (field === 'cyberPM') {
        const personPayload = await CET.projectUI.buildPersonPayload(F.projects.cyberPM, value, true);
        payload = personPayload;
      }

      await save.saveItem({
        sourceList: 'Projects',
        listTitle: lists.projects,
        itemId: project.id,
        payload,
        beforeRaw: project._raw,
        projectNumber: project.projectNumber,
        itemLabel: project.title,
        isCreate: false,
        state: data.state,
      });

      await data.loadAll();
      refreshCurrentView();
      ui.showToast('Project updated.');
    } catch (err) {
      ui.showToast(err.message || 'Save failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleOverviewSave(project, values) {
    if (!validateStatusReason(values.status, values.statusReason)) return;
    try {
      ui.setLoading(true, 'Saving project…');
      const payload = {
        [F.projects.title]: values.title,
        [F.projects.client]: values.client,
        [F.projects.stage]: values.stage,
        [F.projects.status]: values.status,
        [F.projects.statusReason]: values.statusReason,
        [F.projects.cyberProvisioned]: values.cyberProvisioned,
        [F.projects.budgetMM]: values.budgetMM ? Number(values.budgetMM) : null,
      };
      Object.assign(payload, await CET.projectUI.buildPersonPayload(F.projects.cyberPM, values.cyberPM, true));
      Object.assign(payload, await CET.projectUI.buildPersonPayload(F.projects.dssPM, values.dssPM, true));
      Object.assign(payload, await CET.projectUI.buildPersonPayload(F.projects.projectPM, values.projectPM, false));

      await save.saveItem({
        sourceList: 'Projects',
        listTitle: lists.projects,
        itemId: project.id,
        payload,
        beforeRaw: project._raw,
        projectNumber: project.projectNumber,
        itemLabel: project.title,
        isCreate: false,
        state: data.state,
      });
      await data.loadAll();
      renderProjectInDrawer(project.id);
      ui.showToast('Overview saved.');
    } catch (err) {
      ui.showToast(err.message || 'Save failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleDeleteProject(project) {
    if (!confirm(`Delete project ${project.projectNumber}? This removes submissions and effort rows.`)) return;
    try {
      ui.setLoading(true, 'Deleting…');
      await save.deleteClosedProject(project, data.state);
      await data.loadAll();
      closeProjectDrawer();
      refreshProjects();
      ui.showToast('Project deleted.');
    } catch (err) {
      ui.showToast(err.message || 'Delete failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleAddSubmission(project, formData) {
    const planned = formData.get('plannedDate');
    const payload = {
      [F.submissions.projectId]: project.id,
      [F.submissions.type]: formData.get('type'),
      [F.submissions.plannedDate]: new Date(planned).toISOString(),
      [F.submissions.submissionStatus]: formData.get('submissionStatus'),
    };
    try {
      ui.setLoading(true, 'Adding milestone…');
      await save.saveItem({
        sourceList: 'Submissions',
        listTitle: lists.submissions,
        itemId: null,
        payload,
        beforeRaw: null,
        projectNumber: project.projectNumber,
        itemLabel: payload[F.submissions.type],
        isCreate: true,
        state: data.state,
      });
      await data.loadAll();
      await save.updateDerivedProjectFields(project.id, data.state);
      renderProjectInDrawer(project.id);
      ui.showToast('Milestone added.');
    } catch (err) {
      ui.showToast(err.message || 'Failed to add submission', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleUpdateSubmission(project, sub, values) {
    const payload = {
      [F.submissions.type]: values.type,
      [F.submissions.plannedDate]: values.plannedDate
        ? new Date(values.plannedDate).toISOString()
        : null,
      [F.submissions.submissionStatus]: values.submissionStatus,
    };
    if (values.owner) {
      Object.assign(
        payload,
        await CET.projectUI.buildPersonPayload(F.submissions.owner, values.owner, false)
      );
    }
    try {
      ui.setLoading(true, 'Saving milestone…');
      await save.saveItem({
        sourceList: 'Submissions',
        listTitle: lists.submissions,
        itemId: sub.id,
        payload,
        beforeRaw: sub._raw,
        projectNumber: project.projectNumber,
        itemLabel: sub.type,
        isCreate: false,
        state: data.state,
      });
      await data.loadAll();
      await save.updateDerivedProjectFields(project.id, data.state);
      renderProjectInDrawer(project.id);
      ui.showToast('Milestone updated.');
    } catch (err) {
      ui.showToast(err.message || 'Update failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleMarkSubmitted(project, sub) {
    const today = CET.utils.startOfTodayRiyadh().toISOString();
    const payload = {
      [F.submissions.actualDate]: today,
      [F.submissions.submissionStatus]: 'Submitted',
    };
    try {
      ui.setLoading(true, 'Marking submitted…');
      await save.saveItem({
        sourceList: 'Submissions',
        listTitle: lists.submissions,
        itemId: sub.id,
        payload,
        beforeRaw: sub._raw,
        projectNumber: project.projectNumber,
        itemLabel: sub.type,
        isCreate: false,
        state: data.state,
      });
      await data.loadAll();
      renderProjectInDrawer(project.id);
      ui.showToast('Submission marked submitted.');
    } catch (err) {
      ui.showToast(err.message || 'Update failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleAddEffort(project, formData) {
    const monthStr = formData.get('month');
    const [y, m] = monthStr.split('-');
    const monthDate = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toISOString();
    const mm = Number(formData.get('mm'));
    const payload = {
      [F.effortLog.projectId]: project.id,
      [F.effortLog.month]: monthDate,
      [F.effortLog.mmConsumed]: mm,
    };
    const personEmail = formData.get('person');
    if (personEmail) {
      Object.assign(
        payload,
        await CET.projectUI.buildPersonPayload(F.effortLog.person, personEmail, false)
      );
    }
    try {
      ui.setLoading(true, 'Adding effort…');
      await save.saveItem({
        sourceList: 'EffortLog',
        listTitle: lists.effortLog,
        itemId: null,
        payload,
        beforeRaw: null,
        projectNumber: project.projectNumber,
        itemLabel: monthStr,
        isCreate: true,
        state: data.state,
      });
      await data.loadAll();
      await save.updateDerivedProjectFields(project.id, data.state);
      renderProjectInDrawer(project.id);
      ui.showToast('Effort row added.');
    } catch (err) {
      ui.showToast(err.message || 'Failed to add effort', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleUpdateEffort(project, effort, mm) {
    const payload = { [F.effortLog.mmConsumed]: mm };
    try {
      ui.setLoading(true, 'Saving effort…');
      await save.saveItem({
        sourceList: 'EffortLog',
        listTitle: lists.effortLog,
        itemId: effort.id,
        payload,
        beforeRaw: effort._raw,
        projectNumber: project.projectNumber,
        itemLabel: CET.utils.formatDateRiyadh(effort.month),
        isCreate: false,
        state: data.state,
      });
      await data.loadAll();
      await save.updateDerivedProjectFields(project.id, data.state);
      renderProjectInDrawer(project.id);
      ui.showToast('Effort updated.');
    } catch (err) {
      ui.showToast(err.message || 'Update failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleAddNote(project, formData) {
    const text = formData.get('text');
    const payload = {
      [F.notes.projectId]: project.id,
      [F.notes.noteDate]: new Date().toISOString(),
      [F.notes.category]: formData.get('category'),
      [F.notes.text]: text,
    };
    const user = data.state.currentUser;
    if (user?.Id) payload[`${F.notes.author}Id`] = user.Id;
    try {
      ui.setLoading(true, 'Adding note…');
      await save.createNote(project, payload, data.state);
      await data.loadAll();
      renderProjectInDrawer(project.id);
      ui.showToast('Note added (cannot be edited or deleted).');
    } catch (err) {
      ui.showToast(err.message || 'Failed to add note', true);
    } finally {
      ui.setLoading(false);
    }
  }

  async function handleCreateProject(formData) {
    const payload = {
      [F.projects.projectNumber]: formData.get('projectNumber') || 'TBD-001',
      [F.projects.title]: formData.get('title'),
      [F.projects.client]: formData.get('client') || '',
      [F.projects.stage]: formData.get('stage') || 'Pre-Concept',
      [F.projects.status]: formData.get('status') || 'Active',
      [F.projects.cyberProvisioned]: 'Not assessed',
    };
    const budgetRaw = formData.get('budgetMM');
    if (budgetRaw !== null && String(budgetRaw).trim() !== '') {
      payload[F.projects.budgetMM] = Number(budgetRaw);
    }
    Object.assign(
      payload,
      await CET.projectUI.buildPersonPayload(F.projects.cyberPM, formData.get('cyberPM'), true)
    );
    try {
      ui.setLoading(true, 'Creating project…');
      const id = await save.createProject(payload, data.state);
      await data.loadAll();
      await save.updateDerivedProjectFields(id, data.state);
      ui.$('new-project-dialog').close();
      navigateTo('projects');
      refreshProjects();
      openProject(id);
      ui.showToast('Project created.');
    } catch (err) {
      ui.showToast(err.message || 'Create failed', true);
    } finally {
      ui.setLoading(false);
    }
  }

  function bindDashboardControls() {
    ui.$('btn-refresh').addEventListener('click', async () => {
      try {
        ui.setLoading(true, 'Refreshing data…');
        await data.loadAll();
        refreshCurrentView();
      } catch (err) {
        ui.showToast(err.message || 'Refresh failed', true);
      } finally {
        ui.setLoading(false);
      }
    });

    ui.$('week-prev').addEventListener('click', () => {
      CET.appState.weekOffset -= 1;
      refreshDashboard();
      refreshExportMeta();
    });
    ui.$('week-next').addEventListener('click', () => {
      CET.appState.weekOffset += 1;
      refreshDashboard();
      refreshExportMeta();
    });
    ui.$('week-reset').addEventListener('click', () => {
      CET.appState.weekOffset = 0;
      refreshDashboard();
      refreshExportMeta();
    });

    document.querySelectorAll('.main-tab').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.nav));
    });

    ['filter-status', 'filter-stage', 'filter-rag', 'filter-cyber-prov', 'filter-client', 'filter-title', 'filter-cyber-pm', 'filter-my-projects'].forEach(
      (id) => {
        const el = ui.$(id);
        if (el) el.addEventListener('change', refreshProjects);
        if (el && el.tagName === 'INPUT') el.addEventListener('input', refreshProjects);
      }
    );

    ui.$('btn-export-print').addEventListener('click', () => window.print());

    ui.$('btn-export-pdf').addEventListener('click', async () => {
      try {
        ui.setLoading(true, 'Building weekly PDF…');
        await CET.weeklyExport.downloadPdf(data.state, CET.appState.weekOffset);
        ui.showToast('Weekly PDF downloaded.');
      } catch (err) {
        ui.showToast(err.message || 'PDF export failed — try Print instead.', true);
      } finally {
        ui.setLoading(false);
      }
    });

    const newDlg = ui.$('new-project-dialog');
    const newForm = ui.$('form-new-project');
    if (newForm) {
      const stageSel = newForm.querySelector('[name=stage]');
      const statusSel = newForm.querySelector('[name=status]');
      CET.CONFIG.choices.stage.forEach((s) => {
        const o = document.createElement('option');
        o.textContent = s;
        stageSel.appendChild(o);
      });
      CET.CONFIG.choices.status.forEach((s) => {
        const o = document.createElement('option');
        o.textContent = s;
        statusSel.appendChild(o);
      });
      ui.$('btn-new-project').addEventListener('click', () => newDlg.showModal());
      newForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleCreateProject(new FormData(newForm));
      });
    }

    ui.$('btn-column-picker').addEventListener('click', () => {
      const dlg = ui.$('column-picker-dialog');
      const box = ui.$('column-picker-options');
      const optional = ui.optionalColumns();
      const selected = new Set(CET.appState.visibleColumns.map((c) => c.id));
      box.innerHTML = [...ui.defaultColumns(), ...optional]
        .map(
          (c) => `<label class="flex items-center gap-2 text-sm">
          <input type="checkbox" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''} ${ui.defaultColumns().some((d) => d.id === c.id) ? 'checked disabled' : ''} />
          ${CET.utils.escapeHtml(c.label)}
        </label>`
        )
        .join('');
      dlg.showModal();
    });

    ui.$('column-picker-apply').addEventListener('click', () => {
      const defaults = ui.defaultColumns();
      const optional = ui.optionalColumns();
      const all = [...defaults, ...optional];
      const checked = [...ui.$('column-picker-options').querySelectorAll('input:checked')].map((i) => i.value);
      CET.appState.visibleColumns = all.filter((c) => checked.includes(c.id));
      ui.$('column-picker-dialog').close();
      refreshProjects();
    });

    populateFilterDropdowns();
    CET.insightsUI.bindSlippageControls(() => {
      if (CET.appState.mainTab === 'insights') refreshInsights();
    });
  }

  function populateFilterDropdowns() {
    const status = ui.$('filter-status');
    const stage = ui.$('filter-stage');
    const rag = ui.$('filter-rag');
    const prov = ui.$('filter-cyber-prov');
    const addOpts = (sel, choices) => {
      choices.forEach((c) => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        sel.appendChild(o);
      });
    };
    addOpts(status, CET.CONFIG.choices.status);
    addOpts(stage, CET.CONFIG.choices.stage);
    addOpts(rag, CET.CONFIG.ragOrder);
    addOpts(prov, CET.CONFIG.choices.cyberProvisioned);
  }

  function handleRoute() {
    const hash = location.hash || '#dashboard';
    if (hash.startsWith('#project/')) {
      const id = Number(hash.split('/')[1]);
      const tab = CET.appState.mainTab || 'projects';
      if (typeof history.replaceState === 'function') {
        history.replaceState(null, '', `#${tab}`);
      } else {
        location.hash = `#${tab}`;
      }
      CET.appState.mainTab = tab;
      showView(tab);
      ui.setActiveMainTab(tab);
      openProject(id);
      return;
    }

    const tab = hash.replace('#', '') || 'dashboard';
    const allowed = ['dashboard', 'projects', 'insights', 'add-record'];
    const active = allowed.includes(tab) ? tab : 'dashboard';
    CET.appState.mainTab = active;
    showView(active);
    ui.setActiveMainTab(active);

    if (active === 'dashboard') refreshDashboard();
    else if (active === 'projects') refreshProjects();
    else if (active === 'insights') {
      requestAnimationFrame(() => refreshInsights());
    } else if (active === 'add-record') {
      refreshAddRecord();
    }
  }

  async function init() {
    bindDashboardControls();
    bindProjectDrawer();
    CET.addRecordUI.bind({
      getState: () => data.state,
      reloadData: () => data.loadAll(),
      onSaved: () => refreshCurrentView(),
    });
    window.addEventListener('hashchange', handleRoute);

    try {
      ui.setLoading(true, 'Loading SharePoint data…');
      await data.loadAll((list, count) => {
        ui.setLoading(true, `Loaded ${list}: ${count} items…`);
      });
      handleRoute();
    } catch (err) {
      const web = CET.sp.getWebUrl();
      const msg = `${err.message || err} (web: ${web}). Run CyberEffortsTracker.diagnoseLists() in the console.`;
      ui.showToast(msg, true);
      ui.$('load-error').textContent = msg;
      ui.$('load-error').classList.remove('hidden');
    } finally {
      ui.setLoading(false);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.CyberEffortsTracker);
