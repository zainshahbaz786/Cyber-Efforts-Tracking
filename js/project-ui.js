(function (CET) {
  const u = CET.utils;
  const F = CET.CONFIG.fields;
  const lists = CET.CONFIG.lists;

  function renderProjectPage(project, state, handlers) {
    const root = CET.ui.$('view-project');
    const subs = CET.data.submissionsForProject(project.id);
    const efforts = CET.data.effortsForProject(project.id);
    const notes = CET.data.notesForProject(project.id).sort((a, b) => (b.noteDate || 0) - (a.noteDate || 0));
    const history = CET.data.changesForProject(project.projectNumber).sort(
      (a, b) => (b.changedOn || 0) - (a.changedOn || 0)
    );
    const ragInfo = CET.rag.computeRAG(project, state.submissions, state.efforts);
    const consumed = CET.rag.totalMMConsumed(state.efforts, project.id);

    root.innerHTML = `
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" id="btn-back-dashboard" class="text-sm text-sky-700 hover:underline">← Close panel</button>
          <h2 class="text-2xl font-semibold text-slate-900">${u.escapeHtml(project.projectNumber)} — ${u.escapeHtml(
      project.title
    )}</h2>
          <p class="text-sm text-slate-600">${u.escapeHtml(project.client)} · ${u.escapeHtml(project.stage)} · ${u.escapeHtml(
      project.status
    )}</p>
        </div>
        <div>${CET.ui.ragDot(ragInfo.rag)} <span class="text-sm text-slate-600">${u.escapeHtml(ragInfo.reason)}</span></div>
      </div>

      <div class="border-b border-slate-200">
        <nav class="-mb-px flex gap-4 text-sm font-medium" id="project-tabs">
          ${tabBtn('overview', 'Overview', true)}
          ${tabBtn('milestones', 'Milestones')}
          ${tabBtn('effort', 'Effort')}
          ${tabBtn('notes', 'Notes')}
          ${tabBtn('history', 'History')}
        </nav>
      </div>

      <div id="tab-overview" class="tab-panel mt-4 space-y-4">${overviewTab(project, ragInfo)}</div>
      <div id="tab-milestones" class="tab-panel mt-4 hidden">${milestonesTab(subs)}</div>
      <div id="tab-effort" class="tab-panel mt-4 hidden">${effortTab(efforts, project, consumed)}</div>
      <div id="tab-notes" class="tab-panel mt-4 hidden">${notesTab(notes)}</div>
      <div id="tab-history" class="tab-panel mt-4 hidden">${historyTab(history)}</div>
    `;

    CET.ui.$('btn-back-dashboard').addEventListener('click', handlers.onBack);

    root.querySelectorAll('#project-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    bindOverviewSave(project, handlers);
    bindMilestoneActions(project, subs, handlers);
    bindEffortActions(project, efforts, handlers);
    bindNoteActions(project, handlers);
    renderEffortChart(project, efforts, consumed);
  }

  function tabBtn(id, label, active) {
    return `<button type="button" data-tab="${id}" class="tab-btn border-b-2 px-1 py-3 ${
      active ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'
    }">${label}</button>`;
  }

  function switchTab(id) {
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.remove('border-sky-600', 'text-sky-700');
      b.classList.add('border-transparent', 'text-slate-500');
    });
    CET.ui.$(`tab-${id}`).classList.remove('hidden');
    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    if (btn) {
      btn.classList.add('border-sky-600', 'text-sky-700');
      btn.classList.remove('border-transparent', 'text-slate-500');
    }
  }

  function overviewTab(p, ragInfo) {
    return `
      <div class="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-3 text-sm">
        <div><span class="text-slate-500">RAG (automatic)</span><div class="mt-1">${CET.ui.ragDot(ragInfo.rag)}</div></div>
        <div><span class="text-slate-500">Next submission</span><p class="mt-1 font-medium">${u.escapeHtml(p.nextSubmissionType || '—')} · ${u.formatDateRiyadh(p.nextSubmissionDate)}</p></div>
        <div><span class="text-slate-500">Latest note</span><p class="mt-1">${u.safeText(p.latestNote || '—')}</p></div>
      </div>
      <p class="mb-3 text-xs text-slate-600">${u.escapeHtml(ragInfo.reason)}</p>
      <form id="form-overview" class="grid gap-4 md:grid-cols-2">
        ${field('Project number', 'projectNumber', p.projectNumber, true)}
        ${field('Title', 'title', p.title)}
        ${field('Client', 'client', p.client)}
        ${selectField('Stage', 'stage', CET.CONFIG.choices.stage, p.stage)}
        ${selectField('Status', 'status', CET.CONFIG.choices.status, p.status)}
        ${field('Status reason (required if Blocked / On hold)', 'statusReason', u.plainText(p.statusReason))}
        ${selectField('Cyber provisioned', 'cyberProvisioned', CET.CONFIG.choices.cyberProvisioned, p.cyberProvisioned)}
        ${field('Budget MM', 'budgetMM', p.budgetMM ?? '')}
        ${field('Cyber PM (emails ; separated)', 'cyberPM', p.cyberPMDisplay === 'Unassigned' ? '' : p.cyberPMDisplay.replace(/; /g, ';'))}
        ${field('DSS PM', 'dssPM', p.dssPMDisplay === 'Unassigned' ? '' : p.dssPMDisplay)}
        ${field('Project PM', 'projectPM', p.projectPMDisplay === 'Unassigned' ? '' : p.projectPMDisplay)}
        <div class="md:col-span-2 flex gap-2">
          <button type="submit" class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Save overview</button>
          ${
            ['Closed', 'Not awarded'].includes(p.status)
              ? `<button type="button" id="btn-delete-project" class="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">Delete project</button>`
              : ''
          }
        </div>
      </form>`;
  }

  function field(label, name, value, readOnly) {
    const ro = readOnly ? 'readonly class="mt-1 w-full rounded-lg border-slate-200 bg-slate-100 text-slate-600"' : 'class="mt-1 w-full rounded-lg border-slate-300"';
    return `<label class="block text-sm"><span class="font-medium text-slate-700">${u.escapeHtml(label)}</span>
      <input name="${name}" ${ro} value="${u.escapeHtml(value ?? '')}" /></label>`;
  }

  function selectField(label, name, choices, value) {
    return `<label class="block text-sm"><span class="font-medium text-slate-700">${u.escapeHtml(label)}</span>
      <select name="${name}" class="mt-1 w-full rounded-lg border-slate-300">${choices
      .map((c) => `<option ${c === value ? 'selected' : ''}>${u.escapeHtml(c)}</option>`)
      .join('')}</select></label>`;
  }

  function milestonesTab(subs) {
    const sorted = [...subs].sort((a, b) => (a.plannedDate || 0) - (b.plannedDate || 0));
    return `
      <div class="mb-4">${milestoneTimeline(sorted)}</div>
      <div class="mb-4 rounded-lg border bg-slate-50 p-4">
        <h3 class="text-sm font-semibold">Add milestone / deliverable</h3>
        <form id="form-add-submission" class="mt-2 grid gap-2 md:grid-cols-4">
          <select name="type" class="rounded border-slate-300 text-sm">${CET.CONFIG.choices.submissionType
            .map((t) => `<option>${u.escapeHtml(t)}</option>`)
            .join('')}</select>
          <input type="date" name="plannedDate" required class="rounded border-slate-300 text-sm" />
          <select name="submissionStatus" class="rounded border-slate-300 text-sm">${CET.CONFIG.choices.submissionStatus
            .map((s) => `<option>${s}</option>`)
            .join('')}</select>
          <button class="rounded bg-sky-600 px-3 py-2 text-sm text-white">Add</button>
        </form>
      </div>
      <table class="min-w-full text-sm">
        <thead class="text-left text-xs uppercase text-slate-500"><tr>
          <th class="py-2">Type</th><th>Planned</th><th>Actual</th><th>Status</th><th>Owner email</th><th></th>
        </tr></thead>
        <tbody>
          ${sorted
            .map((s) => {
              const plannedInput = s.plannedDate ? u.toDateKey(s.plannedDate) : '';
              return `<tr class="border-t align-top" data-sub-id="${s.id}">
                <td class="py-2"><select data-sub-field="type" data-sub-id="${s.id}" class="w-full rounded border-slate-300 text-xs">${CET.CONFIG.choices.submissionType
                  .map(
                    (t) =>
                      `<option ${t === s.type ? 'selected' : ''}>${u.escapeHtml(t)}</option>`
                  )
                  .join('')}</select></td>
                <td><input type="date" data-sub-field="plannedDate" data-sub-id="${s.id}" value="${plannedInput}" class="rounded border-slate-300 text-xs" /></td>
                <td>${u.formatDateRiyadh(s.actualDate)}</td>
                <td><select data-sub-field="submissionStatus" data-sub-id="${s.id}" class="rounded border-slate-300 text-xs">${CET.CONFIG.choices.submissionStatus
                  .map(
                    (st) =>
                      `<option ${st === s.submissionStatus ? 'selected' : ''}>${u.escapeHtml(st)}</option>`
                  )
                  .join('')}</select></td>
                <td><input data-sub-field="owner" data-sub-id="${s.id}" class="w-full min-w-[8rem] rounded border-slate-300 text-xs" placeholder="email" /></td>
                <td class="text-right space-y-1">
                  <button type="button" data-save-sub="${s.id}" class="block text-sky-700 hover:underline text-xs">Save</button>
                  ${
                    !s.actualDate && s.submissionStatus !== 'Cancelled'
                      ? `<button type="button" data-mark-submitted="${s.id}" class="block text-emerald-700 hover:underline text-xs">Mark submitted</button>`
                      : ''
                  }
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;
  }

  function milestoneTimeline(subs) {
    if (!subs.length) return '<p class="text-sm text-slate-500">No milestones yet.</p>';
    const min = subs[0].plannedDate?.getTime() || Date.now();
    const max = subs[subs.length - 1].plannedDate?.getTime() || min;
    const span = Math.max(max - min, 86400000);
    const bars = subs
      .map((s) => {
        const left = s.plannedDate ? ((s.plannedDate.getTime() - min) / span) * 100 : 0;
        const submitted = !!s.actualDate;
        let color = u.ragHex('Grey');
        if (submitted) color = u.ragHex('Green');
        else if (CET.rag.isSubmissionOverdue(s)) color = u.ragHex('Red');
        else color = u.ragHex('Amber');
        return `<div class="absolute top-0 h-full w-1.5 rounded" style="left:${left}%;background:${color}" title="${u.escapeHtml(s.type)}"></div>`;
      })
      .join('');
    return `<div class="rounded-lg border p-3"><p class="mb-2 text-xs font-medium uppercase text-slate-500">Timeline (planned → actual when submitted)</p>
      <div class="relative h-8 rounded bg-slate-100">${bars}</div>
      <div class="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">${subs
        .map(
          (s) =>
            `<span>${u.escapeHtml(s.type)}: ${u.formatDateRiyadh(s.plannedDate)}${s.actualDate ? ` → ${u.formatDateRiyadh(s.actualDate)}` : ''}</span>`
        )
        .join(' · ')}</div></div>`;
  }

  function effortTab(efforts, project, consumed) {
    const pct =
      project.budgetMM && project.budgetMM > 0 ? Math.round((consumed / project.budgetMM) * 100) : 0;
    return `
      <p class="text-sm text-slate-600">Budget ${u.normalizeNumber(project.budgetMM, 2)} MM · Consumed ${u.normalizeNumber(
      consumed,
      2
    )} MM · ${pct}% used</p>
      <canvas id="project-effort-chart" class="my-3 max-h-48" height="120"></canvas>
      <form id="form-add-effort" class="my-3 flex flex-wrap gap-2">
        <input type="month" name="month" required class="rounded border-slate-300 text-sm" />
        <input name="person" placeholder="Person email" class="rounded border-slate-300 text-sm" />
        <input name="mm" type="number" step="0.01" placeholder="MM" class="w-24 rounded border-slate-300 text-sm" />
        <button class="rounded bg-sky-600 px-3 py-2 text-sm text-white">Add effort row</button>
      </form>
      <table class="min-w-full text-sm">
        <thead class="text-xs uppercase text-slate-500"><tr><th class="text-left py-1">Month</th><th class="text-left">Person</th><th class="text-left">MM</th><th></th></tr></thead>
        <tbody>${efforts
          .map(
            (e) =>
              `<tr class="border-t"><td>${u.formatDateRiyadh(e.month)}</td><td>${u.escapeHtml(
                e.personDisplay
              )}</td><td><input type="number" step="0.01" data-effort-id="${e.id}" value="${u.normalizeNumber(
                e.mmConsumed,
                2
              )}" class="w-20 rounded border-slate-300 text-xs" /></td>
              <td><button type="button" data-save-effort="${e.id}" class="text-sky-700 text-xs hover:underline">Save</button></td></tr>`
          )
          .join('')}</tbody>
      </table>`;
  }

  let projectEffortChart;
  function renderEffortChart(project, efforts, consumed) {
    const canvas = document.getElementById('project-effort-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (projectEffortChart) projectEffortChart.destroy();
    const byMonth = new Map();
    efforts.forEach((e) => {
      const k = u.toDateKey(e.month);
      byMonth.set(k, (byMonth.get(k) || 0) + (e.mmConsumed || 0));
    });
    const labels = [...byMonth.keys()].sort();
    let cumulative = 0;
    const cum = labels.map((m) => {
      cumulative += byMonth.get(m);
      return cumulative;
    });
    const budget = project.budgetMM || 0;
    const ragInfo = CET.rag.computeRAG(project, CET.data.state.submissions, CET.data.state.efforts);
    const lineColor = CET.utils.ragHex(ragInfo.rag);
    projectEffortChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Cumulative MM', data: cum, borderColor: lineColor, backgroundColor: `${lineColor}22`, fill: true },
          {
            label: 'Budget MM',
            data: labels.map(() => budget),
            borderColor: CET.utils.ragHex('Grey'),
            borderDash: [6, 4],
            fill: false,
          },
        ],
      },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
    });
  }

  function notesTab(notes) {
    return `
      <p class="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-3 py-2">Notes are permanent — add only. They cannot be edited or deleted (audit trail).</p>
      <form id="form-add-note" class="mb-4 space-y-2 rounded-lg border p-4">
        <select name="category" class="rounded border-slate-300 text-sm">${CET.CONFIG.choices.noteCategory
          .map((c) => `<option>${c}</option>`)
          .join('')}</select>
        <textarea name="text" rows="3" required class="w-full rounded border-slate-300 text-sm" placeholder="Note text"></textarea>
        <button class="rounded bg-sky-600 px-3 py-2 text-sm text-white">Add note</button>
      </form>
      <div class="space-y-3">${notes
        .map(
          (n) =>
            `<article class="rounded-lg border p-3"><p class="text-xs text-slate-500">${u.formatDateTimeRiyadh(
              n.noteDate
            )} · ${u.escapeHtml(n.category)} · ${u.escapeHtml(n.authorDisplay            )}</p><p class="mt-1 text-sm whitespace-pre-wrap">${u.safeText(n.text)}</p></article>`
        )
        .join('')}</div>`;
  }

  function historyTab(history) {
    if (!history.length) return '<p class="text-sm text-slate-500">No history.</p>';
    return `<table class="min-w-full text-sm"><thead class="text-xs uppercase text-slate-500"><tr>
      <th class="text-left py-1">When</th><th>List</th><th>Field</th><th>Change</th><th>By</th>
    </tr></thead><tbody>${history
      .map(
        (h) => `<tr class="border-t"><td>${u.formatDateTimeRiyadh(h.changedOn)}</td><td>${u.escapeHtml(
          h.sourceList
        )}</td><td>${u.escapeHtml(h.field)}</td><td>${u.safeText(h.oldValue)} → ${u.safeText(
          h.newValue
        )}</td><td>${u.escapeHtml(h.changedByDisplay)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  }

  function bindOverviewSave(project, handlers) {
    const form = CET.ui.$('form-overview');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handlers.onSaveOverview(project, Object.fromEntries(fd.entries()));
    });
    const del = CET.ui.$('btn-delete-project');
    if (del) del.addEventListener('click', () => handlers.onDeleteProject(project));
  }

  function bindMilestoneActions(project, subs, handlers) {
    const form = CET.ui.$('form-add-submission');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handlers.onAddSubmission(project, new FormData(form));
      });
    }
    document.querySelectorAll('[data-mark-submitted]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.markSubmitted);
        const sub = subs.find((s) => s.id === id);
        if (sub) handlers.onMarkSubmitted(project, sub);
      });
    });
    document.querySelectorAll('[data-save-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.saveSub);
        const sub = subs.find((s) => s.id === id);
        if (!sub || !handlers.onUpdateSubmission) return;
        const row = btn.closest('tr');
        const type = row.querySelector('[data-sub-field="type"]').value;
        const plannedDate = row.querySelector('[data-sub-field="plannedDate"]').value;
        const submissionStatus = row.querySelector('[data-sub-field="submissionStatus"]').value;
        const owner = row.querySelector('[data-sub-field="owner"]').value;
        handlers.onUpdateSubmission(project, sub, { type, plannedDate, submissionStatus, owner });
      });
    });
  }

  function bindEffortActions(project, efforts, handlers) {
    const form = CET.ui.$('form-add-effort');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handlers.onAddEffort(project, new FormData(form));
      });
    }
    document.querySelectorAll('[data-save-effort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.saveEffort);
        const effort = efforts.find((e) => e.id === id);
        const input = document.querySelector(`input[data-effort-id="${id}"]`);
        if (effort && input && handlers.onUpdateEffort) {
          handlers.onUpdateEffort(project, effort, Number(input.value));
        }
      });
    });
  }

  function bindNoteActions(project, handlers) {
    const form = CET.ui.$('form-add-note');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handlers.onAddNote(project, new FormData(form));
      });
    }
  }

  async function resolveUserIds(emailsText) {
    const parts = String(emailsText || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const ids = [];
    for (const p of parts) {
      const ensured = await CET.sp.ensureUser(p);
      const user = ensured?.data || ensured;
      if (user?.Id) ids.push(user.Id);
    }
    return ids;
  }

  async function buildPersonPayload(fieldInternal, emailsText, isMulti) {
    const ids = await resolveUserIds(emailsText);
    const idField = `${fieldInternal}Id`;
    if (!ids.length) {
      // Omit empty person fields on create — null or { results: [] } causes SharePoint 400.
      return {};
    }
    if (isMulti) return { [idField]: { results: ids } };
    return { [idField]: ids[0] };
  }

  CET.projectUI = { renderProjectPage, buildPersonPayload };
})(window.CyberEffortsTracker);
