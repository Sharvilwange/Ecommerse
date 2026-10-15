/**
 * charts.js
 * Chart.js wrapper module – creates and updates all 6 dashboard charts
 * plus the SQL result mini-chart.
 * All charts are stored in a registry for easy update on filter change.
 */

const Charts = (() => {

  /* ── Color Palette ─────────────────────────────────────────────────── */
  const PALETTE = {
    blue: '#4f6ef7',
    blueLight: '#6f8cff',
    orange: '#ff8c42',
    teal: '#2dd4bf',
    green: '#4ade80',
    red: '#f87171',
    purple: '#a78bfa',
    yellow: '#fbbf24',
  };

  const CHART_COLORS = [
    PALETTE.blue, PALETTE.orange, PALETTE.teal, PALETTE.green,
    PALETTE.purple, PALETTE.red, PALETTE.yellow, '#60a5fa', '#34d399', '#fb923c'
  ];

  // Chart.js instance registry
  const registry = {};

  /* ── Shared Chart.js Defaults ──────────────────────────────────────── */
  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function getDefaults() {
    const dark = isDark();
    return {
      textColor: dark ? '#8892b0' : '#4a5568',
      gridColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      fontFamily: "'Inter', sans-serif",
    };
  }

  function destroyIfExists(id) {
    if (registry[id]) {
      try { registry[id].destroy(); } catch (e) { }
      delete registry[id];
    }
  }

  function baseOptions(title, extra = {}) {
    const d = getDefaults();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: {
          labels: {
            color: d.textColor,
            font: { family: d.fontFamily, size: 11 },
            padding: 16,
            boxWidth: 12,
          }
        },
        tooltip: {
          backgroundColor: isDark() ? '#1e2333' : '#ffffff',
          titleColor: isDark() ? '#e8eaf6' : '#1a1f35',
          bodyColor: isDark() ? '#8892b0' : '#4a5568',
          borderColor: isDark() ? '#2d3348' : '#dde1f0',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function (ctx) {
              const horizontal = ctx.chart && ctx.chart.options && ctx.chart.options.indexAxis === 'y';
              let v = horizontal ? ctx.parsed.x : (ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed);
              if (typeof v === 'number') {
                if (extra.currency) return ` ₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
                if (extra.percent) return ` ${v}%`;
              }
              return ` ${v}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: d.textColor, font: { family: d.fontFamily, size: 11 }, maxRotation: 45 },
          grid: { color: d.gridColor },
        },
        y: {
          ticks: { color: d.textColor, font: { family: d.fontFamily, size: 11 } },
          grid: { color: d.gridColor },
        }
      },
      ...extra
    };
  }

  // Hides the legend while keeping the tooltip formatting (₹ / %) from baseOptions
  function noLegend(opts) {
    opts.plugins.legend = { display: false };
    return opts;
  }

  /* ── Monthly Trend (line) ──────────────────────────────────────────── */
  function renderMonthly(data) {
    destroyIfExists('monthly');
    const ctx = document.getElementById('chartMonthly').getContext('2d');
    registry['monthly'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [
          {
            label: 'Sales',
            data: data.sales,
            borderColor: PALETTE.blue,
            backgroundColor: 'rgba(79,110,247,0.12)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            borderWidth: 2.5,
          },
          {
            label: 'Profit',
            data: data.profits,
            borderColor: PALETTE.teal,
            backgroundColor: 'rgba(45,212,191,0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            borderWidth: 2.5,
          }
        ]
      },
      options: baseOptions('monthly', { currency: true })
    });
  }

  /* ── Sales by Region (bar) ─────────────────────────────────────────── */
  function renderRegion(data) {
    destroyIfExists('region');
    const ctx = document.getElementById('chartRegion').getContext('2d');
    registry['region'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: 'Sales',
          data: data.values,
          backgroundColor: data.labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + 'cc'),
          borderColor: data.labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: noLegend(baseOptions('region', { currency: true }))
    });
  }

  /* ── Category Share (donut) ────────────────────────────────────────── */
  /**
   * Renders the category donut, or shows a friendly note if data is null
   * (category column absent from the uploaded file).
   *
   * Uses stable id="chartCategoryCard" on the wrapper div so we never
   * need to call .closest() on a canvas that might have been replaced.
   */
  function renderCategory(data) {
    destroyIfExists('category');
    // Use the STABLE card id, never .closest() on a potentially-missing canvas
    const card = document.getElementById('chartCategoryCard');
    if (!card) return; // element not in DOM at all – bail safely

    // data === null means category column not present in this file
    if (!data || !data.labels || !data.labels.length) {
      card.innerHTML = `
        <h3 class="chart-title">Category Share</h3>
        <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center">
          <div class="empty-state">
            <div class="empty-icon">📂</div>
            <p>Category column not found in this file.<br>
               Upload a file with a <code>category</code> or <code>dept</code> column to see this chart.</p>
          </div>
        </div>`;
      return;
    }

    // Restore the canvas if the card was previously replaced with the note
    if (!card.querySelector('canvas#chartCategory')) {
      card.innerHTML = '<h3 class="chart-title">Category Share</h3>' +
        '<div class="chart-wrap"><canvas id="chartCategory"></canvas></div>';
    }

    const canvasEl = document.getElementById('chartCategory');
    if (!canvasEl) return; // guard
    const ctx = canvasEl.getContext('2d');
    registry['category'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
          backgroundColor: CHART_COLORS.slice(0, data.labels.length),
          borderColor: isDark() ? '#1e2333' : '#ffffff',
          borderWidth: 3,
          hoverOffset: 10,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        animation: { duration: 700 },
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: getDefaults().textColor,
              font: { family: getDefaults().fontFamily, size: 11 },
              padding: 12,
              boxWidth: 12,
            }
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                return ` ${ctx.label}: ₹${ctx.parsed.toLocaleString()} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  /* ── Top 10 Products (horizontal bar) ─────────────────────────────── */
  function renderTopProducts(data) {
    destroyIfExists('topProducts');
    // Use the STABLE card id to avoid .closest() on a missing canvas
    const card = document.getElementById('chartTopProductsCard');
    if (!card) return;

    if (!data || data.unavailable || !data.labels || !data.labels.length) {
      card.innerHTML = `
        <h3 class="chart-title">Top 10 Products by Sales</h3>
        <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center">
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <p>No product name or product ID column found in this file.<br>
               This chart requires a <code>product_name</code> / <code>Product Name</code> column.</p>
          </div>
        </div>`;
      return;
    }

    // Restore canvas if card was previously replaced
    if (!card.querySelector('canvas#chartTopProducts')) {
      card.innerHTML = '<h3 class="chart-title">Top 10 Products by Sales</h3>' +
        '<div class="chart-wrap"><canvas id="chartTopProducts"></canvas></div>';
    }

    const canvasEl = document.getElementById('chartTopProducts');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');

    // Shorten long product names
    const shortLabels = data.labels.map(l => l.length > 22 ? l.substring(0, 20) + '…' : l);

    registry['topProducts'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: shortLabels,
        datasets: [{
          label: 'Sales',
          data: data.values,
          backgroundColor: data.values.map((_, i) =>
            `hsl(${220 + i * 14}, 80%, ${isDark() ? '60%' : '50%'})`
          ),
          borderRadius: 5,
          borderSkipped: false,
        }]
      },
      options: {
        ...noLegend(baseOptions('topProducts', { currency: true })),
        indexAxis: 'y'
      }
    });
  }

  /* ── Discount Band vs Profit Margin (grouped bar) ──────────────────── */
  function renderDiscount(data) {
    destroyIfExists('discount');
    const ctx = document.getElementById('chartDiscount').getContext('2d');
    const colors = data.margins.map(v => v >= 0 ? PALETTE.teal + 'cc' : PALETTE.red + 'cc');
    registry['discount'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: 'Profit Margin %',
          data: data.margins,
          backgroundColor: colors,
          borderColor: data.margins.map(v => v >= 0 ? PALETTE.teal : PALETTE.red),
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: noLegend(baseOptions('discount', { percent: true }))
    });
  }

  /* ── Quarter-over-Quarter Growth (line + bar combo) ────────────────── */
  function renderQoQ(data) {
    destroyIfExists('qoq');
    const ctx = document.getElementById('chartQoQ').getContext('2d');
    registry['qoq'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          {
            label: 'Sales',
            data: data.values,
            type: 'bar',
            backgroundColor: PALETTE.blue + '80',
            borderColor: PALETTE.blue,
            borderWidth: 2,
            borderRadius: 4,
            yAxisID: 'y',
          },
          {
            label: 'QoQ Growth %',
            data: data.growth,
            type: 'line',
            borderColor: PALETTE.orange,
            backgroundColor: 'transparent',
            pointRadius: 5,
            pointHoverRadius: 8,
            borderWidth: 2.5,
            tension: 0.3,
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: {
            labels: { color: getDefaults().textColor, font: { size: 11, family: getDefaults().fontFamily }, padding: 12 }
          }
        },
        scales: {
          x: { ticks: { color: getDefaults().textColor, font: { size: 10 }, maxRotation: 45 }, grid: { color: getDefaults().gridColor } },
          y: { ticks: { color: getDefaults().textColor, font: { size: 11 } }, grid: { color: getDefaults().gridColor }, position: 'left' },
          y1: { ticks: { color: PALETTE.orange, font: { size: 11 }, callback: v => v + '%' }, grid: { drawOnChartArea: false }, position: 'right' }
        }
      }
    });
  }

  /* ── SQL Result Mini-Chart ─────────────────────────────────────────── */
  function renderQueryChart(columns, rows, canvasId = 'queryChart') {
    destroyIfExists('queryResult');

    // Auto-detect label column (first text col) and value column (first numeric col)
    let labelCol = null, valueCol = null;
    for (const col of columns) {
      const sample = rows.map(r => r[col]).find(v => v !== '' && v != null);
      if (!labelCol && isNaN(parseFloat(sample))) labelCol = col;
      if (!valueCol && !isNaN(parseFloat(sample))) valueCol = col;
      if (labelCol && valueCol) break;
    }

    if (!valueCol) { console.warn('No numeric column found for chart.'); return; }

    const labels = labelCol ? rows.map(r => String(r[labelCol] || '')) : rows.map((_, i) => `Row ${i + 1}`);
    const values = rows.map(r => parseFloat(r[valueCol]) || 0);

    const ctx = document.getElementById(canvasId).getContext('2d');
    registry['queryResult'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: valueCol,
          data: values,
          backgroundColor: CHART_COLORS.slice(0, values.length).map(c => c + 'cc'),
          borderColor: CHART_COLORS.slice(0, values.length),
          borderWidth: 2,
          borderRadius: 5,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: isDark() ? '#1e2333' : '#fff', borderColor: isDark() ? '#2d3348' : '#dde1f0', borderWidth: 1 }
        },
        scales: {
          x: { ticks: { color: getDefaults().textColor, font: { size: 11 }, maxRotation: 45 }, grid: { color: getDefaults().gridColor } },
          y: { ticks: { color: getDefaults().textColor, font: { size: 11 } }, grid: { color: getDefaults().gridColor } }
        }
      }
    });
  }

  /* ── Refresh all charts (theme change or filter) ──────────────────── */
  function refreshAll(analyticsData) {
    if (!analyticsData) return;
    const safe = (name, fn) => { try { fn(); } catch (e) { console.error(`Chart "${name}" failed:`, e); } };
    if (analyticsData.monthly) safe('monthly', () => renderMonthly(analyticsData.monthly));
    if (analyticsData.region) safe('region', () => renderRegion(analyticsData.region));
    safe('category', () => renderCategory(analyticsData.category));       // may be null → friendly note
    safe('topProducts', () => renderTopProducts(analyticsData.topProducts)); // may be unavailable
    if (analyticsData.discount) safe('discount', () => renderDiscount(analyticsData.discount));
    if (analyticsData.qoq) safe('qoq', () => renderQoQ(analyticsData.qoq));
  }

  /* ── Destroy all charts ────────────────────────────────────────────── */
  function destroyAll() {
    Object.keys(registry).forEach(destroyIfExists);
  }

  return {
    renderMonthly,
    renderRegion,
    renderCategory,
    renderTopProducts,
    renderDiscount,
    renderQoQ,
    renderQueryChart,
    refreshAll,
    destroyAll,
  };

})();

// Diagnostic: confirms in the browser Console that this file parsed and Charts exists
console.log('[charts.js] loaded OK - Charts is', typeof Charts);