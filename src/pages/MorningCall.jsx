import React, { useEffect, useMemo, useState } from 'react';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { BarChart, LineChart, DoughnutChart } from '../components/Charts';
import {
  Sunrise, Package, AlertTriangle, Clock, CheckCircle, TrendingUp, RefreshCw,
  Filter, Download, X, Search, Truck, Building2, MapPin, Activity,
  BarChart3, Workflow, Database, Brain, Trophy, Target, Calendar, Layers,
  IndianRupee, FileText, Flame, Zap, Lightbulb, Calculator,
} from 'lucide-react';
import { currency, formatDate } from '../utils/index';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwp9e-wWPkPNZSv-ijO-d3CXYvM15Lt1ARsvq9_aRA2zzYlRdmFOoJwUuTKlD-zEn8/exec';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const ONE_DAY = 24 * 60 * 60 * 1000;
const today = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();
const yesterday = new Date(today.getTime() - ONE_DAY);
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const txt = (v, fb = '') => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s || fb; };
/* Parse dates day-first (Indian D/M/Y). JS `new Date('1/6/2026')` wrongly reads
   that as Jan 6 (US M/D); the sheet means 1 June. Handle ISO and D-M-Y explicitly. */
const safeDate = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); /* ISO YYYY-MM-DD */
  if (m) { const y = +m[1], mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(y, mo - 1, d); }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); /* D/M/Y, D-M-Y, D.M.Y */
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } /* clearly M/D — swap */
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(y, mo - 1, d);
    return null;
  }
  const dd = new Date(s); /* fallback: "06 Feb 2026", ISO datetime, etc. */
  return isNaN(dd) ? null : new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
};
const dDiff = (a, b) => { if (!a || !b) return null; return Math.max(0, Math.floor((a - b) / ONE_DAY)); };
const isPendingApptText = (s) => {
  const c = String(s || '').toLowerCase().trim();
  if (!c) return true;
  if (/^(na|n\/a|nil|pending|-|none)$/.test(c)) return true;
  if (/no slot|not booked|tbd|tba|to be booked|yet to|not received|awaited|awaiting/.test(c)) return true;
  if (/(appt|appointment|slot)\s+(pending|not booked|awaited|required)/.test(c)) return true;
  if (/\bpending\b/.test(c) && !/\b(booked|confirmed|scheduled|fixed)\b/.test(c)) return true;
  return false;
};
const isDeliveredStatus = (s) => {
  const c = String(s || '').toLowerCase().trim();
  if (!c) return false;
  if (/\b(not\s+delivered|undelivered)\b/.test(c)) return false;
  return /\b(delivered|partial delivered|partially delivered|pod pending)\b/.test(c);
};
const isPartialDelivered = (s) => {
  const c = String(s || '').toLowerCase().trim();
  return /partial.*deliver|partially.*deliver/.test(c);
};
/* 3PL / fulfilment platforms excluded from PO-expiry tracking. */
const EXPIRY_EXCLUDE_PLATFORMS = /flipkart\s*stn|emiza|prozo/i;
/* In-transit / still-in-pipeline = not delivered and not cancelled/RTO. */
const isInTransitStatus = (s) => {
  const c = String(s || '').toLowerCase().trim();
  if (!c) return false;
  if (isDeliveredStatus(s)) return false;
  if (/\b(cancel|cancelled|canceled|rto|returned|return to origin)\b/.test(c)) return false;
  return true;
};
const ageBucket = (a) => {
  if (a == null || !isFinite(a)) return 'Age NA';
  if (a <= 7) return '0-7 Days';
  if (a <= 15) return '8-15 Days';
  if (a <= 20) return '16-20 Days';
  if (a <= 30) return '21-30 Days';
  return 'Above 30 Days';
};
const AGE_ORDER = ['0-7 Days', '8-15 Days', '16-20 Days', '21-30 Days', 'Above 30 Days', 'Age NA'];
const AGE_COLOR = { '0-7 Days': '#10b981', '8-15 Days': '#84cc16', '16-20 Days': '#f59e0b', '21-30 Days': '#f97316', 'Above 30 Days': '#dc2626', 'Age NA': '#9ca3af' };
const zoneFromCity = (city) => {
  const c = String(city || '').toLowerCase();
  if (/delhi|gurgaon|gurugram|noida|lucknow|ghaziabad|faridabad/.test(c)) return 'North';
  if (/bangalore|bengaluru|chennai|hyderabad|coimbatore|kochi/.test(c)) return 'South';
  if (/mumbai|pune|ahmedabad|surat|nashik|nagpur/.test(c)) return 'West';
  if (/kolkata|guwahati|patna|bhubaneswar/.test(c)) return 'East';
  return 'Others';
};

export default function MorningCall() {
  /* Data fetch */
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(GAS_URL, { method: 'GET', redirect: 'follow' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        if (cancelled) return;
        const rows = Array.isArray(json) ? json : (json.data || []);
        /* Enrich with derived fields */
        const enriched = rows.map((r, i) => {
          const dispDate = safeDate(r['Dispatch Date']);
          const apptDate = safeDate(r['Appointment Date']);
          const eddDate = safeDate(r['EDD']);
          const poExpDate = safeDate(r['Po Expiry Date']) || safeDate(r['PO Expiry Date']);
          const status = txt(r['Status'], 'Pending');
          const apptRaw = txt(r['Appointment Date'], '');
          const apptPending = !apptDate && isPendingApptText(apptRaw);
          const age = dispDate ? dDiff(today, dispDate) : null;
          const ageLeftRaw = num(r['Age left'] ?? r['Age Left']);
          const appt1D = safeDate(r['1st Appointment']);
          const appt2D = safeDate(r['2nd Appointment']);
          const appt3D = safeDate(r['3rd Appointment']);
          const apptDArr = [appt1D, appt2D, appt3D].filter(Boolean);
          const latestApptD = apptDArr.length ? new Date(Math.max(...apptDArr.map(d => d.getTime()))) : null;
          return {
            _i: i,
            po: txt(r['PO Number/Order No']),
            wh: txt(r['WH'], 'Unknown'),
            platform: txt(r['Platform/Order Type'], 'Unknown'),
            invoiceNo: txt(r['Invoice Number']),
            value: num(r['Total Invoice Value']),
            dispatchDate: dispDate,
            dispatchDateStr: dispDate ? formatDate(dispDate) : 'NA',
            awb: txt(r['AWB No.']),
            vendor: txt(r['Vendor'], 'Unknown'),
            origin: txt(r['Origin'], 'Unknown'),
            destination: txt(r['Destination'], 'Unknown'),
            zone: zoneFromCity(r['Destination']),
            boxes: num(r['Boxes']),
            status,
            statusLower: status.toLowerCase(),
            isDelivered: isDeliveredStatus(status),
            isPartial: isPartialDelivered(status),
            apptDate, apptRaw, apptPending,
            apptStr: apptDate ? formatDate(apptDate) : (apptRaw || 'Pending'),
            failureRemarks: txt(r['Failure Remarks'], 'NA'),
            deliveryDate: safeDate(r['Delivery Date']),
            edd: eddDate,
            eddStr: eddDate ? formatDate(eddDate) : 'NA',
            ageLeft: ageLeftRaw,
            poExpiryDate: poExpDate,
            poExpiryStr: poExpDate ? formatDate(poExpDate) : 'NA',
            ageBucket: ageBucket(age),
            age,
            hasProof: r['Has Proof of Dispatch'] === true || String(r['Has Proof of Dispatch']).toUpperCase() === 'TRUE',
            poStatus: txt(r['Po Status'], 'Valid'),
            appt1: txt(r['1st Appointment']),
            appt2: txt(r['2nd Appointment']),
            appt3: txt(r['3rd Appointment']),
            appt1Date: appt1D, appt2Date: appt2D, appt3Date: appt3D,
            latestApptDate: latestApptD,
            latestApptStr: latestApptD ? formatDate(latestApptD) : 'NA',
            isInTransit: isInTransitStatus(status),
          };
        });
        setRaw(enriched);
        setLastSync(new Date());
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to fetch'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  /* Filter state */
  const [filters, setFilters] = useState({
    platform: 'all', vendor: 'all', wh: 'all', destination: 'all', zone: 'all',
    status: 'all', apptStatus: 'all', poStatus: 'all', ageBucket: 'all',
    dateFrom: '', dateTo: '', search: '', minValue: '', proofStatus: 'all',
  });
  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const resetFilters = () => setFilters({ platform: 'all', vendor: 'all', wh: 'all', destination: 'all', zone: 'all', status: 'all', apptStatus: 'all', poStatus: 'all', ageBucket: 'all', dateFrom: '', dateTo: '', search: '', minValue: '', proofStatus: 'all' });

  const uniq = (key) => useMemo(() => Array.from(new Set(raw.map(r => r[key]).filter(Boolean))).sort(), [raw]);
  const platforms = uniq('platform'); const vendors = uniq('vendor'); const whs = uniq('wh');
  const destinations = uniq('destination'); const zones = uniq('zone'); const statuses = uniq('status');

  /* Apply filters */
  const data = useMemo(() => raw.filter(r => {
    if (filters.platform !== 'all' && r.platform !== filters.platform) return false;
    if (filters.vendor !== 'all' && r.vendor !== filters.vendor) return false;
    if (filters.wh !== 'all' && r.wh !== filters.wh) return false;
    if (filters.destination !== 'all' && r.destination !== filters.destination) return false;
    if (filters.zone !== 'all' && r.zone !== filters.zone) return false;
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.apptStatus === 'pending' && !r.apptPending) return false;
    if (filters.apptStatus === 'booked' && r.apptPending) return false;
    if (filters.proofStatus === 'yes' && !r.hasProof) return false;
    if (filters.proofStatus === 'no' && r.hasProof) return false;
    if (filters.ageBucket !== 'all' && r.ageBucket !== filters.ageBucket) return false;
    if (filters.dateFrom && r.dispatchDate && r.dispatchDate < new Date(filters.dateFrom)) return false;
    if (filters.dateTo && r.dispatchDate && r.dispatchDate > new Date(filters.dateTo)) return false;
    if (filters.minValue && r.value < parseFloat(filters.minValue)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [r.po, r.invoiceNo, r.awb, r.platform, r.vendor, r.destination, r.failureRemarks].map(v => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [raw, filters]);

  /* ─── Aggregations ─────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const open = data.filter(r => !r.isDelivered);
    const totalValue = data.reduce((s, r) => s + r.value, 0);
    const openValue = open.reduce((s, r) => s + r.value, 0);
    const pendingAppt = open.filter(r => r.apptPending);
    const pendingApptValue = pendingAppt.reduce((s, r) => s + r.value, 0);

    /* Table 1: Age Bucket */
    const ageBuckets = {};
    AGE_ORDER.forEach(b => { ageBuckets[b] = { rows: [], pendingRows: [], value: 0, pendingValue: 0 }; });
    data.forEach(r => {
      ageBuckets[r.ageBucket].rows.push(r);
      ageBuckets[r.ageBucket].value += r.value;
      if (!r.isDelivered && r.apptPending) {
        ageBuckets[r.ageBucket].pendingRows.push(r);
        ageBuckets[r.ageBucket].pendingValue += r.value;
      }
    });

    /* Table 2/3: Age range × appt */
    const range21_30 = open.filter(r => r.age != null && r.age >= 21 && r.age <= 30);
    const above15 = open.filter(r => r.age != null && r.age > 15);
    const split = (arr) => ({
      withAppt: arr.filter(r => !r.apptPending),
      withoutAppt: arr.filter(r => r.apptPending),
    });

    /* Table 3a: Selected platforms */
    const targetPlatforms = ['Prozo', 'Emiza', 'Flipkart STN', 'General-Trade'];
    const targetPlatformStats = targetPlatforms.map(p => {
      const match21_30 = range21_30.filter(r => r.platform.toLowerCase().includes(p.toLowerCase().split('-')[0].split(' ')[0]));
      const matchAbove15 = above15.filter(r => r.platform.toLowerCase().includes(p.toLowerCase().split('-')[0].split(' ')[0]));
      return {
        platform: p,
        c21_30: match21_30.length, v21_30: match21_30.reduce((s, r) => s + r.value, 0), items21_30: match21_30,
        cAbove15: matchAbove15.length, vAbove15: matchAbove15.reduce((s, r) => s + r.value, 0), itemsAbove15: matchAbove15,
      };
    });

    /* Table 4: Date-wise appt vs delivered */
    const byApptDate = {};
    data.forEach(r => {
      if (!r.apptDate) return;
      const k = r.apptDate.toISOString().slice(0, 10);
      if (!byApptDate[k]) byApptDate[k] = { label: formatDate(r.apptDate), date: r.apptDate, total: 0, value: 0, del: 0, delVal: 0, rows: [], pendRows: [] };
      byApptDate[k].total++; byApptDate[k].value += r.value; byApptDate[k].rows.push(r);
      if (r.isDelivered) { byApptDate[k].del++; byApptDate[k].delVal += r.value; }
      else byApptDate[k].pendRows.push(r);
    });
    const dateWise = Object.values(byApptDate).sort((a, b) => a.date - b.date);

    /* Yesterday/Today */
    const yKey = yesterday.toISOString().slice(0, 10);
    const tKey = today.toISOString().slice(0, 10);
    const yesterdayBucket = byApptDate[yKey] || { total: 0, del: 0, rows: [] };
    const todayApptRows = data.filter(r => r.apptDate && r.apptDate.toISOString().slice(0, 10) === tKey);
    const dispatchTodayRows = data.filter(r => r.dispatchDate && r.dispatchDate.toISOString().slice(0, 10) === tKey);
    const dispatchYesterdayRows = data.filter(r => r.dispatchDate && r.dispatchDate.toISOString().slice(0, 10) === yKey);

    /* Table 5/9/10/11 helpers — by platform */
    const groupByKey = (arr, keyFn) => {
      const m = {};
      arr.forEach(r => {
        const k = keyFn(r);
        if (!k) return;
        if (!m[k]) m[k] = { key: k, count: 0, value: 0, rows: [], booked: 0 };
        m[k].count++; m[k].value += r.value; m[k].rows.push(r);
        if (!r.apptPending) m[k].booked++;
      });
      return Object.values(m).sort((a, b) => b.value - a.value);
    };
    const todayApptByPlatform = groupByKey(todayApptRows, r => r.platform);
    const dispatchTodayByPlatform = groupByKey(dispatchTodayRows, r => r.platform);
    const dispatchYesterdayByPlatform = groupByKey(dispatchYesterdayRows, r => r.platform);
    const overallByPlatform = groupByKey(open, r => r.platform);
    const yesterdayDeliveredByPlatform = groupByKey(yesterdayBucket.rows ? yesterdayBucket.rows.filter(r => r.isDelivered) : [], r => r.platform);

    /* Table 6/7/8: EDD vs PO Expiry */
    const expiry = { after: [], on: [], before: [] };
    data.forEach(r => {
      if (!r.edd || !r.poExpiryDate) return;
      if (r.edd > r.poExpiryDate) expiry.after.push(r);
      else if (r.edd.getTime() === r.poExpiryDate.getTime()) expiry.on.push(r);
      else expiry.before.push(r);
    });
    const expiryByPlat = (arr) => groupByKey(arr, r => r.platform);

    /* Expired / expiring-today, in-transit. Excludes 3PL platforms, and excludes
       already-expired POs that have a today/future appointment — those belong in
       the Expiry Change tab, not here. */
    const expiredInTransit = [];
    const expiringTodayInTransit = [];
    data.forEach(r => {
      if (!r.poExpiryDate || !r.isInTransit) return;
      if (EXPIRY_EXCLUDE_PLATFORMS.test(r.platform)) return;
      const t = r.poExpiryDate.getTime();
      const futureAppt = r.latestApptDate && r.latestApptDate.getTime() >= today.getTime();
      if (t < today.getTime()) {
        if (futureAppt) return; /* shown in Expiry Change instead */
        expiredInTransit.push(r);
      } else if (t === today.getTime()) {
        expiringTodayInTransit.push(r);
      }
    });
    const expiredByPlat = groupByKey(expiredInTransit, r => r.platform);
    const expiringTodayByPlat = groupByKey(expiringTodayInTransit, r => r.platform);

    /* Expiry-date-change needed on Filflo: the PO has ALREADY expired
       (expiry < today) but a booked appointment (1st/2nd/3rd) is today or in the
       future — so the expiry must be extended. Same 3PL platforms excluded. */
    const expiryChange = data.filter(r =>
      r.poExpiryDate && r.latestApptDate && !r.isDelivered &&
      !EXPIRY_EXCLUDE_PLATFORMS.test(r.platform) &&
      r.poExpiryDate.getTime() < today.getTime() &&
      r.latestApptDate.getTime() >= today.getTime()
    ).sort((a, b) => b.value - a.value);
    const expiryChangeByPlat = groupByKey(expiryChange, r => r.platform);

    /* Table 13a: Pending appt ageing by platform */
    const pendingApptAgeing = {};
    pendingAppt.forEach(r => {
      if (!pendingApptAgeing[r.platform]) pendingApptAgeing[r.platform] = { platform: r.platform, buckets: {}, total: 0, value: 0, rows: [] };
      pendingApptAgeing[r.platform].buckets[r.ageBucket] = (pendingApptAgeing[r.platform].buckets[r.ageBucket] || 0) + 1;
      pendingApptAgeing[r.platform].total++;
      pendingApptAgeing[r.platform].value += r.value;
      pendingApptAgeing[r.platform].rows.push(r);
    });
    const pendingApptAgeingArr = Object.values(pendingApptAgeing).sort((a, b) => b.total - a.total);

    /* Table 14: Zone-wise yesterday */
    const zoneStatsY = {};
    (yesterdayBucket.rows || []).forEach(r => {
      if (!zoneStatsY[r.zone]) zoneStatsY[r.zone] = { zone: r.zone, total: 0, del: 0, rows: [] };
      zoneStatsY[r.zone].total++;
      zoneStatsY[r.zone].rows.push(r);
      if (r.isDelivered) zoneStatsY[r.zone].del++;
    });
    const zoneArrY = Object.values(zoneStatsY);

    /* Table 15: First attempt */
    const firstAttemptYesterday = { total: yesterdayBucket.total, success: yesterdayBucket.del, rows: yesterdayBucket.rows || [] };

    /* Table 16: Yesterday failure reasons */
    const yesterdayFailures = {};
    (yesterdayBucket.rows || []).filter(r => !r.isDelivered).forEach(r => {
      const reason = r.failureRemarks && !/^(na|n\/a|nil|pending|-|none)$/i.test(r.failureRemarks) ? r.failureRemarks : `No Remark (${r.status})`;
      if (!yesterdayFailures[reason]) yesterdayFailures[reason] = { reason, count: 0, value: 0, rows: [] };
      yesterdayFailures[reason].count++;
      yesterdayFailures[reason].value += r.value;
      yesterdayFailures[reason].rows.push(r);
    });
    const failureArr = Object.values(yesterdayFailures).sort((a, b) => b.count - a.count);

    /* Table 17: Transit impact */
    const transitImpact = open.filter(r => /misrout|delay|transit|route|late|stuck|held up|break/i.test(r.failureRemarks)).sort((a, b) => b.value - a.value);

    /* Table 18/19: Proof compliance */
    const proofByDate = {};
    data.forEach(r => {
      if (!r.dispatchDate) return;
      const k = r.dispatchDate.toISOString().slice(0, 10);
      if (!proofByDate[k]) proofByDate[k] = { label: r.dispatchDateStr, date: r.dispatchDate, total: 0, attached: 0, missing: [] };
      proofByDate[k].total++;
      if (r.hasProof) proofByDate[k].attached++;
      else proofByDate[k].missing.push(r);
    });
    const proofArr = Object.values(proofByDate).filter(p => p.date.toISOString().slice(0, 10) !== tKey && p.attached < p.total).sort((a, b) => b.date - a.date);
    const missingProofAll = proofArr.flatMap(p => p.missing.map(r => ({ ...r, _missingDate: p.label, _ageMissing: dDiff(today, p.date) })));

    /* Table 20: Destination performance (appts before yesterday) */
    const destStats = {};
    data.forEach(r => {
      if (!r.apptDate || r.apptDate >= yesterday) return;
      if (!destStats[r.destination]) destStats[r.destination] = { destination: r.destination, total: 0, value: 0, del: 0, delVal: 0, rows: [], failures: [] };
      destStats[r.destination].total++;
      destStats[r.destination].value += r.value;
      destStats[r.destination].rows.push(r);
      if (r.isDelivered) { destStats[r.destination].del++; destStats[r.destination].delVal += r.value; }
      else if (r.failureRemarks && !/^(na|n\/a|nil|pending|-|none)$/i.test(r.failureRemarks)) {
        destStats[r.destination].failures.push(r);
      }
    });
    const destArr = Object.values(destStats).sort((a, b) => b.total - a.total);
    const destFailures = destArr.flatMap(d => d.failures.map(r => ({ ...r, _dest: d.destination })));

    /* Table 22: Low MOV (<50K) by platform-destination */
    const lowMov = {};
    data.filter(r => r.value > 0 && r.value < 50000).forEach(r => {
      const k = `${r.platform}||${r.destination}`;
      if (!lowMov[k]) lowMov[k] = { platform: r.platform, destination: r.destination, b1: 0, b2: 0, b3: 0, count: 0, value: 0, minValue: Infinity, rows: [] };
      lowMov[k].count++; lowMov[k].value += r.value; lowMov[k].minValue = Math.min(lowMov[k].minValue, r.value);
      if (r.value < 10000) lowMov[k].b1++;
      else if (r.value < 25000) lowMov[k].b2++;
      else lowMov[k].b3++;
      lowMov[k].rows.push(r);
    });
    const lowMovArr = Object.values(lowMov).sort((a, b) => b.count - a.count);

    /* Table 23: Low MOQ (<10 boxes) */
    const lowMoq = {};
    data.filter(r => r.boxes > 0 && r.boxes < 10).forEach(r => {
      const k = `${r.platform}||${r.destination}`;
      if (!lowMoq[k]) lowMoq[k] = { platform: r.platform, destination: r.destination, b1: 0, b2: 0, b3: 0, count: 0, value: 0, minBoxes: Infinity, rows: [] };
      lowMoq[k].count++; lowMoq[k].value += r.value; lowMoq[k].minBoxes = Math.min(lowMoq[k].minBoxes, r.boxes);
      if (r.boxes < 4) lowMoq[k].b1++;
      else if (r.boxes < 7) lowMoq[k].b2++;
      else lowMoq[k].b3++;
      lowMoq[k].rows.push(r);
    });
    const lowMoqArr = Object.values(lowMoq).sort((a, b) => b.count - a.count);

    /* Table 24: Partial delivered */
    const partialDel = {};
    data.filter(r => r.isPartial).forEach(r => {
      const k = `${r.platform}||${r.destination}`;
      if (!partialDel[k]) partialDel[k] = { platform: r.platform, destination: r.destination, count: 0, value: 0, rows: [] };
      partialDel[k].count++; partialDel[k].value += r.value; partialDel[k].rows.push(r);
    });
    const partialDelArr = Object.values(partialDel).sort((a, b) => b.count - a.count);

    return {
      open, totalValue, openValue, pendingAppt, pendingApptValue,
      ageBuckets, range21_30, above15, split,
      targetPlatformStats,
      dateWise, yesterdayBucket, todayApptRows, dispatchTodayRows, dispatchYesterdayRows,
      todayApptByPlatform, dispatchTodayByPlatform, dispatchYesterdayByPlatform, overallByPlatform, yesterdayDeliveredByPlatform,
      expiry, expiryByPlatAfter: expiryByPlat(expiry.after), expiryByPlatOn: expiryByPlat(expiry.on), expiryByPlatBefore: expiryByPlat(expiry.before),
      expiredInTransit, expiringTodayInTransit, expiredByPlat, expiringTodayByPlat,
      expiryChange, expiryChangeByPlat,
      pendingApptAgeingArr,
      zoneArrY, firstAttemptYesterday, failureArr,
      transitImpact, proofArr, missingProofAll,
      destArr, destFailures,
      lowMovArr, lowMoqArr, partialDelArr,
    };
  }, [data]);

  /* ─── Tab state + Drilldown ────────────────────────────────────────── */
  const [tab, setTab] = useState('overview');
  const [drill, setDrill] = useState(null);
  const openDrill = (title, rows) => setDrill({ title, rows });

  /* CSV export of current filtered data */
  const exportCSV = () => {
    if (data.length === 0) return;
    const cols = ['po', 'wh', 'platform', 'vendor', 'destination', 'zone', 'origin', 'boxes', 'value', 'status', 'apptStr', 'failureRemarks', 'dispatchDateStr', 'eddStr', 'poExpiryStr', 'ageBucket', 'age', 'hasProof'];
    const header = ['PO', 'WH', 'Platform', 'Vendor', 'Destination', 'Zone', 'Origin', 'Boxes', 'Value', 'Status', 'Appointment', 'Remarks', 'Dispatch', 'EDD', 'PO Expiry', 'Age Bucket', 'Age (d)', 'Has Proof'];
    const rows = [header, ...data.map(r => cols.map(c => r[c] ?? ''))];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `morning-call-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const drillCols = [
    { key: 'po', label: 'PO' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'value', label: 'Value', render: v => currency(num(v)) },
    { key: 'status', label: 'Status' },
    { key: 'apptStr', label: 'Appointment' },
    { key: 'age', label: 'Age (d)' },
    { key: 'failureRemarks', label: 'Remarks' },
    { key: 'dispatchDateStr', label: 'Dispatch' },
    { key: 'eddStr', label: 'EDD' },
    { key: 'poExpiryStr', label: 'PO Expiry' },
    { key: 'awb', label: 'AWB' },
    { key: 'invoiceNo', label: 'Invoice' },
    { key: 'boxes', label: 'Boxes' },
    { key: 'hasProof', label: 'Proof', render: v => v ? '✓' : '✕' },
  ];

  const activeFilterCount = Object.values(filters).filter(v => v && v !== 'all').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 rounded-xl p-5 text-white">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><Sunrise className="w-5 h-5" /> Morning Logistics Call</h2>
            <p className="text-amber-100 text-[11px] mt-0.5">Intransit summary — live from Google Sheets · {raw.length} POs loaded</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {lastSync && <span className="text-[10px] bg-white/15 px-2 py-1 rounded">Synced {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={() => setRefreshKey(k => k + 1)} className="flex items-center gap-1 text-[11px] px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg font-semibold backdrop-blur"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            <button onClick={exportCSV} disabled={data.length === 0} className="flex items-center gap-1 text-[11px] px-3 py-1.5 bg-white text-orange-700 hover:bg-orange-50 rounded-lg font-semibold disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export</button>
          </div>
        </div>
      </div>

      {loading && raw.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" />
          <p className="text-[12px] text-blue-700 font-semibold">Loading intransit data…</p>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[11px] text-red-700">
          <strong>Fetch error:</strong> {error}. <button onClick={() => setRefreshKey(k => k + 1)} className="underline ml-1">Retry</button>
        </div>
      )}

      {raw.length > 0 && (<>
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <button onClick={() => openDrill('All POs', data)} className="text-left"><KPICard title="Total POs" value={data.length} icon={Package} color="blue" subtitle={currency(stats.totalValue)} /></button>
        <button onClick={() => openDrill('Open ageing', stats.open)} className="text-left"><KPICard title="Open Ageing" value={stats.open.length} icon={Clock} color="orange" subtitle={currency(stats.openValue)} /></button>
        <button onClick={() => openDrill('Pending appointment', stats.pendingAppt)} className="text-left"><KPICard title="Appt Pending" value={`${stats.pendingAppt.length}/${stats.open.length}`} icon={AlertTriangle} color="yellow" subtitle={currency(stats.pendingApptValue)} /></button>
        <button onClick={() => openDrill('Above 15 days', stats.above15)} className="text-left"><KPICard title=">15 Days" value={stats.above15.length} icon={Flame} color="red" subtitle={currency(stats.above15.reduce((s, r) => s + r.value, 0))} /></button>
        <button onClick={() => openDrill('EDD after expiry', stats.expiry.after)} className="text-left"><KPICard title="After Expiry" value={stats.expiry.after.length} icon={AlertTriangle} color="red" subtitle="EDD past PO expiry" /></button>
        <KPICard title="First Attempt %" value={`${stats.firstAttemptYesterday.total > 0 ? (stats.firstAttemptYesterday.success / stats.firstAttemptYesterday.total * 100).toFixed(0) : 0}%`} icon={CheckCircle} color="green" subtitle={`${stats.firstAttemptYesterday.success}/${stats.firstAttemptYesterday.total} yesterday`} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-600" />
            <h3 className="text-[12px] font-bold text-gray-800">Advanced Filters</h3>
            {activeFilterCount > 0 && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">{activeFilterCount} active</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">{data.length} of {raw.length} POs</span>
            {activeFilterCount > 0 && <button onClick={resetFilters} className="text-[10px] text-red-600 hover:text-red-700 font-semibold flex items-center gap-1"><X className="w-3 h-3" /> Clear all</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
          <FSelect label="Platform" value={filters.platform} onChange={v => setF('platform', v)} options={platforms} />
          <FSelect label="Vendor" value={filters.vendor} onChange={v => setF('vendor', v)} options={vendors} />
          <FSelect label="Warehouse" value={filters.wh} onChange={v => setF('wh', v)} options={whs} />
          <FSelect label="Destination" value={filters.destination} onChange={v => setF('destination', v)} options={destinations} />
          <FSelect label="Zone" value={filters.zone} onChange={v => setF('zone', v)} options={zones} />
          <FSelect label="Status" value={filters.status} onChange={v => setF('status', v)} options={statuses} />
          <FSelect label="Age bucket" value={filters.ageBucket} onChange={v => setF('ageBucket', v)} options={AGE_ORDER} />
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Appt</label>
            <select value={filters.apptStatus} onChange={e => setF('apptStatus', e.target.value)} className={`w-full px-2 py-1 border rounded outline-none ${filters.apptStatus !== 'all' ? 'border-indigo-300 bg-indigo-50/40 text-indigo-700 font-semibold' : 'border-gray-200'}`}>
              <option value="all">All</option><option value="booked">Booked</option><option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Proof</label>
            <select value={filters.proofStatus} onChange={e => setF('proofStatus', e.target.value)} className={`w-full px-2 py-1 border rounded outline-none ${filters.proofStatus !== 'all' ? 'border-indigo-300 bg-indigo-50/40 text-indigo-700 font-semibold' : 'border-gray-200'}`}>
              <option value="all">All</option><option value="yes">Has Proof</option><option value="no">Missing Proof</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Dispatch from</label>
            <input type="date" value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded" />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Dispatch to</label>
            <input type="date" value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded" />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Min Value</label>
            <input type="number" placeholder="0" value={filters.minValue} onChange={e => setF('minValue', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded" />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="block text-gray-500 mb-0.5 font-medium">Search (PO / Invoice / AWB / Remark)</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" value={filters.search} onChange={e => setF('search', e.target.value)} placeholder="Type to search…" className="w-full pl-7 pr-2 py-1 border border-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1.5 flex items-center gap-1 overflow-x-auto">
        {[
          { k: 'overview', l: 'Executive Snapshot', icon: BarChart3 },
          { k: 'ageing', l: 'Ageing & Appointment', icon: Clock },
          { k: 'delivery', l: 'Delivery & Expiry', icon: CheckCircle },
          { k: 'expired', l: 'Expired POs', icon: Flame },
          { k: 'expirychange', l: 'Expiry Change (Filflo)', icon: Calendar },
          { k: 'dispatch', l: 'Dispatch & Destination', icon: Truck },
          { k: 'insights', l: 'Smart Insights', icon: Brain },
          { k: 'raw', l: `Raw Data (${data.length})`, icon: Database },
        ].map(t => { const Icon = t.icon; return (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${tab === t.k ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Icon className="w-3.5 h-3.5" /> {t.l}
          </button>
        ); })}
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {tab === 'overview' && <OverviewTab stats={stats} data={data} openDrill={openDrill} />}

      {/* ═══ AGEING TAB ═══ */}
      {tab === 'ageing' && <AgeingTab stats={stats} openDrill={openDrill} />}

      {/* ═══ DELIVERY & EXPIRY TAB ═══ */}
      {tab === 'delivery' && <DeliveryTab stats={stats} openDrill={openDrill} />}

      {/* ═══ EXPIRED POs TAB ═══ */}
      {tab === 'expired' && <ExpiredTab stats={stats} openDrill={openDrill} />}

      {/* ═══ EXPIRY CHANGE (FILFLO) TAB ═══ */}
      {tab === 'expirychange' && <ExpiryChangeTab stats={stats} openDrill={openDrill} />}

      {/* ═══ DISPATCH & DESTINATION TAB ═══ */}
      {tab === 'dispatch' && <DispatchTab stats={stats} openDrill={openDrill} />}

      {/* ═══ INSIGHTS TAB ═══ */}
      {tab === 'insights' && <InsightsTab stats={stats} data={data} openDrill={openDrill} setF={setF} />}

      {/* ═══ RAW DATA TAB ═══ */}
      {tab === 'raw' && (
        <div className="space-y-3">
          <PivotBuilder data={data} openDrill={openDrill} />
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
            <h3 className="text-[12px] font-bold text-gray-700 mb-2 flex items-center gap-2"><Database className="w-4 h-4 text-orange-500" /> Full PO Register ({data.length} rows)</h3>
            <DataTable data={data} columns={drillCols} pageSize={50} exportFilename="morning-call-register" />
          </div>
        </div>
      )}

      </>)}

      {/* Drilldown Modal */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-orange-700">{drill.title}</h3>
                <p className="text-[10px] text-gray-500">{drill.rows.length} POs · {currency(drill.rows.reduce((s, r) => s + r.value, 0))}</p>
              </div>
              <button onClick={() => setDrill(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <DataTable data={drill.rows} columns={drillCols} pageSize={25} exportFilename="morning-call-drill" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Reusable filter dropdown ────────────────────────────────────────── */
function FSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-gray-500 mb-0.5 font-medium">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={`w-full px-2 py-1 border rounded outline-none ${value !== 'all' ? 'border-indigo-300 bg-indigo-50/40 text-indigo-700 font-semibold' : 'border-gray-200'}`}>
        <option value="all">All ({options.length})</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ─── TabularSection: simple section with title + clickable rows ─────── */
function Section({ title, icon: Icon, accent = 'amber', children, sub }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-100 bg-${accent}-50/40 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          {Icon && <Icon className={`w-3.5 h-3.5 text-${accent}-600`} />}
          <h3 className="text-[11px] font-bold text-gray-700">{title}</h3>
        </div>
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/* ─── OVERVIEW TAB ─────────────────────────────────────────────────── */
function OverviewTab({ stats, data, openDrill }) {
  return (
    <div className="space-y-3">
      {/* Age bucket distribution */}
      <Section title="Table 1 — Age Bucket Distribution" icon={Clock} sub="Click row to view POs">
        <table className="w-full text-[11px]">
          <thead><tr className="bg-gray-50 border-b border-gray-100">
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Bucket</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">PO Count</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Value</th>
            <th className="px-3 py-2 text-right font-semibold text-amber-600">Pending Appt</th>
            <th className="px-3 py-2 text-right font-semibold text-amber-600">Pending Value</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {AGE_ORDER.map(b => {
              const bk = stats.ageBuckets[b];
              return (
                <tr key={b} onClick={() => openDrill(`Age bucket: ${b}`, bk.rows)} className="hover:bg-amber-50/40 cursor-pointer">
                  <td className="px-3 py-1.5 font-semibold" style={{ color: AGE_COLOR[b] }}>● {b}</td>
                  <td className="px-3 py-1.5 text-right">{bk.rows.length}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{currency(bk.value)}</td>
                  <td className="px-3 py-1.5 text-right text-amber-700">{bk.pendingRows.length}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-700">{currency(bk.pendingValue)}</td>
                </tr>
              );
            })}
            <tr className="bg-indigo-50 font-bold border-t-2 border-indigo-200">
              <td className="px-3 py-1.5 text-indigo-700">Total</td>
              <td className="px-3 py-1.5 text-right text-indigo-700">{data.length}</td>
              <td className="px-3 py-1.5 text-right font-mono text-indigo-700">{currency(stats.totalValue)}</td>
              <td className="px-3 py-1.5 text-right text-indigo-700">{stats.pendingAppt.length}</td>
              <td className="px-3 py-1.5 text-right font-mono text-indigo-700">{currency(stats.pendingApptValue)}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart title="Age Bucket — PO Count" labels={AGE_ORDER.filter(b => stats.ageBuckets[b].rows.length > 0)}
            datasets={[{ label: 'POs', data: AGE_ORDER.filter(b => stats.ageBuckets[b].rows.length > 0).map(b => stats.ageBuckets[b].rows.length), color: '#f97316' }]} height={220} />
        </div>
        <div className="chart-container">
          <DoughnutChart title="Appt: Booked vs Pending" labels={['Booked', 'Pending']} data={[stats.open.length - stats.pendingAppt.length, stats.pendingAppt.length]} height={220} />
        </div>
      </div>

      {/* Today's snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Table 5 — Today's Appointments by Platform" icon={Calendar} accent="blue">
          {stats.todayApptByPlatform.length === 0 ? <p className="p-4 text-[10px] text-gray-400">No appointments today</p> : (
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50"><th className="px-3 py-1.5 text-left font-semibold text-gray-500">Platform</th><th className="px-3 py-1.5 text-right font-semibold text-gray-500">Count</th><th className="px-3 py-1.5 text-right font-semibold text-gray-500">Value</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {stats.todayApptByPlatform.map(p => (
                  <tr key={p.key} onClick={() => openDrill(`Today appt: ${p.key}`, p.rows)} className="hover:bg-blue-50/40 cursor-pointer">
                    <td className="px-3 py-1.5">{p.key}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{p.count}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{currency(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Table 9 — Yesterday Delivered by Platform" icon={CheckCircle} accent="emerald">
          {stats.yesterdayDeliveredByPlatform.length === 0 ? <p className="p-4 text-[10px] text-gray-400">Nothing delivered yesterday</p> : (
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50"><th className="px-3 py-1.5 text-left font-semibold text-gray-500">Platform</th><th className="px-3 py-1.5 text-right font-semibold text-gray-500">Delivered</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {stats.yesterdayDeliveredByPlatform.map(p => (
                  <tr key={p.key} onClick={() => openDrill(`Yesterday delivered: ${p.key}`, p.rows.filter(r => r.isDelivered))} className="hover:bg-emerald-50/40 cursor-pointer">
                    <td className="px-3 py-1.5">{p.key}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-emerald-700">{p.rows.filter(r => r.isDelivered).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ─── AGEING TAB ───────────────────────────────────────────────────── */
function AgeingTab({ stats, openDrill }) {
  const split21_30 = stats.split(stats.range21_30);
  const splitAbove15 = stats.split(stats.above15);

  return (
    <div className="space-y-3">
      {/* Table 2 + 3 side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Table 2 — 21-30 Days Appt Summary" icon={Clock} accent="amber">
          <ApptSummaryTable data={split21_30} openDrill={openDrill} label="21-30 Days" />
        </Section>
        <Section title="Table 3 — >15 Days Appt Summary" icon={Flame} accent="red">
          <ApptSummaryTable data={splitAbove15} openDrill={openDrill} label=">15 Days" />
        </Section>
      </div>

      {/* Table 3a: Target platforms */}
      <Section title="Table 3a — Target Platform Summary (Prozo · Emiza · Flipkart STN · General-Trade)" icon={Trophy} accent="indigo" sub="21-30 + >15 days breakdown">
        <table className="w-full text-[11px]">
          <thead><tr className="bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Platform</th>
            <th className="px-3 py-2 text-right font-semibold text-amber-600">21-30 POs</th>
            <th className="px-3 py-2 text-right font-semibold text-amber-600">21-30 Value</th>
            <th className="px-3 py-2 text-right font-semibold text-red-600">&gt;15 POs</th>
            <th className="px-3 py-2 text-right font-semibold text-red-600">&gt;15 Value</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.targetPlatformStats.map(p => (
              <tr key={p.platform} className="hover:bg-indigo-50/40">
                <td className="px-3 py-1.5 font-semibold">{p.platform}</td>
                <td onClick={() => openDrill(`${p.platform} — 21-30 Days`, p.items21_30)} className="px-3 py-1.5 text-right cursor-pointer hover:bg-amber-50">{p.c21_30}</td>
                <td onClick={() => openDrill(`${p.platform} — 21-30 Days`, p.items21_30)} className="px-3 py-1.5 text-right font-mono cursor-pointer hover:bg-amber-50">{currency(p.v21_30)}</td>
                <td onClick={() => openDrill(`${p.platform} — >15 Days`, p.itemsAbove15)} className="px-3 py-1.5 text-right cursor-pointer hover:bg-red-50">{p.cAbove15}</td>
                <td onClick={() => openDrill(`${p.platform} — >15 Days`, p.itemsAbove15)} className="px-3 py-1.5 text-right font-mono cursor-pointer hover:bg-red-50">{currency(p.vAbove15)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Table 3b: >15 Days detail */}
      <Section title="Table 3b — >15 Days PO Details" icon={Database} accent="red" sub={`${stats.above15.length} POs`}>
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-50"><tr>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">PO</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Platform</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Destination</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Age</th>
              <th className="px-2 py-1.5 text-right font-semibold text-rose-600">Value</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Appt</th>
              <th className="px-2 py-1.5 text-left font-semibold text-amber-600">Appt Status</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Remark</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {[...stats.above15].sort((a, b) => b.value - a.value).slice(0, 100).map(r => (
                <tr key={r._i} className="hover:bg-red-50/40">
                  <td className="px-2 py-1 font-mono">{r.po}</td>
                  <td className="px-2 py-1">{r.platform}</td>
                  <td className="px-2 py-1">{r.destination}</td>
                  <td className="px-2 py-1 text-right font-bold" style={{ color: r.age > 30 ? '#dc2626' : '#d97706' }}>{r.age}</td>
                  <td className="px-2 py-1 text-right font-mono">{currency(r.value)}</td>
                  <td className="px-2 py-1">{r.apptStr}</td>
                  <td className={`px-2 py-1 ${r.apptPending ? 'text-red-600 font-semibold' : 'text-emerald-600'}`}>{r.apptPending ? 'Without' : 'With'}</td>
                  <td className="px-2 py-1 truncate max-w-[200px]" title={r.failureRemarks}>{r.failureRemarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Table 13a: Pending appt ageing by platform */}
      <Section title="Table 13a — Pending Appointment Ageing × Platform" icon={Activity} accent="yellow" sub="Heatmap of stuck appt bookings">
        <div className="overflow-x-auto"><table className="w-full text-[10px]">
          <thead><tr className="bg-gray-50">
            <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Platform</th>
            {AGE_ORDER.map(b => <th key={b} className="px-2 py-1.5 text-right font-semibold text-gray-500">{b}</th>)}
            <th className="px-2 py-1.5 text-right font-semibold text-indigo-600">Total</th>
            <th className="px-2 py-1.5 text-right font-semibold text-indigo-600">Value</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.pendingApptAgeingArr.map(p => (
              <tr key={p.platform} className="hover:bg-yellow-50/40">
                <td className="px-2 py-1.5 font-semibold">{p.platform}</td>
                {AGE_ORDER.map(b => {
                  const c = p.buckets[b] || 0;
                  return <td key={b} onClick={() => c > 0 && openDrill(`${p.platform} — ${b} pending appt`, p.rows.filter(r => r.ageBucket === b))}
                    className={`px-2 py-1.5 text-right ${c > 0 ? 'cursor-pointer hover:bg-amber-100' : ''}`}
                    style={{ background: c > 0 ? `rgba(245, 158, 11, ${Math.min(0.1 + c * 0.05, 0.7)})` : '' }}>{c || '—'}</td>;
                })}
                <td className="px-2 py-1.5 text-right font-bold text-indigo-700">{p.total}</td>
                <td className="px-2 py-1.5 text-right font-mono text-indigo-700">{currency(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>
    </div>
  );
}

function ApptSummaryTable({ data: split, openDrill, label }) {
  const total = split.withAppt.length + split.withoutAppt.length;
  const wV = split.withAppt.reduce((s, r) => s + r.value, 0);
  const woV = split.withoutAppt.reduce((s, r) => s + r.value, 0);
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="bg-gray-50">
        <th className="px-3 py-1.5 text-left font-semibold text-gray-500">Category</th>
        <th className="px-3 py-1.5 text-right font-semibold text-gray-500">POs</th>
        <th className="px-3 py-1.5 text-right font-semibold text-gray-500">Value</th>
      </tr></thead>
      <tbody className="divide-y divide-gray-50">
        <tr onClick={() => openDrill(`${label} — With Appt`, split.withAppt)} className="hover:bg-emerald-50/40 cursor-pointer">
          <td className="px-3 py-1.5 text-emerald-700">With Appt</td>
          <td className="px-3 py-1.5 text-right">{split.withAppt.length}</td>
          <td className="px-3 py-1.5 text-right font-mono">{currency(wV)}</td>
        </tr>
        <tr onClick={() => openDrill(`${label} — Without Appt`, split.withoutAppt)} className="hover:bg-red-50/40 cursor-pointer">
          <td className="px-3 py-1.5 text-red-700">Without Appt</td>
          <td className="px-3 py-1.5 text-right">{split.withoutAppt.length}</td>
          <td className="px-3 py-1.5 text-right font-mono">{currency(woV)}</td>
        </tr>
        <tr className="bg-indigo-50 font-bold border-t-2 border-indigo-200">
          <td className="px-3 py-1.5 text-indigo-700">Total</td>
          <td className="px-3 py-1.5 text-right text-indigo-700">{total}</td>
          <td className="px-3 py-1.5 text-right font-mono text-indigo-700">{currency(wV + woV)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ─── DELIVERY TAB ─────────────────────────────────────────────────── */
function DeliveryTab({ stats, openDrill }) {
  return (
    <div className="space-y-3">
      {/* Table 4: Date-wise */}
      <Section title="Table 4 — Date-wise Appt vs Delivered" icon={Calendar} accent="emerald">
        <div className="max-h-[300px] overflow-y-auto"><table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-gray-50"><tr>
            <th className="px-3 py-1.5 text-left font-semibold text-gray-500">Date</th>
            <th className="px-3 py-1.5 text-right font-semibold text-gray-500">Total</th>
            <th className="px-3 py-1.5 text-right font-semibold text-gray-500">Value</th>
            <th className="px-3 py-1.5 text-right font-semibold text-emerald-600">Del</th>
            <th className="px-3 py-1.5 text-right font-semibold text-emerald-600">Del Val</th>
            <th className="px-3 py-1.5 text-right font-semibold text-red-600">Pending</th>
            <th className="px-3 py-1.5 text-right font-semibold text-red-600">Pend Val</th>
            <th className="px-3 py-1.5 text-right font-semibold text-indigo-600">%</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.dateWise.map(d => {
              const pct = d.total > 0 ? d.del / d.total * 100 : 0;
              return (
                <tr key={d.label} className="hover:bg-emerald-50/40">
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td onClick={() => openDrill(`${d.label} — Appts`, d.rows)} className="px-3 py-1.5 text-right cursor-pointer hover:bg-blue-50">{d.total}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{currency(d.value)}</td>
                  <td onClick={() => openDrill(`${d.label} — Delivered`, d.rows.filter(r => r.isDelivered))} className="px-3 py-1.5 text-right text-emerald-700 cursor-pointer hover:bg-emerald-50">{d.del}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{currency(d.delVal)}</td>
                  <td onClick={() => openDrill(`${d.label} — Pending`, d.pendRows)} className="px-3 py-1.5 text-right text-red-700 cursor-pointer hover:bg-red-50">{d.total - d.del}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-red-700">{currency(d.value - d.delVal)}</td>
                  <td className="px-3 py-1.5 text-right font-bold" style={{ color: pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Section>

      {/* Table 6/7/8 side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Section title="Table 6 — Reach AFTER Expiry" icon={AlertTriangle} accent="red" sub={`${stats.expiry.after.length} POs`}>
          <table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {stats.expiryByPlatAfter.map(p => (
                <tr key={p.key} onClick={() => openDrill(`After expiry: ${p.key}`, p.rows)} className="hover:bg-red-50/40 cursor-pointer">
                  <td className="px-2 py-1">{p.key}</td><td className="px-2 py-1 text-right text-red-700 font-bold">{p.count}</td><td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Table 7 — Reach ON Expiry" icon={AlertTriangle} accent="yellow" sub={`${stats.expiry.on.length} POs`}>
          <table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {stats.expiryByPlatOn.map(p => (
                <tr key={p.key} onClick={() => openDrill(`On expiry: ${p.key}`, p.rows)} className="hover:bg-yellow-50/40 cursor-pointer">
                  <td className="px-2 py-1">{p.key}</td><td className="px-2 py-1 text-right text-amber-700 font-bold">{p.count}</td><td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Table 8 — Reach BEFORE Expiry" icon={CheckCircle} accent="emerald" sub={`${stats.expiry.before.length} POs`}>
          <table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {stats.expiryByPlatBefore.map(p => (
                <tr key={p.key} onClick={() => openDrill(`Before expiry: ${p.key}`, p.rows)} className="hover:bg-emerald-50/40 cursor-pointer">
                  <td className="px-2 py-1">{p.key}</td><td className="px-2 py-1 text-right text-emerald-700 font-bold">{p.count}</td><td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      {/* Table 15 + 16 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Table 15 — First Attempt Success (Yesterday)" icon={Target} accent="purple">
          <div className="p-4 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-[9px] uppercase tracking-wider text-gray-500">Total</p><p className="text-2xl font-bold text-blue-700">{stats.firstAttemptYesterday.total}</p></div>
            <div><p className="text-[9px] uppercase tracking-wider text-gray-500">Success</p><p className="text-2xl font-bold text-emerald-700">{stats.firstAttemptYesterday.success}</p></div>
            <div><p className="text-[9px] uppercase tracking-wider text-gray-500">Success %</p><p className="text-2xl font-bold" style={{ color: stats.firstAttemptYesterday.total > 0 && stats.firstAttemptYesterday.success / stats.firstAttemptYesterday.total >= 0.7 ? '#059669' : '#dc2626' }}>{stats.firstAttemptYesterday.total > 0 ? (stats.firstAttemptYesterday.success / stats.firstAttemptYesterday.total * 100).toFixed(0) : 0}%</p></div>
          </div>
        </Section>
        <Section title="Table 16 — Failure Reasons (Yesterday)" icon={AlertTriangle} accent="red" sub={`${stats.failureArr.length} reasons`}>
          <div className="max-h-[200px] overflow-y-auto"><table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-1 text-left text-gray-500">Reason</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {stats.failureArr.map(f => (
                <tr key={f.reason} onClick={() => openDrill(`Failure: ${f.reason}`, f.rows)} className="hover:bg-red-50/40 cursor-pointer">
                  <td className="px-2 py-1 truncate max-w-[200px]" title={f.reason}>{f.reason}</td>
                  <td className="px-2 py-1 text-right text-red-700 font-bold">{f.count}</td>
                  <td className="px-2 py-1 text-right font-mono">{currency(f.value)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Section>
      </div>
    </div>
  );
}

/* ─── Platform breakdown table (reusable) ──────────────────────────── */
function PlatTable({ arr, onPick, prefix, accentClass = 'text-gray-700', hoverClass = 'hover:bg-gray-50' }) {
  if (!arr || !arr.length) return <div className="p-4 text-center text-[11px] text-gray-400">None</div>;
  return (
    <table className="w-full text-[10px]">
      <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
      <tbody className="divide-y divide-gray-50">
        {arr.map(p => (
          <tr key={p.key} onClick={() => onPick(`${prefix}: ${p.key}`, p.rows)} className={`${hoverClass} cursor-pointer`}>
            <td className="px-2 py-1">{p.key}</td>
            <td className={`px-2 py-1 text-right font-bold ${accentClass}`}>{p.count}</td>
            <td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── EXPIRED POs TAB ──────────────────────────────────────────────── */
function ExpiredTab({ stats, openDrill }) {
  const exp = stats.expiredInTransit, todayExp = stats.expiringTodayInTransit;
  const expVal = exp.reduce((s, r) => s + r.value, 0);
  const todayVal = todayExp.reduce((s, r) => s + r.value, 0);
  const cols = [
    { key: 'po', label: 'PO' }, { key: 'platform', label: 'Platform' }, { key: 'status', label: 'Status' },
    { key: 'poExpiryStr', label: 'PO Expiry' }, { key: 'age', label: 'Age (d)' },
    { key: 'destination', label: 'Destination' }, { key: 'vendor', label: 'Vendor' },
    { key: 'value', label: 'Value', render: v => currency(num(v)) },
  ];
  return (
    <div className="space-y-3">
      <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-[11px] text-rose-700">
        Expired / expiring <strong>in-transit</strong> POs with <strong>no upcoming appointment</strong>. POs that already expired but have a today/future appointment are shown in <strong>Expiry Change (Filflo)</strong>. Flipkart STN, Emiza &amp; Prozo are excluded.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button onClick={() => openDrill('Already expired (in-transit)', exp)} className="text-left"><KPICard title="Already Expired" value={exp.length} icon={Flame} color="red" subtitle={currency(expVal)} /></button>
        <button onClick={() => openDrill('Expiring today (in-transit)', todayExp)} className="text-left"><KPICard title="Expiring Today" value={todayExp.length} icon={AlertTriangle} color="yellow" subtitle={currency(todayVal)} /></button>
        <KPICard title="Total At-Risk" value={exp.length + todayExp.length} icon={Clock} color="orange" subtitle={currency(expVal + todayVal)} />
        <KPICard title="Platforms Affected" value={new Set([...exp, ...todayExp].map(r => r.platform)).size} icon={Layers} color="purple" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Already Expired — by Platform" icon={Flame} accent="red" sub={`${exp.length} POs`}>
          <PlatTable arr={stats.expiredByPlat} onPick={openDrill} prefix="Expired" accentClass="text-red-700" hoverClass="hover:bg-red-50/40" />
        </Section>
        <Section title="Expiring Today — by Platform" icon={AlertTriangle} accent="yellow" sub={`${todayExp.length} POs`}>
          <PlatTable arr={stats.expiringTodayByPlat} onPick={openDrill} prefix="Expiring today" accentClass="text-amber-700" hoverClass="hover:bg-yellow-50/40" />
        </Section>
      </div>
      <Section title="Already Expired — full list" icon={Flame} accent="red" sub={`${exp.length} POs`}>
        <div className="p-3"><DataTable data={exp} columns={cols} pageSize={25} exportFilename="expired-pos" emptyMessage="No expired in-transit POs." /></div>
      </Section>
      {todayExp.length > 0 && (
        <Section title="Expiring Today — full list" icon={AlertTriangle} accent="yellow" sub={`${todayExp.length} POs`}>
          <div className="p-3"><DataTable data={todayExp} columns={cols} pageSize={25} exportFilename="expiring-today-pos" /></div>
        </Section>
      )}
    </div>
  );
}

/* ─── EXPIRY CHANGE (FILFLO) TAB ───────────────────────────────────── */
function ExpiryChangeTab({ stats, openDrill }) {
  const list = stats.expiryChange;
  const val = list.reduce((s, r) => s + r.value, 0);
  return (
    <div className="space-y-3">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 text-[11px] text-indigo-700">
        POs that have <strong>already expired</strong> (PO expiry before today) but have a <strong>today/future appointment</strong> booked. Action: <strong>change the expiry date on Filflo</strong> to at least the latest appointment date so the PO isn't rejected.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button onClick={() => openDrill('Expiry change needed (Filflo)', list)} className="text-left"><KPICard title="Need Expiry Change" value={list.length} icon={Calendar} color="indigo" subtitle={currency(val)} /></button>
        <KPICard title="Platforms" value={new Set(list.map(r => r.platform)).size} icon={Layers} color="purple" />
        <KPICard title="At-Risk Value" value={currency(val)} icon={IndianRupee} color="orange" />
      </div>
      <Section title="By Platform" icon={Calendar} accent="indigo" sub={`${list.length} POs`}>
        <PlatTable arr={stats.expiryChangeByPlat} onPick={openDrill} prefix="Expiry change" accentClass="text-indigo-700" hoverClass="hover:bg-indigo-50/40" />
      </Section>
      <Section title="POs needing expiry-date change on Filflo" icon={Calendar} accent="indigo" sub={`${list.length} POs`}>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto"><table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-gray-50"><tr>
            <th className="px-2 py-1 text-left text-gray-500">PO</th>
            <th className="px-2 py-1 text-left text-gray-500">Platform</th>
            <th className="px-2 py-1 text-left text-gray-500">Status</th>
            <th className="px-2 py-1 text-left text-gray-500">PO Expiry</th>
            <th className="px-2 py-1 text-left text-gray-500">1st Appt</th>
            <th className="px-2 py-1 text-left text-gray-500">2nd Appt</th>
            <th className="px-2 py-1 text-left text-gray-500">3rd Appt</th>
            <th className="px-2 py-1 text-left text-emerald-600">Set Expiry &ge;</th>
            <th className="px-2 py-1 text-right text-gray-500">Value</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {list.map(r => (
              <tr key={r._i} className="hover:bg-indigo-50/30">
                <td className="px-2 py-1 font-medium">{r.po}</td>
                <td className="px-2 py-1">{r.platform}</td>
                <td className="px-2 py-1">{r.status}</td>
                <td className="px-2 py-1 text-red-600 font-semibold">{r.poExpiryStr}</td>
                <td className="px-2 py-1">{r.appt1Date ? formatDate(r.appt1Date) : (r.appt1 || '—')}</td>
                <td className="px-2 py-1">{r.appt2Date ? formatDate(r.appt2Date) : (r.appt2 || '—')}</td>
                <td className="px-2 py-1">{r.appt3Date ? formatDate(r.appt3Date) : (r.appt3 || '—')}</td>
                <td className="px-2 py-1 text-emerald-700 font-bold">{r.latestApptStr}</td>
                <td className="px-2 py-1 text-right font-mono">{currency(r.value)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={9} className="px-2 py-4 text-center text-gray-400">No POs need an expiry change right now.</td></tr>}
          </tbody>
        </table></div>
      </Section>
    </div>
  );
}

/* ─── DISPATCH TAB ─────────────────────────────────────────────────── */
function DispatchTab({ stats, openDrill }) {
  return (
    <div className="space-y-3">
      {/* Table 10/11/12 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[
          { title: 'Table 10 — Dispatch vs Booked (Today)', arr: stats.dispatchTodayByPlatform, accent: 'blue' },
          { title: 'Table 11 — Dispatch vs Booked (Yesterday)', arr: stats.dispatchYesterdayByPlatform, accent: 'pink' },
          { title: 'Table 12 — Overall Appt Booked %', arr: stats.overallByPlatform, accent: 'peach' },
        ].map(panel => (
          <Section key={panel.title} title={panel.title} icon={Truck} accent={panel.accent === 'peach' ? 'orange' : panel.accent}>
            <table className="w-full text-[10px]">
              <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-right text-gray-500">Total</th><th className="px-2 py-1 text-right text-gray-500">Booked</th><th className="px-2 py-1 text-right text-gray-500">%</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {panel.arr.map(p => {
                  const pct = p.count > 0 ? p.booked / p.count * 100 : 0;
                  return (
                    <tr key={p.key} onClick={() => openDrill(`${panel.title} — ${p.key}`, p.rows)} className="hover:bg-blue-50/40 cursor-pointer">
                      <td className="px-2 py-1">{p.key}</td><td className="px-2 py-1 text-right">{p.count}</td>
                      <td className="px-2 py-1 text-right">{p.booked}</td>
                      <td className="px-2 py-1 text-right font-bold" style={{ color: pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct.toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        ))}
      </div>

      {/* Table 14: Zone-wise yesterday */}
      <Section title="Table 14 — Zone-wise Delivery (Yesterday Appts)" icon={MapPin} accent="teal">
        <table className="w-full text-[11px]">
          <thead><tr className="bg-gray-50"><th className="px-3 py-1.5 text-left text-gray-500">Zone</th><th className="px-3 py-1.5 text-right text-gray-500">Total</th><th className="px-3 py-1.5 text-right text-gray-500">Delivered</th><th className="px-3 py-1.5 text-right text-gray-500">%</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.zoneArrY.map(z => {
              const pct = z.total > 0 ? z.del / z.total * 100 : 0;
              return (
                <tr key={z.zone} onClick={() => openDrill(`Zone ${z.zone} (Yesterday)`, z.rows)} className="hover:bg-teal-50/40 cursor-pointer">
                  <td className="px-3 py-1.5 font-semibold">{z.zone}</td>
                  <td className="px-3 py-1.5 text-right">{z.total}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-700">{z.del}</td>
                  <td className="px-3 py-1.5 text-right font-bold" style={{ color: pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* Table 17: Transit impact */}
      <Section title="Table 17 — Transit Impact (Delay/Misroute/Stuck POs)" icon={AlertTriangle} accent="orange" sub={`${stats.transitImpact.length} POs flagged`}>
        <div className="max-h-[250px] overflow-y-auto"><table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-1 text-left text-gray-500">PO</th><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-left text-gray-500">Destination</th><th className="px-2 py-1 text-left text-gray-500">Remark</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.transitImpact.slice(0, 50).map(r => (
              <tr key={r._i} className="hover:bg-orange-50/40">
                <td className="px-2 py-1 font-mono">{r.po}</td>
                <td className="px-2 py-1">{r.platform}</td>
                <td className="px-2 py-1">{r.destination}</td>
                <td className="px-2 py-1 truncate max-w-[200px]" title={r.failureRemarks}>{r.failureRemarks}</td>
                <td className="px-2 py-1 text-right font-mono">{currency(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      {/* Table 18/19 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Table 18 — Dispatch Proof Compliance (Excl Today)" icon={FileText} accent="emerald" sub={`${stats.proofArr.length} dates below 100%`}>
          <table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Date</th><th className="px-2 py-1 text-right text-gray-500">Total</th><th className="px-2 py-1 text-right text-gray-500">With Proof</th><th className="px-2 py-1 text-right text-gray-500">%</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {stats.proofArr.map(p => {
                const pct = p.total > 0 ? p.attached / p.total * 100 : 0;
                return (
                  <tr key={p.label} onClick={() => openDrill(`Missing proof — ${p.label}`, p.missing)} className="hover:bg-emerald-50/40 cursor-pointer">
                    <td className="px-2 py-1">{p.label}</td><td className="px-2 py-1 text-right">{p.total}</td><td className="px-2 py-1 text-right text-emerald-700">{p.attached}</td>
                    <td className="px-2 py-1 text-right font-bold" style={{ color: pct >= 90 ? '#059669' : pct >= 70 ? '#d97706' : '#dc2626' }}>{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        <Section title="Table 19 — Missing Proof Ageing" icon={Flame} accent="red" sub={`${stats.missingProofAll.length} POs missing proof`}>
          <div className="max-h-[200px] overflow-y-auto"><table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-1 text-left text-gray-500">Date</th><th className="px-2 py-1 text-left text-gray-500">PO</th><th className="px-2 py-1 text-right text-gray-500">Days</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {[...stats.missingProofAll].sort((a, b) => (b._ageMissing || 0) - (a._ageMissing || 0)).slice(0, 50).map(r => (
                <tr key={r._i} className="hover:bg-red-50/40"><td className="px-2 py-1">{r._missingDate}</td><td className="px-2 py-1 font-mono">{r.po}</td><td className="px-2 py-1 text-right font-bold" style={{ color: (r._ageMissing || 0) > 7 ? '#dc2626' : '#d97706' }}>{r._ageMissing || '-'}</td></tr>
              ))}
            </tbody>
          </table></div>
        </Section>
      </div>

      {/* Table 20/21 */}
      <Section title="Table 20 — Destination Performance (Past Appts)" icon={MapPin} accent="emerald" sub={`${stats.destArr.length} destinations`}>
        <div className="max-h-[300px] overflow-y-auto"><table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-1 text-left text-gray-500">Destination</th><th className="px-2 py-1 text-right text-gray-500">Total</th><th className="px-2 py-1 text-right text-gray-500">Value</th><th className="px-2 py-1 text-right text-gray-500">Del</th><th className="px-2 py-1 text-right text-gray-500">Del Val</th><th className="px-2 py-1 text-right text-gray-500">%</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.destArr.map(d => {
              const pct = d.total > 0 ? d.del / d.total * 100 : 0;
              return (
                <tr key={d.destination} onClick={() => openDrill(`${d.destination} — Past appts`, d.rows)} className="hover:bg-emerald-50/40 cursor-pointer">
                  <td className="px-2 py-1 font-semibold">{d.destination}</td>
                  <td className="px-2 py-1 text-right">{d.total}</td>
                  <td className="px-2 py-1 text-right font-mono">{currency(d.value)}</td>
                  <td className="px-2 py-1 text-right text-emerald-700">{d.del}</td>
                  <td className="px-2 py-1 text-right font-mono text-emerald-700">{currency(d.delVal)}</td>
                  <td className="px-2 py-1 text-right font-bold" style={{ color: pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626' }}>{pct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Section>

      {/* Table 22/23/24 */}
      <Section title="Table 22 — Low MOV Analytics (<₹50K)" icon={IndianRupee} accent="yellow" sub={`${stats.lowMovArr.length} platform-destination combos`}>
        <div className="max-h-[300px] overflow-y-auto"><table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-left text-gray-500">Destination</th><th className="px-2 py-1 text-right text-gray-500">&lt;10K</th><th className="px-2 py-1 text-right text-gray-500">10-25K</th><th className="px-2 py-1 text-right text-gray-500">25-50K</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th><th className="px-2 py-1 text-right text-gray-500">Min MOV</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.lowMovArr.slice(0, 30).map((p, i) => (
              <tr key={i} onClick={() => openDrill(`Low MOV: ${p.platform} → ${p.destination}`, p.rows)} className="hover:bg-yellow-50/40 cursor-pointer">
                <td className="px-2 py-1">{p.platform}</td><td className="px-2 py-1">{p.destination}</td>
                <td className="px-2 py-1 text-right">{p.b1 || '—'}</td><td className="px-2 py-1 text-right">{p.b2 || '—'}</td><td className="px-2 py-1 text-right">{p.b3 || '—'}</td>
                <td className="px-2 py-1 text-right font-bold">{p.count}</td><td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
                <td className="px-2 py-1 text-right font-mono text-red-600">{currency(p.minValue)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section title="Table 23 — Low MOQ Analytics (<10 Boxes)" icon={Package} accent="purple" sub={`${stats.lowMoqArr.length} combos`}>
        <div className="max-h-[300px] overflow-y-auto"><table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-left text-gray-500">Destination</th><th className="px-2 py-1 text-right text-gray-500">0-3 Box</th><th className="px-2 py-1 text-right text-gray-500">4-6 Box</th><th className="px-2 py-1 text-right text-gray-500">7-9 Box</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th><th className="px-2 py-1 text-right text-gray-500">Min Box</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.lowMoqArr.slice(0, 30).map((p, i) => (
              <tr key={i} onClick={() => openDrill(`Low MOQ: ${p.platform} → ${p.destination}`, p.rows)} className="hover:bg-purple-50/40 cursor-pointer">
                <td className="px-2 py-1">{p.platform}</td><td className="px-2 py-1">{p.destination}</td>
                <td className="px-2 py-1 text-right">{p.b1 || '—'}</td><td className="px-2 py-1 text-right">{p.b2 || '—'}</td><td className="px-2 py-1 text-right">{p.b3 || '—'}</td>
                <td className="px-2 py-1 text-right font-bold">{p.count}</td><td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
                <td className="px-2 py-1 text-right font-mono text-red-600">{p.minBoxes}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section title="Table 24 — Partial Delivered by Platform-Destination" icon={AlertTriangle} accent="pink" sub={`${stats.partialDelArr.length} combos`}>
        <table className="w-full text-[10px]">
          <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Platform</th><th className="px-2 py-1 text-left text-gray-500">Destination</th><th className="px-2 py-1 text-right text-gray-500">Count</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.partialDelArr.map((p, i) => (
              <tr key={i} onClick={() => openDrill(`Partial: ${p.platform} → ${p.destination}`, p.rows)} className="hover:bg-pink-50/40 cursor-pointer">
                <td className="px-2 py-1">{p.platform}</td><td className="px-2 py-1">{p.destination}</td>
                <td className="px-2 py-1 text-right font-bold text-pink-700">{p.count}</td>
                <td className="px-2 py-1 text-right font-mono">{currency(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

/* ─── INSIGHTS TAB ─────────────────────────────────────────────────── */
function InsightsTab({ stats, data, openDrill, setF }) {
  /* Auto-detected callouts */
  const insights = useMemo(() => {
    const out = [];
    if (stats.above15.length > 0) {
      const v = stats.above15.reduce((s, r) => s + r.value, 0);
      out.push({ kind: 'critical', icon: Flame, title: `${stats.above15.length} POs aged >15 days`, body: <>Total exposure: <strong>{currency(v)}</strong>. Escalate immediately to avoid post-expiry losses.</>, cta: 'View list', onCta: () => openDrill('>15 days', stats.above15) });
    }
    if (stats.expiry.after.length > 0) {
      const v = stats.expiry.after.reduce((s, r) => s + r.value, 0);
      out.push({ kind: 'critical', icon: AlertTriangle, title: `${stats.expiry.after.length} POs will reach AFTER expiry`, body: <>At-risk value: <strong>{currency(v)}</strong>. These will get rejected if not expedited.</>, cta: 'View', onCta: () => openDrill('After expiry', stats.expiry.after) });
    }
    if (stats.pendingAppt.length > stats.open.length * 0.3) {
      out.push({ kind: 'warn', icon: Clock, title: `${(stats.pendingAppt.length / stats.open.length * 100).toFixed(0)}% of open POs have no appointment`, body: <>Push the courier ops team to book — exposure: <strong>{currency(stats.pendingApptValue)}</strong></>, cta: 'Filter to pending', onCta: () => setF('apptStatus', 'pending') });
    }
    const topPendingPlat = stats.pendingApptAgeingArr[0];
    if (topPendingPlat) {
      out.push({ kind: 'warn', icon: Building2, title: `${topPendingPlat.platform} has most pending appointments`, body: <><strong>{topPendingPlat.total}</strong> POs ({currency(topPendingPlat.value)}) without appointment.</>, cta: 'Filter to this platform', onCta: () => setF('platform', topPendingPlat.platform) });
    }
    if (stats.transitImpact.length > 0) {
      const v = stats.transitImpact.reduce((s, r) => s + r.value, 0);
      out.push({ kind: 'warn', icon: Truck, title: `${stats.transitImpact.length} POs stuck in transit`, body: <>Delays/misroutes detected: <strong>{currency(v)}</strong> blocked.</>, cta: 'View', onCta: () => openDrill('Transit impact', stats.transitImpact) });
    }
    if (stats.firstAttemptYesterday.total > 0) {
      const rate = stats.firstAttemptYesterday.success / stats.firstAttemptYesterday.total * 100;
      if (rate < 70) out.push({ kind: 'critical', icon: Target, title: `First-attempt success only ${rate.toFixed(0)}%`, body: <>Of <strong>{stats.firstAttemptYesterday.total}</strong> yesterday's appointments, only <strong>{stats.firstAttemptYesterday.success}</strong> delivered first-go.</>, cta: 'View failures', onCta: () => openDrill('Yesterday failures', stats.firstAttemptYesterday.rows.filter(r => !r.isDelivered)) });
      else out.push({ kind: 'good', icon: CheckCircle, title: `First-attempt success ${rate.toFixed(0)}%`, body: <>Strong performance — keep the discipline.</>, cta: null });
    }
    return out.slice(0, 8);
  }, [stats, data]);

  /* Top problem platforms / vendors */
  const topPlatforms = [...stats.overallByPlatform].slice(0, 5);
  const vendorAgg = useMemo(() => {
    const m = {};
    data.forEach(r => {
      if (!m[r.vendor]) m[r.vendor] = { vendor: r.vendor, count: 0, value: 0, open: 0, pendingAppt: 0, rows: [] };
      m[r.vendor].count++; m[r.vendor].value += r.value; m[r.vendor].rows.push(r);
      if (!r.isDelivered) m[r.vendor].open++;
      if (r.apptPending) m[r.vendor].pendingAppt++;
    });
    return Object.values(m).sort((a, b) => b.open - a.open).slice(0, 10);
  }, [data]);

  const toneCfg = {
    critical: { bg: 'bg-red-50 border-red-200', icon: 'text-red-600', title: 'text-red-700' },
    warn: { bg: 'bg-amber-50 border-amber-200', icon: 'text-amber-600', title: 'text-amber-700' },
    good: { bg: 'bg-emerald-50 border-emerald-200', icon: 'text-emerald-600', title: 'text-emerald-700' },
  };

  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4">
        <h3 className="text-[12px] font-bold text-indigo-800 flex items-center gap-2 mb-3"><Brain className="w-4 h-4" /> Smart Insights — Top concerns for the morning call</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {insights.map((ins, i) => { const c = toneCfg[ins.kind]; const Icon = ins.icon; return (
            <div key={i} className={`${c.bg} border rounded-lg p-2.5`}>
              <div className="flex items-start gap-2">
                <Icon className={`w-4 h-4 ${c.icon} flex-shrink-0 mt-0.5`} />
                <div className="flex-1">
                  <p className={`text-[10px] font-bold ${c.title} uppercase tracking-wider`}>{ins.title}</p>
                  <p className="text-[11px] text-gray-700 mt-0.5 leading-snug">{ins.body}</p>
                  {ins.cta && <button onClick={ins.onCta} className={`text-[10px] mt-1 ${c.title} hover:underline font-semibold`}>{ins.cta} →</button>}
                </div>
              </div>
            </div>
          ); })}
        </div>
      </div>

      <Section title="Top Vendors by Open Workload" icon={Truck} accent="orange">
        <table className="w-full text-[10px]">
          <thead><tr className="bg-gray-50"><th className="px-2 py-1 text-left text-gray-500">Vendor</th><th className="px-2 py-1 text-right text-gray-500">Total</th><th className="px-2 py-1 text-right text-gray-500">Open</th><th className="px-2 py-1 text-right text-gray-500">Pending Appt</th><th className="px-2 py-1 text-right text-gray-500">Value</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {vendorAgg.map(v => (
              <tr key={v.vendor} onClick={() => setF('vendor', v.vendor)} className="hover:bg-orange-50/40 cursor-pointer">
                <td className="px-2 py-1 font-semibold">{v.vendor}</td>
                <td className="px-2 py-1 text-right">{v.count}</td>
                <td className="px-2 py-1 text-right font-bold text-orange-700">{v.open}</td>
                <td className="px-2 py-1 text-right text-amber-700">{v.pendingAppt}</td>
                <td className="px-2 py-1 text-right font-mono">{currency(v.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

/* ─── PIVOT BUILDER ───────────────────────────────────────────────── */
function PivotBuilder({ data, openDrill }) {
  const DIMS = [
    { k: 'platform', l: 'Platform' }, { k: 'vendor', l: 'Vendor' }, { k: 'wh', l: 'Warehouse' },
    { k: 'destination', l: 'Destination' }, { k: 'zone', l: 'Zone' }, { k: 'status', l: 'Status' },
    { k: 'ageBucket', l: 'Age Bucket' }, { k: 'origin', l: 'Origin' },
  ];
  const METRICS = [
    { k: 'count', l: 'POs' }, { k: 'value', l: 'Value ₹' }, { k: 'boxes', l: 'Boxes' }, { k: 'open', l: 'Open POs' }, { k: 'pendingAppt', l: 'Pending Appt' },
  ];

  const [rowDim, setRowDim] = useState('platform');
  const [colDim, setColDim] = useState('ageBucket');
  const [metric, setMetric] = useState('count');

  const pivot = useMemo(() => {
    const rows = new Set(), cols = new Set();
    const cells = {};
    data.forEach(r => {
      const rk = String(r[rowDim] || 'Unknown');
      const ck = String(r[colDim] || 'Unknown');
      rows.add(rk); cols.add(ck);
      const key = `${rk}||${ck}`;
      if (!cells[key]) cells[key] = { count: 0, value: 0, boxes: 0, open: 0, pendingAppt: 0, rows: [] };
      cells[key].count++; cells[key].value += r.value; cells[key].boxes += r.boxes; cells[key].rows.push(r);
      if (!r.isDelivered) cells[key].open++;
      if (r.apptPending) cells[key].pendingAppt++;
    });
    const rowTotals = {}, colTotals = {};
    Object.entries(cells).forEach(([k, v]) => { const [rk, ck] = k.split('||'); rowTotals[rk] = (rowTotals[rk] || 0) + (v[metric] || 0); colTotals[ck] = (colTotals[ck] || 0) + (v[metric] || 0); });
    const rowsArr = Array.from(rows).sort((a, b) => (rowTotals[b] || 0) - (rowTotals[a] || 0)).slice(0, 15);
    const colsArr = Array.from(cols).sort((a, b) => (colTotals[b] || 0) - (colTotals[a] || 0)).slice(0, 10);
    const max = Math.max(...Object.values(cells).map(c => c[metric] || 0), 1);
    return { rows: rowsArr, cols: colsArr, cells, max, rowTotals, colTotals };
  }, [data, rowDim, colDim, metric]);

  const fmtCell = (v) => { if (v == null) return '—'; if (metric === 'value') return currency(v); return Math.round(v).toLocaleString('en-IN'); };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <h3 className="text-[12px] font-bold text-gray-800 mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-indigo-500" /> Pivot Builder — Pick Rows × Cols × Metric</h3>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div><label className="block text-[10px] text-gray-600 mb-1 font-medium">Rows</label><select value={rowDim} onChange={e => setRowDim(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-indigo-200 rounded bg-indigo-50/30 text-indigo-700 font-semibold">{DIMS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select></div>
        <div><label className="block text-[10px] text-gray-600 mb-1 font-medium">Columns</label><select value={colDim} onChange={e => setColDim(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-purple-200 rounded bg-purple-50/30 text-purple-700 font-semibold">{DIMS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select></div>
        <div><label className="block text-[10px] text-gray-600 mb-1 font-medium">Metric</label><select value={metric} onChange={e => setMetric(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-orange-200 rounded bg-orange-50/30 text-orange-700 font-semibold">{METRICS.map(m => <option key={m.k} value={m.k}>{m.l}</option>)}</select></div>
      </div>
      <div className="overflow-x-auto"><table className="text-[9px] w-full">
        <thead><tr>
          <th className="px-2 py-1.5 text-left bg-gray-50 sticky left-0 z-10 font-semibold">{DIMS.find(d => d.k === rowDim)?.l} ↓ / {DIMS.find(d => d.k === colDim)?.l} →</th>
          {pivot.cols.map(c => <th key={c} className="px-2 py-1.5 text-right font-semibold text-gray-600 min-w-[70px]" title={c}>{c.length > 14 ? c.slice(0, 14) + '…' : c}</th>)}
          <th className="px-2 py-1.5 text-right font-bold text-indigo-700 bg-indigo-50">Total</th>
        </tr></thead>
        <tbody>
          {pivot.rows.map(r => (
            <tr key={r} className="border-b border-gray-50">
              <th className="px-2 py-1.5 text-left font-semibold text-gray-700 sticky left-0 bg-white z-10" title={r}>{r.length > 22 ? r.slice(0, 22) + '…' : r}</th>
              {pivot.cols.map(c => {
                const cell = pivot.cells[`${r}||${c}`];
                const v = cell ? cell[metric] : null;
                const intensity = pivot.max > 0 && v != null ? v / pivot.max : 0;
                const bg = v != null ? `rgba(245, 158, 11, ${Math.min(0.05 + intensity * 0.7, 0.85)})` : 'transparent';
                const txt2 = intensity > 0.5 ? '#fff' : '#374151';
                return <td key={c} className={`px-2 py-1.5 text-right font-mono ${cell ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400' : ''}`} style={{ background: bg, color: txt2 }}
                  onClick={() => cell && openDrill(`${r} × ${c}`, cell.rows)}>{fmtCell(v)}</td>;
              })}
              <td className="px-2 py-1.5 text-right bg-indigo-50 font-bold text-indigo-700">{fmtCell(pivot.rowTotals[r])}</td>
            </tr>
          ))}
          <tr className="bg-indigo-100/50 border-t-2 border-indigo-200">
            <th className="px-2 py-1.5 text-left font-bold text-indigo-800 sticky left-0 bg-indigo-100 z-10">Total</th>
            {pivot.cols.map(c => <td key={c} className="px-2 py-1.5 text-right font-bold text-indigo-700">{fmtCell(pivot.colTotals[c])}</td>)}
            <td className="px-2 py-1.5 text-right font-bold text-indigo-800 bg-indigo-200">{fmtCell(Object.values(pivot.rowTotals).reduce((s, v) => s + v, 0))}</td>
          </tr>
        </tbody>
      </table></div>
    </div>
  );
}
