"""
Step 1: Generate a realistic, deliberately MESSY retail sales dataset.
(Stand-in for a real company export. Swap in a Kaggle dataset like
'Superstore Sales' if you prefer -- the rest of the pipeline works the same.)
"""
import numpy as np
import pandas as pd
from pathlib import Path

rng = np.random.default_rng(42)
OUT = Path("data/raw")
OUT.mkdir(parents=True, exist_ok=True)

# ---------- Dimension tables (used for SQL joins) ----------
products = pd.DataFrame({
    "product_id": [f"P{str(i).zfill(3)}" for i in range(1, 25)],
    "product_name": [
        "Laptop Pro 14", "Laptop Air 13", "Gaming Laptop X", "Wireless Mouse", "Mechanical Keyboard",
        "27in Monitor", "USB-C Hub", "Webcam HD", "Noise Cancelling Headphones", "Bluetooth Speaker",
        "Smartphone S", "Smartphone Lite", "Tablet 10", "Smartwatch", "Fitness Band",
        "Office Chair", "Standing Desk", "Desk Lamp", "Notebook Pack", "Gel Pen Set",
        "Printer Ink Set", "Laser Printer", "External SSD 1TB", "Power Bank 20000mAh"],
    "category": (["Technology"] * 15) + (["Furniture"] * 3) + (["Office Supplies"] * 6),
})
products["category"] = products["category"].where(
    ~products["product_name"].isin(["External SSD 1TB", "Power Bank 20000mAh", "Laser Printer"]), "Technology")
base_price = rng.integers(8, 1400, len(products)).astype(float)
base_price[:3] = [1250, 1050, 1399]
base_price[[18, 19]] = [9, 7]
products["unit_price"] = base_price
products["unit_cost"] = (products["unit_price"] * rng.uniform(0.55, 0.85, len(products))).round(2)
products["unit_price"] = products["unit_price"].round(2)

regions = pd.DataFrame({
    "region_id": [1, 2, 3, 4],
    "region": ["North", "South", "East", "West"],
    "regional_manager": ["A. Sharma", "R. Iyer", "S. Banerjee", "P. Deshmukh"],
})
states = {
    "North": ["Delhi", "Punjab", "Uttar Pradesh", "Haryana"],
    "South": ["Karnataka", "Tamil Nadu", "Kerala", "Telangana"],
    "East": ["West Bengal", "Odisha", "Bihar", "Assam"],
    "West": ["Maharashtra", "Gujarat", "Rajasthan", "Goa"],
}
segments = ["Consumer", "Corporate", "Home Office"]

# ---------- Fact table ----------
N = 6000
dates = pd.to_datetime("2024-01-01") + pd.to_timedelta(rng.integers(0, 730, N), unit="D")
# mild seasonality: boost Oct-Dec
boost = rng.random(N) < 0.18
dates = pd.Series(dates)
year_pick = rng.choice([2024, 2025], boost.sum(), p=[0.4, 0.6])  # festive-season peak every year, growing
dates[boost] = [pd.Timestamp(f"{y}-10-01") + pd.Timedelta(days=int(d))
                for y, d in zip(year_pick, rng.integers(0, 92, boost.sum()))]
dates = dates.sort_values().reset_index(drop=True)

region_choice = rng.choice(regions["region"], N, p=[0.22, 0.28, 0.17, 0.33])
state_choice = [rng.choice(states[r]) for r in region_choice]
prod_idx = rng.choice(len(products), N, p=np.linspace(2, 1, len(products)) / np.linspace(2, 1, len(products)).sum())
qty = rng.integers(1, 9, N)
discount = rng.choice([0, 0, 0, 0.05, 0.1, 0.15, 0.2, 0.3], N)

sales = pd.DataFrame({
    "order_id": [f"ORD-{100000 + i}" for i in range(N)],
    "order_date": dates,
    "customer_id": [f"C{rng.integers(1000, 2600)}" for _ in range(N)],
    "segment": rng.choice(segments, N, p=[0.52, 0.30, 0.18]),
    "region": region_choice,
    "state": state_choice,
    "product_id": products.loc[prod_idx, "product_id"].values,
    "quantity": qty,
    "discount": discount,
})
sales = sales.merge(products[["product_id", "unit_price", "unit_cost"]], on="product_id", how="left")
sales["sales"] = (sales["unit_price"] * sales["quantity"] * (1 - sales["discount"])).round(2)
sales["profit"] = (sales["sales"] - sales["unit_cost"] * sales["quantity"]).round(2)
sales = sales.drop(columns=["unit_price", "unit_cost"])
sales["ship_mode"] = rng.choice(["Standard Class", "Second Class", "First Class", "Same Day"], N, p=[.6, .2, .15, .05])

# ---------- Inject mess ----------
raw = sales.copy()
raw["order_date"] = raw["order_date"].dt.strftime("%Y-%m-%d")

# 1. mixed date formats
idx = rng.choice(N, 600, replace=False)
raw.loc[idx[:300], "order_date"] = pd.to_datetime(raw.loc[idx[:300], "order_date"]).dt.strftime("%d/%m/%Y")
raw.loc[idx[300:], "order_date"] = pd.to_datetime(raw.loc[idx[300:], "order_date"]).dt.strftime("%b %d, %Y")

# 2. inconsistent text (case, whitespace, spelling variants)
i = rng.choice(N, 500, replace=False)
raw.loc[i[:170], "region"] = raw.loc[i[:170], "region"].str.upper()
raw.loc[i[170:340], "region"] = raw.loc[i[170:340], "region"].str.lower() + " "
raw.loc[i[340:], "region"] = raw.loc[i[340:], "region"].replace({"North": "N.", "South": "S.", "East": "E.", "West": "W."})
j = rng.choice(N, 300, replace=False)
raw.loc[j[:150], "segment"] = raw.loc[j[:150], "segment"].str.lower()
raw.loc[j[150:], "segment"] = " " + raw.loc[j[150:], "segment"]

# 3. missing values
for col, n in [("customer_id", 120), ("state", 180), ("discount", 150), ("ship_mode", 90), ("sales", 60), ("profit", 80), ("quantity", 40)]:
    raw.loc[rng.choice(N, n, replace=False), col] = np.nan

# 4. bad values: negative / zero quantity, impossible discount, outliers
k = rng.choice(N, 25, replace=False)
raw.loc[k[:10], "quantity"] = -raw.loc[k[:10], "quantity"].abs()
raw.loc[k[10:18], "discount"] = 1.5
raw.loc[k[18:], "sales"] = raw.loc[k[18:], "sales"].astype(float) * 50  # extreme outliers

# 5. duplicates (exact duplicate rows)
dups = raw.sample(150, random_state=1)
raw = pd.concat([raw, dups], ignore_index=True).sample(frac=1, random_state=7).reset_index(drop=True)

raw.to_csv(OUT / "sales_raw.csv", index=False)
products.to_csv(OUT / "products.csv", index=False)
regions.to_csv(OUT / "regions.csv", index=False)
print(f"sales_raw.csv: {raw.shape}  | products: {products.shape} | regions: {regions.shape}")
