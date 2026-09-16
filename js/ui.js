(function (CET) {
  const u = CET.utils;
  const rag = CET.rag;
  const F = CET.CONFIG.fields;

  function $(id) {
    return document.getElementById(id);
  }

  function setLoading(show, message) {
    const el = $('app-loading');
    if (!el) return;
    if (show) {
      el.classList.remove('hidden');
      el.classList.add('flex');
    } else {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
    if (message) el.querySelector('[data-loading-text]').textContent = message;
  }

  function showToast(message, isError) {
    const el = $('app-toast');
    if (!el) return;
    el.textContent = message;
    el.className = `fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${
      isError ? 'bg-red-600 text-white' : 'bg-slate-800 text-white'
    }`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
  }

  function ragDot(ragValue) {
    const cls = u.ragBadgeClass(ragValue);
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}">${u.escapeHtml(
      ragValue || 'Grey'
    )}</span>`;
  }

  function renderKPIs(kpis) {
    const html = `
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${kpiCard('Due this week', kpis.dueThisWeek, 'Green')}
        ${kpiCard('Overdue', kpis.overdue, 'Red')}
        ${kpiCard('Blocked (client)', `${kpis.blocked} · avg ${kpis.avgBlockedDays}d`, 'Amber')}
        ${kpiCard('Unassigned / not assessed', kpis.unassigned, 'Grey')}
      </div>`;
    $('kpi-cards').innerHTML = html;
  }

  function kpiCard(title, value, ragTone) {
    const p = u.ragPalette(ragTone);
    return `<div class="rounded-xl border p-4 ${p.bg} ring-1 ring-inset ${p.ring}">
      <p class="text-xs font-medium uppercase tracking-wide ${p.text}">${u.escapeHtml(title)}</p>
      <p class="mt-2 text-3xl font-semibold text-slate-900">${u.escapeHtml(String(value))}</p>
    </div>`;
  }

  function setActiveMainTab(tabId) {
    document.querySelectorAll('.main-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.nav === tabId);
    });
  }

  function renderChangePanel(sections, weekLabel, onProjectClick) {
    const container = $('change-panel');
    if (!sections.length) {
      container.innerHTML = '<p class="text-sm text-slate-500">No changes in this week.</p>';
      return;
    }

    container.innerHTML = sections
      .map((sec) => {
        if (!sec.items.length) return '';
        const rows = sec.items
          .map((c) => {
            const proj = u.escapeHtml(c.projectNumber || '—');
            const label = u.escapeHtml(c.itemLabel || '—');
            const field = u.escapeHtml(c.field || '');
            const transition = `${u.safeText(c.oldValue || '—')} → ${u.safeText(c.newValue || '—')}`;
            const who = u.escapeHtml(c.changedByDisplay || '');
            const click =
              c.projectNumber && c.projectNumber !== '—'
                ? `data-project-number="${u.escapeHtml(c.projectNumber)}" class="change-row cursor-pointer hover:bg-slate-50"`
                : 'class="change-row"';
            return `<tr ${click}>
              <td class="px-3 py-2 text-sm">${proj}</td>
              <td class="px-3 py-2 text-sm">${label}</td>
              <td class="px-3 py-2 text-sm">${field}</td>
              <td class="px-3 py-2 text-sm">${transition}</td>
              <td class="px-3 py-2 text-sm text-slate-500">${who}</td>
            </tr>`;
          })
          .join('');

        const openAttr = sec.name === 'Other' ? '' : ' open';
        return `<details class="group rounded-lg border border-slate-200 bg-white"${openAttr}>
          <summary class="flex cursor-pointer items-center justify-between px-4 py-3 font-medium text-slate-800">
            <span>${u.escapeHtml(sec.name)}</span>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs">${sec.items.length}</span>
          </summary>
          <div class="overflow-x-auto border-t border-slate-100">
            <table class="min-w-full divide-y divide-slate-100">
              <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th class="px-3 py-2">Project</th>
                  <th class="px-3 py-2">Item</th>
                  <th class="px-3 py-2">Field</th>
                  <th class="px-3 py-2">Change</th>
                  <th class="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </details>`;
      })
      .join('');

    $('change-week-label').textContent = weekLabel;

    container.querySelectorAll('.change-row[data-project-number]').forEach((row) => {
      row.addEventListener('click', () => {
        const num = row.getAttribute('data-project-number');
        if (num && onProjectClick) onProjectClick(num);
      });
    });
  }

  function renderOverdueTable(rows, onProjectClick) {
    const tbody = $('overdue-body');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-sm text-slate-500">No overdue submissions.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(({ project, submission, daysOverdue }) => {
        return `<tr class="hover:bg-slate-50 cursor-pointer" data-project-id="${project.id}">
          <td class="px-3 py-2 text-sm font-medium">${u.escapeHtml(project.projectNumber)}</td>
          <td class="px-3 py-2 text-sm">${u.escapeHtml(submission.type)}</td>
          <td class="px-3 py-2 text-sm">${u.formatDateRiyadh(submission.plannedDate)}</td>
          <td class="px-3 py-2 text-sm text-red-700 font-medium">${daysOverdue ?? '—'}</td>
          <td class="px-3 py-2 text-sm">${u.escapeHtml(submission.ownerDisplay)}</td>
          <td class="px-3 py-2 text-sm">${ragDot(project.rag)}</td>
        </tr>`;
      })
      .join('');
    tbody.querySelectorAll('tr[data-project-id]').forEach((tr) => {
      tr.addEventListener('click', () => onProjectClick(Number(tr.dataset.projectId)));
    });
  }

  function renderNext14Table(rows, onProjectClick) {
    const tbody = $('next14-body');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-6 text-center text-sm text-slate-500">Nothing due in the next 14 days.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(({ project, submission, daysRemaining }) => {
        return `<tr class="hover:bg-slate-50 cursor-pointer" data-project-id="${project.id}">
          <td class="px-3 py-2 text-sm font-medium">${u.escapeHtml(project.projectNumber)}</td>
          <td class="px-3 py-2 text-sm">${u.escapeHtml(submission.type)}</td>
          <td class="px-3 py-2 text-sm">${u.formatDateRiyadh(submission.plannedDate)}</td>
          <td class="px-3 py-2 text-sm">${u.escapeHtml(submission.ownerDisplay)}</td>
          <td class="px-3 py-2 text-sm">${ragDot(project.rag)}</td>
          <td class="px-3 py-2 text-sm">${daysRemaining ?? '—'}</td>
          <td class="px-3 py-2 text-sm text-slate-600 max-w-xs truncate" title="${u.safeText(project.latestNote)}">${u.safeText(project.latestNote || '—')}</td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('tr[data-project-id]').forEach((tr) => {
      tr.addEventListener('click', () => onProjectClick(Number(tr.dataset.projectId)));
    });
  }

  function getTableFilters() {
    return {
      status: $('filter-status')?.value || '',
      stage: $('filter-stage')?.value || '',
      rag: $('filter-rag')?.value || '',
      cyberProvisioned: $('filter-cyber-prov')?.value || '',
      client: ($('filter-client')?.value || '').trim().toLowerCase(),
      title: ($('filter-title')?.value || '').trim().toLowerCase(),
      cyberPM: ($('filter-cyber-pm')?.value || '').trim().toLowerCase(),
      myProjects: $('filter-my-projects')?.checked || false,
      chartFilter: CET.appState?.chartFilter || null,
    };
  }

  function projectMatchesFilters(p, filters, currentUserLogin) {
    if (filters.status && p.status !== filters.status) return false;
    if (filters.stage && p.stage !== filters.stage) return false;
    if (filters.rag && p.rag !== filters.rag) return false;
    if (filters.cyberProvisioned && p.cyberProvisioned !== filters.cyberProvisioned) return false;
    if (filters.client && !(p.client || '').toLowerCase().includes(filters.client)) return false;
    if (filters.title && !(p.title || '').toLowerCase().includes(filters.title)) return false;
    if (filters.cyberPM && !(p.cyberPMDisplay || '').toLowerCase().includes(filters.cyberPM)) return false;
    if (filters.myProjects && currentUserLogin) {
      const logins = u.personLogin(p.cyberPM).toLowerCase();
      if (!logins.includes(currentUserLogin.toLowerCase())) return false;
    }
    if (filters.chartFilter) {
      const cf = filters.chartFilter;
      if (cf.type === 'status' && p.status !== cf.value) return false;
      if (cf.type === 'stage' && p.stage !== cf.value) return false;
      if (cf.type === 'rag' && p.rag !== cf.value) return false;
    }
    return true;
  }

  function renderProjectTable(projects, efforts, filters, currentUser, onOpenProject, onInlineSave) {
    const login = currentUser?.Email || currentUser?.LoginName || '';
    const visibleCols = CET.appState.visibleColumns || defaultColumns();

    let list = projects.filter((p) => projectMatchesFilters(p, filters, login));
    list.sort((a, b) => {
      const r = rag.ragSortKey(a.rag) - rag.ragSortKey(b.rag);
      if (r !== 0) return r;
      const da = a.nextSubmissionDate ? a.nextSubmissionDate.getTime() : Infinity;
      const db = b.nextSubmissionDate ? b.nextSubmissionDate.getTime() : Infinity;
      return da - db;
    });

    const thead = $('project-table-head');
    const tbody = $('project-table-body');
    thead.innerHTML = `<tr>${visibleCols.map((c) => `<th class="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">${u.escapeHtml(c.label)}</th>`).join('')}<th class="px-3 py-2"></th></tr>`;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="${visibleCols.length + 1}" class="px-3 py-8 text-center text-sm text-slate-500">No projects match filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((p) => {
        const consumed = rag.totalMMConsumed(efforts, p.id);
        const cells = visibleCols.map((col) => {
          switch (col.id) {
            case 'rag':
              return `<td class="px-3 py-2">${ragDot(p.rag)}</td>`;
            case 'status':
              return `<td class="px-3 py-2"><select data-edit="status" data-id="${p.id}" class="rounded border-slate-300 text-sm">${optionList(
                CET.CONFIG.choices.status,
                p.status
              )}</select></td>`;
            case 'statusReason':
              return `<td class="px-3 py-2"><input data-edit="statusReason" data-id="${p.id}" class="w-full rounded border-slate-300 text-sm" value="${u.safeText(
                p.statusReason
              )}" /></td>`;
            case 'cyberProvisioned':
              return `<td class="px-3 py-2"><select data-edit="cyberProvisioned" data-id="${p.id}" class="rounded border-slate-300 text-sm">${optionList(
                CET.CONFIG.choices.cyberProvisioned,
                p.cyberProvisioned
              )}</select></td>`;
            case 'cyberPM':
              return `<td class="px-3 py-2"><input data-edit="cyberPM" data-id="${p.id}" title="Semicolon-separated emails" class="w-full min-w-[8rem] rounded border-slate-300 text-sm" value="${u.escapeHtml(
                p.cyberPMDisplay === 'Unassigned' ? '' : p.cyberPMDisplay.replace(/; /g, ';')
              )}" placeholder="email@domain; …" /></td>`;
            case 'nextSubmission':
              return `<td class="px-3 py-2 text-sm">${u.escapeHtml(p.nextSubmissionType || '—')} · ${u.formatDateRiyadh(
                p.nextSubmissionDate
              )}</td>`;
            case 'latestNote':
              return `<td class="px-3 py-2 text-sm max-w-xs truncate" title="${u.safeText(p.latestNote)}">${u.safeText(
                p.latestNote || '—'
              )}</td>`;
            case 'mmConsumed':
              return `<td class="px-3 py-2 text-sm">${u.normalizeNumber(consumed, 2)}</td>`;
            default:
              return `<td class="px-3 py-2 text-sm">${u.escapeHtml(String(p[col.field] ?? '—'))}</td>`;
          }
        });
        return `<tr class="hover:bg-slate-50" data-project-id="${p.id}">
          ${cells.join('')}
          <td class="px-3 py-2 text-right"><button type="button" data-open="${p.id}" class="text-sm font-medium text-sky-700 hover:underline">Open</button></td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => onOpenProject(Number(btn.dataset.open)));
    });

    tbody.querySelectorAll('[data-edit]').forEach((el) => {
      el.addEventListener('change', () => onInlineSave(el));
      if (el.tagName === 'INPUT') {
        el.addEventListener('blur', () => onInlineSave(el));
      }
    });
  }

  function optionList(choices, selected) {
    return choices
      .map((c) => `<option value="${u.escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${u.escapeHtml(c)}</option>`)
      .join('');
  }

  function defaultColumns() {
    return [
      { id: 'rag', label: 'RAG', field: 'rag' },
      { id: 'projectNumber', label: 'Project #', field: 'projectNumber' },
      { id: 'title', label: 'Title', field: 'title' },
      { id: 'client', label: 'Client', field: 'client' },
      { id: 'stage', label: 'Stage', field: 'stage' },
      { id: 'status', label: 'Status', field: 'status' },
      { id: 'cyberPM', label: 'Cyber PM', field: 'cyberPMDisplay' },
      { id: 'nextSubmission', label: 'Next submission', field: 'nextSubmission' },
      { id: 'latestNote', label: 'Latest note', field: 'latestNote' },
    ];
  }

  function optionalColumns() {
    return [
      { id: 'dssPM', label: 'DSS PM', field: 'dssPMDisplay' },
      { id: 'projectPM', label: 'Project PM', field: 'projectPMDisplay' },
      { id: 'budgetMM', label: 'Budget MM', field: 'budgetMM' },
      { id: 'mmConsumed', label: 'MM consumed', field: 'mmConsumed' },
      { id: 'cyberProvisioned', label: 'Cyber provisioned', field: 'cyberProvisioned' },
      { id: 'statusReason', label: 'Status reason', field: 'statusReason' },
    ];
  }

  function renderFilterChips(chartFilter, onClear) {
    const el = $('filter-chips');
    if (!el) return;
    if (!chartFilter) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<span class="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-900">
      Filter: ${u.escapeHtml(chartFilter.type)} = ${chartFilter.type === 'rag' ? ragDot(chartFilter.value) : u.escapeHtml(chartFilter.value)}
      <button type="button" id="clear-chart-filter" class="font-bold hover:text-sky-700">×</button>
    </span>`;
    $('clear-chart-filter').addEventListener('click', onClear);
  }

  function renderSecondaryPanels(state) {
    const blocked = CET.analytics.blockedByClient(state);
    $('panel-blocked').innerHTML = blocked.length
      ? `<table class="min-w-full text-sm"><thead><tr class="text-left text-xs uppercase text-slate-500"><th class="py-1">Project</th><th>Reason</th><th>Days</th><th>Cyber PM</th></tr></thead><tbody>
        ${blocked
          .map(
            (b) => `<tr class="border-t"><td class="py-1 pr-2">${u.escapeHtml(b.project.projectNumber)}</td><td>${u.safeText(
              b.reason
            )}</td><td>${b.days}</td><td>${u.escapeHtml(b.cyberPM)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p class="text-sm text-slate-500">No blocked projects.</p>';

    const gaps = CET.analytics.coverageGap(state);
    $('panel-coverage').innerHTML = gaps.length
      ? gaps
          .map(
            (g) =>
              `<div class="text-sm border-b py-1">${u.escapeHtml(g.project.projectNumber)} — ${g.ageDays} days</div>`
          )
          .join('')
      : '<p class="text-sm text-slate-500">No coverage gaps.</p>';

    const slips = CET.analytics.slippagePanel(state.changes, state, 8);
    $('panel-slippage').innerHTML = slips.length
      ? slips
          .map(
            (s) =>
              `<div class="text-sm border-b py-1">${u.escapeHtml(s.project?.projectNumber || '—')} · ${u.escapeHtml(
                s.type
              )}: ${u.safeText(s.originalDate)} → ${u.safeText(s.currentDate)} (${s.weeksSlipped ?? '?'} wk)</div>`
          )
          .join('')
      : '<p class="text-sm text-slate-500">No slippage in the last 8 weeks.</p>';
  }

  CET.ui = {
    $,
    setLoading,
    showToast,
    setActiveMainTab,
    renderKPIs,
    renderChangePanel,
    renderOverdueTable,
    renderNext14Table,
    renderProjectTable,
    renderFilterChips,
    renderSecondaryPanels,
    getTableFilters,
    defaultColumns,
    optionalColumns,
    ragDot,
  };
})(window.CyberEffortsTracker);
