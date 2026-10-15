"""
Step 3: Load clean data into SQLite, run every query in sql/analysis_queries.sql,
and save each result as a CSV (so you can show real output in interviews).
"""
import re
import sqlite3
from pathlib import Path
import pandas as pd

DB = Path("sales.db")
OUT = Path("outputs/sql_results")
OUT.mkdir(parents=True, exist_ok=True)

if DB.exists():
    DB.unlink()
con = sqlite3.connect(DB)
pd.read_csv("data/clean/sales_clean.csv").to_sql("sales", con, index=False)
pd.read_csv("data/raw/products.csv").to_sql("products", con, index=False)
pd.read_csv("data/raw/regions.csv").to_sql("regions", con, index=False)

sql = Path("sql/analysis_queries.sql").read_text()
blocks = re.split(r"(?m)^-- (Q\d+)\.", sql)[1:]
for qid, body in zip(blocks[0::2], blocks[1::2]):
    title, _, query = body.partition("\n")
    df = pd.read_sql_query(query.strip().rstrip(";"), con)
    df.to_csv(OUT / f"{qid}.csv", index=False)
    print(f"\n{qid}: {title.strip()}  ({len(df)} rows)")
    print(df.head(5).to_string(index=False))
con.close()
