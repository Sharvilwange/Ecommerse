/**
 * sql.js
 * SQLite WASM (sql.js) integration module.
 * Loads the WASM binary, creates a database, loads cleaned rows into
 * a `sales` table (and `products` table if product data exists),
 * and exposes a query() function that returns { columns, rows, time }.
 */

const SQLEngine = (() => {

  let db = null;
  let sqlJs = null;
  let isReady = false;

  /* ── Example Query Templates ───────────────────────────────────────── */
  const EXAMPLE_QUERIES = {
    total_by_region: `-- Total sales and profit by region
SELECT
  region,
  COUNT(*) AS orders,
  ROUND(SUM(sales), 2) AS total_sales,
  ROUND(SUM(profit), 2) AS total_profit,
  ROUND(SUM(profit) / SUM(sales) * 100, 1) AS margin_pct
FROM sales
GROUP BY region
ORDER BY total_sales DESC;`,

    top10_products: `-- Top 10 products by total sales
SELECT
  product_name,
  category,
  COUNT(*) AS orders,
  SUM(quantity) AS units_sold,
  ROUND(SUM(sales), 2) AS total_sales,
  ROUND(SUM(profit), 2) AS total_profit
FROM sales
GROUP BY product_name, category
ORDER BY total_sales DESC
LIMIT 10;`,

    monthly_mom: `-- Monthly sales with Month-over-Month growth
WITH monthly AS (
  SELECT
    strftime('%Y-%m', order_date) AS month,
    ROUND(SUM(sales), 2) AS total_sales
  FROM sales
  GROUP BY 1
),
with_lag AS (
  SELECT
    month,
    total_sales,
    LAG(total_sales) OVER (ORDER BY month) AS prev_sales
  FROM monthly
)
SELECT
  month,
  total_sales,
  prev_sales,
  ROUND((total_sales - prev_sales) / prev_sales * 100, 1) AS mom_growth_pct
FROM with_lag
ORDER BY month;`,

    top3_per_region: `-- Top 3 products per region using RANK()
WITH ranked AS (
  SELECT
    region,
    product_name,
    ROUND(SUM(sales), 2) AS total_sales,
    RANK() OVER (PARTITION BY region ORDER BY SUM(sales) DESC) AS rnk
  FROM sales
  GROUP BY region, product_name
)
SELECT region, rnk, product_name, total_sales
FROM ranked
WHERE rnk <= 3
ORDER BY region, rnk;`,

    discount_impact: `-- Discount impact on profit margin using CASE
SELECT
  CASE
    WHEN discount = 0           THEN '0% (No discount)'
    WHEN discount <= 0.10       THEN '1-10%'
    WHEN discount <= 0.20       THEN '11-20%'
    WHEN discount <= 0.30       THEN '21-30%'
    ELSE '> 30%'
  END AS discount_band,
  COUNT(*) AS orders,
  ROUND(SUM(sales), 2) AS total_sales,
  ROUND(SUM(profit), 2) AS total_profit,
  ROUND(SUM(profit) / SUM(sales) * 100, 1) AS margin_pct
FROM sales
GROUP BY 1
ORDER BY MIN(discount);`,

    above_avg_customers: `-- Customers above average revenue (subquery)
SELECT
  customer_id,
  COUNT(*) AS orders,
  ROUND(SUM(sales), 2) AS total_revenue
FROM sales
WHERE customer_id IS NOT NULL
  AND customer_id != 'Unknown'
GROUP BY customer_id
HAVING total_revenue > (
  SELECT AVG(sub.customer_total)
  FROM (
    SELECT customer_id, SUM(sales) AS customer_total
    FROM sales
    GROUP BY customer_id
  ) sub
)
ORDER BY total_revenue DESC
LIMIT 20;`,

    cumulative_revenue: `-- Cumulative (running total) revenue by month
SELECT
  strftime('%Y-%m', order_date) AS month,
  ROUND(SUM(sales), 2) AS monthly_sales,
  ROUND(SUM(SUM(sales)) OVER (ORDER BY strftime('%Y-%m', order_date)), 2) AS cumulative_sales
FROM sales
GROUP BY 1
ORDER BY 1;`,
  };

  /* ── Initialise sql.js ─────────────────────────────────────────────── */
  /**
   * Load the sql.js WASM binary and initialise the SQL engine.
   * Must be called before any query() calls.
   * @returns {Promise<void>}
   */
  async function init() {
    if (isReady) return;
    try {
      // sql.js CDN WASM binary location
      sqlJs = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
      });
      isReady = true;
    } catch (err) {
      throw new Error(`Failed to load SQL engine: ${err.message}`);
    }
  }

  /* ── Load Data into DB ─────────────────────────────────────────────── */
  /**
   * Create (or recreate) the SQLite database and load all cleaned rows.
   * Creates a `sales` table. If product_name columns exist, also creates a `products` view.
   * @param {object[]} rows - cleaned rows (array of plain objects)
   * @returns {{ schema: object }} - schema info for sidebar
   */
  function loadData(rows) {
    if (!isReady) throw new Error('SQL engine not initialised. Call SQLEngine.init() first.');
    if (!rows || !rows.length) throw new Error('No data to load.');

    // Close old DB if exists
    if (db) { try { db.close(); } catch(e) {} }
    db = new sqlJs.Database();

    // Derive columns (skip internal __ flags)
    const cols = Object.keys(rows[0]).filter(c => !c.startsWith('__'));

    // Infer SQLite column types
    function inferType(col) {
      const numericCols = new Set(['quantity', 'discount', 'sales', 'profit']);
      if (numericCols.has(col)) return 'REAL';
      if (col.includes('date') || col.includes('Date')) return 'TEXT';
      return 'TEXT';
    }

    const colDefs = cols.map(c => `"${c}" ${inferType(c)}`).join(', ');
    db.run(`DROP TABLE IF EXISTS sales`);
    db.run(`CREATE TABLE sales (${colDefs})`);

    // Batch insert
    const placeholders = cols.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO sales VALUES (${placeholders})`);

    for (const row of rows) {
      const vals = cols.map(c => {
        const v = row[c];
        if (v === '' || v === null || v === undefined) return null;
        const numCols = new Set(['quantity', 'discount', 'sales', 'profit']);
        if (numCols.has(c)) {
          const f = parseFloat(v);
          return isNaN(f) ? null : f;
        }
        return String(v);
      });
      stmt.run(vals);
    }
    stmt.free();

    // Build schema info
    const schema = { sales: cols.map(c => ({ name: c, type: inferType(c) })) };
    return { schema };
  }

  /* ── Execute SQL Query ─────────────────────────────────────────────── */
  /**
   * Run a SQL query against the loaded database.
   * @param {string} sql
   * @returns {{ columns: string[], rows: object[], time: number }}
   */
  function query(sql) {
    if (!db) throw new Error('No data loaded. Please upload and clean a file first.');
    const t0 = performance.now();
    const results = db.exec(sql.trim());
    const t1 = performance.now();
    const time = +(t1 - t0).toFixed(2);

    if (!results || !results.length) {
      return { columns: [], rows: [], time };
    }

    const { columns, values } = results[0];
    const rows = values.map(valArr => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = valArr[i]; });
      return obj;
    });

    return { columns, rows, time };
  }

  /* ── Get Example Query SQL ─────────────────────────────────────────── */
  function getExampleQuery(id) {
    return EXAMPLE_QUERIES[id] || '';
  }

  /* ── Get all example query IDs ─────────────────────────────────────── */
  function getExampleQueryIds() {
    return Object.keys(EXAMPLE_QUERIES);
  }

  /* ── Export Results as CSV ─────────────────────────────────────────── */
  function resultToCSV(columns, rows) {
    const lines = [columns.join(',')];
    for (const row of rows) {
      const cells = columns.map(c => {
        const v = row[c] == null ? '' : String(row[c]);
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v;
      });
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  /* ── Close DB ──────────────────────────────────────────────────────── */
  function close() {
    if (db) { try { db.close(); } catch(e) {} db = null; }
  }

  return { init, loadData, query, getExampleQuery, getExampleQueryIds, resultToCSV, close };

})();
