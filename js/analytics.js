(function (CET) {
  const u = CET.utils;
  const rag = CET.rag;

  function getWeekBoundsForDue() {
    return u.getCurrentWeekBounds();
  }

  function submissionDueThisWeek(sub, bounds) {
    if (!sub.plannedDate || sub.actualDate) return false;
    if (sub.submissionStatus === 'Cancelled') return false;
    const t = sub.plannedDate.getTime();
    return t >= bounds.start.getTime() && t < bounds.end.getTime();
  }

  function submissionDueNext14Days(sub) {
    if (!sub.plannedDate || sub.actualDate) return false;
    if (sub.submissionStatus === 'Cancelled') return false;
    const today = u.startOfTodayRiyadh();
    const end = new Date(today);
    end.setDate(end.getDate() + 14);
    const t = sub.plannedDate.getTime();
    return t >= today.getTime() && t <= end.getTime();
  }

  function computeKPIs(state) {
    const week = getWeekBoundsForDue();
    const overdue = state.submissions.filter(rag.isSubmissionOverdue);
    const dueThisWeek = state.submissions.filter((s) => submissionDueThisWeek(s, week));
    const blockedProjects = state.projects.filter((p) => p.status === 'Blocked-client');
    const blockedDays = blockedProjects.map((p) => rag.daysBlocked(p));
    const avgBlocked =
      blockedDays.length > 0
        ? Math.round(blockedDays.reduce((a, b) => a + b, 0) / blockedDays.length)
        : 0;

    const unassigned = state.projects.filter(
      (p) =>
        p.status !== 'Closed' &&
        p.status !== 'Not awarded' &&
        (p.cyberPMDisplay === 'Unassigned' ||
          p.cyberProvisioned === 'Not assessed' ||
          u.isBlank(p.cyberProvisioned))
    );

    return {
      dueThisWeek: dueThisWeek.length,
      overdue: overdue.length,
      blocked: blockedProjects.length,
      avgBlockedDays: avgBlocked,
      unassigned: unassigned.length,
    };
  }

  function overdueRows(state) {
    const today = u.startOfTodayRiyadh();
    const rows = [];
    state.submissions.filter(rag.isSubmissionOverdue).forEach((sub) => {
      const project = state.projects.find((p) => p.id === sub.projectId);
      if (!project) return;
      const daysOverdue = Math.abs(u.daysBetween(sub.plannedDate, today) || 0);
      rows.push({ project, submission: sub, daysOverdue });
    });
    rows.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    return rows;
  }

  function next14DaysRows(state) {
    const rows = [];
    state.submissions.filter(submissionDueNext14Days).forEach((sub) => {
      const project = state.projects.find((p) => p.id === sub.projectId);
      if (!project) return;
      const today = u.startOfTodayRiyadh();
      const daysRemaining = u.daysBetween(today, sub.plannedDate);
      rows.push({
        project,
        submission: sub,
        daysRemaining,
      });
    });
    rows.sort(
      (a, b) => (a.submission.plannedDate || 0) - (b.submission.plannedDate || 0)
    );
    return rows;
  }

  function slippagePanel(changes, state, weeksBack) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (weeksBack || 8) * 7);
    const slips = changes
      .filter(
        (c) =>
          !c.suppressed &&
          c.sourceList === 'Submissions' &&
          c.field === 'PlannedDate' &&
          c.changedOn &&
          c.changedOn >= cutoff
      )
      .filter((c) => c.oldValue && c.newValue && c.newValue > c.oldValue);

    return slips.map((c) => {
      const sub = state.submissions.find((s) => s.id === c.itemId);
      const project = sub
        ? state.projects.find((p) => p.id === sub.projectId)
        : state.projects.find((p) => p.projectNumber === c.projectNumber);
      const oldD = u.parseDateOnly(c.oldValue);
      const newD = u.parseDateOnly(c.newValue);
      const weeks =
        oldD && newD ? Math.round((newD - oldD) / (7 * 86400000)) : null;
      return {
        project,
        type: sub ? sub.type : c.itemLabel,
        originalDate: c.oldValue,
        currentDate: c.newValue,
        weeksSlipped: weeks,
      };
    });
  }

  function effortByProject(state) {
    return state.projects
      .map((p) => {
        const consumed = rag.totalMMConsumed(state.efforts, p.id);
        const budget = p.budgetMM || 0;
        const pct = budget > 0 ? (consumed / budget) * 100 : 0;
        return { project: p, consumed, budget, pct };
      })
      .filter((r) => r.budget > 0 || r.consumed > 0)
      .sort((a, b) => b.pct - a.pct);
  }

  function loadByCyberPM(state, months) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months || 6) + 1, 1);
    const byPersonMonth = new Map();

    state.efforts.forEach((e) => {
      if (!e.month || e.month < start) return;
      const key = `${u.toDateKey(e.month)}|${e.personDisplay || 'Unassigned'}`;
      byPersonMonth.set(key, (byPersonMonth.get(key) || 0) + (e.mmConsumed || 0));
    });

    return byPersonMonth;
  }

  function blockedByClient(state) {
    return state.projects
      .filter((p) => p.status === 'Blocked-client')
      .map((p) => ({
        project: p,
        reason: p.statusReason || '—',
        blockedSince: p.blockedSince,
        days: rag.daysBlocked(p),
        cyberPM: p.cyberPMDisplay,
      }))
      .sort((a, b) => b.days - a.days);
  }

  function coverageGap(state) {
    const today = u.startOfTodayRiyadh();
    return state.projects
      .filter((p) => p.status === 'Active')
      .filter(
        (p) =>
          p.cyberPMDisplay === 'Unassigned' ||
          p.cyberProvisioned === 'Not assessed' ||
          p.cyberProvisioned === 'Pending'
      )
      .map((p) => {
        const created = p._raw?.Created ? u.parseDateOnly(p._raw.Created) : today;
        return { project: p, ageDays: u.daysBetween(created, today) || 0 };
      });
  }

  function ragBreakdown(state) {
    const counts = new Map();
    CET.CONFIG.ragOrder.forEach((r) => counts.set(r, 0));
    state.projects.forEach((p) => {
      if (p.status === 'Closed' || p.status === 'Not awarded') return;
      const r = p.rag && counts.has(p.rag) ? p.rag : 'Grey';
      counts.set(r, (counts.get(r) || 0) + 1);
    });
    return counts;
  }

  function statusBreakdown(state) {
    const counts = new Map();
    state.projects.forEach((p) => {
      if (p.status === 'Closed' || p.status === 'Not awarded') return;
      if (u.isBlank(p.status)) return;
      counts.set(p.status, (counts.get(p.status) || 0) + 1);
    });
    return counts;
  }

  function stageFunnel(state) {
    const order = CET.CONFIG.choices.stage;
    const counts = new Map();
    order.forEach((s) => counts.set(s, 0));
    state.projects.forEach((p) => {
      if (p.status !== 'Active') return;
      if (!counts.has(p.stage)) counts.set(p.stage, 0);
      counts.set(p.stage, counts.get(p.stage) + 1);
    });
    return order.map((stage) => ({ stage, count: counts.get(stage) || 0 }));
  }

  CET.analytics = {
    computeKPIs,
    overdueRows,
    next14DaysRows,
    slippagePanel,
    effortByProject,
    loadByCyberPM,
    blockedByClient,
    coverageGap,
    ragBreakdown,
    statusBreakdown,
    stageFunnel,
  };
})(window.CyberEffortsTracker);
