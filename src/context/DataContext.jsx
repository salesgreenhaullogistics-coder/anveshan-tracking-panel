import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchShipmentData, searchShipments, fetchSearchSuggestions } from '../utils/index';
import { correctPlatformName } from '../utils/platformMapping';
import { correctStatus } from '../utils/statusMapping';

const DataContext = createContext(null);

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
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const HEADER_VALUES = new Set([
  'booking date', 'invoice no.', 'awb no.', 'vendor', 'consignee', 'origin',
  'destination', 'boxes', 'status', 'appointment date', 'failure remarks', 'delivery date', 'edd',
  'po number', 'cn status', 'zone', 'tat', 'month', 'delivery-booked', 'ref. no.', 'rto awb', 'cn no.',
  'logistics cost', 'pod', 'platform', 'pickup date',
]);

const EMPTY_FILTERS = { platform: '', courier: '', zone: '', city: '', dateFrom: '', dateTo: '', month: '' };
const TAB_KEYS = ['dashboard', 'all-lrs', 'intransit', 'ofd', 'appointment', 'aged-pos', 'lost', 'prepull', 'aging-monitor', 'delivered', 'return', 'pods', 'grn', 'kpi', 'okr', 'cost', 'analytics', 'poc', 'sop', 'provision'];

function makeInitialTabFilterState() {
  const obj = {};
  TAB_KEYS.forEach((tab) => {
    obj[tab] = { applied: { ...EMPTY_FILTERS }, pending: { ...EMPTY_FILTERS } };
  });
  return obj;
}

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

function parseRows(raw) {
  if (!raw || !Array.isArray(raw)) return [];

  // Already normalized rows from /api?action=shipments
  if (raw.length && typeof raw[0] === 'object' && !Array.isArray(raw[0]) && ('awbNo' in raw[0] || 'invoiceNo' in raw[0])) {
    return raw
      .map((row) => ({
        ...row,
        platform: correctPlatformName(row.platform || row.consignee || ''),
        status: correctStatus(row.status),
        month: row.month || deriveMMMYY(row.month, row.bookingDate),
      }))
      .filter((r) => !isHeaderRow(r) && r.awbNo);
  }

  let rows = [];

  if (raw.length > 0 && typeof raw[0] === 'object' && !Array.isArray(raw[0])) {
    rows = raw.map((row) => {
      const obj = {};
      for (const [apiKey, internalKey] of Object.entries(KEY_MAP)) {
        const val = row[apiKey];
        obj[internalKey] = val !== undefined && val !== null ? String(val).trim() : '';
      }
      if (!obj.bookingDate && row.ff) obj.bookingDate = String(row.ff).trim();
      obj.platform = correctPlatformName(obj.consignee);
      obj.status = correctStatus(obj.status);
      obj.month = deriveMMMYY(obj.month, obj.bookingDate);
      return obj;
    });
  } else if (raw.length > 1 && Array.isArray(raw[0])) {
    const headers = raw[0];
    const internalKeys = headers.map((h) => KEY_MAP[h] || h);
    rows = raw.slice(1).map((row) => {
      const obj = {};
      internalKeys.forEach((key, i) => {
        obj[key] = row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '';
      });
      obj.platform = correctPlatformName(obj.consignee);
      obj.status = correctStatus(obj.status);
      obj.month = deriveMMMYY(obj.month, obj.bookingDate);
      return obj;
    });
  }

  return rows.filter((r) => !isHeaderRow(r) && r.awbNo);
}

export function DataProvider({ children }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [tabFilters, setTabFilters] = useState(makeInitialTabFilterState);

  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  const requestIdRef = useRef(0);

  const currentTabState = tabFilters[activeTab] || { applied: EMPTY_FILTERS, pending: EMPTY_FILTERS };
  const filters = currentTabState.applied;
  const pendingFilters = currentTabState.pending;

  const updateTabState = useCallback((tab, updater) => {
    setTabFilters((prev) => {
      const current = prev[tab] || { applied: { ...EMPTY_FILTERS }, pending: { ...EMPTY_FILTERS } };
      const next = updater(current);
      return { ...prev, [tab]: next };
    });
  }, []);

  const setPendingFilters = useCallback((updater) => {
    updateTabState(activeTab, (current) => {
      const nextPending = typeof updater === 'function' ? updater(current.pending) : updater;
      return { ...current, pending: nextPending };
    });
  }, [activeTab, updateTabState]);

  const setFilters = useCallback((updater) => {
    updateTabState(activeTab, (current) => {
      const nextApplied = typeof updater === 'function' ? updater(current.applied) : updater;
      return { ...current, applied: nextApplied };
    });
  }, [activeTab, updateTabState]);

  const loadData = useCallback(async (opts = {}) => {
    const { forceRefresh = false } = opts;
    const localRequestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    try {
      /* analytics/cost/kpi/okr tabs use full dashboard data */
      const apiTab = ['analytics', 'cost', 'kpi', 'okr', 'all-lrs', 'aging-monitor'].includes(activeTab) ? 'dashboard' : activeTab;
      const result = await fetchShipmentData({
        tab: apiTab,
        forceRefresh,
      });
      const parsed = parseRows(result);

      if (localRequestId !== requestIdRef.current) return;
      setRawData(parsed);
      setLastFetched(new Date());
    } catch (err) {
      if (localRequestId !== requestIdRef.current) return;
      console.error('Failed to fetch data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      if (localRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [activeTab]);

  useEffect(() => {
    loadData({ forceRefresh: false });
  }, [loadData]);

  const applyFilters = useCallback(() => {
    updateTabState(activeTab, (current) => ({
      ...current,
      applied: { ...current.pending },
    }));
  }, [activeTab, updateTabState]);

  const clearFilters = useCallback(() => {
    updateTabState(activeTab, () => ({
      applied: { ...EMPTY_FILTERS },
      pending: { ...EMPTY_FILTERS },
    }));
  }, [activeTab, updateTabState]);

  const uniqueValues = useMemo(() => {
    const pSet = new Set(), cSet = new Set(), zSet = new Set(), dSet = new Set(), mSet = new Set();
    for (const r of rawData) {
      if (r.platform) pSet.add(r.platform);
      if (r.vendor) cSet.add(r.vendor);
      if (r.zone) zSet.add(r.zone);
      if (r.destination) dSet.add(r.destination);
      if (r.month) mSet.add(r.month);
    }
    const months = [...mSet]
      .map(m => ({ label: m, sort: (parseInt(`20${m.slice(4)}`, 10) || 2000) * 100 + MONTH_ABBR.indexOf(m.slice(0, 3)) }))
      .sort((a, b) => a.sort - b.sort).map(m => m.label);
    return { platforms: [...pSet].sort(), couriers: [...cSet].sort(), zones: [...zSet].sort(), cities: [...dSet].sort(), months };
  }, [rawData]);

  const globalSearch = useCallback(async (query, options = {}) => {
    const { limit = 100 } = options;
    const q = (query || '').trim().toLowerCase();
    if (!q) return { data: [], total: 0, query };

    const tokens = q.split(/\s+/).filter(Boolean);
    const results = rawData.filter((r) => {
      const searchable = [r.awbNo, r.invoiceNo, r.poNumber, r.refNo, r.cnNo, r.platform, r.vendor, r.destination, r.status]
        .map(v => (v || '').toLowerCase()).join(' ');
      return tokens.every(t => searchable.includes(t));
    });

    return { data: results.slice(0, limit), total: results.length, query, detectedTypeLabel: `${results.length} matches` };
  }, [rawData]);

  const fetchScopedData = useCallback(async (tab, scopedFilters = null) => {
    const result = await fetchShipmentData({
      tab,
      filters: scopedFilters || filters,
      forceRefresh: false,
    });
    return parseRows(result);
  }, [filters]);

  const getSearchSuggestions = useCallback(async (query, options = {}) => {
    const { limit = 8 } = options;
    const q = (query || '').trim().toLowerCase();
    if (!q || q.length < 2) return [];

    const seen = new Set();
    const suggestions = [];
    const fields = [
      { key: 'awbNo', fieldLabel: 'AWB' },
      { key: 'invoiceNo', fieldLabel: 'Invoice' },
      { key: 'poNumber', fieldLabel: 'PO' },
      { key: 'refNo', fieldLabel: 'Ref' },
    ];

    for (const row of rawData) {
      if (suggestions.length >= limit) break;
      for (const { key, fieldLabel } of fields) {
        const val = (row[key] || '').trim();
        if (val && val.toLowerCase().includes(q) && !seen.has(val)) {
          seen.add(val);
          suggestions.push({ field: key, fieldLabel, value: val });
          if (suggestions.length >= limit) break;
        }
      }
    }
    return suggestions;
  }, [rawData]);

  /* ─── client-side filter application ─── */
  const filteredData = useMemo(() => {
    if (!Object.values(filters).some(Boolean)) return rawData;
    return rawData.filter((r) => {
      if (filters.platform && r.platform !== filters.platform) return false;
      if (filters.courier && r.vendor !== filters.courier) return false;
      if (filters.zone && r.zone !== filters.zone) return false;
      if (filters.city && r.destination !== filters.city) return false;
      if (filters.month && r.month !== filters.month) return false;
      if (filters.dateFrom) {
        const bd = r.bookingDate ? new Date(r.bookingDate) : null;
        if (bd && !isNaN(bd) && bd < new Date(filters.dateFrom)) return false;
      }
      if (filters.dateTo) {
        const bd = r.bookingDate ? new Date(r.bookingDate) : null;
        if (bd && !isNaN(bd) && bd > new Date(filters.dateTo + 'T23:59:59')) return false;
      }
      return true;
    });
  }, [rawData, filters]);

  const refreshData = useCallback(() => loadData({ forceRefresh: true }), [loadData]);

  const value = {
    activeTab,
    setActiveTab,
    rawData,
    data: filteredData,
    loading,
    error,
    lastFetched,
    filters,
    setFilters,
    pendingFilters,
    setPendingFilters,
    applyFilters,
    clearFilters,
    uniqueValues,
    refreshData,
    globalSearch,
    fetchScopedData,
    getSearchSuggestions,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

export default DataContext;
