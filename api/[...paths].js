import https from 'https';

// Google Sheets API endpoint
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec';

let dataCache = [];
let cacheTTL = 0;

// Fetch with redirect handling
function fetchFollowRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchFollowRedirects(res.headers.location, maxRedirects - 1).then(resolve, reject);
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Load data from Google Sheets
async function loadSheetData() {
  const now = Date.now();
  const CACHE_TTL = 5 * 60 * 1000;

  if (dataCache.length > 0 && now - cacheTTL < CACHE_TTL) {
    return dataCache;
  }

  try {
    const body = await fetchFollowRedirects(APPS_SCRIPT_URL);
    const parsed = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : parsed?.data || [];
    dataCache = rows;
    cacheTTL = now;
    return rows;
  } catch (err) {
    return dataCache;
  }
}

// Utility functions
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { action = 'shipments', q = '', limit = '100' } = req.query;

    if (action === 'test') {
      return res.status(200).json({ ok: true, message: 'API is working!' });
    }

    // Load data from Google Sheets
    const allData = await loadSheetData();

    if (action === 'shipments') {
      return res.status(200).json({
        ok: true,
        action,
        data: allData,
        total: allData.length,
      });
    }

    if (action === 'search') {
      const query = String(q || '').toLowerCase().trim();
      if (!query) {
        return res.status(200).json({
          action: 'search',
          query: '',
          detectedType: null,
          detectedTypeLabel: '',
          total: 0,
          data: [],
        });
      }

      // Detect search type
      const isInvoice = /^INV[\d\w-]*$/i.test(query);
      const isAWB = /^[\d]{10,15}$/.test(query) || /^AWB[\d\w-]*$/i.test(query);
      const isPO = /^PO[\d\w-]*$/i.test(query) || /^[\w]{3,}-[\d]{3,}/.test(query);
      const isRefNo = /^REF[\d\w-]*$/i.test(query);

      let detectedType = null;
      let detectedTypeLabel = '';
      if (isInvoice) {
        detectedType = 'invoice';
        detectedTypeLabel = 'Invoice Number';
      } else if (isAWB) {
        detectedType = 'awb';
        detectedTypeLabel = 'AWB Number';
      } else if (isPO) {
        detectedType = 'po';
        detectedTypeLabel = 'PO Number';
      } else if (isRefNo) {
        detectedType = 'ref';
        detectedTypeLabel = 'Reference Number';
      } else {
        detectedTypeLabel = 'Mixed Search';
      }

      // Search with fuzzy matching
      const results = allData.filter((row) => {
        const awb = String(row.awbNo || '').toLowerCase();
        const invoice = String(row.invoiceNo || '').toLowerCase();
        const po = String(row.poNumber || '').toLowerCase();
        const ref = String(row.refNo || '').toLowerCase();

        const exactMatch = awb === query || invoice === query || po === query || ref === query;
        if (exactMatch) return true;

        return awb.includes(query) || invoice.includes(query) || po.includes(query) || ref.includes(query);
      }).slice(0, parseInt(limit) || 100);

      return res.status(200).json({
        action: 'search',
        query,
        detectedType,
        detectedTypeLabel,
        total: results.length,
        data: results,
      });
    }

    if (action === 'suggest') {
      const query = String(q || '').toLowerCase().trim();
      const suggestions = [];

      if (query) {
        const limit_n = parseInt(limit) || 8;
        const seen = new Set();

        // Collect suggestions from all fields
        const fields = ['awbNo', 'invoiceNo', 'poNumber', 'refNo'];
        const fieldLabels = { awbNo: 'AWB', invoiceNo: 'Invoice', poNumber: 'PO', refNo: 'Ref' };

        for (const field of fields) {
          const values = [...new Set(
            allData
              .map((r) => r[field])
              .filter(Boolean)
              .map((s) => String(s).toLowerCase())
              .filter((s) => s.includes(query))
          )].slice(0, limit_n);

          values.forEach((val) => {
            if (!seen.has(val) && suggestions.length < limit_n) {
              suggestions.push({ field, fieldLabel: fieldLabels[field], value: val });
              seen.add(val);
            }
          });
        }
      }

      return res.status(200).json({
        action: 'suggest',
        query,
        suggestions: suggestions.slice(0, parseInt(limit) || 8),
      });
    }

    return res.status(200).json({
      ok: true,
      action,
      data: [],
      total: 0,
      message: 'Unknown action',
    });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
