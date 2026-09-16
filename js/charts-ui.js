(function (CET) {
  const chartInstances = {};
  const u = CET.utils;
  const RAG_ORDER = CET.CONFIG.ragOrder;

  const gridColor = 'rgba(148, 163, 184, 0.25)';

  function destroyChart(id) {
    if (chartInstances[id]) {
      chartInstances[id].destroy();
      delete chartInstances[id];
    }
  }

  function doughnutPlugins(showLabels) {
    return {
      legend: {
        position: 'bottom',
        labels: { usePointStyle: true, pointStyle: 'circle', padding: 18 },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total ? Math.round((ctx.parsed / total) * 100) : 0;
            return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
          },
        },
      },
      datalabels: showLabels
        ? {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            color: '#fff',
            font: { weight: '600', size: 12 },
            formatter: (v) => v,
          }
        : { display: false },
    };
  }

  function renderRagDonut(canvasId, breakdown, onSegmentClick) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    let labels = RAG_ORDER.filter((r) => (breakdown.get(r) || 0) > 0);
    let data = labels.map((r) => breakdown.get(r) || 0);
    if (!labels.length) {
      labels = ['No projects'];
      data = [1];
    }
    const colors = labels.map((r) => (RAG_ORDER.includes(r) ? u.ragHex(r) : u.ragHex('Grey')));

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        animation: { animateRotate: true, duration: 900, easing: 'easeOutQuart' },
        plugins: doughnutPlugins(true),
        onClick: (_, elements) => {
          if (!elements.length || !onSegmentClick) return;
          onSegmentClick(labels[elements[0].index]);
        },
      },
    });
  }

  function renderStatusDonut(canvasId, breakdown, onSegmentClick) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = [];
    const data = [];
    const colors = [];
    const statusColors = CET.CONFIG.statusChartColors || {};
    breakdown.forEach((value, label) => {
      labels.push(label);
      data.push(value);
      colors.push(statusColors[label] || u.ragHex('Grey'));
    });

    if (!labels.length) {
      labels.push('No active projects');
      data.push(1);
      colors.push(u.ragHex('Grey'));
    }

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }],
      },
      options: {
        cutout: '62%',
        plugins: doughnutPlugins(true),
        onClick: (_, elements) => {
          if (!elements.length || !onSegmentClick) return;
          onSegmentClick(labels[elements[0].index]);
        },
      },
    });
  }

  function renderEffortBar(canvasId, rows, onBarClick) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const top = rows.slice(0, 12);
    const labels = top.map((r) => r.project.projectNumber);
    const values = top.map((r) => Math.round(r.pct));
    const colors = top.map((r) => u.effortBarRagColor(r));

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '% budget used',
            data: values,
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: {
            max: 120,
            grid: { color: gridColor },
            ticks: { callback: (v) => `${v}%` },
          },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'end',
            color: '#334155',
            font: { size: 10, weight: '600' },
            formatter: (v) => `${v}%`,
          },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const row = top[ctx.dataIndex];
                return [`RAG: ${row.project.rag}`, `Stage: ${row.project.stage}`];
              },
            },
          },
        },
        onClick: (_, elements) => {
          if (!elements.length || !onBarClick) return;
          onBarClick(top[elements[0].index].project);
        },
      },
    });
  }

  function renderLoadStacked(canvasId, state, months) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const map = CET.analytics.loadByCyberPM(state, months);
    const monthSet = new Set();
    const personSet = new Set();
    map.forEach((_, key) => {
      const [m, p] = key.split('|');
      monthSet.add(m);
      personSet.add(p);
    });
    const monthsSorted = [...monthSet].sort();
    const people = [...personSet].sort().slice(0, 8);

    const ragCycle = RAG_ORDER.map((r) => u.ragHex(r));
    const datasets = people.map((person, i) => ({
      label: person.length > 24 ? `${person.slice(0, 22)}…` : person,
      data: monthsSorted.map((m) => map.get(`${m}|${person}`) || 0),
      backgroundColor: ragCycle[i % ragCycle.length],
      borderRadius: 4,
    }));

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: { labels: monthsSorted, datasets },
      options: {
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: gridColor }, title: { display: true, text: 'Man-months' } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10 } },
          datalabels: { display: false },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    });
  }

  function renderStageFunnel(canvasId, funnel, onClick) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const max = Math.max(...funnel.map((f) => f.count), 1);
    const colors = funnel.map((f) => {
      if (f.count === 0) return `${u.ragHex('Grey')}88`;
      const t = f.count / max;
      if (t >= 0.75) return u.ragHex('Green');
      if (t >= 0.35) return u.ragHex('Amber');
      return u.ragHex('Grey');
    });

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: funnel.map((f) => f.stage),
        datasets: [
          {
            label: 'Active projects',
            data: funnel.map((f) => f.count),
            backgroundColor: colors,
            borderRadius: 8,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 1 } },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            anchor: 'end',
            align: 'top',
            color: '#475569',
            font: { weight: '600' },
          },
        },
        onClick: (_, elements) => {
          if (!elements.length || !onClick) return;
          onClick(funnel[elements[0].index].stage);
        },
      },
    });
  }

  CET.chartsUI = {
    renderRagDonut,
    renderStatusDonut,
    renderEffortBar,
    renderLoadStacked,
    renderStageFunnel,
    destroyAll: () => Object.keys(chartInstances).forEach(destroyChart),
  };
})(window.CyberEffortsTracker);
