/**
 * analyzer.js  (v2 – bug-fixed)
 * Computes aggregated metrics from cleaned rows for the dashboard.
 *
 * KEY FIXES:
 *  - computeMonthlyTrend: generates full month spine from min→max date; no gaps.
 *  - computeRegionData: correctly groups by cleaned region column.
 *  - computeCategoryData: returns null if category column is absent.
 *  - computeTopProducts: falls back to product_id if product_name absent.
 *  - getFilterOptions: skips absent columns.
 */

const Analyzer = (() => {

  /* ── Number Helpers ────────────────────────────────────────────────── */
  function n(v) { const f = parseFloat(v); return isNaN(f) ? 0 : f; }
  function sum(rows, field) { return rows.reduce((acc, r) => acc + n(r[field]), 0); }

  /**
   * Format a number with suffix (K, L, Cr) and optional currency prefix.
   */
  function fmt(v, prefix = '', decimals = 0) {
    if (Math.abs(v) >= 1e7)  return prefix + (v / 1e7).toFixed(1) + 'Cr';
    if (Math.abs(v) >= 1e5)  return prefix + (v / 1e5).toFixed(1) + 'L';
    if (Math.abs(v) >= 1e3)  return prefix + (v / 1e3).toFixed(1) + 'K';
    return prefix + v.toFixed(decimals);
  }

  /* ── Column-presence Helper ────────────────────────────────────────── */
  /**
   * Check if a column is meaningfully present (exists with at least one non-blank value).
   */
  function colPresent(rows, field) {
    if (!rows.length) return false;
    return rows.some(r => {
      const v = r[field];
      return v !== '' && v !== null && v !== undefined &&
             !(typeof v === 'string' && v.trim() === '') &&
             v !== 'Unknown';
    });
  }

  /* ── Filter Helpers ────────────────────────────────────────────────── */
  /**
   * Apply user filters to rows. Skips filter fields whose column isn't present.
   */
  function applyFilters(rows, filters = {}) {
    return rows.filter(row => {
      if (filters.startDate && row.order_date && row.order_date < filters.startDate) return false;
      if (filters.endDate   && row.order_date && row.order_date > filters.endDate)   return false;
      if (filters.region   && row.region   && row.region   !== filters.region)   return false;
      if (filters.category && row.category && row.category !== filters.category)  return false;
      if (filters.segment  && row.segment  && row.segment  !== filters.segment)   return false;
      return true;
    });
  }

  /* ── KPI Computations ──────────────────────────────────────────────── */
  function computeKPIs(rows) {
    const totalSales   = sum(rows, 'sales');
    const totalProfit  = sum(rows, 'profit');
    const totalQty     = sum(rows, 'quantity');
    const totalOrders  = rows.length;
    const avgOrderVal  = totalOrders > 0 ? totalSales / totalOrders : 0;
    const profitMargin = totalSales   > 0 ? (totalProfit / totalSales) * 100 : 0;

    return [
      { id: 'total_sales',   label: 'Total Sales',     value: totalSales,   formatted: fmt(totalSales, '₹'),           icon: '💰', color: 'blue'   },
      { id: 'total_profit',  label: 'Total Profit',    value: totalProfit,  formatted: fmt(totalProfit, '₹'),          icon: '📈', color: 'green'  },
      { id: 'profit_margin', label: 'Profit Margin',   value: profitMargin, formatted: profitMargin.toFixed(1) + '%', icon: '🎯', color: 'teal'   },
      { id: 'total_orders',  label: 'Total Orders',    value: totalOrders,  formatted: totalOrders.toLocaleString(),   icon: '🛒', color: 'orange' },
      { id: 'avg_order_val', label: 'Avg Order Value', value: avgOrderVal,  formatted: fmt(avgOrderVal, '₹', 0),       icon: '📊', color: 'purple' },
      { id: 'units_sold',    label: 'Units Sold',      value: totalQty,     formatted: Math.round(totalQty).toLocaleString(), icon: '📦', color: 'orange' },
    ];
  }

  /* ── Monthly Trend ─────────────────────────────────────────────────── */
  /**
   * Build monthly aggregates with a COMPLETE spine from min to max date.
   * Months with no orders get 0 values – they are NOT skipped.
   */
  function computeMonthlyTrend(rows) {
    // Aggregate existing data
    const map = {};
    for (const row of rows) {
      const d = row.order_date;
      if (!d || typeof d !== 'string' || d.length < 7) continue;
      // Validate it looks like YYYY-MM-...
      if (!/^\d{4}-\d{2}/.test(d)) continue;
      const key = d.substring(0, 7); // YYYY-MM
      if (!map[key]) map[key] = { sales: 0, profit: 0 };
      map[key].sales  += n(row.sales);
      map[key].profit += n(row.profit);
    }

    const dataKeys = Object.keys(map).sort();
    if (!dataKeys.length) return { labels: [], sales: [], profits: [], rawKeys: [] };

    // Build complete spine: every YYYY-MM between min and max
    const [minY, minM] = dataKeys[0].split('-').map(Number);
    const [maxY, maxM] = dataKeys[dataKeys.length - 1].split('-').map(Number);

    const allKeys = [];
    let y = minY, m = minM;
    while (y < maxY || (y === maxY && m <= maxM)) {
      allKeys.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const sales   = allKeys.map(k => +(map[k]?.sales  || 0).toFixed(2));
    const profits = allKeys.map(k => +(map[k]?.profit || 0).toFixed(2));
    const labels  = allKeys.map(k => {
      const [yr, mo] = k.split('-');
      return `${MONTH_NAMES[+mo - 1]} '${yr.slice(2)}`;
    });

    return { labels, sales, profits, rawKeys: allKeys };
  }

  /* ── Sales by Region ───────────────────────────────────────────────── */
  /**
   * Group by the `region` column (post-cleaning, should be North/South/East/West).
   * Excludes rows where region is blank or 'Unknown' from the chart label
   * but still counts them under 'Unknown'.
   */
  function computeRegionData(rows) {
    const map = {};
    for (const row of rows) {
      const r = (row.region && String(row.region).trim()) ? String(row.region).trim() : 'Unknown';
      map[r] = (map[r] || 0) + n(row.sales);
    }
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return {
      labels: sorted.map(x => x[0]),
      values: sorted.map(x => +x[1].toFixed(2))
    };
  }

  /* ── Category Donut ────────────────────────────────────────────────── */
  /**
   * Returns null if category column is absent from the data.
   * The chart layer uses null to show a friendly "not available" message.
   */
  function computeCategoryData(rows) {
    // Check if category is meaningfully present
    if (!colPresent(rows, 'category')) return null;

    const map = {};
    for (const row of rows) {
      const c = (row.category && String(row.category).trim()) ? String(row.category).trim() : 'Unknown';
      map[c] = (map[c] || 0) + n(row.sales);
    }
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return {
      labels: sorted.map(x => x[0]),
      values: sorted.map(x => +x[1].toFixed(2))
    };
  }

  /* ── Top 10 Products ───────────────────────────────────────────────── */
  function computeTopProducts(rows) {
    // Prefer product_name; fall back to product_id; skip if neither meaningful
    const useField = colPresent(rows, 'product_name') ? 'product_name'
                   : colPresent(rows, 'product_id')   ? 'product_id'
                   : null;

    if (!useField) return { labels: [], values: [], unavailable: true };

    const map = {};
    for (const row of rows) {
      const p = (row[useField] && String(row[useField]).trim()) ? String(row[useField]).trim() : 'Unknown';
      if (p === 'Unknown') continue; // skip unknown products
      map[p] = (map[p] || 0) + n(row.sales);
    }

    const sorted = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      labels: sorted.map(x => x[0]),
      values: sorted.map(x => +x[1].toFixed(2))
    };
  }

  /* ── Discount Band vs Profit Margin ────────────────────────────────── */
  function computeDiscountBands(rows) {
    const bands = {
      '0% (No discount)': { totalSales: 0, totalProfit: 0 },
      '1–10%':            { totalSales: 0, totalProfit: 0 },
      '11–20%':           { totalSales: 0, totalProfit: 0 },
      '21–30%':           { totalSales: 0, totalProfit: 0 },
      '> 30%':            { totalSales: 0, totalProfit: 0 },
    };

    for (const row of rows) {
      const d = n(row.discount);
      let band;
      if (d <= 0)        band = '0% (No discount)';
      else if (d <= 0.1) band = '1–10%';
      else if (d <= 0.2) band = '11–20%';
      else if (d <= 0.3) band = '21–30%';
      else               band = '> 30%';
      bands[band].totalSales  += n(row.sales);
      bands[band].totalProfit += n(row.profit);
    }

    const labels  = Object.keys(bands);
    const margins = labels.map(l => {
      const b = bands[l];
      return b.totalSales > 0 ? +((b.totalProfit / b.totalSales) * 100).toFixed(1) : 0;
    });
    return { labels, margins };
  }

  /* ── Quarter-over-Quarter Growth ───────────────────────────────────── */
  function computeQoQ(rows) {
    const map = {};
    for (const row of rows) {
      const d = row.order_date;
      if (!d || typeof d !== 'string' || d.length < 7) continue;
      if (!/^\d{4}-\d{2}/.test(d)) continue;
      const y = parseInt(d.substring(0, 4));
      const m = parseInt(d.substring(5, 7));
      const q = Math.ceil(m / 3);
      const key = `${y}-Q${q}`;
      map[key] = (map[key] || 0) + n(row.sales);
    }
    const labels = Object.keys(map).sort();
    const values = labels.map(l => +map[l].toFixed(2));
    const growth = values.map((v, i) => {
      if (i === 0) return 0;
      const prev = values[i - 1];
      return prev > 0 ? +(((v - prev) / prev) * 100).toFixed(1) : 0;
    });
    return { labels, values, growth };
  }

  /* ── Key Insights ──────────────────────────────────────────────────── */
  function generateInsights(rows) {
    const insights = [];

    // Best / worst region
    const regionData = computeRegionData(rows);
    const realRegions = regionData.labels.filter(l => l !== 'Unknown');
    if (realRegions.length >= 2) {
      const best  = realRegions[0];
      const worst = realRegions[realRegions.length - 1];
      const bestVal  = regionData.values[regionData.labels.indexOf(best)];
      const worstVal = regionData.values[regionData.labels.indexOf(worst)];
      insights.push({
        emoji: '🏆',
        text: `Best region: <strong>${best}</strong> (${fmt(bestVal, '₹')}). Lowest: <strong>${worst}</strong> (${fmt(worstVal, '₹')}).`
      });
    }

    // Peak month
    const monthly = computeMonthlyTrend(rows);
    if (monthly.sales.length > 0) {
      const maxVal = Math.max(...monthly.sales);
      const maxIdx = monthly.sales.indexOf(maxVal);
      if (maxVal > 0) {
        insights.push({
          emoji: '📅',
          text: `Peak sales month: <strong>${monthly.labels[maxIdx]}</strong> with ${fmt(maxVal, '₹')} in revenue.`
        });
      }
    }

    // Discount impact
    const discBands = computeDiscountBands(rows);
    const noDisc   = discBands.margins[0];
    const highDisc = discBands.margins[discBands.labels.length - 1];
    if (!isNaN(noDisc) && !isNaN(highDisc)) {
      const diff = (noDisc - highDisc).toFixed(1);
      insights.push({
        emoji: '💸',
        text: `No-discount orders: <strong>${noDisc}%</strong> margin vs heavily discounted: <strong>${highDisc}%</strong> — a <strong>${diff}%</strong> drop from aggressive discounting.`
      });
    }

    // Lowest-margin products
    if (colPresent(rows, 'product_name') || colPresent(rows, 'product_id')) {
      const pField = colPresent(rows, 'product_name') ? 'product_name' : 'product_id';
      const productMap = {};
      for (const row of rows) {
        const p = (row[pField] && String(row[pField]).trim() && row[pField] !== 'Unknown')
                  ? String(row[pField]).trim() : null;
        if (!p) continue;
        if (!productMap[p]) productMap[p] = { sales: 0, profit: 0 };
        productMap[p].sales  += n(row.sales);
        productMap[p].profit += n(row.profit);
      }
      const products = Object.entries(productMap)
        .filter(([, v]) => v.sales > 500)
        .map(([name, v]) => ({ name, margin: (v.profit / v.sales) * 100 }))
        .sort((a, b) => a.margin - b.margin);
      if (products.length > 0) {
        const worst = products[0];
        insights.push({
          emoji: '⚠️',
          text: `Lowest-margin product: <strong>${worst.name}</strong> at ${worst.margin.toFixed(1)}% — consider pricing review.`
        });
      }
    }

    // QoQ trend
    const qoq = computeQoQ(rows);
    if (qoq.growth.length >= 2) {
      const latest = qoq.growth[qoq.growth.length - 1];
      const sign   = latest >= 0 ? '+' : '';
      insights.push({
        emoji: latest >= 0 ? '📈' : '📉',
        text: `Latest quarter-over-quarter growth: <strong>${sign}${latest}%</strong>.`
      });
    }

    return insights;
  }

  /* ── Filter Options ────────────────────────────────────────────────── */
  function getFilterOptions(rows) {
    function unique(field) {
      if (!colPresent(rows, field)) return [];
      return [...new Set(
        rows.map(r => r[field])
          .filter(v => v && String(v).trim() && v !== 'Unknown')
      )].sort();
    }

    const dates = rows
      .map(r => r.order_date)
      .filter(v => v && /^\d{4}-\d{2}-\d{2}$/.test(v))
      .sort();

    return {
      regions:    unique('region'),
      categories: unique('category'),
      segments:   unique('segment'),
      minDate:    dates[0] || '',
      maxDate:    dates[dates.length - 1] || '',
      hasCategory: colPresent(rows, 'category'),
      hasProduct:  colPresent(rows, 'product_name') || colPresent(rows, 'product_id'),
    };
  }

  /**
   * Reconciliation: compare JS-computed total sales with SQL SUM.
   * Returns { match: bool, jsSales, sqlSales, diff }.
   */
  function reconcile(rows, sqlSalesTotal) {
    const jsSales = +sum(rows, 'sales').toFixed(2);
    const sqlSales = +parseFloat(sqlSalesTotal).toFixed(2);
    const diff = Math.abs(jsSales - sqlSales);
    const match = diff < 0.01; // allow 1 cent rounding difference
    return { match, jsSales, sqlSales, diff };
  }

  return {
    applyFilters,
    computeKPIs,
    computeMonthlyTrend,
    computeRegionData,
    computeCategoryData,
    computeTopProducts,
    computeDiscountBands,
    computeQoQ,
    generateInsights,
    getFilterOptions,
    reconcile,
    colPresent,
    fmt,
  };

})();
