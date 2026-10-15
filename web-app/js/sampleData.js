/**
 * sampleData.js
 * Generates a messy ~500-row sales dataset in-browser for demo purposes.
 * Intentionally includes: nulls, duplicates, inconsistent casing/labels,
 * mixed date formats, negative quantities, outliers, and bad discounts.
 */

const SampleData = (() => {

  // Products reference
  const PRODUCTS = [
    { id: 'P001', name: 'Laptop Pro 14',           category: 'Technology',      price: 1250 },
    { id: 'P002', name: 'Laptop Air 13',            category: 'Technology',      price: 1050 },
    { id: 'P003', name: 'Gaming Laptop X',          category: 'Technology',      price: 1399 },
    { id: 'P004', name: 'Wireless Mouse',           category: 'Technology',      price: 618  },
    { id: 'P005', name: 'Mechanical Keyboard',      category: 'Technology',      price: 610  },
    { id: 'P006', name: '27in Monitor',             category: 'Technology',      price: 1203 },
    { id: 'P007', name: 'USB-C Hub',                category: 'Technology',      price: 127  },
    { id: 'P008', name: 'Webcam HD',                category: 'Technology',      price: 978  },
    { id: 'P009', name: 'Noise Cancelling Headphones', category: 'Technology',   price: 288  },
    { id: 'P010', name: 'Bluetooth Speaker',        category: 'Technology',      price: 139  },
    { id: 'P011', name: 'Smartphone S',             category: 'Technology',      price: 740  },
    { id: 'P012', name: 'Smartphone Lite',          category: 'Technology',      price: 1366 },
    { id: 'P013', name: 'Tablet 10',                category: 'Technology',      price: 1032 },
    { id: 'P014', name: 'Smartwatch',               category: 'Technology',      price: 1067 },
    { id: 'P016', name: 'Office Chair',             category: 'Furniture',       price: 1102 },
    { id: 'P017', name: 'Standing Desk',            category: 'Furniture',       price: 722  },
    { id: 'P018', name: 'Desk Lamp',                category: 'Furniture',       price: 186  },
    { id: 'P019', name: 'Notebook Pack',            category: 'Office Supplies', price: 9    },
    { id: 'P020', name: 'Gel Pen Set',              category: 'Office Supplies', price: 7    },
    { id: 'P021', name: 'Printer Ink Set',          category: 'Office Supplies', price: 704  },
  ];

  // Intentionally messy region variants (will be cleaned later)
  const REGIONS_MESSY = ['North', 'NORTH', 'north ', 'N.', 'South', 'SOUTH', 'south', 'S.', 'East', 'EAST', 'east', 'West', 'WEST', 'west ', 'W.'];
  const REGIONS_CLEAN = { 'North':1, 'South':1, 'East':1, 'West':1 };

  const SEGMENTS_MESSY = ['Consumer', 'CONSUMER', 'consumer', 'Corporate', 'CORPORATE', 'corporate', 'Home Office', 'home office', 'HOME OFFICE'];
  const STATES = ['Delhi', 'Maharashtra', 'Karnataka', 'Gujarat', 'Tamil Nadu', 'Uttar Pradesh', 'West Bengal', 'Rajasthan', 'Kerala', 'Goa', 'Assam', 'Punjab'];
  const SHIP_MODES = ['Standard Class', 'Second Class', 'First Class', 'Same Day', '', null];

  // Mixed date formats (intentionally messy)
  const DATE_FORMATS = ['ISO', 'DMY', 'MDY_FULL', 'MDY_SHORT'];

  function rnd(min, max) { return Math.random() * (max - min) + min; }
  function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
  function pick(arr) { return arr[rndInt(0, arr.length - 1)]; }

  function formatDateMessy(date) {
    const fmt = pick(DATE_FORMATS);
    const d = date.getDate().toString().padStart(2,'0');
    const m = date.getMonth() + 1;
    const y = date.getFullYear();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    switch (fmt) {
      case 'ISO':      return `${y}-${m.toString().padStart(2,'0')}-${d}`;
      case 'DMY':      return `${d}/${m.toString().padStart(2,'0')}/${y}`;
      case 'MDY_FULL': return `${months[m-1]} ${parseInt(d)}, ${y}`;
      case 'MDY_SHORT':return `${m}/${parseInt(d)}/${y}`;
      default:         return `${y}-${m.toString().padStart(2,'0')}-${d}`;
    }
  }

  function generateRow(index, startDate, endDate) {
    const product = pick(PRODUCTS);
    const quantity = rndInt(1, 10);

    // Introduce messy discounts (some > 1.0, i.e. > 100%)
    let discount = Math.round(pick([0, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) * 100) / 100;
    if (Math.random() < 0.02) discount = rnd(1.1, 2.0); // bad discount

    const sales = +(product.price * quantity * (1 - Math.min(discount, 1))).toFixed(2);
    const profitMargin = rnd(0.05, 0.35);
    let profit = +(sales * profitMargin).toFixed(2);

    // Introduce some negative profits and outliers
    if (Math.random() < 0.05) profit = -Math.abs(profit);
    if (Math.random() < 0.02) profit = profit * 8; // outlier

    const dateRange = endDate - startDate;
    const orderDate = new Date(startDate + Math.random() * dateRange);

    // Null injection
    const customerId = Math.random() < 0.05 ? null : `C${rndInt(1000, 2500)}`;
    const shipMode = Math.random() < 0.04 ? null : pick(['Standard Class', 'Second Class', 'First Class', 'Same Day']);

    // Messy region / segment
    const region = pick(REGIONS_MESSY);
    const segment = pick(SEGMENTS_MESSY);

    // Introduce negative quantity occasionally
    const qty = Math.random() < 0.02 ? -quantity : quantity;

    return {
      order_id:    `ORD-${100000 + index}`,
      order_date:  formatDateMessy(orderDate),
      customer_id: customerId || '',
      segment:     segment,
      region:      region,
      state:       pick(STATES),
      product_id:  product.id,
      product_name:Math.random() < 0.1 ? product.name.toLowerCase() : product.name, // messy case
      category:    Math.random() < 0.15 ? product.category.toUpperCase() : product.category,
      quantity:    qty,
      discount:    discount,
      sales:       sales,
      profit:      Math.random() < 0.03 ? '' : profit, // null profit
      ship_mode:   shipMode || '',
    };
  }

  /**
   * Generate the full messy sample dataset.
   * Returns an array of row objects.
   */
  function generate(count = 500) {
    const startDate = new Date('2024-01-01').getTime();
    const endDate   = new Date('2025-12-31').getTime();
    const rows = [];

    for (let i = 0; i < count; i++) {
      rows.push(generateRow(i, startDate, endDate));
    }

    // Add ~15 exact duplicate rows
    for (let i = 0; i < 15; i++) {
      const src = rows[rndInt(0, 50)];
      rows.push({ ...src });
    }

    // Shuffle
    for (let i = rows.length - 1; i > 0; i--) {
      const j = rndInt(0, i);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }

    return rows;
  }

  /**
   * Convert row objects to CSV string.
   */
  function toCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      const cells = headers.map(h => {
        const v = row[h] == null ? '' : String(row[h]);
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v;
      });
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  return { generate, toCSV };

})();
