import * as XLSX from 'xlsx';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';

// ── API ──────────────────────────────────────────────────────────────────────

let dataCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function fetchShipmentData(options = {}) {
  const {
    tab = 'dashboard',
    filters = {},
    forceRefresh = false,
  } = options;

  const query = new URLSearchParams({
    action: 'shipments',
    tab,
  });
  if (filters.platform) query.set('platform', filters.platform);
  if (filters.courier) query.set('courier', filters.courier);
  if (filters.zone) query.set('zone', filters.zone);
  if (filters.city) query.set('city', filters.city);
  if (filters.month) query.set('month', filters.month);
  if (filters.dateFrom) query.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) query.set('dateTo', filters.dateTo);
  if (forceRefresh) query.set('refresh', '1');

  const cacheKey = query.toString();
  const now = Date.now();
  const cached = dataCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const attempts = [
    () => fetchWithTimeout(`/api?${query.toString()}`, { redirect: 'follow' }),
  ];

  let lastErr;
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
      dataCache.set(cacheKey, { ts: now, data: rows });
      return rows;
    } catch (err) {
      lastErr = err;
      console.warn('Fetch attempt failed:', err.message);
    }
  }
  throw lastErr || new Error('All fetch attempts failed');
}

export async function searchShipments(query, options = {}) {
  const { limit = 100, forceRefresh = false } = options;
  const params = new URLSearchParams({
    action: 'search',
    q: query || '',
    limit: String(limit),
  });
  if (forceRefresh) params.set('refresh', '1');

  const res = await fetchWithTimeout(`/api?${params.toString()}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSearchSuggestions(query, options = {}) {
  const { limit = 8 } = options;
  const params = new URLSearchParams({
    action: 'suggest',
    q: query || '',
    limit: String(limit),
  });
  const res = await fetchWithTimeout(`/api?${params.toString()}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Fuzzy Status Matching ────────────────────────────────────────────────────

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyMatch(status, patterns) {
  const n = normalize(status);
  if (!n || n.length < 2) return false; // empty / single-char strings never match
  return patterns.some((p) => {
    const np = normalize(p);
    if (!np) return false;
    return n.includes(np) || np.includes(n) || levenshtein(n, np) <= 2;
  });
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// ── Normalized status exact values (from Right Status.xlsx mapping) ──────────
// After status mapping is applied, statuses are one of these normalized values.
// Exact match is checked first; fuzzy matching is fallback for any unmapped values.

const NORMALIZED = {
  IN_TRANSIT:           'In-Transit',
  DELIVERED:            'Delivered',
  PARTIAL_DELIVERED:    'Partial Delivered',
  PARTIAL_RTO:          'Partial RTO Delivered',
  RTO_DELIVERED:        'RTO Delivered',
  RTO_IN_TRANSIT:       'RTO - In Transit',
  LOST:                 'Lost',
  OTHER:                'Other',
};

// Fuzzy fallback patterns for any unmapped raw statuses
const IN_TRANSIT_PATTERNS = [
  'pending', 'intransit', 'in transit', 'in-transit', 'undelivered',
  'in transit to destination', 'shipment in transit',
  'out for pickup', 'picked up', 'manifested', 'booked',
];
const OFD_PATTERNS = [
  'ofd', 'out for delivery', 'rtd', 'out for delivary',
  'dispatched to customer', 'last mile',
];
const DELIVERED_PATTERNS = [
  'delivered', 'pod pending', 'pod uploaded', 'pod received',
  'successfully delivered', 'shipment delivered',
];
const PARTIAL_DELIVERED_PATTERNS = [
  'partial delivered', 'partially delivered', 'partial delivery',
];
const RTO_DELIVERED_PATTERNS = [
  'rto delivered', 'rto - delivered', 'rto return', 'rto-delivered',
  'returned to origin', 'rto complete',
];
const RTO_INTRANSIT_PATTERNS = [
  'rto - pending for delivery', 'rto - in transit', 'rto - pending with gracious',
  'rto - ofd', 'rto - document pending', 'rto-intransit', 'rto - documents received',
  'rto in transit', 'rto intransit', 'rto pending',
];
const RTO_PARTIAL_PATTERNS = [
  'partial rto delivered', 'partially delivered - rto', 'partial delivered - rto', 'rto partial',
];
const LOST_PATTERNS = [
  'lost', 'missing', 'not found', 'shipment lost', 'damaged beyond repair',
];

export function isInTransit(status) {
  if (status === NORMALIZED.IN_TRANSIT) return true;
  if (status === NORMALIZED.DELIVERED || status === NORMALIZED.PARTIAL_DELIVERED ||
      status === NORMALIZED.RTO_DELIVERED || status === NORMALIZED.RTO_IN_TRANSIT ||
      status === NORMALIZED.PARTIAL_RTO || status === NORMALIZED.LOST ||
      status === NORMALIZED.OTHER) return false;
  return fuzzyMatch(status, IN_TRANSIT_PATTERNS) && !isOFD(status) && !isDelivered(status) && !isRTO(status);
}

export function isOFD(status) {
  // No normalized status maps to OFD (OFD → In-Transit per mapping)
  if (Object.values(NORMALIZED).includes(status)) return false;
  return fuzzyMatch(status, OFD_PATTERNS);
}

export function isDelivered(status) {
  if (status === NORMALIZED.DELIVERED) return true;
  if (status === NORMALIZED.PARTIAL_DELIVERED || status === NORMALIZED.RTO_DELIVERED ||
      status === NORMALIZED.RTO_IN_TRANSIT || status === NORMALIZED.PARTIAL_RTO ||
      status === NORMALIZED.IN_TRANSIT || status === NORMALIZED.LOST ||
      status === NORMALIZED.OTHER) return false;
  return fuzzyMatch(status, DELIVERED_PATTERNS) && !isPartialDelivered(status) && !isRTO(status);
}

export function isPartialDelivered(status) {
  if (status === NORMALIZED.PARTIAL_DELIVERED) return true;
  if (Object.values(NORMALIZED).includes(status)) return false;
  return fuzzyMatch(status, PARTIAL_DELIVERED_PATTERNS) && !isRTOPartial(status);
}

export function isRTODelivered(status) {
  if (status === NORMALIZED.RTO_DELIVERED) return true;
  if (Object.values(NORMALIZED).includes(status)) return false;
  return fuzzyMatch(status, RTO_DELIVERED_PATTERNS);
}

export function isRTOInTransit(status) {
  if (status === NORMALIZED.RTO_IN_TRANSIT) return true;
  if (Object.values(NORMALIZED).includes(status)) return false;
  return fuzzyMatch(status, RTO_INTRANSIT_PATTERNS);
}

export function isRTOPartial(status) {
  if (status === NORMALIZED.PARTIAL_RTO) return true;
  if (Object.values(NORMALIZED).includes(status)) return false;
  return fuzzyMatch(status, RTO_PARTIAL_PATTERNS);
}

export function isRTO(status) {
  return isRTODelivered(status) || isRTOInTransit(status) || isRTOPartial(status);
}

export function isLost(status) {
  if (status === NORMALIZED.LOST) return true;
  if (Object.values(NORMALIZED).includes(status)) return false;
  return fuzzyMatch(status, LOST_PATTERNS);
}

export function classifyStatus(status) {
  if (isRTODelivered(status)) return 'RTO Delivered';
  if (isRTOInTransit(status)) return 'RTO In-Transit';
  if (isRTOPartial(status)) return 'RTO Partial';
  if (isDelivered(status)) return 'Delivered';
  if (isPartialDelivered(status)) return 'Partial Delivered';
  if (isOFD(status)) return 'OFD';
  if (isLost(status)) return 'Lost';
  if (isInTransit(status)) return 'In-Transit';
  return 'Other';
}

// ── Date Utilities ───────────────────────────────────────────────────────────

export function safeParseDate(str) {
  if (!str) return null;
  let d = new Date(str);
  if (isValid(d)) return d;
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    if (isValid(d)) return d;
  }
  return null;
}

export function formatDate(str) {
  const d = safeParseDate(str);
  if (!d) return str || '-';
  return format(d, 'dd MMM yyyy');
}

export function daysBetween(from, to) {
  const f = safeParseDate(from);
  const t = safeParseDate(to);
  if (!f || !t) return null;
  return differenceInDays(t, f);
}

export function getAgeBucket(days) {
  if (days === null || days === undefined) return 'Unknown';
  if (days <= 3) return '0-3 Days';
  if (days <= 7) return '4-7 Days';
  if (days <= 15) return '8-15 Days';
  return '15+ Days';
}

export function isAged(bookingDate, threshold = 7) {
  const bd = safeParseDate(bookingDate);
  if (!bd) return false;
  return differenceInDays(new Date(), bd) > threshold;
}

// ── Export Utilities ─────────────────────────────────────────────────────────

export function exportToExcel(data, columns, filename = 'export') {
  const headers = columns.map((c) => c.label);
  const rows = data.map((row) => columns.map((c) => row[c.key] || ''));
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const colWidths = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] || '').length));
    return { wch: Math.min(maxLen + 2, 40) };
  });
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── Chart Color Palette ──────────────────────────────────────────────────────

export const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#A855F7', '#D946EF',
];

export function getColor(i) {
  return COLORS[i % COLORS.length];
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function percent(num, den) {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 10000) / 100;
}

export function currency(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Unknown';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

export function countBy(arr, key) {
  const groups = groupBy(arr, key);
  return Object.entries(groups).map(([k, v]) => ({ label: k, count: v.length }));
}
