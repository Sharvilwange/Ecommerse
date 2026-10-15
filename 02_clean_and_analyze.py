"""
Step 2: Clean the raw sales data with Pandas, log every fix, run EDA, export
Tableau-ready files and charts.
"""
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

RAW = Path("data/raw")
CLEAN = Path("data/clean")
FIG = Path("outputs/figures")
for p in (CLEAN, FIG):
    p.mkdir(parents=True, exist_ok=True)

log = []  # data-quality log -> shows recruiters you quantify your cleaning


def note(msg):
    log.append(msg)
    print(msg)


df = pd.read_csv(RAW / "sales_raw.csv")
products = pd.read_csv(RAW / "products.csv")
regions = pd.read_csv(RAW / "regions.csv")
note(f"Raw rows: {len(df):,}")

# ---------------- 1. Duplicates ----------------
n = df.duplicated().sum()
df = df.drop_duplicates().reset_index(drop=True)
note(f"Removed {n} exact duplicate rows -> {len(df):,} rows")

# ---------------- 2. Text standardisation ----------------
region_map = {"n.": "North", "s.": "South", "e.": "East", "w.": "West",
              "north": "North", "south": "South", "east": "East", "west": "West"}
before = df["region"].nunique()
df["region"] = df["region"].str.strip().str.lower().map(region_map)
note(f"Standardised region labels: {before} variants -> {df['region'].nunique()} (unmapped: {df['region'].isna().sum()})")
df["segment"] = df["segment"].str.strip().str.title()
df["state"] = df["state"].str.strip().str.title()

# ---------------- 3. Dates (mixed formats) ----------------
def parse_date(s):
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%b %d, %Y"):
        try:
            return pd.to_datetime(s, format=fmt)
        except (ValueError, TypeError):
            continue
    return pd.NaT

df["order_date"] = df["order_date"].apply(parse_date)
note(f"Parsed 3 mixed date formats; unparseable dates: {df['order_date'].isna().sum()}")

# ---------------- 4. Invalid values ----------------
bad_qty = (df["quantity"] <= 0).sum()
df["quantity"] = df["quantity"].abs()          # negative qty = data-entry sign error
note(f"Fixed {bad_qty} negative quantities (sign errors)")

bad_disc = (df["discount"] > 1).sum()
df.loc[df["discount"] > 1, "discount"] = np.nan  # impossible discount -> treat as missing
note(f"Flagged {bad_disc} impossible discounts (>100%) as missing")

# ---------------- 5. Missing values ----------------
miss = df.isna().sum()
note("Missing values before imputation:\n" + miss[miss > 0].to_string())

df["customer_id"] = df["customer_id"].fillna("UNKNOWN")
df["ship_mode"] = df["ship_mode"].fillna(df["ship_mode"].mode()[0])
df["discount"] = df["discount"].fillna(0)  # assume no discount when not recorded

# state: infer from most common state within the same region isn't valid -> label
df["state"] = df["state"].fillna("Unknown")
df["order_date"] = df["order_date"].fillna(df["order_date"].median())

# Recompute sales/profit from product master (source of truth) where missing/outlier
df = df.merge(products[["product_id", "product_name", "category", "unit_price", "unit_cost"]],
              on="product_id", how="left")
df["quantity"] = df["quantity"].fillna(df.groupby("product_id")["quantity"].transform("median")).round().astype(int)

calc_sales = (df["unit_price"] * df["quantity"] * (1 - df["discount"])).round(2)
calc_profit = (calc_sales - df["unit_cost"] * df["quantity"]).round(2)

# outliers: reported sales > 5x recomputed value
outlier = df["sales"] > 5 * calc_sales
note(f"Detected {outlier.sum()} sales outliers (>5x expected) -> recomputed from price x qty")
fill_s = df["sales"].isna().sum()
fill_p = df["profit"].isna().sum()
df["sales"] = np.where(df["sales"].isna() | outlier, calc_sales, df["sales"])
df["profit"] = np.where(df["profit"].isna() | outlier, calc_profit, df["profit"])
note(f"Recomputed {fill_s} missing sales and {fill_p} missing profit values from the product master")

# ---------------- 6. Feature engineering ----------------
df["year"] = df["order_date"].dt.year
df["month"] = df["order_date"].dt.month
df["month_name"] = df["order_date"].dt.strftime("%b")
df["year_month"] = df["order_date"].dt.to_period("M").astype(str)
df["quarter"] = "Q" + df["order_date"].dt.quarter.astype(str)
df["profit_margin_pct"] = (df["profit"] / df["sales"] * 100).round(2)
df["order_date"] = df["order_date"].dt.date

df = df.drop(columns=["unit_price", "unit_cost"])
assert df.isna().sum().sum() == 0, "Nulls remain!"
note(f"Final clean rows: {len(df):,} | nulls remaining: 0")

df.to_csv(CLEAN / "sales_clean.csv", index=False)
(CLEAN / "data_quality_log.txt").write_text("\n".join(log))

# ---------------- 7. EDA & KPIs ----------------
total_sales, total_profit = df["sales"].sum(), df["profit"].sum()
kpis = {
    "Total Sales": total_sales,
    "Total Profit": total_profit,
    "Profit Margin %": total_profit / total_sales * 100,
    "Total Orders": df["order_id"].nunique(),
    "Avg Order Value": total_sales / df["order_id"].nunique(),
    "Units Sold": int(df["quantity"].sum()),
    "Unique Customers": df.loc[df["customer_id"] != "UNKNOWN", "customer_id"].nunique(),
}
print("\nKPIs:")
for k, v in kpis.items():
    print(f"  {k}: {v:,.2f}")
pd.Series(kpis).to_csv(CLEAN / "kpis.csv", header=["value"])

by_region = df.groupby("region").agg(sales=("sales", "sum"), profit=("profit", "sum"), orders=("order_id", "nunique"))
by_region["margin_pct"] = by_region["profit"] / by_region["sales"] * 100
by_cat = df.groupby("category").agg(sales=("sales", "sum"), profit=("profit", "sum"))
by_prod = df.groupby("product_name").agg(sales=("sales", "sum"), profit=("profit", "sum"), units=("quantity", "sum")).sort_values("sales", ascending=False)
monthly = df.groupby("year_month").agg(sales=("sales", "sum"), profit=("profit", "sum"))
print("\nBy region:\n", by_region.round(1))
print("\nTop 5 products:\n", by_prod.head(5).round(1))
loss = by_prod[by_prod["profit"] < 0]
print("\nLoss-making products:", list(loss.index))

# ---------------- 8. Charts ----------------
plt.rcParams.update({"axes.spines.top": False, "axes.spines.right": False, "font.size": 10})
BLUE, ORANGE = "#2B6CB0", "#DD6B20"

fig, ax = plt.subplots(figsize=(10, 4))
ax.plot(monthly.index, monthly["sales"], color=BLUE, marker="o", label="Sales")
ax.plot(monthly.index, monthly["profit"], color=ORANGE, marker="o", label="Profit")
ax.set_title("Monthly Sales & Profit"); ax.legend(frameon=False)
plt.xticks(rotation=60); plt.tight_layout(); plt.savefig(FIG / "monthly_trend.png", dpi=150); plt.close()

fig, ax = plt.subplots(figsize=(6, 4))
by_region["sales"].sort_values().plot.barh(ax=ax, color=BLUE)
ax.set_title("Sales by Region"); plt.tight_layout(); plt.savefig(FIG / "sales_by_region.png", dpi=150); plt.close()

fig, ax = plt.subplots(figsize=(8, 5))
by_prod["sales"].head(10).sort_values().plot.barh(ax=ax, color=BLUE)
ax.set_title("Top 10 Products by Sales"); plt.tight_layout(); plt.savefig(FIG / "top_products.png", dpi=150); plt.close()
print("\nSaved clean data, KPI file, log and charts.")
