(function (CET) {
  const u = CET.utils;

  function buildWeeklyReportHtml(state, weekOffset) {
    const bounds = u.getRiyadhWeekBounds(new Date(), weekOffset || 0);
    const weekLabel = u.formatWeekLabel(bounds);
    const kpis = CET.analytics.computeKPIs(state);
    const sections = CET.changePanel.buildChangeSections(state.changes, state.efforts, bounds);
    const next14 = CET.analytics.next14DaysRows(state);
    const overdue = CET.analytics.overdueRows(state);
    const blocked = CET.analytics.blockedByClient(state);
    const slips = CET.analytics.slippagePanel(state.changes, state, 8);
    const effort = CET.analytics.effortByProject(state).slice(0, 20);
    const loadMap = CET.analytics.loadByCyberPM(state, 6);
    const loadSummary = [];
    loadMap.forEach((mm, key) => {
      const [, person] = key.split('|');
      loadSummary.push({ person, mm });
    });
    loadSummary.sort((a, b) => b.mm - a.mm);

    const changeHtml = sections
      .filter((s) => s.items.length)
      .map(
        (sec) => `
        <h3>${u.escapeHtml(sec.name)} (${sec.items.length})</h3>
        <table><thead><tr><th>Project</th><th>Item</th><th>Field</th><th>Change</th></tr></thead>
        <tbody>${sec.items
          .map(
            (c) =>
              `<tr><td>${u.escapeHtml(c.projectNumber)}</td><td>${u.escapeHtml(c.itemLabel)}</td><td>${u.escapeHtml(
                c.field
              )}</td><td>${u.escapeHtml(c.oldValue || '—')} → ${u.escapeHtml(c.newValue || '—')}</td></tr>`
          )
          .join('')}</tbody></table>`
      )
      .join('');

    return `
      <div class="weekly-report-doc p-6 text-slate-900" style="font-family:Segoe UI,sans-serif;font-size:11px;">
        <h1 style="font-size:18px;margin-bottom:4px;">Cyber Efforts Tracker — Weekly Management Pack</h1>
        <p style="color:#475569;margin-bottom:16px;">Week: ${u.escapeHtml(weekLabel)} · Generated ${u.escapeHtml(
      u.formatDateTimeRiyadh(new Date())
    )} (Riyadh)</p>

        <h2 style="font-size:14px;margin-top:12px;">Key metrics</h2>
        <table style="width:100%;margin-bottom:16px;"><tr>
          <td><strong>Due this week</strong><br/>${kpis.dueThisWeek}</td>
          <td><strong>Overdue</strong><br/>${kpis.overdue}</td>
          <td><strong>Blocked</strong><br/>${kpis.blocked} (avg ${kpis.avgBlockedDays}d)</td>
          <td><strong>Unassigned / not assessed</strong><br/>${kpis.unassigned}</td>
        </tr></table>

        <h2 style="font-size:14px;">What changed this week</h2>
        ${changeHtml || '<p>No changes recorded.</p>'}

        <h2 style="font-size:14px;margin-top:16px;">Next 14 days</h2>
        ${tableFromRows(
          next14,
          ['Project', 'Type', 'Planned', 'Owner', 'RAG', 'Days left'],
          (r) => [
            r.project.projectNumber,
            r.submission.type,
            u.formatDateRiyadh(r.submission.plannedDate),
            r.submission.ownerDisplay,
            r.project.rag,
            String(r.daysRemaining ?? ''),
          ]
        )}

        <h2 style="font-size:14px;margin-top:16px;">Overdue submissions</h2>
        ${tableFromRows(
          overdue,
          ['Project', 'Type', 'Planned', 'Days overdue', 'Owner', 'RAG'],
          (r) => [
            r.project.projectNumber,
            r.submission.type,
            u.formatDateRiyadh(r.submission.plannedDate),
            String(r.daysOverdue ?? ''),
            r.submission.ownerDisplay,
            r.project.rag,
          ]
        )}

        <h2 style="font-size:14px;margin-top:16px;">Blocked by client</h2>
        ${tableFromRows(
          blocked,
          ['Project', 'Reason', 'Days blocked', 'Cyber PM'],
          (r) => [r.project.projectNumber, r.reason, String(r.days), r.cyberPM]
        )}

        <h2 style="font-size:14px;margin-top:16px;">Slippage (8 weeks)</h2>
        ${tableFromRows(
          slips,
          ['Project', 'Type', 'Original', 'Current', 'Weeks'],
          (r) => [
            r.project?.projectNumber || '—',
            r.type,
            r.originalDate,
            r.currentDate,
            String(r.weeksSlipped ?? ''),
          ]
        )}

        <h2 style="font-size:14px;margin-top:16px;">Effort vs budget (top 20)</h2>
        ${tableFromRows(
          effort,
          ['Project', 'Budget MM', 'Consumed', '% used', 'Stage'],
          (r) => [
            r.project.projectNumber,
            u.normalizeNumber(r.budget, 2),
            u.normalizeNumber(r.consumed, 2),
            `${Math.round(r.pct)}%`,
            r.project.stage,
          ]
        )}

        <h2 style="font-size:14px;margin-top:16px;">Workload by person (6 months)</h2>
        ${tableFromRows(
          loadSummary.slice(0, 30),
          ['Person', 'Total MM'],
          (r) => [r.person, u.normalizeNumber(r.mm, 2)]
        )}
      </div>`;
  }

  function tableFromRows(rows, headers, mapRow) {
    if (!rows.length) return '<p>None.</p>';
    return `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <thead><tr>${headers.map((h) => `<th style="text-align:left;border-bottom:1px solid #ccc;padding:4px;">${u.escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr>${mapRow(r)
              .map((c) => `<td style="padding:4px;border-bottom:1px solid #eee;">${u.escapeHtml(String(c))}</td>`)
              .join('')}</tr>`
        )
        .join('')}</tbody></table>`;
  }

  async function downloadPdf(state, weekOffset) {
    const root = document.getElementById('weekly-export-root');
    if (!root) throw new Error('Export container missing');
    root.innerHTML = buildWeeklyReportHtml(state, weekOffset);
    root.classList.remove('hidden');

    if (typeof html2pdf === 'undefined') {
      window.print();
      return;
    }

    const bounds = u.getRiyadhWeekBounds(new Date(), weekOffset || 0);
    const filename = `Cyber-Efforts-Weekly-${u.toDateKey(bounds.start)}.pdf`;

    await html2pdf()
      .set({
        margin: 10,
        filename,
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      })
      .from(root.querySelector('.weekly-report-doc'))
      .save();

    root.classList.add('hidden');
  }

  CET.weeklyExport = { buildWeeklyReportHtml, downloadPdf };
})(window.CyberEffortsTracker);
