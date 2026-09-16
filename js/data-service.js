(function (CET) {
  const { CONFIG } = CET;
  const sp = CET.sp;
  const norm = CET.normalize;
  const lists = CONFIG.lists;

  const state = {
    projects: [],
    submissions: [],
    efforts: [],
    notes: [],
    changes: [],
    currentUser: null,
    loading: false,
    error: null,
    lastLoaded: null,
    webUrl: null,
  };

  async function loadList(key, listTitle, onProgress) {
    const items = await sp.readRecordsSimple(listTitle);
    if (onProgress) onProgress(key, items.length);
    return items;
  }

  async function loadAll(onProgress) {
    state.loading = true;
    state.error = null;
    state.webUrl = sp.getWebUrl();

    try {
      state.currentUser = await sp.getCurrentUser();

      const rawProjects = await loadList('Projects', lists.projects, onProgress);
      const rawSubs = await loadList('Submissions', lists.submissions, onProgress);
      const rawEfforts = await loadList('EffortLog', lists.effortLog, onProgress);
      const rawNotes = await loadList('Notes', lists.notes, onProgress);
      const rawChanges = await loadList('ChangeLog', lists.changeLog, onProgress);

      state.projects = rawProjects.map(norm.project);
      state.submissions = rawSubs.map(norm.submission);
      state.efforts = rawEfforts.map(norm.effort);
      state.notes = rawNotes.map(norm.note);
      state.changes = rawChanges.map(norm.change);
      state.lastLoaded = new Date();

      state.projects.forEach((p) => {
        const computed = CET.rag.computeRAG(p, state.submissions, state.efforts);
        if (!p.rag || p.rag === 'Grey') p.rag = computed.rag;
        p.ragReason = computed.reason;
      });

      console.info(
        `[CyberEffortsTracker] Loaded from ${state.webUrl}: Projects=${state.projects.length}, Submissions=${state.submissions.length}, EffortLog=${state.efforts.length}, Notes=${state.notes.length}, ChangeLog=${state.changes.length}`
      );
    } catch (err) {
      state.error = err.message || String(err);
      throw err;
    } finally {
      state.loading = false;
    }
    return state;
  }

  function getProjectById(id) {
    return state.projects.find((p) => p.id === Number(id));
  }

  function getProjectByNumber(num) {
    return state.projects.find((p) => p.projectNumber === num);
  }

  function submissionsForProject(projectId) {
    return state.submissions.filter((s) => s.projectId === Number(projectId));
  }

  function effortsForProject(projectId) {
    return state.efforts.filter((e) => e.projectId === Number(projectId));
  }

  function notesForProject(projectId) {
    return state.notes.filter((n) => n.projectId === Number(projectId));
  }

  function changesForProject(projectNumber) {
    return state.changes.filter((c) => c.projectNumber === projectNumber);
  }

  CET.data = {
    state,
    loadAll,
    getProjectById,
    getProjectByNumber,
    submissionsForProject,
    effortsForProject,
    notesForProject,
    changesForProject,
  };
})(window.CyberEffortsTracker);
