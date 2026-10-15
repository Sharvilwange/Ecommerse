# 📊 Sales Data Analyzer

A **browser-native** sales analytics tool for data analyst portfolios. Upload messy CSV/Excel files, auto-clean them, explore an interactive dashboard, and run SQL queries — **all in the browser, no backend required**.

> 🔒 **Your data never leaves your browser.** All processing uses client-side WebAssembly.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📁 **Upload** | Drag-and-drop CSV/Excel or load a built-in 500-row messy dataset |
| 🗂️ **Column Mapping** | Auto-detects canonical columns; user can override via dropdowns |
| 🧹 **Data Cleaning** | 11 toggleable rules: dedup, whitespace, case, fuzzy merge, date parsing, outlier detection |
| 📋 **Quality Report** | Before/after row counts, null counts per column, change log |
| 📈 **Auto Dashboard** | 6 charts, 6 KPI cards, smart filter bar, AI-written insights |
| 🗄️ **SQL Playground** | SQLite WASM, window functions, 7 example queries, schema browser, query history |
| ⬇️ **Exports** | Download cleaned CSV, query results CSV, dashboard as PNG |

---

## 🛠️ Tech Stack

- **HTML5 + CSS3 + Vanilla JavaScript** (no build step, no framework)
- **[PapaParse](https://www.papaparse.com/)** – CSV parsing
- **[SheetJS](https://sheetjs.com/)** – Excel (.xlsx) parsing
- **[sql.js](https://sql.js.org/)** – SQLite compiled to WebAssembly
- **[Chart.js](https://www.chartjs.org/)** – Interactive charts
- **[CodeMirror 5](https://codemirror.net/)** – SQL editor with syntax highlighting
- **[html2canvas](https://html2canvas.hertzen.com/)** – Dashboard PNG export

---

## 🚀 Quick Start (Local)

No build tools needed — just open the file!

```bash
# Clone or download the repository
git clone https://github.com/yourusername/sales-data-analyzer.git
cd sales-data-analyzer/web-app

# Option 1: Open directly (some browsers block local WASM loading)
open index.html

# Option 2: Use a local server (recommended for WASM support)
# Python 3
python -m http.server 8080
# Then open: http://localhost:8080

# Node.js (npx)
npx serve .
# Then open: http://localhost:3000
```

---

## 🌐 Deployment

### GitHub Pages

```bash
# 1. Create a new GitHub repository
# 2. Push the web-app/ folder contents to the main branch:
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/repo-name.git
git push -u origin main

# 3. Go to Settings → Pages → Source: main branch / root
# 4. Your app will be live at: https://yourusername.github.io/repo-name/
```

### Netlify (Drag & Drop)

1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag the `web-app/` folder onto the dashboard
3. Done — instant live URL!

### Netlify CLI

```bash
npm install -g netlify-cli
cd web-app
netlify deploy --prod --dir .
```

> **Note:** No `netlify.toml` or build config needed — this is a static site.

---

## 📂 Project Structure

```
web-app/
├── index.html          # Single-page app entry point
├── style.css           # Complete stylesheet (dark/light themes)
├── data/
│   └── sample_sales_messy.csv  # 515-row test dataset with intentional mess
└── js/
    ├── sampleData.js   # In-browser sample data generator
    ├── parser.js       # CSV/Excel parser + column auto-detection
    ├── cleaner.js      # 11 cleaning rules + IQR outlier detection
    ├── analyzer.js     # KPIs, chart data, filter logic, insights
    ├── charts.js       # Chart.js wrappers for all 6 dashboard charts
    ├── sql.js          # sql.js (SQLite WASM) engine + example queries
    └── app.js          # Main controller – wires everything together
```

---

## 🧪 Testing the Full Flow

1. Open `index.html` (or `http://localhost:8080`)
2. Click **"✨ Load Sample Dataset"** on the Upload tab
3. Verify the raw data preview shows 515 rows with messy data
4. Click **"Clean Data →"** to go to the Cleaning tab
5. Click **"▶ Run Cleaning"** — verify the quality report shows fixes
6. Click the **Dashboard** tab — all 6 charts should render
7. Try the date range filter and "Apply"
8. Click the **SQL Playground** tab
9. Select "Monthly trend with MoM growth" from the dropdown
10. Press **"▶ Run"** or `Ctrl+Enter`
11. Click **"📊 Chart This"** to visualize the result
12. Download the cleaned CSV and PNG

---

## 📊 Sample Data Details

The `sample_sales_messy.csv` file contains **515 rows** with intentional data quality issues:

| Issue | Count |
|---|---|
| Exact duplicate rows | ~15 |
| Null customer_id | ~25 |
| Null ship_mode | ~20 |
| Null profit | ~15 |
| Mixed date formats | ~all rows |
| Inconsistent region labels | ~all rows (`NORTH`, `north `, `N.`) |
| Inconsistent segment labels | ~all rows (`CONSUMER`, `corporate`) |
| Negative quantities | ~10 |
| Discount > 100% | ~10 |
| Profit outliers (8× median) | ~10 |

---

## ⚙️ Cleaning Rules Reference

| Rule | What it does |
|---|---|
| Remove Duplicates | Detects exact row duplicates by JSON stringification |
| Trim Whitespace | Strips leading/trailing spaces from all text fields |
| Standardise Case | Title-cases region, segment, category, product_name |
| Fuzzy Merge Labels | Maps `NORTH`, `north `, `N.` → `North` via lookup table |
| Parse Dates | Handles ISO, DD/MM/YYYY, `Mar 05, 2025`, M/D/YYYY formats |
| Fix Negative Quantities | Converts `-qty` to `abs(qty)` |
| Flag Bad Discounts | Caps discount > 1.0 (100%) and logs |
| Detect Outliers | IQR method on sales & profit; flags but preserves rows |
| Fill Missing Numerics | Replaces blank numeric cells with column median |
| Recompute Missing Profit | Estimates profit as 20% of sales where profit is blank |
| Fill Missing Categoricals | Fills blank text fields with mode or `"Unknown"` |

---

## 🔒 Privacy

- Zero server calls for data processing
- All WASM binaries are loaded from CDN on page load, then run locally
- You can load the page, disconnect from the internet, and still analyze data

---

## 📄 License

MIT License — free to use for portfolio, commercial, or educational purposes.

---

*Built as a data analyst portfolio project demonstrating browser-native ETL, analytics, and SQL capabilities.*
