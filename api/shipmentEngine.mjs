import { correctPlatformName } from '../src/utils/platformMapping.js';
import { correctStatus } from '../src/utils/statusMapping.js';

const KEY_MAP = {
  'Booking Date': 'bookingDate',
  'Invoice No.': 'invoiceNo',
  'AWB No.': 'awbNo',
  Vendor: 'vendor',
  Consignee: 'consignee',
  Origin: 'origin',
  Destination: 'destination',
  Boxes: 'boxes',
  Status: 'status',
  'Appointment Date': 'appointmentDate',
  'Failure Remarks': 'failureRemarks',
  'Delivery Date': 'deliveryDate',
  EDD: 'edd',
  'PO Number': 'poNumber',
  'CN Status': 'cnStatus',
  Zone: 'zone',
  TAT: 'tat',
  Month: 'month',
  'Delivery-Booked': 'deliveryBooked',
  'Ref. No.': 'refNo',
  'RTO AWB': 'rtoAwb',
  'CN No.': 'cnNo',
  'Invoice Value': 'invoiceValue',
  'Logistics Cost': 'logisticsCost',
  POD: 'pod',
  'POD Link': 'podUrl',
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAME_TO_IDX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const HEADER_VALUES = new Set([
  'booking date', 'invoice no.', 'awb no.', 'vendor', 'consignee', 'origin',
  'destination', 'boxes', 'status', 'appointment date', 'failure remarks', 'delivery date', 'edd',
  'po number', 'cn status', 'zone', 'tat', 'month', 'delivery-booked', 'ref. no.', 'rto awb', 'cn no.',
  'logistics cost', 'pod', 'platform', 'pickup date',
]);

const SEARCH_FIELDS = ['invoiceNo', 'awbNo', 'poNumber', 'refNo'];
const SEARCH_TYPE_LABEL = {
  invoiceNo: 'Invoice No.',
  awbNo: 'AWB No.',
  poNumber: 'PO Number',
  refNo: 'Ref. No.',
  mixed: 'Mixed',
};

let cache = {
  ts: 0,
  rows: [],
  indexes: null,
};

function deriveMMMYY(rawMonth, bookingDate) {
  if (!rawMonth) return '';
  const ml = String(rawMonth).toLowerCase().trim();
  if (MONTH_NAME_TO_IDX[ml] === undefined) return '';
  if (!bookingDate) return '';
  const d = new Date(bookingDate);
  if (Number.isNaN(d.getTime())) return '';
  const fullYr = d.getFullYear();
  if (fullYr < 2020 || fullYr > 2030) return '';
  return `${MONTH_ABBR[MONTH_NAME_TO_IDX[ml]]}'${String(fullYr).slice(-2)}`;
}

function isHeaderRow(obj) {
  const awb = (obj.awbNo || '').toLowerCase();
  return HEADER_VALUES.has(awb) || awb === 'awb no.' || awb === 'awb no';
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function toObjectRow(row) {
  const obj = {};
  for (const [apiKey, internalKey] of Object.entries(KEY_MAP)) {
    const val = row?.[apiKey];
    obj[internalKey] = val !== undefined && val !== null ? String(val).trim() : '';
  }
  obj.rawStatus = obj.status;
  obj.platform = correctPlatformName(obj.consignee);
  obj.status = correctStatus(obj.status);
  obj.month = deriveMMMYY(obj.month, obj.bookingDate);
  obj.search = {
    invoiceNo: normalizeText(obj.invoiceNo),
    awbNo: normalizeText(obj.awbNo),
    poNumber: normalizeText(obj.poNumber),
    refNo: normalizeText(obj.refNo),
  };
  return obj;
}

function parseRows(raw) {
  if (!raw || !Array.isArray(raw)) return [];

  let rows = [];
  if (raw.length > 0 && typeof raw[0] === 'object' && !Array.isArray(raw[0])) {
    rows = raw.map(toObjectRow);
  } else if (raw.length > 1 && Array.isArray(raw[0])) {
    const headers = raw[0];
    const internalKeys = headers.map((h) => KEY_MAP[h] || h);
    rows = raw.slice(1).map((r) => {
      const obj = {};
      internalKeys.forEach((key, i) => {
        obj[key] = r[i] !== undefined && r[i] !== null ? String(r[i]).trim() : '';
      });
      obj.rawStatus = obj.status;
      obj.platform = correctPlatformName(obj.consignee);
      obj.status = correctStatus(obj.status);
      obj.month = deriveMMMYY(obj.month, obj.bookingDate);
      obj.search = {
        invoiceNo: normalizeText(obj.invoiceNo),
        awbNo: normalizeText(obj.awbNo),
        poNumber: normalizeText(obj.poNumber),
        refNo: normalizeText(obj.refNo),
      };
      return obj;
    });
  }

  return rows.filter((r) => !isHeaderRow(r) && r.awbNo);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;
  const parts = String(value).split(/[/.\-]/);
  if (parts.length === 3) {
    const tryIso = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    if (!Number.isNaN(tryIso.getTime())) return tryIso;
  }
  return null;
}

function daysBetween(from, to) {
  const f = parseDate(from);
  const t = parseDate(to);
  if (!f || !t) return null;
  return Math.floor((t.getTime() - f.getTime()) / 86400000);
}

function isInTransitRow(row) {
  const status = String(row.status || '').toLowerCase();
  if (status === 'in-transit') return true;
  const raw = String(row.rawStatus || '').toLowerCase();
  return raw.includes('in transit') || raw.includes('in-transit') || raw.includes('intransit');
}

function isOfdRow(row) {
  const raw = String(row.rawStatus || row.status || '').toLowerCase();
  return raw.includes('ofd') || raw.includes('out for delivery') || raw.includes('out for delivary');
}

function isDeliveredRow(row) {
  const status = String(row.status || '');
  return status === 'Delivered' || status === 'Partial Delivered';
}

function isRtoRow(row) {
  const status = String(row.status || '').toLowerCase();
  return status.includes('rto');
}

function isLostRow(row) {
  return String(row.status || '').toLowerCase() === 'lost';
}

function hasAppointment(row) {
  return Boolean(parseDate(row.appointmentDate));
}

function hasPod(row) {
  const pod = String(row.pod || '').trim().toLowerCase();
  return Boolean(pod) && pod !== '-' && pod !== 'na';
}

function hasDeliveryDate(row) {
  const d = String(row.deliveryDate || '').trim();
  return Boolean(d) && d !== '-';
}

function isAgedPoRow(row) {
  const bd = parseDate(row.bookingDate);
  if (!bd) return false;
  return Math.floor((Date.now() - bd.getTime()) / 86400000) > 7;
}

function isPrepullRow(row) {
  const diff = daysBetween(row.edd, row.appointmentDate);
  return diff !== null && diff > 7;
}

function filterByTab(rows, tab = 'dashboard') {
  switch (tab) {
    case 'intransit':
      return rows.filter(isInTransitRow);
    case 'ofd':
      return rows.filter(isOfdRow);
    case 'appointment':
      return rows;
    case 'aged-pos':
      return rows.filter(isAgedPoRow);
    case 'lost':
      return rows.filter(isLostRow);
    case 'prepull':
      return rows.filter(isPrepullRow);
    case 'delivered':
      return rows.filter(isDeliveredRow);
    case 'return':
      return rows.filter(isRtoRow);
    case 'pods':
      return rows;
    case 'grn':
      return rows.filter(hasDeliveryDate);
    case 'dashboard':
    case 'kpi':
    case 'okr':
    case 'cost':
    case 'poc':
    case 'sop':
    case 'provision':
    default:
      return rows;
  }
}

function filterByCommonFilters(rows, filters = {}) {
  const { platform = '', courier = '', zone = '', city = '', month = '', dateFrom = '', dateTo = '' } = filters;
  const fromDate = parseDate(dateFrom);
  const toDate = parseDate(dateTo);

  return rows.filter((row) => {
    if (platform && row.platform !== platform) return false;
    if (courier && row.vendor !== courier) return false;
    if (zone && row.zone !== zone) return false;
    if (city && row.destination !== city) return false;
    if (month && row.month !== month) return false;

    if (fromDate || toDate) {
      const bd = parseDate(row.bookingDate);
      if (bd && fromDate && bd < fromDate) return false;
      if (bd && toDate && bd > toDate) return false;
    }

    return true;
  });
}

function maybeIdentifierType(token) {
  const t = token.toLowerCase();
  if (t.includes('awb')) return 'awbNo';
  if (t.includes('invoice') || t.includes('inv')) return 'invoiceNo';
  if (t.includes('po')) return 'poNumber';
  if (t.includes('ref')) return 'refNo';
  if (/^\d{8,}$/.test(t)) return 'awbNo';
  return 'mixed';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function scoreTokenMatch(queryToken, fieldValue) {
  if (!queryToken || !fieldValue) return 0;
  if (queryToken.length < 2) return 0;
  if (fieldValue === queryToken) return 100;
  if (fieldValue.startsWith(queryToken)) return 80;
  if (fieldValue.includes(queryToken)) return 65;

  const maxLen = Math.max(fieldValue.length, queryToken.length);
  if (maxLen < 5) return 0;
  const distance = levenshtein(fieldValue, queryToken);
  const ratio = distance / maxLen;
  if (ratio <= 0.2) return 45;
  if (ratio <= 0.3) return 25;
  return 0;
}

function detectSearchType(tokens) {
  const inferred = new Set(tokens.map(maybeIdentifierType).filter((t) => t !== 'mixed'));
  if (inferred.size === 1) return [...inferred][0];
  return 'mixed';
}

function buildIndexes(rows) {
  return {
    searchable: rows.map((r, idx) => ({ idx, invoiceNo: r.search.invoiceNo, awbNo: r.search.awbNo, poNumber: r.search.poNumber, refNo: r.search.refNo })),
  };
}

async function loadRows(fetchRawFn, options = {}) {
  const { ttlMs = 180000, forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && cache.rows.length && now - cache.ts < ttlMs) {
    return cache;
  }

  const raw = await fetchRawFn();
  const rows = parseRows(raw);
  cache = {
    ts: now,
    rows,
    indexes: buildIndexes(rows),
  };
  return cache;
}

function stripInternalFields(row) {
  const { search, ...rest } = row;
  return rest;
}

function searchRows(rows, indexes, query, limit = 100) {
  const q = String(query || '').trim();
  if (!q) {
    return { query: '', detectedType: 'mixed', detectedTypeLabel: SEARCH_TYPE_LABEL.mixed, results: [] };
  }

  const tokens = q
    .split(/[\s,;|]+/)
    .map((token) => normalizeText(token))
    .filter(Boolean);

  if (!tokens.length) {
    return { query: q, detectedType: 'mixed', detectedTypeLabel: SEARCH_TYPE_LABEL.mixed, results: [] };
  }

  const detectedType = detectSearchType(tokens);
  const preferredFields = detectedType === 'mixed' ? SEARCH_FIELDS : [detectedType, ...SEARCH_FIELDS.filter((f) => f !== detectedType)];

  const scored = [];
  for (const rowIndex of indexes.searchable) {
    let score = 0;
    let matchedField = null;
    for (const token of tokens) {
      let tokenBest = 0;
      let tokenField = null;
      for (const field of preferredFields) {
        const s = scoreTokenMatch(token, rowIndex[field]);
        if (s > tokenBest) {
          tokenBest = s;
          tokenField = field;
        }
      }
      if (tokenBest === 0) {
        score = 0;
        matchedField = null;
        break;
      }
      const fieldWeight = tokenField && tokenField === detectedType ? 1.25 : 1;
      score += tokenBest * fieldWeight;
      matchedField = matchedField || tokenField;
    }

    if (score > 0) {
      scored.push({ row: rows[rowIndex.idx], score, matchedField });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, limit));

  return {
    query: q,
    detectedType,
    detectedTypeLabel: SEARCH_TYPE_LABEL[detectedType] || SEARCH_TYPE_LABEL.mixed,
    results: top.map((item) => ({
      ...stripInternalFields(item.row),
      _searchMeta: {
        score: item.score,
        matchedField: item.matchedField,
      },
    })),
  };
}

function suggestRows(rows, query, limit = 8) {
  const q = normalizeText(query);
  if (!q || q.length < 2) return [];

  const out = [];
  const seen = new Set();

  for (const row of rows) {
    for (const field of SEARCH_FIELDS) {
      const value = row[field];
      const normalized = row.search[field];
      if (!value || !normalized) continue;
      if (!normalized.includes(q)) continue;
      const key = `${field}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ field, fieldLabel: SEARCH_TYPE_LABEL[field], value });
      if (out.length >= limit) return out;
    }
  }

  return out;
}

export async function handleShipmentApiRequest(url, fetchRawFn) {
  const action = url.searchParams.get('action') || 'shipments';
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const dataset = await loadRows(fetchRawFn, { forceRefresh });

  if (action === 'shipments') {
    const tab = url.searchParams.get('tab') || 'dashboard';
    const filters = {
      platform: url.searchParams.get('platform') || '',
      courier: url.searchParams.get('courier') || '',
      zone: url.searchParams.get('zone') || '',
      city: url.searchParams.get('city') || '',
      month: url.searchParams.get('month') || '',
      dateFrom: url.searchParams.get('dateFrom') || '',
      dateTo: url.searchParams.get('dateTo') || '',
    };

    const tabRows = filterByTab(dataset.rows, tab);
    const filteredRows = filterByCommonFilters(tabRows, filters);

    return {
      ok: true,
      body: {
        action,
        tab,
        total: filteredRows.length,
        sourceTotal: dataset.rows.length,
        data: filteredRows.map(stripInternalFields),
      },
    };
  }

  if (action === 'search') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));

    const result = searchRows(dataset.rows, dataset.indexes, q, limit);
    return {
      ok: true,
      body: {
        action,
        query: result.query,
        detectedType: result.detectedType,
        detectedTypeLabel: result.detectedTypeLabel,
        total: result.results.length,
        data: result.results,
      },
    };
  }

  if (action === 'suggest') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 8)));
    return {
      ok: true,
      body: {
        action,
        query: q,
        suggestions: suggestRows(dataset.rows, q, limit),
      },
    };
  }

  return {
    ok: false,
    status: 400,
    body: { error: `Unsupported action: ${action}` },
  };
}
