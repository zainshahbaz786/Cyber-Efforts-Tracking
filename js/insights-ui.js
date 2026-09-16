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

  function ragPlain(cell) {
    return cell.getValue() || 'Grey';
  }

  function buildTabulator(elId, columns, data, onRowClick) {
    const el = document.getElementById(elId);
    if (!el || typeof Tabulator === 'undefined') return null;

    const table = new Tabulator(el, {
      data,
      layout: 'fitColumns',
      height: Math.min(320, 56 + data.length * 36),
      placeholder: 'Nothing to show — good news!',
      columnDefaults: { headerSort: true, vertAlign: 'middle' },
      columns,
      rowFormatter: (row) => {
        const elRow = row.getElement();
        elRow.classList.add('cursor-pointer', 'hover:bg-slate-50');
        const rag = row.getData().rag;
        const ragCell = elRow.querySelector('[tabulator-field="rag"]');
        if (ragCell && rag) {
          ragCell.style.color = u.ragHex(rag);
        }
      },
    });

    if (onRowClick) {
      table.on('rowClick', (_, row) => onRowClick(row.getData()));
    }
    return table;
  }

  function renderTables(state, onOpenProject) {
    destroyTabulators();

    const blocked = CET.analytics.blockedByClient(state).map((b) => ({
      projectNumber: b.project.projectNumber,
      reason: u.plainText(b.reason),
      days: b.days,
      cyberPM: b.cyberPM,
      projectId: b.project.id,
      rag: b.project.rag,
    }));

    tabBlocked = buildTabulator(
      'tabulator-blocked',
      [
        { title: 'Project', field: 'projectNumber', width: 120 },
        { title: 'RAG', field: 'rag', width: 72, headerSort: false, formatter: ragPlain },
        { title: 'Reason', field: 'reason', minWidth: 140 },
        { title: 'Days blocked', field: 'days', hozAlign: 'right', width: 110 },
        { title: 'Cyber PM', field: 'cyberPM', minWidth: 120 },
      ],
      blocked,
      (row) => onOpenProject(row.projectId)
    );

    const gaps = CET.analytics.coverageGap(state).map((g) => ({
      projectNumber: g.project.projectNumber,
      title: g.project.title,
      ageDays: g.ageDays,
      cyberPM: g.project.cyberPMDisplay,
      provisioned: g.project.cyberProvisioned,
      projectId: g.project.id,
      rag: g.project.rag,
    }));

    tabCoverage = buildTabulator(
      'tabulator-coverage',
      [
        { title: 'Project', field: 'projectNumber', width: 110 },
        { title: 'RAG', field: 'rag', width: 72, headerSort: false, formatter: ragPlain },
        { title: 'Title', field: 'title', minWidth: 160 },
        { title: 'Age (days)', field: 'ageDays', hozAlign: 'right', width: 100 },
        { title: 'Cyber prov.', field: 'provisioned', width: 110 },
        { title: 'Cyber PM', field: 'cyberPM', minWidth: 100 },
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

    tabSlippage = buildTabulator(
      'tabulator-slippage',
      [
        { title: 'Project', field: 'projectNumber', width: 110 },
        { title: 'Milestone', field: 'type', minWidth: 120 },
        { title: 'Was', field: 'originalDate', width: 100 },
        { title: 'Now', field: 'currentDate', width: 100 },
        { title: 'Weeks slipped', field: 'weeksSlipped', hozAlign: 'right', width: 110 },
      ],
      slips,
      (row) => row.projectId && onOpenProject(row.projectId)
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
