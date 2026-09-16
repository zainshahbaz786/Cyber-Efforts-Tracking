(function (CET) {
  const u = CET.utils;
  let tabBlocked = null;
  let tabCoverage = null;
  let tabSlippage = null;
  let tippyInstances = [];

  function destroyTabulators() {
    [tabBlocked, tabCoverage, tabSlippage].forEach((t) => {
      try {
        if (t && t.destroy) t.destroy();
      } catch (_) {
        /* ignore */
      }
    });
    tabBlocked = tabCoverage = tabSlippage = null;
  }

  function destroyTooltips() {
    tippyInstances.forEach((i) => i.destroy());
    tippyInstances = [];
  }

  function setTableCount(id, n) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  }

  function animateStat(id, value, decimals) {
    const el = document.getElementById(id);
    if (!el) return;
    const end = Number(value) || 0;
    if (typeof countUp !== 'undefined' && countUp.CountUp) {
      const counter = new countUp.CountUp(el, end, {
        duration: 1.2,
        decimalPlaces: decimals || 0,
        useGrouping: true,
      });
      if (!counter.error) counter.start();
      else el.textContent = String(end);
    } else {
      el.textContent = String(end);
    }
  }

  function renderSummaryStrip(state) {
    const rag = CET.analytics.ragBreakdown(state);
    const kpis = CET.analytics.computeKPIs(state);
    animateStat('insight-count-red', rag.get('Red') || 0);
    animateStat('insight-count-amber', rag.get('Amber') || 0);
    animateStat('insight-count-green', rag.get('Green') || 0);
    animateStat('insight-count-grey', rag.get('Grey') || 0);
    animateStat('insight-count-overdue', kpis.overdue);
    animateStat('insight-count-blocked', kpis.blocked);
  }

  function htmlFormatter(buildHtml) {
    return function (cell, _fp, onRendered) {
      onRendered(() => {
        cell.getElement().innerHTML = buildHtml(cell);
      });
      return '';
    };
  }

  function ragBadge(cell) {
    const rag = cell.getValue() || 'Grey';
    const hex = u.ragHex(rag);
    return `<span class="insight-rag-pill" style="--rag:${hex}">${rag}</span>`;
  }

  function daysBlockedCell(cell) {
    const days = Number(cell.getValue()) || 0;
    const cls = days > 14 ? 'insight-num-warn' : days > 7 ? 'insight-num-caution' : '';
    return `<span class="${cls}">${days}</span>`;
  }

  function provisionCell(cell) {
    const v = cell.getValue() || '—';
    const map = {
      Yes: 'insight-badge insight-badge-ok',
      No: 'insight-badge insight-badge-bad',
      Pending: 'insight-badge insight-badge-warn',
      'Not assessed': 'insight-badge insight-badge-muted',
    };
    const cls = map[v] || 'insight-badge insight-badge-muted';
    return `<span class="${cls}">${u.plainText(v)}</span>`;
  }

  function slippageDatesCell(cell, field) {
    const row = cell.getRow().getData();
    if (field === 'originalDate') {
      return `<span class="insight-date-old">${u.plainText(cell.getValue())}</span>`;
    }
    return `<span class="insight-date-new">${u.plainText(cell.getValue())}</span>`;
  }

  function buildTabulator(elId, columns, data, onRowClick, tableHeight) {
    const el = document.getElementById(elId);
    if (!el || typeof Tabulator === 'undefined') return null;

    const h = tableHeight || Math.min(360, 52 + Math.max(data.length, 3) * 44);

    const table = new Tabulator(el, {
      data,
      layout: 'fitColumns',
      height: h,
      placeholder: 'Nothing here — that is usually good news.',
      columnDefaults: {
        headerSort: true,
        vertAlign: 'middle',
        headerHozAlign: 'left',
        resizable: false,
      },
      columns,
      rowFormatter: (row) => {
        row.getElement().classList.add('insight-table-row');
      },
    });

    table.on('rowClick', (_, row) => {
      if (onRowClick) onRowClick(row.getData());
    });
    return table;
  }

  function renderTables(state, onOpenProject) {
    destroyTabulators();

    const blocked = CET.analytics.blockedByClient(state).map((b) => ({
      projectNumber: b.project.projectNumber,
      reason: u.plainText(b.reason),
      days: b.days,
      cyberPM: b.cyberPM || '—',
      projectId: b.project.id,
      rag: b.project.rag,
    }));

    setTableCount('table-count-blocked', blocked.length);
    tabBlocked = buildTabulator(
      'tabulator-blocked',
      [
        { title: 'Project #', field: 'projectNumber', width: 108, headerTooltip: 'Click row to open project' },
        { title: 'Health', field: 'rag', width: 88, headerSort: false, formatter: htmlFormatter(ragBadge), hozAlign: 'center' },
        { title: 'Why blocked', field: 'reason', minWidth: 180, formatter: 'textarea' },
        { title: 'Days', field: 'days', hozAlign: 'right', width: 72, formatter: htmlFormatter(daysBlockedCell), headerTooltip: 'Days in blocked status' },
        { title: 'Cyber PM', field: 'cyberPM', minWidth: 120 },
      ],
      blocked,
      (row) => onOpenProject(row.projectId)
    );

    const gaps = CET.analytics.coverageGap(state).map((g) => ({
      projectNumber: g.project.projectNumber,
      title: u.plainText(g.project.title),
      ageDays: g.ageDays,
      cyberPM: g.project.cyberPMDisplay || '—',
      provisioned: g.project.cyberProvisioned || 'Not assessed',
      projectId: g.project.id,
      rag: g.project.rag,
    }));

    setTableCount('table-count-coverage', gaps.length);
    tabCoverage = buildTabulator(
      'tabulator-coverage',
      [
        { title: 'Project #', field: 'projectNumber', width: 108 },
        { title: 'Health', field: 'rag', width: 88, headerSort: false, formatter: htmlFormatter(ragBadge), hozAlign: 'center' },
        { title: 'Project name', field: 'title', minWidth: 160 },
        { title: 'Age (days)', field: 'ageDays', hozAlign: 'right', width: 88 },
        { title: 'Cyber assessed', field: 'provisioned', width: 118, formatter: htmlFormatter(provisionCell), hozAlign: 'center' },
        { title: 'Cyber PM', field: 'cyberPM', minWidth: 110 },
      ],
      gaps,
      (row) => onOpenProject(row.projectId)
    );

    const weeks = getSlippageWeeks();
    const slips = CET.analytics.slippagePanel(state.changes, state, weeks).map((s) => ({
      projectNumber: s.project?.projectNumber || '—',
      type: s.type,
      originalDate: u.formatDateRiyadh(u.parseDateOnly(s.originalDate)) || u.plainText(s.originalDate),
      currentDate: u.formatDateRiyadh(u.parseDateOnly(s.currentDate)) || u.plainText(s.currentDate),
      weeksSlipped: s.weeksSlipped ?? '—',
      projectId: s.project?.id,
    }));

    setTableCount('table-count-slippage', slips.length);
    tabSlippage = buildTabulator(
      'tabulator-slippage',
      [
        { title: 'Project #', field: 'projectNumber', width: 108 },
        { title: 'Milestone', field: 'type', minWidth: 130 },
        {
          title: 'Planned was',
          field: 'originalDate',
          width: 112,
          formatter: htmlFormatter((cell) => slippageDatesCell(cell, 'originalDate')),
        },
        {
          title: 'Planned now',
          field: 'currentDate',
          width: 112,
          formatter: htmlFormatter((cell) => slippageDatesCell(cell, 'currentDate')),
        },
        { title: 'Weeks late', field: 'weeksSlipped', hozAlign: 'right', width: 96 },
      ],
      slips,
      (row) => row.projectId && onOpenProject(row.projectId),
      Math.min(400, 52 + Math.max(slips.length, 3) * 44)
    );
  }

  function getSlippageWeeks() {
    const sel = document.getElementById('insights-slippage-range');
    return sel ? Number(sel.value) || 8 : 8;
  }

  function initTooltips() {
    destroyTooltips();
    if (typeof tippy === 'undefined') return;
    document.querySelectorAll('[data-tippy-content]').forEach((el) => {
      tippyInstances.push(
        tippy(el, {
          theme: 'cet-insights',
          allowHTML: true,
          maxWidth: 320,
          animation: 'shift-away',
        })
      );
    });
  }

  function render(state, handlers) {
    renderSummaryStrip(state);

    CET.chartsUI.renderRagDonut('chart-rag', CET.analytics.ragBreakdown(state), (rag) => {
      handlers.onFilter({ type: 'rag', value: rag });
    });

    CET.chartsUI.renderStatusDonut('chart-status', CET.analytics.statusBreakdown(state), (status) => {
      handlers.onFilter({ type: 'status', value: status });
    });

    CET.chartsUI.renderStageFunnel('chart-stage', CET.analytics.stageFunnel(state), (stage) => {
      handlers.onFilter({ type: 'stage', value: stage });
    });

    CET.chartsUI.renderEffortBar('chart-effort', CET.analytics.effortByProject(state), (project) =>
      handlers.onOpenProject(project.id)
    );

    CET.chartsUI.renderLoadStacked('chart-load', state, 6);

    renderTables(state, handlers.onOpenProject);
    initTooltips();
  }

  function bindSlippageControls(refreshFn) {
    const sel = document.getElementById('insights-slippage-range');
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.addEventListener('change', () => refreshFn());
    }
  }

  CET.insightsUI = {
    render,
    bindSlippageControls,
    destroyTabulators,
  };
})(window.CyberEffortsTracker);
