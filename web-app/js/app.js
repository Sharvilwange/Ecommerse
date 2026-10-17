/**
 * app.js
 * Main application controller.
 * Wires together: UI events, Parser, Cleaner, Analyzer, Charts, SQLEngine.
 * Manages global app state and tab navigation.
 */

/* ═══════════════════════════════════════════════════════════════════════
   APP STATE
═══════════════════════════════════════════════════════════════════════ */
const AppState = {
  rawHeaders: [],
  rawRows: [],
  mapping: {},
  cleanedRows: [],
  changeLog: [],
  cleanStats: {},
  activeFilters: {},
  queryHistory: [],
  currentQueryCols: [],
  currentQueryRows: [],
  cmEditor: null,       // CodeMirror instance
  analyticsData: null,       // last computed dashboard data
};

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY HELPERS
═══════════════════════════════════════════════════════════════════════ */
function showLoading(msg = 'Processing…') {
  document.getElementById('loadingOverlay').classList.remove('hidden');
  document.getElementById('loadingMsg').textContent = msg;
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function downloadBlob(content, filename, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function enableTab(id) {
  const btn = document.getElementById(`tab-${id}`);
  if (btn) btn.disabled = false;
}

function fmtNum(v, decimals = 2) {
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toFixed(decimals);
}

/* ═══════════════════════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════════════════════ */
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
    btn.setAttribute('aria-selected', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}-content`);
  });
  // Refresh CodeMirror when SQL tab is opened
  if (tabId === 'sql' && AppState.cmEditor) {
    setTimeout(() => AppState.cmEditor.refresh(), 50);
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!btn.disabled) switchTab(btn.dataset.tab);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   THEME TOGGLE
═══════════════════════════════════════════════════════════════════════ */
(function initTheme() {
  const btn = document.getElementById('themeToggle');
  const html = document.documentElement;
  const saved = localStorage.getItem('sda-theme') || 'dark';
  html.setAttribute('data-theme', saved);
  btn.textContent = saved === 'dark' ? '☀️' : '🌙';

  btn.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    btn.textContent = next === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('sda-theme', next);

    // Update CodeMirror theme
    if (AppState.cmEditor) {
      AppState.cmEditor.setOption('theme', next === 'dark' ? 'dracula' : 'eclipse');
    }

    // Re-render charts
    if (AppState.analyticsData) {
      setTimeout(() => Charts.refreshAll(AppState.analyticsData), 100);
    }
  });
})();

/* ═══════════════════════════════════════════════════════════════════════
   FILE UPLOAD – DRAG AND DROP
═══════════════════════════════════════════════════════════════════════ */
(function initUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  // Drag events
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Click to open file dialog
  dropZone.addEventListener('click', e => {
    if (e.target === dropZone || e.target.classList.contains('drop-zone-inner') ||
      e.target.classList.contains('drop-icon') || e.target.classList.contains('drop-title') ||
      e.target.classList.contains('drop-sub')) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  // Sample data
  document.getElementById('loadSampleBtn').addEventListener('click', loadSampleData);
})();

async function handleFile(file) {
  const maxSize = 50 * 1024 * 1024; // 50 MB
  if (file.size > maxSize) {
    showToast('File too large. Maximum size is 50 MB.', 'error');
    return;
  }
  showLoading('Parsing file…');
  try {
    const { headers, rows } = await Parser.parseFile(file);
    if (!rows.length) throw new Error('The file contains no data rows.');
    AppState.rawHeaders = headers;
    AppState.rawRows = rows;
    AppState.mapping = Parser.autoDetectColumns(headers);
    renderRawPreview(headers, rows);
    showToast(`Loaded ${rows.length} rows from "${file.name}"`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    console.error(err);
  } finally {
    hideLoading();
  }
}

function loadSampleData() {
  showLoading('Generating sample dataset…');
  setTimeout(() => {
    try {
      const rows = SampleData.generate(500);
      const { headers, rows: parsedRows } = Parser.parseFromObjects(rows);
      AppState.rawHeaders = headers;
      AppState.rawRows = parsedRows;
      AppState.mapping = Parser.autoDetectColumns(headers);
      renderRawPreview(headers, parsedRows);
      showToast('Sample dataset loaded (500 messy rows)', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }, 50);
}

/* ═══════════════════════════════════════════════════════════════════════
   RAW PREVIEW RENDER
═══════════════════════════════════════════════════════════════════════ */
function renderRawPreview(headers, rows) {
  const section = document.getElementById('rawPreviewSection');
  const head = document.getElementById('rawPreviewHead');
  const body = document.getElementById('rawPreviewBody');
  const countBadge = document.getElementById('rawRowCount');

  section.classList.remove('hidden');
  countBadge.textContent = `${rows.length} rows`;

  // Build column mapping dropdowns
  renderMappingGrid(headers, AppState.mapping);

  // Table head
  head.innerHTML = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';

  // Table body (first 20 rows)
  body.innerHTML = rows.slice(0, 20).map(row =>
    '<tr>' + headers.map(h => {
      const v = row[h];
      const isEmpty = v === '' || v === null || v === undefined;
      return `<td class="${isEmpty ? 'null-val' : ''}">${isEmpty ? '∅ null' : escapeHtml(String(v))}</td>`;
    }).join('') + '</tr>'
  ).join('');

  enableTab('clean');

  // Scroll to preview
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMappingGrid(headers, autoMapping) {
  const grid = document.getElementById('mappingGrid');
  const CANONICAL_FIELDS = [
    'order_id', 'order_date', 'customer_id', 'segment', 'region',
    'state', 'product_id', 'product_name', 'category', 'quantity',
    'discount', 'sales', 'profit', 'ship_mode'
  ];

  grid.innerHTML = CANONICAL_FIELDS.map(field => {
    const matched = autoMapping[field];
    const options = ['(not mapped)', ...headers].map(h =>
      `<option value="${h === '(not mapped)' ? '' : h}" ${matched === h ? 'selected' : ''}>${h}</option>`
    ).join('');
    return `
      <div class="mapping-item">
        <span class="mapping-label">${field.replace(/_/g, ' ')}</span>
        <select class="mapping-select ${matched ? 'auto-matched' : ''}"
                data-field="${field}" id="map-${field}">
          ${options}
        </select>
      </div>`;
  }).join('');

  // Listen to changes
  grid.querySelectorAll('.mapping-select').forEach(sel => {
    sel.addEventListener('change', () => {
      AppState.mapping[sel.dataset.field] = sel.value || null;
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   PROCEED TO CLEANING
═══════════════════════════════════════════════════════════════════════ */
document.getElementById('proceedToCleanBtn').addEventListener('click', () => {
  // Read current mapping from dropdowns
  document.querySelectorAll('.mapping-select').forEach(sel => {
    AppState.mapping[sel.dataset.field] = sel.value || null;
  });
  initCleaningTab();
  switchTab('clean');
});

/* ═══════════════════════════════════════════════════════════════════════
   CLEANING TAB INIT
═══════════════════════════════════════════════════════════════════════ */
let cleaningRulesRendered = false;
function initCleaningTab() {
  if (!cleaningRulesRendered) {
    renderCleaningRules();
    cleaningRulesRendered = true;
  }
  runCleaning();
}

function renderCleaningRules() {
  const container = document.getElementById('cleaningRules');
  container.innerHTML = Cleaner.RULES.map(rule => `
    <label class="rule-toggle ${rule.defaultOn ? 'active' : ''}" data-rule="${rule.id}">
      <input type="checkbox" id="rule-${rule.id}" ${rule.defaultOn ? 'checked' : ''}
             onchange="document.querySelector('[data-rule=${rule.id}]').classList.toggle('active', this.checked)" />
      <div class="rule-info">
        <div class="rule-name">${rule.icon} ${rule.name}</div>
        <p class="rule-desc">${rule.desc}</p>
      </div>
    </label>
  `).join('');
}

document.getElementById('reRunCleanBtn').addEventListener('click', runCleaning);

function getEnabledRules() {
  const enabled = new Set();
  Cleaner.RULES.forEach(rule => {
    const cb = document.getElementById(`rule-${rule.id}`);
    if (cb && cb.checked) enabled.add(rule.id);
  });
  return enabled;
}

async function runCleaning() {
  showLoading('Running cleaning rules…');
  await sleep(30);

  try {
    // Apply column mapping; keepExtra=true so unmapped cols aren't lost
    const mappedRows = Parser.applyMapping(AppState.rawRows, AppState.mapping, true);
    const enabledRules = getEnabledRules();
    const { cleanedRows, changeLog, stats, outlierRows } = Cleaner.clean(mappedRows, enabledRules);

    AppState.cleanedRows = cleanedRows;
    AppState.changeLog = changeLog;
    AppState.cleanStats = stats;
    AppState.outlierRows = outlierRows || [];

    renderQualityReport(stats, mappedRows, cleanedRows, outlierRows || []);
    renderChangeLog(changeLog);

    document.getElementById('downloadCleanBtn').disabled = false;
    enableTab('dashboard');
    enableTab('sql');

    // Build dashboard first (does not depend on SQL)
    initDashboard(cleanedRows);

    // Load SQL engine; after loading, run reconciliation
    await initSQL(cleanedRows);

    showToast(`Cleaning complete: ${cleanedRows.length} rows`, 'success');
  } catch (err) {
    showToast(`Cleaning error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    hideLoading();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   QUALITY REPORT
═══════════════════════════════════════════════════════════════════════ */
function renderQualityReport(stats, rawRows, cleanRows, outlierRows) {
  const reportCard = document.getElementById('qualityReport');
  const metricsGrid = document.getElementById('qualityMetrics');
  const beforeAfter = document.getElementById('beforeAfterGrid');

  reportCard.classList.remove('hidden');

  // Only profile columns actually present in BOTH raw and clean (exclude __ flags)
  const rawCols = new Set(rawRows.length ? Object.keys(rawRows[0]).filter(k => !k.startsWith('__')) : []);
  const cleanCols = new Set(cleanRows.length ? Object.keys(cleanRows[0]).filter(k => !k.startsWith('__')) : []);
  const sharedCols = [...rawCols].filter(c => cleanCols.has(c));
  const colSet = new Set(sharedCols);

  const rawNulls = Cleaner.nullCountsPerColumn(rawRows, colSet);
  const cleanNulls = Cleaner.nullCountsPerColumn(cleanRows, colSet);

  metricsGrid.innerHTML = [
    { label: 'Rows Before', value: stats.totalRowsBefore, color: 'blue' },
    { label: 'Rows After', value: stats.totalRowsAfter, color: 'green' },
    { label: 'Duplicates Removed', value: stats.duplicatesRemoved, color: 'orange' },
    { label: 'Nulls Filled', value: stats.nullsFilled, color: 'teal' },
    { label: 'Outliers Flagged', value: stats.outliersDetected, color: 'red' },
    { label: 'Dates Parsed', value: stats.datesParsed, color: 'purple' },
  ].map(m => `
    <div class="metric-card ${m.color}">
      <div class="metric-value">${m.value.toLocaleString()}</div>
      <div class="metric-label">${m.label}</div>
    </div>
  `).join('');

  // Before / After null table – only columns that appear in both raw and clean
  const visibleCols = sharedCols.slice(0, 12);
  const makeRows = (nullMap) => visibleCols.map(c => `
    <div class="ba-row">
      <span class="ba-col">${c}</span>
      <span class="ba-val ${nullMap[c] === 0 ? 'improved' : (nullMap[c] || 0) > 5 ? 'warning' : ''}">${nullMap[c] ?? 0}</span>
    </div>`).join('');

  beforeAfter.innerHTML = `
    <div class="ba-panel">
      <h4>Before – Null Counts</h4>
      ${makeRows(rawNulls)}
    </div>
    <div class="ba-panel">
      <h4>After – Null Counts</h4>
      ${makeRows(cleanNulls)}
    </div>`;

  // Outlier detail table
  const outlierSection = document.getElementById('outlierSection');
  if (outlierSection) {
    if (outlierRows && outlierRows.length > 0) {
      const oFields = Object.keys(outlierRows[0]).filter(k => !k.startsWith('__')).slice(0, 8);
      const oHead = oFields.map(f => `<th>${f}</th>`).join('');
      const oBody = outlierRows.slice(0, 50).map(r =>
        '<tr>' + oFields.map(f => `<td>${r[f] ?? ''}</td>`).join('') + '</tr>'
      ).join('');
      outlierSection.innerHTML = `
        <h2 class="section-title">📊 Flagged Outliers <span class="badge">${outlierRows.length}</span></h2>
        <p class="section-sub">Rows where sales or profit is beyond the 3×IQR fence. Values are NOT changed.</p>
        <div class="table-wrapper"><table class="data-table"><thead><tr>${oHead}</tr></thead><tbody>${oBody}</tbody></table></div>`;
      outlierSection.classList.remove('hidden');
    } else {
      outlierSection.classList.add('hidden');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   CHANGE LOG
═══════════════════════════════════════════════════════════════════════ */
function renderChangeLog(logs) {
  const section = document.getElementById('changeLogSection');
  const list = document.getElementById('changeLogList');
  const count = document.getElementById('changeLogCount');

  section.classList.remove('hidden');
  count.textContent = logs.length;

  if (!logs.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>No changes were needed – data was already clean!</p></div>';
    return;
  }

  list.innerHTML = logs.map(entry => `
    <div class="log-entry ${entry.type || 'info'}">
      <span class="log-icon">${entry.icon || 'ℹ️'}</span>
      <span class="log-text">${entry.text}</span>
      ${entry.count != null ? `<span class="log-count">×${entry.count}</span>` : ''}
    </div>
  `).join('');
}

/* ═══════════════════════════════════════════════════════════════════════
   DOWNLOAD CLEANED CSV
═══════════════════════════════════════════════════════════════════════ */
document.getElementById('downloadCleanBtn').addEventListener('click', () => {
  const csv = Cleaner.toCSV(AppState.cleanedRows);
  downloadBlob(csv, 'sales_cleaned.csv');
  showToast('Cleaned CSV downloaded', 'success');
});

/* ═══════════════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════════════ */
function initDashboard(rows) {
  const opts = Analyzer.getFilterOptions(rows);

  // Populate filter dropdowns
  const regionSel = document.getElementById('filterRegion');
  const categorySel = document.getElementById('filterCategory');
  const segmentSel = document.getElementById('filterSegment');

  regionSel.innerHTML = '<option value="">All Regions</option>' + opts.regions.map(v => `<option>${v}</option>`).join('');
  categorySel.innerHTML = '<option value="">All Categories</option>' + opts.categories.map(v => `<option>${v}</option>`).join('');
  segmentSel.innerHTML = '<option value="">All Segments</option>' + opts.segments.map(v => `<option>${v}</option>`).join('');

  document.getElementById('filterStartDate').value = opts.minDate;
  document.getElementById('filterEndDate').value = opts.maxDate;

  AppState.activeFilters = {};
  renderDashboard(rows);
}

function renderDashboard(rows) {
  const filtered = Analyzer.applyFilters(rows, AppState.activeFilters);

  // KPIs
  const kpis = Analyzer.computeKPIs(filtered);
  renderKPIs(kpis);

  // Store total sales for reconciliation
  AppState.lastKPISales = kpis.find(k => k.id === 'total_sales')?.value || 0;

  // Charts data
  AppState.analyticsData = {
    monthly: Analyzer.computeMonthlyTrend(filtered),
    region: Analyzer.computeRegionData(filtered),
    category: Analyzer.computeCategoryData(filtered),   // may be null
    topProducts: Analyzer.computeTopProducts(filtered),    // may be { unavailable: true }
    discount: Analyzer.computeDiscountBands(filtered),
    qoq: Analyzer.computeQoQ(filtered),
  };

  Charts.refreshAll(AppState.analyticsData);

  // Insights
  const insights = Analyzer.generateInsights(filtered);
  const insightsList = document.getElementById('insightsList');
  insightsList.innerHTML = insights.map(i => `
    <div class="insight-item">
      <span class="insight-emoji">${i.emoji}</span>
      <span class="insight-text">${i.text}</span>
    </div>
  `).join('');

  // Update reconciliation badge if SQL is loaded
  updateReconciliation();
}

function renderKPIs(kpis) {
  const row = document.getElementById('kpiRow');
  // Add reconciliation badge placeholder after the KPI cards
  row.innerHTML = kpis.map(kpi => `
    <div class="kpi-card ${kpi.color}">
      <div class="kpi-icon">${kpi.icon}</div>
      <div class="kpi-value">${kpi.formatted}</div>
      <div class="kpi-label">${kpi.label}</div>
    </div>
  `).join('') + '<div id="reconciliationBadge" class="reconciliation-badge"></div>';
}

/* ── Dashboard Filters ──── */
document.getElementById('applyFilters').addEventListener('click', () => {
  AppState.activeFilters = {
    startDate: document.getElementById('filterStartDate').value || null,
    endDate: document.getElementById('filterEndDate').value || null,
    region: document.getElementById('filterRegion').value || null,
    category: document.getElementById('filterCategory').value || null,
    segment: document.getElementById('filterSegment').value || null,
  };
  renderDashboard(AppState.cleanedRows);
});

document.getElementById('resetFilters').addEventListener('click', () => {
  AppState.activeFilters = {};
  const opts = Analyzer.getFilterOptions(AppState.cleanedRows);
  document.getElementById('filterStartDate').value = opts.minDate;
  document.getElementById('filterEndDate').value = opts.maxDate;
  document.getElementById('filterRegion').value = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterSegment').value = '';
  renderDashboard(AppState.cleanedRows);
});

/* ── Export Dashboard PNG ── */
document.getElementById('downloadDashboard').addEventListener('click', async () => {
  showLoading('Generating PNG…');
  try {
    const target = document.getElementById('chartsGrid');
    const canvas = await html2canvas(target, { backgroundColor: null, scale: 2, useCORS: true });
    canvas.toBlob(blob => {
      downloadBlob(blob, 'sales_dashboard.png', 'image/png');
      showToast('Dashboard exported as PNG', 'success');
    });
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   RECONCILIATION CHECK
═══════════════════════════════════════════════════════════════════════ */
/**
 * Runs SELECT SUM(sales) FROM sales in SQL and compares to the JS KPI total.
 * Updates the reconciliation badge on the dashboard.
 */
function updateReconciliation() {
  const badge = document.getElementById('reconciliationBadge');
  if (!badge) return;

  // SQL may not be loaded yet
  if (!AppState.sqlReady) {
    badge.innerHTML = `<span class="recon-pending">⏳ Reconciliation pending SQL load…</span>`;
    return;
  }

  try {
    const { rows } = SQLEngine.query('SELECT ROUND(SUM(sales), 2) AS sql_total FROM sales');
    const sqlTotal = rows.length ? parseFloat(rows[0]['sql_total']) : 0;
    const result = Analyzer.reconcile(AppState.cleanedRows, sqlTotal);

    if (result.match) {
      badge.innerHTML = `
        <span class="recon-ok">
          ✅ Reconciliation passed &mdash; Dashboard total (${Analyzer.fmt(result.jsSales, '₹')}) matches
          SQL <code>SUM(sales)</code> (${Analyzer.fmt(result.sqlSales, '\u20b9')})
        </span>`;
    } else {
      badge.innerHTML = `
        <span class="recon-fail">
          ❌ Reconciliation mismatch &mdash; Dashboard: ${Analyzer.fmt(result.jsSales, '\u20b9')},
          SQL SUM(sales): ${Analyzer.fmt(result.sqlSales, '\u20b9')},
          diff: ${result.diff.toFixed(2)}
        </span>`;
    }
  } catch (e) {
    badge.innerHTML = `<span class="recon-pending">⏳ Run cleaning first to enable reconciliation</span>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   SQL PLAYGROUND
═══════════════════════════════════════════════════════════════════════ */
let sqlInitialised = false;
let sqlSchema = null;

async function initSQL(rows) {
  try {
    if (!sqlInitialised) {
      showLoading('Loading SQL engine…');
      await SQLEngine.init();
      sqlInitialised = true;
      initCodeMirror();
    }
    const { schema } = SQLEngine.loadData(rows);
    sqlSchema = schema;
    AppState.sqlReady = true;
    renderSchemaSidebar(schema);
    // Now that SQL is ready, update the reconciliation badge
    updateReconciliation();
  } catch (err) {
    console.error('SQL init error:', err);
    showToast('SQL engine error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function initCodeMirror() {
  if (AppState.cmEditor) return;
  const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dracula' : 'eclipse';
  AppState.cmEditor = CodeMirror(document.getElementById('sqlEditorWrap'), {
    mode: 'text/x-sql',
    theme: theme,
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    tabSize: 2,
    indentWithTabs: false,
    extraKeys: {
      'Ctrl-Enter': runQuery,
      'Cmd-Enter': runQuery,
    },
    value: `-- Welcome to the SQL Playground!\n-- Type a query below or pick an example above.\n\nSELECT * FROM sales LIMIT 10;`,
    lineWrapping: true,
  });
}

function renderSchemaSidebar(schema) {
  const panel = document.getElementById('schemaPanel');
  panel.innerHTML = Object.entries(schema).map(([tableName, cols]) => `
    <div class="schema-table-name">📋 ${tableName}</div>
    ${cols.map(col => `
      <div class="schema-col" onclick="insertColName('${col.name}')" title="Click to insert">
        <span class="schema-col-name">${col.name}</span>
        <span class="schema-col-type">${col.type}</span>
      </div>
    `).join('')}
  `).join('');
}

window.insertColName = function (name) {
  if (AppState.cmEditor) {
    AppState.cmEditor.replaceSelection(name);
    AppState.cmEditor.focus();
  }
};

/* ── Example Queries ── */
document.getElementById('exampleQueries').addEventListener('change', function () {
  const id = this.value;
  if (!id) return;
  const sql = SQLEngine.getExampleQuery(id);
  if (sql && AppState.cmEditor) {
    AppState.cmEditor.setValue(sql);
    AppState.cmEditor.focus();
  }
  this.value = '';
});

/* ── Run Query ── */
document.getElementById('runQueryBtn').addEventListener('click', runQuery);
document.getElementById('clearQueryBtn').addEventListener('click', () => {
  if (AppState.cmEditor) AppState.cmEditor.setValue('');
});

function runQuery() {
  const sql = AppState.cmEditor ? AppState.cmEditor.getValue().trim() : '';
  if (!sql) { showToast('Please enter a SQL query.', 'warn'); return; }

  const errDiv = document.getElementById('queryError');
  const metaDiv = document.getElementById('queryMeta');
  const resultTable = document.getElementById('queryResultTable');
  const resultEmpty = document.getElementById('queryResultEmpty');
  const dlBtn = document.getElementById('downloadResultsBtn');
  const chartBtn = document.getElementById('chartResultBtn');

  errDiv.classList.add('hidden');
  errDiv.textContent = '';

  try {
    const { columns, rows, time } = SQLEngine.query(sql);

    AppState.currentQueryCols = columns;
    AppState.currentQueryRows = rows;

    // Push to history
    addToHistory(sql);

    if (!columns.length || !rows.length) {
      resultEmpty.classList.remove('hidden');
      resultTable.classList.add('hidden');
      metaDiv.textContent = `Query executed in ${time}ms – 0 rows returned.`;
      dlBtn.disabled = true; chartBtn.disabled = true;
      return;
    }

    metaDiv.textContent = `${rows.length} row${rows.length !== 1 ? 's' : ''} · ${time}ms`;

    // Build sortable table
    renderResultTable(columns, rows);
    resultEmpty.classList.add('hidden');
    resultTable.classList.remove('hidden');
    dlBtn.disabled = false;
    chartBtn.disabled = false;

    // Hide old chart
    document.getElementById('queryChartWrap').classList.add('hidden');

  } catch (err) {
    errDiv.textContent = `❌ ${err.message}`;
    errDiv.classList.remove('hidden');
    metaDiv.textContent = '';
    resultTable.classList.add('hidden');
    resultEmpty.classList.remove('hidden');
    dlBtn.disabled = true; chartBtn.disabled = true;
  }
}

function renderResultTable(columns, rows) {
  const head = document.getElementById('queryResultHead');
  const body = document.getElementById('queryResultBody');

  head.innerHTML = '<tr>' + columns.map(c => `<th id="qth-${c}">${c}</th>`).join('') + '</tr>';

  const MAX_ROWS = 500;
  body.innerHTML = rows.slice(0, MAX_ROWS).map(row =>
    '<tr>' + columns.map(c => {
      const v = row[c];
      const isEmpty = v === null || v === undefined;
      return `<td class="${isEmpty ? 'null-val' : ''}">${isEmpty ? 'NULL' : escapeHtml(String(v))}</td>`;
    }).join('') + '</tr>'
  ).join('');

  if (rows.length > MAX_ROWS) {
    body.innerHTML += `<tr><td colspan="${columns.length}" style="text-align:center;color:var(--text-muted);padding:12px;">
      Showing first ${MAX_ROWS} of ${rows.length} rows
    </td></tr>`;
  }

  // Sortable columns
  let sortState = { col: null, asc: true };
  head.querySelectorAll('th').forEach((th, idx) => {
    th.addEventListener('click', () => {
      const col = columns[idx];
      sortState.asc = sortState.col === col ? !sortState.asc : true;
      sortState.col = col;
      head.querySelectorAll('th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortState.asc ? 'sort-asc' : 'sort-desc');

      const sorted = [...rows].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return sortState.asc ? an - bn : bn - an;
        return sortState.asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });

      body.innerHTML = sorted.slice(0, MAX_ROWS).map(row =>
        '<tr>' + columns.map(c => {
          const v = row[c];
          const isEmpty = v === null || v === undefined;
          return `<td class="${isEmpty ? 'null-val' : ''}">${isEmpty ? 'NULL' : escapeHtml(String(v))}</td>`;
        }).join('') + '</tr>'
      ).join('');
    });
  });
}

/* ── Download Results CSV ── */
document.getElementById('downloadResultsBtn').addEventListener('click', () => {
  const csv = SQLEngine.resultToCSV(AppState.currentQueryCols, AppState.currentQueryRows);
  downloadBlob(csv, 'query_results.csv');
  showToast('Results downloaded', 'success');
});

/* ── Chart This Result ── */
let queryChartInstance = null;
document.getElementById('chartResultBtn').addEventListener('click', () => {
  const wrap = document.getElementById('queryChartWrap');
  if (wrap.classList.contains('hidden')) {
    wrap.classList.remove('hidden');
    Charts.renderQueryChart(AppState.currentQueryCols, AppState.currentQueryRows, 'queryChart');
  } else {
    wrap.classList.add('hidden');
  }
});

/* ── Query History ── */
// Stores truncated display versions
// Full SQL is stored alongside for recall
const fullQueryHistory = [];

function addToHistory(sql) {
  const short = sql.replace(/\s+/g, ' ').trim().substring(0, 60) + (sql.length > 60 ? '…' : '');
  // Avoid exact duplicates at the top
  if (fullQueryHistory[0] === sql) return;
  AppState.queryHistory.unshift(short);
  fullQueryHistory.unshift(sql);
  if (AppState.queryHistory.length > 10) { AppState.queryHistory.pop(); fullQueryHistory.pop(); }

  const historyDiv = document.getElementById('queryHistory');
  historyDiv.innerHTML = AppState.queryHistory.map((q, i) => `
    <div class="history-item" onclick="loadHistoryQuery(${i})" title="Click to load query">${escapeHtml(q)}</div>
  `).join('');
}

window.loadHistoryQuery = function (i) {
  const q = fullQueryHistory[i];
  if (q && AppState.cmEditor) {
    AppState.cmEditor.setValue(q);
    AppState.cmEditor.focus();
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   MISC UTILITIES
═══════════════════════════════════════════════════════════════════════ */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════════ */
(function init() {
  // CodeMirror init is deferred to SQL tab open
  console.log('🚀 Sales Data Analyzer ready');
})();
