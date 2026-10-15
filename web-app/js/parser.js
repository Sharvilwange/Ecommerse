/**
 * parser.js
 * Handles CSV (via PapaParse) and Excel (via SheetJS/xlsx) file parsing.
 * Returns a standardised { headers, rows } object.
 */

const Parser = (() => {

  /**
   * Parse a File object (CSV or XLSX) and return { headers, rows }.
   * rows is an array of plain objects keyed by header names.
   * @param {File} file
   * @returns {Promise<{headers: string[], rows: object[]}>}
   */
  async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      return parseCSV(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      return parseExcel(file);
    } else {
      throw new Error(`Unsupported file type: .${ext}. Please upload a CSV or Excel file.`);
    }
  }

  /**
   * Parse CSV using PapaParse.
   * @param {File} file
   * @returns {Promise<{headers: string[], rows: object[]}>}
   */
  function parseCSV(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // keep everything as strings initially; cleaner handles types
        complete(results) {
          if (results.errors && results.errors.length > 0) {
            const serious = results.errors.filter(e => e.type !== 'FieldMismatch');
            if (serious.length > 0) {
              console.warn('PapaParse warnings:', results.errors);
            }
          }
          const headers = results.meta.fields || [];
          const rows    = results.data || [];
          resolve({ headers, rows });
        },
        error(err) {
          reject(new Error(`CSV parse error: ${err.message}`));
        }
      });
    });
  }

  /**
   * Parse Excel (.xlsx / .xls) using SheetJS.
   * Reads the first sheet and converts to JSON with headers.
   * @param {File} file
   * @returns {Promise<{headers: string[], rows: object[]}>}
   */
  function parseExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data     = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const sheet     = workbook.Sheets[sheetName];

          // defval: '' ensures missing cells become empty strings
          const json = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: '',
            raw: false,
            dateNF: 'YYYY-MM-DD'
          });

          if (!json.length) {
            throw new Error('The Excel file appears to be empty.');
          }

          const headers = json[0].map(h => String(h).trim());
          const rows    = json.slice(1).map(rowArr => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = rowArr[i] != null ? String(rowArr[i]) : ''; });
            return obj;
          }).filter(row => Object.values(row).some(v => v !== ''));

          resolve({ headers, rows });
        } catch (err) {
          reject(new Error(`Excel parse error: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read the file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Parse from a plain objects array (e.g. generated sample data).
   * @param {object[]} rows
   * @returns {{headers: string[], rows: object[]}}
   */
  function parseFromObjects(rows) {
    if (!rows || !rows.length) return { headers: [], rows: [] };
    const headers = Object.keys(rows[0]);
    return { headers, rows };
  }

  /**
   * AUTO-DETECT column mapping:
   * Given an array of header names, try to match them to the canonical
   * field names: order_id, order_date, region, product, product_name,
   * product_id, category, quantity, discount, sales, profit, customer_id,
   * segment, ship_mode, state
   *
   * Returns a mapping object: { canonicalField: detectedColumnName | null }
   * @param {string[]} headers
   * @returns {object}
   */
  function autoDetectColumns(headers) {
    const CANONICAL_FIELDS = [
      'order_id', 'order_date', 'customer_id', 'segment', 'region',
      'state', 'product_id', 'product_name', 'category', 'quantity',
      'discount', 'sales', 'profit', 'ship_mode'
    ];

    // Synonym map: canonical -> list of patterns to match
    const SYNONYMS = {
      order_id:     ['order_id','order id','orderid','id','order number','ord_id'],
      order_date:   ['order_date','order date','date','orderdate','purchase date','sale date'],
      customer_id:  ['customer_id','customer id','cust_id','custid','client_id'],
      segment:      ['segment','customer segment','cust segment','seg'],
      region:       ['region','area','territory','zone'],
      state:        ['state','province','location','city','geo'],
      product_id:   ['product_id','product id','prod_id','sku','item_id'],
      product_name: ['product_name','product name','product','item','item name','prod_name'],
      category:     ['category','cat','product category','dept','department'],
      quantity:     ['quantity','qty','units','count','amount','pieces'],
      discount:     ['discount','disc','discounts','promo','reduction'],
      sales:        ['sales','revenue','total','total_sales','sale_amount','amount'],
      profit:       ['profit','gain','earnings','net','margin','profit_amount'],
      ship_mode:    ['ship_mode','ship mode','shipping','shipment','delivery','delivery mode'],
    };

    const mapping = {};
    const usedHeaders = new Set();

    for (const field of CANONICAL_FIELDS) {
      const synonyms = SYNONYMS[field] || [field];
      let matched = null;

      // Try exact match first (case-insensitive)
      for (const h of headers) {
        const hClean = h.toLowerCase().replace(/[\s_\-]+/g, '_').trim();
        if (synonyms.includes(hClean) && !usedHeaders.has(h)) {
          matched = h;
          break;
        }
      }

      // Try partial / fuzzy match
      if (!matched) {
        for (const h of headers) {
          const hLower = h.toLowerCase();
          if (synonyms.some(s => hLower.includes(s) || s.includes(hLower)) && !usedHeaders.has(h)) {
            matched = h;
            break;
          }
        }
      }

      mapping[field] = matched;
      if (matched) usedHeaders.add(matched);
    }

    return mapping;
  }

  /**
   * Apply a column mapping to the parsed rows.
   * Returns new rows using canonical field names, dropping unmapped columns (unless user wants to keep them).
   * @param {object[]} rows
   * @param {object} mapping - { canonicalField: originalColName | null }
   * @param {boolean} keepExtra - whether to keep non-mapped columns
   * @returns {object[]}
   */
  function applyMapping(rows, mapping, keepExtra = false) {
    return rows.map(row => {
      const newRow = {};

      for (const [canonical, original] of Object.entries(mapping)) {
        if (original && row[original] !== undefined) {
          // Source column exists → copy its value under the canonical name
          newRow[canonical] = row[original];
        }
        // If original is null/empty (column not mapped), do NOT add the key at all.
        // This prevents unmapped fields from being counted as 500 nulls.
      }

      if (keepExtra) {
        // Carry forward any columns that weren't consumed by the mapping
        const mappedOriginals = new Set(Object.values(mapping).filter(Boolean));
        for (const [k, v] of Object.entries(row)) {
          if (!mappedOriginals.has(k)) newRow[k] = v;
        }
      }

      return newRow;
    });
  }

  return { parseFile, parseFromObjects, autoDetectColumns, applyMapping };

})();
