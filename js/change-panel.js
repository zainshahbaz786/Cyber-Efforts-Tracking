(function (CET) {
  const u = CET.utils;

  function inWeek(changedOn, bounds) {
    if (!changedOn) return false;
    const t = changedOn.getTime();
    return t >= bounds.start.getTime() && t < bounds.end.getTime();
  }

  function groupChanges(changes, weekBounds) {
    const filtered = changes.filter((c) => !c.suppressed && inWeek(c.changedOn, weekBounds));

    const groups = new Map();
    filtered.forEach((c) => {
      const key = `${c.sourceList}|${c.itemId}|${c.field}`;
      if (!groups.has(key)) {
        groups.set(key, { first: c, last: c, rows: [c] });
      } else {
        const g = groups.get(key);
        g.rows.push(c);
        if (c.changedOn < g.first.changedOn) g.first = c;
        if (c.changedOn > g.last.changedOn) g.last = c;
      }
    });

    const result = [];
    groups.forEach((g) => {
      const oldV = g.first.oldValue;
      const newV = g.last.newValue;
      if (oldV === newV) return;
      result.push({
        sourceList: g.last.sourceList,
        itemId: g.last.itemId,
        field: g.last.field,
        oldValue: oldV,
        newValue: newV,
        projectNumber: g.last.projectNumber,
        itemLabel: g.last.itemLabel,
        changedByDisplay: g.last.changedByDisplay,
        changedOn: g.last.changedOn,
        changeType: g.last.changeType,
      });
    });

    return result.sort((a, b) => (a.changedOn || 0) - (b.changedOn || 0));
  }

  function bucketChange(c) {
    if (c.sourceList === 'Projects' && c.changeType === 'Create') return 'New projects';
    if (c.field === 'Stage') return 'Moved stage';
    if (c.field === 'Status' && c.newValue === 'Blocked-client') return 'Blocked';
    if (c.field === 'Status' && ['Closed', 'On hold', 'Not awarded'].includes(c.newValue)) {
      return 'Closed / On hold';
    }
    if (
      c.sourceList === 'Submissions' &&
      c.field === 'ActualDate' &&
      u.isBlank(c.oldValue) &&
      !u.isBlank(c.newValue)
    ) {
      return 'Submitted';
    }
    if (c.sourceList === 'Submissions' && c.field === 'PlannedDate') {
      if (c.oldValue && c.newValue && c.newValue > c.oldValue) return 'Slipped';
    }
    if (['CyberPM', 'DSS_PM', 'ProjectPM'].includes(c.field)) return 'Reassigned';
    return 'Other';
  }

  function effortBookedInWeek(efforts, changes, weekBounds) {
    /* Effort booked: total MMConsumed logged in the week — use ChangeLog on EffortLog or note creates */
    const effortChanges = changes.filter(
      (c) =>
        !c.suppressed &&
        c.sourceList === 'EffortLog' &&
        inWeek(c.changedOn, weekBounds) &&
        c.field === 'MMConsumed'
    );
    let total = 0;
    effortChanges.forEach((c) => {
      const n = Number(c.newValue);
      if (!Number.isNaN(n)) total += n;
    });
    return { total, rows: effortChanges };
  }

  function buildChangeSections(changes, efforts, weekBounds) {
    const grouped = groupChanges(changes, weekBounds);
    const buckets = new Map();
    const order = [
      'New projects',
      'Moved stage',
      'Blocked',
      'Closed / On hold',
      'Submitted',
      'Slipped',
      'Reassigned',
      'Effort booked',
      'Other',
    ];
    order.forEach((b) => buckets.set(b, []));

    grouped.forEach((c) => {
      const b = bucketChange(c);
      buckets.get(b).push(c);
    });

    const effort = effortBookedInWeek(efforts, changes, weekBounds);
    if (effort.total > 0) {
      buckets.get('Effort booked').push({
        projectNumber: '—',
        itemLabel: 'Total MM booked',
        field: 'MMConsumed',
        oldValue: '',
        newValue: u.normalizeNumber(effort.total, 2),
        changedByDisplay: '',
        summary: true,
      });
    }

    return order.map((name) => ({ name, items: buckets.get(name) || [] }));
  }

  CET.changePanel = { groupChanges, buildChangeSections, bucketChange };
})(window.CyberEffortsTracker);
