import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchShipmentData } from '../utils/index';
import { correctPlatformName } from '../utils/platformMapping';
import { correctStatus } from '../utils/statusMapping';

const DataContext = createContext(null);

const KEY_MAP = {
  'Booking Date': 'bookingDate',
  'Invoice No.': 'invoiceNo',
  'AWB No.': 'awbNo',
  'Vendor': 'vendor',
  'Consignee': 'consignee',
  'Origin': 'origin',
  'Destination': 'destination',
  'Boxes': 'boxes',
  'Status': 'status',
  'Appointment Date': 'appointmentDate',
  'Failure Remarks': 'failureRemarks',
  'Delivery Date': 'deliveryDate',
  'EDD': 'edd',
  'PO Number': 'poNumber',
  'CN Status': 'cnStatus',
  'Zone': 'zone',
  'TAT': 'tat',
  'Month': 'month',
  'Delivery-Booked': 'deliveryBooked',
  'Ref. No.': 'refNo',
  'RTO AWB': 'rtoAwb',
  'CN No.': 'cnNo',
  'Logistics Cost': 'logisticsCost',
  'POD': 'pod',
  'POD Link': 'podUrl',
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAME_TO_IDX = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
};
/** Derive MMM'YY from bookingDate + raw month name, e.g. "Jan'25" */
function deriveMMMYY(rawMonth, bookingDate) {
  if (!rawMonth) return '';
  const ml = rawMonth.toLowerCase().trim();
  if (MONTH_NAME_TO_IDX[ml] === undefined) return '';          // filter "Booking Date", "Pickup Date", etc.
  const mIdx = MONTH_NAME_TO_IDX[ml];
  if (!bookingDate) return '';                                  // no year derivable → skip
  const d = new Date(bookingDate);
  if (isNaN(d)) return '';
  const fullYr = d.getFullYear();
  if (fullYr < 2020 || fullYr > 2027) return '';               // filter garbage years
  return `${MONTH_ABBR[mIdx]}'${String(fullYr).slice(-2)}`;
}

/** Header-row / garbage check */
const HEADER_VALUES = new Set(['booking date','invoice no.','awb no.','vendor','consignee','origin',
  'destination','boxes','status','appointment date','failure remarks','delivery date','edd',
  'po number','cn status','zone','tat','month','delivery-booked','ref. no.','rto awb','cn no.',
  'logistics cost','pod','platform','pickup date']);
function isHeaderRow(obj) {
  const awb = (obj.awbNo || '').toLowerCase();
  return HEADER_VALUES.has(awb) || awb === 'awb no.' || awb === 'awb no';
}

function parseRows(raw) {
  if (!raw || !Array.isArray(raw)) return [];

  let rows = [];

  if (raw.length > 0 && typeof raw[0] === 'object' && !Array.isArray(raw[0])) {
    rows = raw.map((row) => {
      const obj = {};
      for (const [apiKey, internalKey] of Object.entries(KEY_MAP)) {
        const val = row[apiKey];
        obj[internalKey] = val !== undefined && val !== null ? String(val).trim() : '';
      }
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

  // Filter out header-duplicate rows AND completely empty rows (no AWB = no real data)
  return rows.filter((r) => !isHeaderRow(r) && r.awbNo);
}

const EMPTY_FILTERS = { platform: '', courier: '', zone: '', city: '', dateFrom: '', dateTo: '', month: '' };

export function DataProvider({ children }) {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [pendingFilters, setPendingFilters] = useState(EMPTY_FILTERS);

  const fetchingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchShipmentData();
      const parsed = parseRows(result);
      setRawData(parsed);
      setLastFetched(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const uniqueValues = useMemo(() => {
    const platforms = [...new Set(rawData.map((r) => r.platform).filter(Boolean))].sort();
    const couriers = [...new Set(rawData.map((r) => r.vendor).filter(Boolean))].sort();
    const zones = [...new Set(rawData.map((r) => r.zone).filter(Boolean))].sort();
    const cities = [...new Set(rawData.map((r) => r.destination).filter(Boolean))].sort();

    // Sort months chronologically (MMM'YY format)
    const monthSet = [...new Set(rawData.map((r) => r.month).filter(Boolean))];
    const monthOrder = monthSet.map((m) => {
      const abbr = m.slice(0, 3);
      const yr = parseInt('20' + m.slice(4), 10) || 2000;
      const mi = MONTH_ABBR.indexOf(abbr);
      return { label: m, sort: yr * 100 + mi };
    }).sort((a, b) => a.sort - b.sort);
    const months = monthOrder.map((m) => m.label);

    return { platforms, couriers, zones, cities, months };
  }, [rawData]);

  const filteredData = useMemo(() => {
    return rawData.filter((row) => {
      if (filters.platform && row.platform !== filters.platform) return false;
      if (filters.courier && row.vendor !== filters.courier) return false;
      if (filters.zone && row.zone !== filters.zone) return false;
      if (filters.city && row.destination !== filters.city) return false;
      if (filters.month && row.month !== filters.month) return false;
      if (filters.dateFrom) {
        const bd = parseDate(row.bookingDate);
        if (bd && bd < new Date(filters.dateFrom)) return false;
      }
      if (filters.dateTo) {
        const bd = parseDate(row.bookingDate);
        if (bd && bd > new Date(filters.dateTo)) return false;
      }
      return true;
    });
  }, [rawData, filters]);

  const applyFilters = useCallback(() => {
    setFilters({ ...pendingFilters });
  }, [pendingFilters]);

  const clearFilters = useCallback(() => {
    setPendingFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }, []);

  const value = {
    rawData,
    data: filteredData,
    loading, error, lastFetched,
    filters, setFilters,
    pendingFilters, setPendingFilters,
    applyFilters, clearFilters,
    uniqueValues,
    refreshData: loadData,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

export default DataContext;
