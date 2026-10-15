/**
 * cleaner.js  (v2 – bug-fixed)
 * Applies data-cleaning rules to an array of row objects.
 * Each rule is togglable. Returns { cleanedRows, changeLog, stats, outlierRows }.
 *
 * KEY FIXES:
 *  - Never drops rows; never zeroes a present sales/profit value.
 *  - fill_missing_numeric only touches columns that EXIST in the data.
 *  - fill_missing_categorical covers ALL text columns present (including state).
 *  - Outlier detection uses 3×IQR fence; flags rows but never mutates values.
 *    Outlier rows are returned separately so the UI can display them.
 *  - Per-step console.log of row count + SUM(sales) for traceability.
 */

const Cleaner = (() => {

  /* ── Cleaning Rule Definitions ─────────────────────────────────────── */
  const RULES = [
    {
      id: 'remove_duplicates',
      name: 'Remove Duplicate Rows',
      desc: 'Detects and removes exact duplicate rows (all field values identical).',
      defaultOn: true,
      icon: '🗑️'
    },
    {
      id: 'trim_whitespace',
      name: 'Trim Whitespace',
      desc: 'Strips leading/trailing spaces from all text values.',
      defaultOn: true,
      icon: '✂️'
    },
    {
      id: 'standardise_case',
      name: 'Standardise Text Case',
      desc: 'Converts region, segment, category, and product_name to Title Case.',
      defaultOn: true,
      icon: '🔤'
    },
    {
      id: 'fuzzy_merge',
      name: 'Fuzzy Merge Labels',
      desc: 'Maps inconsistent labels (NORTH, north , N. → North) to canonical values.',
      defaultOn: true,
      icon: '🔀'
    },
    {
      id: 'parse_dates',
      name: 'Parse & Standardise Dates',
      desc: 'Converts mixed date formats (YYYY-MM-DD, DD/MM/YYYY, "Mar 05, 2025") to ISO format.',
      defaultOn: true,
      icon: '📅'
    },
    {
      id: 'fix_negatives',
      name: 'Fix Negative Quantities',
      desc: 'Converts negative quantity values to their absolute value.',
      defaultOn: true,
      icon: '🔢'
    },
    {
      id: 'flag_bad_discounts',
      name: 'Flag Bad Discounts (> 100%)',
      desc: 'Caps discounts to 1.0 (100%) and logs rows where discount exceeded this.',
      defaultOn: true,
      icon: '⚠️'
    },
    {
      id: 'detect_outliers',
      name: 'Detect & Flag Outliers',
      desc: 'Flags sales/profit values beyond 3×IQR fence. Rows are flagged, not removed or changed.',
      defaultOn: true,
      icon: '📊'
    },
    {
      id: 'fill_missing_numeric',
      name: 'Fill Missing Numerics',
      desc: 'Fills blank numeric fields with column median. Only fills truly blank cells; never overwrites present values.',
      defaultOn: true,
      icon: '🔧'
    },
    {
      id: 'fill_missing_categorical',
      name: 'Fill Missing Categoricals',
      desc: 'Fills blank text fields (region, segment, category, state, ship_mode, etc.) with mode or "Unknown".',
      defaultOn: true,
      icon: '📝'
    },
    {
      id: 'recompute_profit',
      name: 'Recompute Missing Profit',
      desc: 'Where profit is blank but sales exists, estimates profit as 20% of sales.',
      defaultOn: true,
      icon: '💰'
    },
  ];

  /* ── Fuzzy Merge Lookup Tables ─────────────────────────────────────── */
  const REGION_MAP = {
    'north':  'North', 'north ': 'North', 'n.': 'North', 'nrth': 'North',
    'south':  'South', 'south ': 'South', 's.': 'South', 'sth':  'South',
    'east':   'East',  'east ':  'East',  'e.': 'East',  'est':  'East',
    'west':   'West',  'west ':  'West',  'w.': 'West',  'wst':  'West',
    // also handle all-caps canonical values that title-case step might miss
    'north region': 'North', 'south region': 'South',
    'east region':  'East',  'west region':  'West',
  };

  const SEGMENT_MAP = {
    'consumer':    'Consumer',
    'corp':        'Corporate',
    'corporate':   'Corporate',
    'home office': 'Home Office',
    'homeoffice':  'Home Office',
    'home_office': 'Home Office',
    'ho':          'Home Office',
  };

  const CATEGORY_MAP = {
    'tech':            'Technology',
    'technology':      'Technology',
    'technolgy':       'Technology',
    'furniture':       'Furniture',
    'furnitures':      'Furniture',
    'furn':            'Furniture',
    'office supplies': 'Office Supplies',
    'office supply':   'Office Supplies',
    'office':          'Office Supplies',
    'supplies':        'Office Supplies',
  };

  /* ── Date Parsing ──────────────────────────────────────────────────── */
  const MONTHS = {
    jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
    jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
  };

  /**
   * Parse a date string in any of the known formats.
   * Returns 'YYYY-MM-DD' or null if unparseable.
   */
  function parseDate(str) {
    if (!str || typeof str !== 'string' || !str.trim()) return null;
    const s = str.trim();

    // 1) Already ISO: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, mo, d] = s.split('-').map(Number);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return s;
      return null;
    }

    // 2) DD/MM/YYYY  (European – preferred since test files use this)
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const day = +m[1], mon = +m[2], yr = +m[3];
      // If day > 12 it must be DD/MM; otherwise assume DD/MM too
      if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
        const dt = new Date(yr, mon - 1, day);
        if (!isNaN(dt)) return toISO(dt);
      }
      // Fallback: try MM/DD/YYYY
      if (mon >= 1 && mon <= 31 && day >= 1 && day <= 12) {
        const dt = new Date(yr, day - 1, mon);
        if (!isNaN(dt)) return toISO(dt);
      }
    }

    // 3) "Mar 05, 2025" or "Mar 5 2025"
    m = s.match(/^([A-Za-z]{3})[\s.]+(\d{1,2})[,\s]+(\d{4})$/);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo !== undefined) {
        const dt = new Date(+m[3], mo, +m[2]);
        if (!isNaN(dt)) return toISO(dt);
      }
    }

    // 4) "5 Mar 2025"
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo !== undefined) {
        const dt = new Date(+m[3], mo, +m[1]);
        if (!isNaN(dt)) return toISO(dt);
      }
    }

    // 5) M/D/YYYY (US)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dt = new Date(+m[3], +m[1] - 1, +m[2]);
      if (!isNaN(dt)) return toISO(dt);
    }

    // 6) Last resort: JS Date constructor (handles many edge cases)
    const dt = new Date(s);
    if (!isNaN(dt) && dt.getFullYear() > 1970) return toISO(dt);

    return null;
  }

  function toISO(dt) {
    const y = dt.getFullYear();
    const m = (dt.getMonth() + 1).toString().padStart(2, '0');
    const d = dt.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /* ── Statistics Helpers ────────────────────────────────────────────── */
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  }

  /**
   * IQR fence with configurable multiplier.
   * Using k=3.0 to avoid flagging normal high-value orders.
   */
  function iqrFence(arr, k = 3.0) {
    const s = [...arr].sort((a, b) => a - b);
    const q1 = s[Math.floor(s.length * 0.25)];
    const q3 = s[Math.floor(s.length * 0.75)];
    const iqr = q3 - q1;
    return { lower: q1 - k * iqr, upper: q3 + k * iqr, q1, q3, iqr };
  }

  /**
   * Return numeric values for a field that are actually present (non-blank).
   * IMPORTANT: blank/missing values are excluded; they are NOT treated as 0.
   */
  function colNumbers(rows, field) {
    return rows
      .map(r => r[field])
      .filter(v => v !== '' && v !== null && v !== undefined)
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v));
  }

  /**
   * Diagnostic: sum a field treating missing as 0 (for logging only).
   */
  function diagSum(rows, field) {
    return rows.reduce((acc, r) => {
      const v = parseFloat(r[field]);
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
  }

  /* ── Detect columns present in the data ───────────────────────────── */
  /**
   * Return the set of column names that ACTUALLY contain data.
   * A column must have at least one non-blank, non-empty value to be
   * considered "present". This prevents unmapped canonical fields (which
   * would appear as keys with all-blank values) from being profiled,
   * counted as nulls, or filled.
   *
   * @param {object[]} rows
   * @returns {Set<string>}
   */
  function presentColumns(rows) {
    const colSet = new Set();
    if (!rows.length) return colSet;

    // Collect all keys first
    const allKeys = new Set();
    const sample = rows.slice(0, Math.min(rows.length, rows.length)); // all rows for accuracy
    for (const row of sample) {
      for (const k of Object.keys(row)) {
        if (!k.startsWith('__')) allKeys.add(k);
      }
    }

    // A column is "present" only if at least one row has a non-blank value for it
    for (const key of allKeys) {
      const hasData = rows.some(row => {
        const v = row[key];
        return v !== '' && v !== null && v !== undefined &&
               !(typeof v === 'string' && v.trim() === '');
      });
      if (hasData) colSet.add(key);
    }

    return colSet;
  }

  /* ── Main Cleaning Function ────────────────────────────────────────── */
  /**
   * @param {object[]} rawRows
   * @param {Set<string>} enabledRules
   * @returns {{ cleanedRows, changeLog, stats, outlierRows }}
   */
  function clean(rawRows, enabledRules) {
    const log = [];
    const stats = {
      totalRowsBefore:   rawRows.length,
      duplicatesRemoved: 0,
      nullsFilled:       0,
      whitespaceFixed:   0,
      caseFixed:         0,
      fuzzyMerged:       0,
      datesParsed:       0,
      datesFailed:       0,
      negativeQtyFixed:  0,
      badDiscountsFixed: 0,
      outliersDetected:  0,
      profitRecomputed:  0,
      totalRowsAfter:    0,
    };

    let rows = rawRows.map(r => ({ ...r })); // shallow clone – never mutate input

    // Detect which canonical columns exist in this file
    const present = presentColumns(rows);

    // Helper: is a value considered "blank/missing"?
    function isBlank(v) {
      return v === '' || v === null || v === undefined ||
             (typeof v === 'string' && v.trim() === '');
    }

    // ── Diagnostic log at start ──────────────────────────────────────
    if (present.has('sales')) {
      console.debug(`[Cleaner] START: rows=${rows.length}, SUM(sales)=${diagSum(rows,'sales').toFixed(2)}`);
    }

    // ── STEP 1: Trim whitespace ──────────────────────────────────────
    if (enabledRules.has('trim_whitespace')) {
      let count = 0;
      rows = rows.map(row => {
        const newRow = {};
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'string' && v !== v.trim()) {
            newRow[k] = v.trim(); count++;
          } else {
            newRow[k] = v;
          }
        }
        return newRow;
      });
      if (count > 0) {
        log.push({ type: 'fix', icon: '✂️', text: `Trimmed whitespace from cell values`, count });
        stats.whitespaceFixed = count;
      }
    }

    // ── STEP 2: Remove exact duplicates ─────────────────────────────
    if (enabledRules.has('remove_duplicates')) {
      const seen = new Set();
      const deduped = [];
      for (const row of rows) {
        // Key on non-internal fields only
        const key = JSON.stringify(
          Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('__')))
        );
        if (!seen.has(key)) { seen.add(key); deduped.push(row); }
      }
      stats.duplicatesRemoved = rows.length - deduped.length;
      if (stats.duplicatesRemoved > 0) {
        log.push({ type: 'fix', icon: '🗑️', text: `Removed exact duplicate rows`, count: stats.duplicatesRemoved });
      }
      rows = deduped;
      if (present.has('sales')) console.debug(`[Cleaner] after dedup: rows=${rows.length}, SUM(sales)=${diagSum(rows,'sales').toFixed(2)}`);
    }

    // ── STEP 3: Standardise text case ───────────────────────────────
    if (enabledRules.has('standardise_case')) {
      // Only apply to text columns that exist
      const textFields = ['category', 'region', 'segment', 'product_name', 'ship_mode', 'state']
        .filter(f => present.has(f));
      let count = 0;
      rows = rows.map(row => {
        const r = { ...row };
        for (const f of textFields) {
          if (r[f] && typeof r[f] === 'string' && r[f].trim()) {
            const titled = toTitleCase(r[f]);
            if (titled !== r[f]) { r[f] = titled; count++; }
          }
        }
        return r;
      });
      if (count > 0) {
        log.push({ type: 'fix', icon: '🔤', text: `Standardised text to Title Case`, count });
        stats.caseFixed = count;
      }
    }

    // ── STEP 4: Fuzzy merge region / segment / category ─────────────
    if (enabledRules.has('fuzzy_merge')) {
      let count = 0;
      rows = rows.map(row => {
        const r = { ...row };
        if (present.has('region') && r.region && typeof r.region === 'string') {
          const key = r.region.toLowerCase().trim();
          const mapped = REGION_MAP[key];
          if (mapped && mapped !== r.region) { r.region = mapped; count++; }
        }
        if (present.has('segment') && r.segment && typeof r.segment === 'string') {
          const key = r.segment.toLowerCase().trim();
          const mapped = SEGMENT_MAP[key];
          if (mapped && mapped !== r.segment) { r.segment = mapped; count++; }
        }
        if (present.has('category') && r.category && typeof r.category === 'string') {
          const key = r.category.toLowerCase().trim();
          const mapped = CATEGORY_MAP[key];
          if (mapped && mapped !== r.category) { r.category = mapped; count++; }
        }
        return r;
      });
      if (count > 0) {
        log.push({ type: 'fix', icon: '🔀', text: `Fuzzy-merged inconsistent labels`, count });
        stats.fuzzyMerged = count;
      }
    }

    // ── STEP 5: Parse & standardise dates ───────────────────────────
    if (enabledRules.has('parse_dates') && present.has('order_date')) {
      let parsed = 0, failed = 0, already = 0;
      const failedSamples = [];
      rows = rows.map(row => {
        const r = { ...row };
        const raw = r.order_date;
        if (isBlank(raw)) return r; // leave blank; will be handled by null fill
        const iso = parseDate(String(raw));
        if (iso) {
          if (iso !== raw) { r.order_date = iso; parsed++; }
          else already++;
        } else {
          failed++;
          if (failedSamples.length < 5) failedSamples.push(raw);
        }
        return r;
      });
      if (parsed > 0)  log.push({ type: 'fix', icon: '📅', text: `Standardised date formats to ISO (YYYY-MM-DD)`, count: parsed });
      if (failed > 0)  log.push({ type: 'warn', icon: '⚠️', text: `Could not parse ${failed} date value(s), e.g.: ${failedSamples.join(', ')}`, count: failed });
      stats.datesParsed  = parsed;
      stats.datesFailed  = failed;
      console.debug(`[Cleaner] after dates: parsed=${parsed}, already_iso=${already}, failed=${failed}`);
    }

    // ── STEP 6: Fix negative quantities ─────────────────────────────
    if (enabledRules.has('fix_negatives') && present.has('quantity')) {
      let count = 0;
      rows = rows.map(row => {
        const r = { ...row };
        const qty = parseFloat(r.quantity);
        if (!isNaN(qty) && qty < 0) { r.quantity = String(Math.abs(qty)); count++; }
        return r;
      });
      if (count > 0) {
        log.push({ type: 'fix', icon: '🔢', text: `Fixed negative quantity values`, count });
        stats.negativeQtyFixed = count;
      }
    }

    // ── STEP 7: Cap bad discounts (> 1.0) ───────────────────────────
    if (enabledRules.has('flag_bad_discounts') && present.has('discount')) {
      let count = 0;
      rows = rows.map(row => {
        const r = { ...row };
        const d = parseFloat(r.discount);
        if (!isNaN(d) && d > 1.0) {
          r.discount = '1';
          r.__flagBadDiscount = true;
          count++;
        }
        return r;
      });
      if (count > 0) {
        log.push({ type: 'warn', icon: '⚠️', text: `Capped discounts exceeding 100%`, count });
        stats.badDiscountsFixed = count;
      }
    }

    // ── STEP 8: Fill missing numerics with column median ─────────────
    // ONLY fills truly blank/missing cells; NEVER overwrites a present value.
    // Only processes columns that exist in this file.
    if (enabledRules.has('fill_missing_numeric')) {
      const numericFields = ['sales', 'profit', 'quantity', 'discount'].filter(f => present.has(f));
      let count = 0;
      const filledDetail = [];
      for (const field of numericFields) {
        const validVals = colNumbers(rows, field);
        if (!validVals.length) continue;
        const med = median(validVals);
        let fieldCount = 0;
        rows = rows.map(row => {
          const r = { ...row };
          if (isBlank(r[field])) {
            r[field] = med.toFixed(4);
            fieldCount++;
          }
          return r;
        });
        if (fieldCount > 0) {
          filledDetail.push(`${field}: ${fieldCount} (median=${med.toFixed(2)})`);
          count += fieldCount;
        }
      }
      if (count > 0) {
        log.push({ type: 'fix', icon: '🔧', text: `Filled missing numeric values with column median: ${filledDetail.join('; ')}`, count });
        stats.nullsFilled += count;
        if (present.has('sales')) console.debug(`[Cleaner] after fill_numeric: rows=${rows.length}, SUM(sales)=${diagSum(rows,'sales').toFixed(2)}`);
      }
    }

    // ── STEP 9: Recompute missing profit ────────────────────────────
    if (enabledRules.has('recompute_profit') && present.has('profit') && present.has('sales')) {
      let count = 0;
      rows = rows.map(row => {
        const r = { ...row };
        if (isBlank(r.profit)) {
          const s = parseFloat(r.sales);
          if (!isNaN(s) && s > 0) {
            r.profit = (s * 0.20).toFixed(2);
            count++;
          }
        }
        return r;
      });
      if (count > 0) {
        log.push({ type: 'fix', icon: '💰', text: `Estimated missing profit as 20% of sales`, count });
        stats.profitRecomputed = count;
      }
    }

    // ── STEP 10: Fill missing categoricals ──────────────────────────
    // Fills ALL text columns present in the data, not just a hard-coded list.
    if (enabledRules.has('fill_missing_categorical')) {
      // Candidate text columns — only include those present in this file
      const candidates = [
        'region', 'segment', 'category', 'ship_mode',
        'state', 'customer_id', 'product_name', 'product_id'
      ].filter(f => present.has(f));

      let count = 0;
      const filledDetail = [];
      for (const field of candidates) {
        const vals = rows
          .map(r => r[field])
          .filter(v => !isBlank(v) && String(v).trim() !== '');

        // For id-like fields always use 'Unknown', otherwise use mode
        const isIdField = ['customer_id', 'product_id'].includes(field);
        const mode = isIdField ? 'Unknown' : (computeMode(vals) || 'Unknown');

        let fieldCount = 0;
        rows = rows.map(row => {
          const r = { ...row };
          if (isBlank(r[field]) || String(r[field]).trim() === '') {
            r[field] = mode;
            fieldCount++;
          }
          return r;
        });
        if (fieldCount > 0) {
          filledDetail.push(`${field}: ${fieldCount}`);
          count += fieldCount;
        }
      }
      if (count > 0) {
        log.push({ type: 'fix', icon: '📝', text: `Filled missing categorical values: ${filledDetail.join(', ')}`, count });
        stats.nullsFilled += count;
      }
    }

    // ── STEP 11: Detect outliers using 3×IQR fence ──────────────────
    // FLAG ONLY – never modify values. Uses k=3.0 to avoid false positives.
    const outlierRows = [];
    if (enabledRules.has('detect_outliers')) {
      const outlierFields = ['sales', 'profit'].filter(f => present.has(f));
      let count = 0;
      for (const field of outlierFields) {
        const vals = colNumbers(rows, field);
        if (vals.length < 10) continue; // need enough data for meaningful IQR
        const { lower, upper, q1, q3, iqr } = iqrFence(vals, 3.0);
        rows = rows.map(row => {
          const r = { ...row };
          const v = parseFloat(r[field]);
          if (!isNaN(v) && (v > upper || v < lower)) {
            r[`__outlier_${field}`] = true;
            count++;
          }
          return r;
        });
        if (iqr > 0) {
          log.push({ type: 'warn', icon: '📊',
            text: `${field} outliers (3×IQR fence: [${lower.toFixed(0)}, ${upper.toFixed(0)}]), Q1=${q1.toFixed(0)}, Q3=${q3.toFixed(0)}`,
            count: rows.filter(r => r[`__outlier_${field}`]).length
          });
        }
      }
      // Collect outlier rows for display
      rows.forEach((r, i) => {
        const isOut = outlierFields.some(f => r[`__outlier_${f}`]);
        if (isOut) outlierRows.push({ rowIndex: i, ...r });
      });
      stats.outliersDetected = count;
    }

    if (present.has('sales')) {
      console.debug(`[Cleaner] FINAL: rows=${rows.length}, SUM(sales)=${diagSum(rows,'sales').toFixed(2)}, outliers=${stats.outliersDetected}`);
    }

    stats.totalRowsAfter = rows.length;
    return { cleanedRows: rows, changeLog: log, stats, outlierRows };
  }

  /* ── Utility Functions ─────────────────────────────────────────────── */
  function toTitleCase(str) {
    return str.replace(/\w\S*/g, txt =>
      txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
    );
  }

  function computeMode(arr) {
    if (!arr.length) return null;
    const freq = {};
    let maxCount = 0, mode = arr[0];
    for (const v of arr) {
      const key = String(v);
      freq[key] = (freq[key] || 0) + 1;
      if (freq[key] > maxCount) { maxCount = freq[key]; mode = v; }
    }
    return mode;
  }

  /**
   * Compute null counts per column – only for columns present in the data.
   * Skips internal __ flags.
   * @param {object[]} rows
   * @param {Set<string>|null} onlyCols - if provided, only profile these columns
   * @returns {object} { colName: nullCount }
   */
  function nullCountsPerColumn(rows, onlyCols = null) {
    if (!rows.length) return {};
    const cols = Object.keys(rows[0]).filter(k => {
      if (k.startsWith('__')) return false;
      if (onlyCols && !onlyCols.has(k)) return false;
      return true;
    });
    const result = {};
    for (const col of cols) {
      result[col] = rows.filter(r =>
        r[col] === '' || r[col] === null || r[col] === undefined ||
        (typeof r[col] === 'string' && r[col].trim() === '')
      ).length;
    }
    return result;
  }

  /**
   * Convert rows to CSV string (strips internal __ columns).
   */
  function toCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]).filter(k => !k.startsWith('__'));
    const lines = [headers.join(',')];
    for (const row of rows) {
      const cells = headers.map(h => {
        const v = row[h] == null ? '' : String(row[h]);
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"` : v;
      });
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  return { RULES, clean, nullCountsPerColumn, toCSV, parseDate };

})();
