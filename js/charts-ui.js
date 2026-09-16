(function (CET) {
  const chartInstances = {};
  const u = CET.utils;
  const RAG_ORDER = CET.CONFIG.ragOrder;
  const gridColor = 'rgba(148, 163, 184, 0.25)';
  const fontFamily = "'Segoe UI', system-ui, sans-serif";

  function useApex() {
    return typeof ApexCharts !== 'undefined';
  }

  function hostEl(id) {
    return document.getElementById(id);
  }

  function destroyChart(id) {
    const inst = chartInstances[id];
    if (!inst) return;
    try {
      if (inst.destroy) inst.destroy();
    } catch (_) {
      /* ignore */
    }
    delete chartInstances[id];
    const el = hostEl(id);
    if (el) el.innerHTML = '';
  }

  function ensureCanvas(hostId) {
    const host = hostEl(hostId);
    if (!host) return null;
    host.innerHTML = '';
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    return canvas;
  }

  function apexBase(extra) {
    return {
      chart: {
        fontFamily,
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 750 },
        ...(extra || {}),
      },
      grid: { borderColor: '#e2e8f0', strokeDashArray: 4, padding: { left: 8, right: 12 } },
      tooltip: {
        theme: 'light',
        style: { fontSize: '13px', fontFamily },
        y: { formatter: (v) => (Number.isFinite(v) ? v : v) },
      },
      legend: {
        fontSize: '13px',
        fontFamily,
        labels: { colors: '#475569' },
      },
    };
  }

  function mountApex(hostId, options) {
    destroyChart(hostId);
    const el = hostEl(hostId);
    if (!el) return;
    chartInstances[hostId] = new ApexCharts(el, options);
    chartInstances[hostId].render();
  }

  function donutPlugins(showLabels) {
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

  function renderDonutApex(hostId, labels, series, colors, centerLabel, onPick) {
    const total = series.reduce((a, b) => a + b, 0);
    const opts = {
      ...apexBase({
        type: 'donut',
        height: 280,
        events: {
          dataPointSelection: (_e, _ctx, cfg) => {
            if (!onPick || cfg.dataPointIndex < 0) return;
            const label = labels[cfg.dataPointIndex];
            if (label && !String(label).startsWith('No ')) onPick(label);
          },
        },
      }),
      series,
      labels,
      colors,
      states: { hover: { filter: { type: 'lighten', value: 0.08 } } },
      plotOptions: {
        pie: {
          expandOnClick: true,
          donut: {
            size: '68%',
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: '13px',
                color: '#64748b',
                offsetY: -4,
              },
              value: {
                show: true,
                fontSize: '26px',
                fontWeight: 600,
                color: '#0f172a',
                offsetY: 4,
                formatter: (val) => (total ? val : '0'),
              },
              total: {
                show: true,
                showAlways: true,
                label: centerLabel,
                fontSize: '12px',
                color: '#94a3b8',
                formatter: () => String(total),
              },
            },
          },
        },
      },
      dataLabels: {
        enabled: true,
        dropShadow: { enabled: false },
        style: { fontSize: '12px', fontWeight: 600 },
        formatter: (val, opts) => {
          const n = opts.w.config.series[opts.seriesIndex];
          return n > 0 ? `${Math.round(val)}%` : '';
        },
      },
      legend: { position: 'bottom', horizontalAlign: 'center', fontSize: '13px' },
      stroke: { width: 2, colors: ['#fff'] },
      noData: { text: 'No data yet', align: 'center', style: { color: '#64748b', fontSize: '14px' } },
    };
    mountApex(hostId, opts);
  }

  function renderRagDonut(canvasId, breakdown, onSegmentClick) {
    destroyChart(canvasId);
    let labels = RAG_ORDER.filter((r) => (breakdown.get(r) || 0) > 0);
    let data = labels.map((r) => breakdown.get(r) || 0);
    if (!labels.length) {
      labels = ['No active projects'];
      data = [0];
    }
    const colors = labels.map((r) => (RAG_ORDER.includes(r) ? u.ragHex(r) : u.ragHex('Grey')));

    if (useApex() && labels[0] !== 'No active projects') {
      renderDonutApex(canvasId, labels, data, colors, 'Projects', onSegmentClick);
      return;
    }
    if (useApex() && labels[0] === 'No active projects') {
      renderDonutApex(canvasId, ['No projects'], [1], [u.ragHex('Grey')], 'Projects', null);
      return;
    }

    const canvas = ensureCanvas(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const chartData = labels[0] === 'No active projects' ? [1] : data;
    chartInstances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: chartData, backgroundColor: colors, borderWidth: 2, borderColor: '#ffffff', hoverOffset: 10 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        plugins: donutPlugins(true),
        onClick: (_, elements) => {
          if (!elements.length || !onSegmentClick) return;
          onSegmentClick(labels[elements[0].index]);
        },
      },
    });
  }

  function renderStatusDonut(canvasId, breakdown, onSegmentClick) {
    destroyChart(canvasId);
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
      if (useApex()) {
        renderDonutApex(canvasId, ['No active projects'], [1], [u.ragHex('Grey')], 'By status', null);
        return;
      }
      labels.push('No active projects');
      data.push(1);
      colors.push(u.ragHex('Grey'));
    }

    if (useApex()) {
      renderDonutApex(canvasId, labels, data, colors, 'By status', onSegmentClick);
      return;
    }

    const canvas = ensureCanvas(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    chartInstances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }] },
      options: {
        cutout: '62%',
        plugins: donutPlugins(true),
        onClick: (_, elements) => {
          if (!elements.length || !onSegmentClick) return;
          onSegmentClick(labels[elements[0].index]);
        },
      },
    });
  }

  function renderStageFunnel(canvasId, funnel, onClick) {
    destroyChart(canvasId);
    const categories = funnel.map((f) => f.stage);
    const values = funnel.map((f) => f.count);
    const barColors = values.map((c) => (c > 0 ? '#0284c7' : '#e2e8f0'));

    if (useApex()) {
      const chartH = Math.max(300, categories.length * 38);
      mountApex(canvasId, {
        ...apexBase({
          type: 'bar',
          height: chartH,
          events: {
            dataPointSelection: (_e, _ctx, cfg) => {
              if (!onClick || cfg.dataPointIndex < 0) return;
              onClick(categories[cfg.dataPointIndex]);
            },
          },
        }),
        series: [{ name: 'Active projects', data: values }],
        plotOptions: {
          bar: {
            horizontal: true,
            borderRadius: 6,
            barHeight: '72%',
            distributed: true,
          },
        },
        colors: barColors,
        dataLabels: {
          enabled: true,
          style: { fontSize: '12px', fontWeight: 600, colors: ['#fff', '#64748b'] },
          formatter: (val) => (val > 0 ? val : ''),
          background: { enabled: false },
        },
        xaxis: {
          categories,
          tickAmount: 5,
          title: { text: 'Number of projects', style: { fontSize: '12px', color: '#64748b', fontWeight: 500 } },
          labels: { style: { fontSize: '12px' } },
        },
        yaxis: {
          labels: { maxWidth: 200, style: { fontSize: '12px', colors: '#334155' } },
        },
        legend: { show: false },
        grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
        tooltip: {
          y: { formatter: (v) => `${v} project${v === 1 ? '' : 's'}` },
        },
      });
      return;
    }

    const canvas = ensureCanvas(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: categories,
        datasets: [{ label: 'Active projects', data: values, backgroundColor: barColors, borderRadius: 8, maxBarThickness: 48 }],
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { beginAtZero: true, grid: { color: gridColor }, ticks: { stepSize: 1 } },
          y: { grid: { display: false } },
        },
        plugins: { legend: { display: false }, datalabels: { display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'end' } },
        onClick: (_, elements) => {
          if (!elements.length || !onClick) return;
          onClick(categories[elements[0].index]);
        },
      },
    });
  }

  function renderEffortBar(canvasId, rows, onBarClick) {
    destroyChart(canvasId);
    const top = rows.slice(0, 10);
    const labels = top.map((r) => r.project.projectNumber);
    const values = top.map((r) => Math.round(r.pct * 10) / 10);
    const colors = top.map((r) => u.effortBarRagColor(r));

    if (useApex()) {
      const chartH = Math.max(320, top.length * 44);
      const xMax = Math.min(120, Math.max(100, ...values, 0) + 10);
      mountApex(canvasId, {
        ...apexBase({
          type: 'bar',
          height: chartH,
          events: {
            dataPointSelection: (_e, _ctx, cfg) => {
              if (!onBarClick || cfg.dataPointIndex < 0) return;
              onBarClick(top[cfg.dataPointIndex].project);
            },
          },
        }),
        series: [{ name: '% budget used', data: values }],
        plotOptions: {
          bar: {
            horizontal: true,
            borderRadius: 6,
            barHeight: '68%',
            distributed: true,
          },
        },
        colors,
        dataLabels: {
          enabled: true,
          offsetX: 28,
          style: { fontSize: '11px', fontWeight: 600, colors: ['#334155'] },
          formatter: (val) => `${val}%`,
          background: { enabled: false },
        },
        xaxis: {
          categories: labels,
          max: xMax,
          labels: { formatter: (v) => `${Math.round(v)}%`, style: { fontSize: '12px' } },
          title: { text: '% of cyber budget consumed', style: { fontSize: '12px', color: '#64748b' } },
        },
        annotations: {
          xaxis: [
            {
              x: 80,
              borderColor: '#d97706',
              strokeDashArray: 4,
              label: {
                text: '80% watch line',
                orientation: 'horizontal',
                style: { background: '#fff7ed', color: '#b45309', fontSize: '10px' },
              },
            },
            {
              x: 100,
              borderColor: '#94a3b8',
              strokeDashArray: 2,
              label: { text: '100%', style: { background: '#f8fafc', color: '#64748b', fontSize: '10px' } },
            },
          ],
        },
        legend: { show: false },
        tooltip: {
          custom: ({ series, seriesIndex, dataPointIndex, w }) => {
            const row = top[dataPointIndex];
            const pct = series[seriesIndex][dataPointIndex];
            const p = row.project;
            return `<div class="apex-tooltip-custom">
              <strong>${w.globals.labels[dataPointIndex]}</strong>
              <div>${pct}% of budget</div>
              <div>RAG: ${p.rag} · ${p.stage}</div>
              <div style="color:#64748b">${row.consumed.toFixed(1)} / ${row.budget.toFixed(1)} MM</div>
            </div>`;
          },
        },
      });
      return;
    }

    const canvas = ensureCanvas(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '% budget used', data: values, backgroundColor: colors, borderRadius: 6, maxBarThickness: 22 }],
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { max: 120, grid: { color: gridColor }, ticks: { callback: (v) => `${v}%` } },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          datalabels: { display: true, anchor: 'end', align: 'end', formatter: (v) => `${v}%` },
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

    if (useApex()) {
      const series = people.map((person) => ({
        name: person.length > 28 ? `${person.slice(0, 26)}…` : person,
        data: monthsSorted.map((m) => Math.round((map.get(`${m}|${person}`) || 0) * 100) / 100),
      }));

      mountApex(canvasId, {
        ...apexBase({ type: 'bar', height: 320, stacked: true }),
        series,
        colors: ragCycle.slice(0, people.length),
        plotOptions: { bar: { horizontal: false, borderRadius: 4, columnWidth: '55%' } },
        xaxis: {
          categories: monthsSorted.map((m) => {
            const [y, mo] = m.split('-');
            const d = new Date(Number(y), Number(mo) - 1, 1);
            return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
          }),
          labels: { rotate: -35, style: { fontSize: '11px' } },
        },
        yaxis: {
          title: { text: 'Man-months logged', style: { fontSize: '12px', color: '#64748b' } },
          labels: { formatter: (v) => (Number.isInteger(v) ? v : v.toFixed(1)) },
        },
        legend: { position: 'bottom', horizontalAlign: 'center', fontSize: '12px' },
        fill: { opacity: 0.92 },
        tooltip: { shared: true, intersect: false, y: { formatter: (v) => `${v} MM` } },
      });
      return;
    }

    const canvas = ensureCanvas(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
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
        plugins: { legend: { position: 'bottom' }, datalabels: { display: false } },
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
