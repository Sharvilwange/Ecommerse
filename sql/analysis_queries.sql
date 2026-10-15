-- =====================================================================
-- Sales Performance Analysis | SQL queries (SQLite syntax; works with
-- minor changes in MySQL / PostgreSQL / SQL Server)
-- Tables: sales (fact), products (dim), regions (dim)
-- =====================================================================

-- Q1. Core KPIs
SELECT ROUND(SUM(sales), 2)                         AS total_sales,
       ROUND(SUM(profit), 2)                        AS total_profit,
       ROUND(100.0 * SUM(profit) / SUM(sales), 2)   AS profit_margin_pct,
       COUNT(DISTINCT order_id)                     AS total_orders,
       ROUND(SUM(sales) / COUNT(DISTINCT order_id), 2) AS avg_order_value
FROM sales;

-- Q2. Revenue and profit by category (JOIN with product master)
SELECT p.category,
       ROUND(SUM(s.sales), 2)  AS revenue,
       ROUND(SUM(s.profit), 2) AS profit,
       ROUND(100.0 * SUM(s.profit) / SUM(s.sales), 2) AS margin_pct
FROM sales s
JOIN products p ON s.product_id = p.product_id
GROUP BY p.category
ORDER BY revenue DESC;

-- Q3. Top 10 products by revenue
SELECT p.product_name,
       SUM(s.quantity)         AS units_sold,
       ROUND(SUM(s.sales), 2)  AS revenue,
       ROUND(SUM(s.profit), 2) AS profit
FROM sales s
JOIN products p ON s.product_id = p.product_id
GROUP BY p.product_name
ORDER BY revenue DESC
LIMIT 10;

-- Q4. Regional performance with regional manager (JOIN with regions)
SELECT r.region,
       r.regional_manager,
       ROUND(SUM(s.sales), 2)  AS revenue,
       ROUND(SUM(s.profit), 2) AS profit,
       COUNT(DISTINCT s.order_id) AS orders,
       ROUND(100.0 * SUM(s.sales) / (SELECT SUM(sales) FROM sales), 1) AS pct_of_total_sales
FROM sales s
JOIN regions r ON s.region = r.region
GROUP BY r.region, r.regional_manager
ORDER BY revenue DESC;

-- Q5. Monthly revenue trend with month-over-month growth (window function)
WITH monthly AS (
    SELECT year_month, SUM(sales) AS revenue
    FROM sales
    GROUP BY year_month
)
SELECT year_month,
       ROUND(revenue, 2) AS revenue,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY year_month))
             / LAG(revenue) OVER (ORDER BY year_month), 1) AS mom_growth_pct
FROM monthly
ORDER BY year_month;

-- Q6. Year-over-year growth by quarter
WITH q AS (
    SELECT year, quarter, SUM(sales) AS revenue
    FROM sales
    GROUP BY year, quarter
)
SELECT cur.quarter,
       ROUND(prev.revenue, 2) AS rev_2024,
       ROUND(cur.revenue, 2)  AS rev_2025,
       ROUND(100.0 * (cur.revenue - prev.revenue) / prev.revenue, 1) AS yoy_growth_pct
FROM q cur
JOIN q prev ON cur.quarter = prev.quarter AND cur.year = prev.year + 1
ORDER BY cur.quarter;

-- Q7. Top 3 products within each region (RANK window function)
SELECT * FROM (
    SELECT s.region,
           p.product_name,
           ROUND(SUM(s.sales), 2) AS revenue,
           RANK() OVER (PARTITION BY s.region ORDER BY SUM(s.sales) DESC) AS rnk
    FROM sales s
    JOIN products p ON s.product_id = p.product_id
    GROUP BY s.region, p.product_name
)
WHERE rnk <= 3
ORDER BY region, rnk;

-- Q8. Does discounting hurt profit? (bucketed with CASE)
SELECT CASE WHEN discount = 0 THEN '0%'
            WHEN discount <= 0.10 THEN '1-10%'
            WHEN discount <= 0.20 THEN '11-20%'
            ELSE '21%+' END AS discount_band,
       COUNT(*)                AS line_items,
       ROUND(SUM(sales), 2)    AS revenue,
       ROUND(100.0 * SUM(profit) / SUM(sales), 2) AS margin_pct
FROM sales
GROUP BY discount_band
ORDER BY MIN(discount);

-- Q9. Customer segments: value per customer
SELECT segment,
       COUNT(DISTINCT customer_id)  AS customers,
       ROUND(SUM(sales), 2)         AS revenue,
       ROUND(SUM(sales) / COUNT(DISTINCT customer_id), 2) AS revenue_per_customer
FROM sales
WHERE customer_id <> 'UNKNOWN'
GROUP BY segment
ORDER BY revenue DESC;

-- Q10. Repeat customers: top 10 by lifetime revenue
SELECT customer_id,
       COUNT(DISTINCT order_id) AS orders,
       ROUND(SUM(sales), 2)     AS lifetime_revenue
FROM sales
WHERE customer_id <> 'UNKNOWN'
GROUP BY customer_id
ORDER BY lifetime_revenue DESC
LIMIT 10;

-- Q11. Products with margin below the company average (subquery)
SELECT p.product_name,
       ROUND(100.0 * SUM(s.profit) / SUM(s.sales), 2) AS margin_pct
FROM sales s
JOIN products p ON s.product_id = p.product_id
GROUP BY p.product_name
HAVING 100.0 * SUM(s.profit) / SUM(s.sales) <
       (SELECT 100.0 * SUM(profit) / SUM(sales) FROM sales)
ORDER BY margin_pct;

-- Q12. Running (cumulative) revenue by month
SELECT year_month,
       ROUND(SUM(SUM(sales)) OVER (ORDER BY year_month), 2) AS cumulative_revenue
FROM sales
GROUP BY year_month
ORDER BY year_month;
