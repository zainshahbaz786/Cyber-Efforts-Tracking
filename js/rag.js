(function (CET) {
  const u = CET.utils;

  const GREY_STATUS = new Set(['Pending kickoff', 'On hold', 'Not awarded', 'Closed']);
  const PRE_DD_STAGES = new Set([
    'Pre-Concept',
    'Concept',
    'Schematic Design',
    'Gap Assessment',
    'Other',
  ]);

  function isSubmissionOverdue(sub) {
    if (!sub.plannedDate || sub.actualDate) return false;
    if (sub.submissionStatus === 'Cancelled') return false;
    const today = u.startOfTodayRiyadh();
    const planned = new Date(sub.plannedDate);
    planned.setHours(0, 0, 0, 0);
    return planned < today;
  }

  function isDueWithinDays(sub, days) {
    if (!sub.plannedDate || sub.actualDate) return false;
    if (sub.submissionStatus === 'Cancelled') return false;
    const today = u.startOfTodayRiyadh();
    const planned = new Date(sub.plannedDate);
    planned.setHours(0, 0, 0, 0);
    const diff = u.daysBetween(today, planned);
    return diff !== null && diff >= 0 && diff <= days;
  }

  function daysBlocked(project) {
    if (project.status !== 'Blocked-client' || !project.blockedSince) return 0;
    const today = u.startOfTodayRiyadh();
    return Math.max(0, u.daysBetween(project.blockedSince, today) || 0);
  }

  function totalMMConsumed(efforts, projectId) {
    return efforts
      .filter((e) => e.projectId === projectId)
      .reduce((sum, e) => sum + (e.mmConsumed || 0), 0);
  }

  function computeRAG(project, submissions, efforts) {
    const projectSubs = submissions.filter((s) => s.projectId === project.id);
    const reasons = [];

    if (projectSubs.some(isSubmissionOverdue)) {
      reasons.push('At least one submission is overdue.');
    }
    const blockedDays = daysBlocked(project);
    if (project.status === 'Blocked-client' && blockedDays > 14) {
      reasons.push(`Blocked by client for more than 14 days (${blockedDays} days).`);
    }
    if (reasons.length) return { rag: 'Red', reason: reasons.join(' ') };

    if (
      projectSubs.some(
        (s) =>
          isDueWithinDays(s, 7) &&
          s.submissionStatus !== 'In progress' &&
          s.submissionStatus !== 'Submitted'
      )
    ) {
      reasons.push('A submission is due within 7 days and is not in progress or submitted.');
    }
    if (project.status === 'Blocked-client' && blockedDays <= 14) {
      reasons.push(`Blocked by client (${blockedDays} days).`);
    }
    const budget = project.budgetMM;
    const consumed = totalMMConsumed(efforts, project.id);
    if (budget && budget > 0 && PRE_DD_STAGES.has(project.stage)) {
      const pct = consumed / budget;
      if (pct >= 0.8) {
        reasons.push(`Effort at ${Math.round(pct * 100)}% of budget before Detailed Design.`);
      }
    }
    if (reasons.length) return { rag: 'Amber', reason: reasons.join(' ') };

    if (GREY_STATUS.has(project.status)) {
      return { rag: 'Grey', reason: `Project status is ${project.status}.` };
    }
    if (!projectSubs.length) {
      return { rag: 'Grey', reason: 'No submissions on this project.' };
    }

    return { rag: 'Green', reason: 'No red or amber rules matched.' };
  }

  function ragSortKey(rag) {
    const order = { Red: 0, Amber: 1, Green: 2, Grey: 3 };
    return order[rag] ?? 9;
  }

  CET.rag = {
    isSubmissionOverdue,
    isDueWithinDays,
    daysBlocked,
    totalMMConsumed,
    computeRAG,
    ragSortKey,
  };
})(window.CyberEffortsTracker);
