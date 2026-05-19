import React, { useEffect, useMemo, useState } from 'react';
import KPICard from '../components/KPICard';
import { BarChart, LineChart, DoughnutChart } from '../components/Charts';
import DataTable from '../components/DataTable';
import {
  ClipboardList, IndianRupee, AlertTriangle, TrendingUp, RefreshCw, Filter,
  Download, X, ChevronRight, Search, Truck, Building2, Package, CheckCircle,
  Clock, FileText, ArrowDown, ArrowUp, Activity, MapPin, BarChart3, Workflow,
  Database, Trophy, Target, Zap, Lightbulb, Brain, Flame, Calculator, Layers,
} from 'lucide-react';
import { currency, percent, formatDate } from '../utils/index';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw9b8mBaVqC4Ps-j1e1jxeqikvsNeZyYwgJemkoblqWex5aq3Gv-sUniIjeZseTa2nQ/exec';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const safeDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const today = new Date();
const daysSince = (d) => { const x = safeDate(d); return x ? Math.floor((today - x) / 86400000) : null; };

/* Aging buckets for claim age (days since claim raised) */
const ageBucket = (days) => {
  if (days == null) return 'N/A';
  if (days <= 7) return '0-7d';
  if (days <= 15) return '8-15d';
  if (days <= 30) return '16-30d';
  if (days <= 60) return '31-60d';
  return '60+d';
};
const AGE_ORDER = ['0-7d','8-15d','16-30d','31-60d','60+d','N/A'];
const AGE_COLOR = { '0-7d': '#10b981', '8-15d': '#84cc16', '16-30d': '#f59e0b', '31-60d': '#f97316', '60+d': '#dc2626', 'N/A': '#9ca3af' };

/* Claim status categorisation: open vs closed-recovered vs closed-lost */
const isOpen = (s) => { if (!s) return true; const v = String(s).toLowerCase(); return v.includes('pending') || v.includes('open') || v.includes('process'); };
const isRecovered = (status, finalStatus) => {
  const s = String(finalStatus || '').toLowerCase();
  if (s.includes('recover') || s.includes('credit') || s.includes('settled') || s.includes('cn issued') || s.includes('paid')) return true;
  const t = String(status || '').toLowerCase();
  return t.includes('recover') || t.includes('credit') || t.includes('settled') || t.includes('paid');
};
const isLost = (finalStatus) => { const s = String(finalStatus || '').toLowerCase(); return s.includes('reject') || s.includes('lost') || s.includes('denied') || s.includes('writeoff'); };

export default function GRN() {
  /* ─── Data fetching ──────────────────────────────────────────────────── */
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(GAS_URL, { method: 'GET', redirect: 'follow' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        if (cancelled) return;
        const rows = Array.isArray(json) ? json : (json.data || []);
        setRaw(rows.map((r, i) => ({ _i: i, ...r })));
        setLastSync(new Date());
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to fetch'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  /* ─── Filter state ───────────────────────────────────────────────────── */
  const [filters, setFilters] = useState({
    platform: 'all', courier: 'all', wh: 'all', status: 'all', holder: 'all', cnType: 'all',
    reason: 'all', remarks: 'all', dateFrom: '', dateTo: '', search: '', minValue: '',
  });
  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const resetFilters = () => setFilters({ platform: 'all', courier: 'all', wh: 'all', status: 'all', holder: 'all', cnType: 'all', reason: 'all', remarks: 'all', dateFrom: '', dateTo: '', search: '', minValue: '' });

  /* Unique values for filter dropdowns */
  const uniq = (key) => useMemo(() => Array.from(new Set(raw.map(r => (r[key] || '').toString().trim()).filter(Boolean))).sort(), [raw]);
  const platforms = uniq('Order Type');
  const couriers = uniq('Carrier/Shipping Partner');
  const whs = uniq('WH');
  const statuses = uniq('Claim Status');
  const holders = uniq('Claim Holder');
  const cnTypes = uniq('CN/COF(Couier)');
  const reasons = uniq('Claim Reason');
  const remarks = uniq('GRN Remarks');

  /* Apply filters */
  const data = useMemo(() => {
    return raw.filter(r => {
      if (filters.platform !== 'all' && (r['Order Type'] || '') !== filters.platform) return false;
      if (filters.courier !== 'all' && (r['Carrier/Shipping Partner'] || '') !== filters.courier) return false;
      if (filters.wh !== 'all' && (r['WH'] || '') !== filters.wh) return false;
      if (filters.status !== 'all' && (r['Claim Status'] || '') !== filters.status) return false;
      if (filters.holder !== 'all' && (r['Claim Holder'] || '') !== filters.holder) return false;
      if (filters.cnType !== 'all' && (r['CN/COF(Couier)'] || '') !== filters.cnType) return false;
      if (filters.reason !== 'all' && (r['Claim Reason'] || '') !== filters.reason) return false;
      if (filters.remarks !== 'all' && (r['GRN Remarks'] || '') !== filters.remarks) return false;
      if (filters.dateFrom) { const d = safeDate(r['Delivery Date']); if (!d || d < new Date(filters.dateFrom)) return false; }
      if (filters.dateTo)   { const d = safeDate(r['Delivery Date']); if (!d || d > new Date(filters.dateTo)) return false; }
      if (filters.minValue) { if (num(r['Deficit Value']) < parseFloat(filters.minValue)) return false; }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const haystack = [r['PO Number'], r['Invoice Number'], r['AWB Number'], r['SKU Code'], r['Claim Reason'], r['GRN Remarks'], r['Carrier/Shipping Partner']].map(v => String(v || '').toLowerCase()).join(' ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [raw, filters]);

  /* ─── Aggregates ─────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const totalDeficitVal = data.reduce((s, r) => s + num(r['Deficit Value']), 0);
    const totalDeficitUnits = data.reduce((s, r) => s + num(r['Deficit Unit']), 0);
    const totalItemVal = data.reduce((s, r) => s + num(r['Total Item Value']), 0);
    const totalDispatched = data.reduce((s, r) => s + num(r['Fulfilled/Dispatched Qty (in Units)']), 0);
    const totalGRN = data.reduce((s, r) => s + num(r['GRN Qty (in Units)']), 0);

    const openClaims = data.filter(r => isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status'])).length;
    const recoveredClaims = data.filter(r => isRecovered(r['Claim Status'], r['Claim Final Status']));
    const lostClaims = data.filter(r => isLost(r['Claim Final Status']));
    const recoveredVal = recoveredClaims.reduce((s, r) => s + num(r['Deficit Value']), 0);
    const lostVal = lostClaims.reduce((s, r) => s + num(r['Deficit Value']), 0);
    const recoveryRate = totalDeficitVal > 0 ? (recoveredVal / totalDeficitVal * 100) : 0;
    const deficitRate = totalDispatched > 0 ? (totalDeficitUnits / totalDispatched * 100) : 0;

    /* Group helper */
    const groupSum = (key) => {
      const m = {};
      data.forEach(r => {
        const k = (r[key] || 'Unknown').toString();
        if (!m[k]) m[k] = { count: 0, deficitVal: 0, deficitUnits: 0, recovered: 0, open: 0 };
        m[k].count++;
        m[k].deficitVal += num(r['Deficit Value']);
        m[k].deficitUnits += num(r['Deficit Unit']);
        if (isRecovered(r['Claim Status'], r['Claim Final Status'])) m[k].recovered += num(r['Deficit Value']);
        if (isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status'])) m[k].open++;
      });
      return Object.entries(m).map(([name, v]) => ({ name, ...v, recoveryPct: v.deficitVal > 0 ? (v.recovered / v.deficitVal * 100) : 0 })).sort((a, b) => b.deficitVal - a.deficitVal);
    };

    const byPlatform = groupSum('Order Type');
    const byCourier  = groupSum('Carrier/Shipping Partner');
    const byWH       = groupSum('WH');
    const byHolder   = groupSum('Claim Holder');
    const byReason   = groupSum('Claim Reason');
    const byRemarks  = groupSum('GRN Remarks');
    const bySKU      = groupSum('SKU Code').slice(0, 15);

    /* Status pie */
    const statusBreakdown = {};
    data.forEach(r => {
      const s = (r['Claim Status'] || 'Unknown').toString();
      if (!statusBreakdown[s]) statusBreakdown[s] = { count: 0, val: 0 };
      statusBreakdown[s].count++;
      statusBreakdown[s].val += num(r['Deficit Value']);
    });
    const statusArr = Object.entries(statusBreakdown).map(([s, v]) => ({ status: s, ...v })).sort((a, b) => b.val - a.val);

    /* Claim age bucket */
    const ageBkts = { '0-7d':{c:0,v:0}, '8-15d':{c:0,v:0}, '16-30d':{c:0,v:0}, '31-60d':{c:0,v:0}, '60+d':{c:0,v:0}, 'N/A':{c:0,v:0} };
    data.forEach(r => {
      if (isRecovered(r['Claim Status'], r['Claim Final Status'])) return; /* only count open claims for aging */
      const days = daysSince(r['Claim Date']);
      const b = ageBucket(days);
      ageBkts[b].c++;
      ageBkts[b].v += num(r['Deficit Value']);
    });

    /* Monthly trend */
    const byMonth = {};
    data.forEach(r => {
      const d = safeDate(r['Delivery Date']);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { count: 0, val: 0, recoveredVal: 0 };
      byMonth[key].count++;
      byMonth[key].val += num(r['Deficit Value']);
      if (isRecovered(r['Claim Status'], r['Claim Final Status'])) byMonth[key].recoveredVal += num(r['Deficit Value']);
    });
    const monthArr = Object.entries(byMonth).map(([m, v]) => ({ month: m, ...v, recoveryPct: v.val > 0 ? (v.recoveredVal / v.val * 100) : 0 })).sort((a, b) => a.month.localeCompare(b.month));

    return { totalDeficitVal, totalDeficitUnits, totalItemVal, totalDispatched, totalGRN, openClaims, recoveredClaims: recoveredClaims.length, lostClaims: lostClaims.length, recoveredVal, lostVal, recoveryRate, deficitRate, byPlatform, byCourier, byWH, byHolder, byReason, byRemarks, bySKU, statusArr, ageBkts, monthArr };
  }, [data]);

  /* ─── Tab state ──────────────────────────────────────────────────────── */
  const [tab, setTab] = useState('overview'); // overview | top | sources | claims | raw

  /* ─── Drilldown ──────────────────────────────────────────────────────── */
  const [drill, setDrill] = useState(null); // { title, rows }
  const openDrill = (title, predicate) => {
    const rows = data.filter(predicate);
    setDrill({ title, rows });
  };

  /* Export filtered as CSV */
  const exportCSV = () => {
    if (data.length === 0) return;
    const keys = Object.keys(data[0]).filter(k => !k.startsWith('_'));
    const rows = [keys, ...data.map(r => keys.map(k => r[k] ?? ''))];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `grn-deficit-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const drillCols = [
    { key: 'WH', label: 'WH' },
    { key: 'Order Type', label: 'Platform' },
    { key: 'PO Number', label: 'PO' },
    { key: 'Invoice Number', label: 'Invoice' },
    { key: 'AWB Number', label: 'AWB' },
    { key: 'SKU Code', label: 'SKU' },
    { key: 'Fulfilled/Dispatched Qty (in Units)', label: 'Disp Qty', render: v => num(v) },
    { key: 'GRN Qty (in Units)', label: 'GRN Qty', render: v => num(v) },
    { key: 'Deficit Unit', label: 'Deficit U', render: v => num(v) },
    { key: 'Deficit Value', label: 'Deficit ₹', render: v => currency(num(v)) },
    { key: 'GRN Remarks', label: 'Remarks' },
    { key: 'Claim Status', label: 'Status' },
    { key: 'Claim Holder', label: 'Holder' },
    { key: 'Carrier/Shipping Partner', label: 'Courier' },
    { key: 'Claim Date', label: 'Claim Date', render: v => formatDate(v) },
    { key: 'Delivery Date', label: 'Delivery', render: v => formatDate(v) },
    { key: '_age', label: 'Age (d)', render: (_, r) => daysSince(r['Claim Date']) ?? '-' },
  ];

  const activeFilterCount = Object.values(filters).filter(v => v && v !== 'all').length;

  /* ─── UI ─────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-600 to-orange-600 rounded-xl p-5 text-white">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><ClipboardList className="w-5 h-5" /> GRN Deficit Controller</h2>
            <p className="text-rose-100 text-[11px] mt-0.5">Live deficit + claim management — sourced from Google Sheets</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {lastSync && <span className="text-[10px] bg-white/10 px-2 py-1 rounded">Synced {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={() => setRefreshKey(k => k + 1)} className="flex items-center gap-1 text-[11px] px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg font-semibold backdrop-blur"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            <button onClick={exportCSV} disabled={data.length === 0} className="flex items-center gap-1 text-[11px] px-3 py-1.5 bg-white text-rose-700 hover:bg-rose-50 rounded-lg font-semibold disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          </div>
        </div>
      </div>

      {/* Loading / Error states */}
      {loading && raw.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" />
          <p className="text-[12px] text-blue-700 font-semibold">Loading GRN data from Google Sheets…</p>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[11px] text-red-700">
          <strong>Fetch error:</strong> {error}. <button onClick={() => setRefreshKey(k => k + 1)} className="underline ml-1">Retry</button>
        </div>
      )}

      {!loading && raw.length === 0 && !error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[11px] text-amber-700">No data returned by the GAS endpoint. Check that the Apps Script is deployed as a web app with public access.</div>
      )}

      {raw.length > 0 && (<>

      {/* ─── KPI Strip ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <button onClick={() => openDrill('All deficit records', () => true)} className="text-left"><KPICard title="Deficit Value" value={currency(stats.totalDeficitVal)} icon={IndianRupee} color="red" subtitle={`${data.length} records`} /></button>
        <button onClick={() => openDrill('All deficit records', () => true)} className="text-left"><KPICard title="Deficit Units" value={Math.round(stats.totalDeficitUnits).toLocaleString('en-IN')} icon={Package} color="orange" subtitle={`${stats.deficitRate.toFixed(2)}% of dispatch`} /></button>
        <button onClick={() => openDrill('Open claims', r => isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status']))} className="text-left"><KPICard title="Open Claims" value={stats.openClaims} icon={Clock} color="yellow" subtitle="Pending action" /></button>
        <button onClick={() => openDrill('Recovered claims', r => isRecovered(r['Claim Status'], r['Claim Final Status']))} className="text-left"><KPICard title="Recovered ₹" value={currency(stats.recoveredVal)} icon={CheckCircle} color="green" subtitle={`${stats.recoveredClaims} claims`} /></button>
        <button onClick={() => openDrill('Lost / rejected claims', r => isLost(r['Claim Final Status']))} className="text-left"><KPICard title="Lost ₹" value={currency(stats.lostVal)} icon={AlertTriangle} color="red" subtitle={`${stats.lostClaims} claims`} /></button>
        <KPICard title="Recovery Rate" value={`${stats.recoveryRate.toFixed(1)}%`} icon={TrendingUp} color={stats.recoveryRate >= 70 ? 'green' : stats.recoveryRate >= 40 ? 'yellow' : 'red'} subtitle={`of ${currency(stats.totalDeficitVal)}`} />
      </div>

      {/* ─── Filter Panel ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-600" />
            <h3 className="text-[12px] font-bold text-gray-800">Advanced Filters</h3>
            {activeFilterCount > 0 && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">{activeFilterCount} active</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">{data.length} of {raw.length} records</span>
            {activeFilterCount > 0 && <button onClick={resetFilters} className="text-[10px] text-red-600 hover:text-red-700 font-semibold flex items-center gap-1"><X className="w-3 h-3" /> Clear all</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
          <FilterSelect label="Platform" value={filters.platform} onChange={v => setF('platform', v)} options={platforms} />
          <FilterSelect label="Courier" value={filters.courier} onChange={v => setF('courier', v)} options={couriers} />
          <FilterSelect label="WH" value={filters.wh} onChange={v => setF('wh', v)} options={whs} />
          <FilterSelect label="Claim Status" value={filters.status} onChange={v => setF('status', v)} options={statuses} />
          <FilterSelect label="Holder" value={filters.holder} onChange={v => setF('holder', v)} options={holders} />
          <FilterSelect label="CN/COF" value={filters.cnType} onChange={v => setF('cnType', v)} options={cnTypes} />
          <FilterSelect label="Reason" value={filters.reason} onChange={v => setF('reason', v)} options={reasons} />
          <FilterSelect label="GRN Remarks" value={filters.remarks} onChange={v => setF('remarks', v)} options={remarks} />
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Date from</label>
            <input type="date" value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded focus:border-indigo-400 outline-none" />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Date to</label>
            <input type="date" value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded focus:border-indigo-400 outline-none" />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5 font-medium">Min Deficit ₹</label>
            <input type="number" placeholder="0" value={filters.minValue} onChange={e => setF('minValue', e.target.value)} className="w-full px-2 py-1 border border-gray-200 rounded focus:border-indigo-400 outline-none" />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="block text-gray-500 mb-0.5 font-medium">Search (PO / Invoice / AWB / SKU / Reason)</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" value={filters.search} onChange={e => setF('search', e.target.value)} placeholder="Type to search across PO, Invoice, AWB, SKU…" className="w-full pl-7 pr-2 py-1 border border-gray-200 rounded focus:border-indigo-400 outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tab Navigation ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1.5 flex items-center gap-1 overflow-x-auto">
        {[
          { k: 'overview', l: 'Overview', icon: BarChart3 },
          { k: 'insights', l: 'Insights & Predictions', icon: Brain },
          { k: 'top', l: 'Top Performers', icon: Trophy },
          { k: 'sources', l: 'Deficit Sources', icon: Target },
          { k: 'claims', l: 'Claims Workflow', icon: Workflow },
          { k: 'raw', l: `Raw Data (${data.length})`, icon: Database },
        ].map(t => { const Icon = t.icon; return (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${tab === t.k ? 'bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Icon className="w-3.5 h-3.5" /> {t.l}
          </button>
        ); })}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
      {tab === 'overview' && (<>
      {/* Smart Insights strip — auto-detected callouts */}
      <SmartInsights stats={stats} data={data} setF={setF} />
      {/* ─── Charts row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart title="Deficit Value by Platform" labels={stats.byPlatform.slice(0, 10).map(p => p.name)}
            datasets={[{ label: 'Deficit ₹', data: stats.byPlatform.slice(0, 10).map(p => Math.round(p.deficitVal)), color: '#ef4444' }]} height={220} />
        </div>
        <div className="chart-container">
          <BarChart title="Deficit Value by Courier" labels={stats.byCourier.slice(0, 10).map(p => p.name.slice(0, 18))}
            datasets={[{ label: 'Deficit ₹', data: stats.byCourier.slice(0, 10).map(p => Math.round(p.deficitVal)), color: '#f97316' }]} height={220} />
        </div>
        <div className="chart-container">
          <DoughnutChart title="Claim Status Distribution" labels={stats.statusArr.slice(0, 6).map(s => s.status)} data={stats.statusArr.slice(0, 6).map(s => Math.round(s.val))} height={220} />
        </div>
        <div className="chart-container">
          <BarChart title="Top 10 Claim Reasons" labels={stats.byReason.slice(0, 10).map(p => p.name.slice(0, 22))}
            datasets={[{ label: 'Records', data: stats.byReason.slice(0, 10).map(p => p.count), color: '#6366f1' }]} height={220} />
        </div>
      </div>

      {/* ─── Monthly trend + Aging ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <LineChart title="Monthly Deficit ₹ vs Recovered ₹" labels={stats.monthArr.map(m => m.month)} datasets={[
            { label: 'Deficit', data: stats.monthArr.map(m => Math.round(m.val)), color: '#ef4444', fill: true },
            { label: 'Recovered', data: stats.monthArr.map(m => Math.round(m.recoveredVal)), color: '#10b981', fill: true },
          ]} height={220} />
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-[12px] font-bold text-gray-700 mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Open Claim Aging</h3>
          <div className="space-y-2">
            {AGE_ORDER.map(b => {
              const bk = stats.ageBkts[b];
              if (!bk || bk.c === 0) return null;
              const max = Math.max(...AGE_ORDER.map(a => stats.ageBkts[a]?.v || 0), 1);
              const w = bk.v / max * 100;
              return (
                <button key={b} onClick={() => openDrill(`Open claims aged ${b}`, r => {
                  if (isRecovered(r['Claim Status'], r['Claim Final Status'])) return false;
                  const d = daysSince(r['Claim Date']); return ageBucket(d) === b;
                })} className="w-full flex items-center gap-2 text-[11px] hover:bg-gray-50 rounded p-1 -mx-1 transition-colors">
                  <span className="w-12 text-gray-700 font-semibold">{b}</span>
                  <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
                    <div className="h-full rounded transition-all flex items-center pr-1 justify-end" style={{ width: `${w}%`, background: AGE_COLOR[b] }}>
                      <span className="text-[9px] font-bold text-white">{bk.c}</span>
                    </div>
                  </div>
                  <span className="w-24 text-right text-gray-600 font-mono">{currency(bk.v)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── BI breakdown tables ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BreakdownPanel title="Platform Performance" icon={Building2} items={stats.byPlatform.slice(0, 10)} onPick={(name) => setF('platform', name)} />
        <BreakdownPanel title="Courier Performance" icon={Truck} items={stats.byCourier.slice(0, 10)} onPick={(name) => setF('courier', name)} />
        <BreakdownPanel title="Claim Holder" icon={FileText} items={stats.byHolder.slice(0, 10)} onPick={(name) => setF('holder', name)} />
        <BreakdownPanel title="GRN Remarks Pattern" icon={AlertTriangle} items={stats.byRemarks.slice(0, 10)} onPick={(name) => setF('remarks', name)} />
      </div>

      {/* ─── Top SKUs by deficit ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[12px] font-bold text-gray-700 flex items-center gap-2"><Package className="w-4 h-4 text-rose-500" /> Top 15 SKUs by Deficit ₹</h3>
          <span className="text-[10px] text-gray-400">Click row to drill</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead><tr className="bg-gray-50 border-b border-gray-100">
            <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">SKU</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Records</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Units</th>
            <th className="px-3 py-2 text-right font-semibold text-rose-600 uppercase">Deficit ₹</th>
            <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">Recovered ₹</th>
            <th className="px-3 py-2 text-right font-semibold text-indigo-600 uppercase">Recovery %</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {stats.bySKU.map(s => (
              <tr key={s.name} onClick={() => openDrill(`SKU ${s.name}`, r => r['SKU Code'] === s.name)} className="hover:bg-rose-50/30 cursor-pointer">
                <td className="px-3 py-2 font-mono text-[10px] text-gray-700">{s.name}</td>
                <td className="px-3 py-2 text-right">{s.count}</td>
                <td className="px-3 py-2 text-right text-orange-600">{Math.round(s.deficitUnits).toLocaleString('en-IN')}</td>
                <td className="px-3 py-2 text-right font-bold text-rose-600">{currency(s.deficitVal)}</td>
                <td className="px-3 py-2 text-right text-emerald-600">{currency(s.recovered)}</td>
                <td className="px-3 py-2 text-right font-bold" style={{ color: s.recoveryPct >= 70 ? '#059669' : s.recoveryPct >= 40 ? '#d97706' : '#dc2626' }}>{s.recoveryPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      </>)}
      {/* end OVERVIEW tab */}

      {/* ═══ INSIGHTS & PREDICTIONS TAB ═══ */}
      {tab === 'insights' && (
        <InsightsTab data={data} stats={stats} openDrill={openDrill} />
      )}

      {/* ═══ TOP PERFORMERS TAB ═══ */}
      {tab === 'top' && (
        <TopPerformersTab stats={stats} data={data} setF={setF} openDrill={openDrill} />
      )}

      {/* ═══ DEFICIT SOURCES TAB ═══ */}
      {tab === 'sources' && (
        <DeficitSourcesTab data={data} openDrill={openDrill} />
      )}

      {/* ═══ CLAIMS WORKFLOW TAB ═══ */}
      {tab === 'claims' && (
        <ClaimsWorkflowTab data={data} stats={stats} openDrill={openDrill} />
      )}

      {/* ═══ RAW DATA TAB ═══ */}
      {tab === 'raw' && (
        <div className="space-y-3">
          <PivotBuilder data={data} openDrill={openDrill} />
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] font-bold text-gray-700 flex items-center gap-2"><Database className="w-4 h-4 text-rose-500" /> Full deficit register ({data.length} rows)</h3>
              <span className="text-[10px] text-gray-400">All filters applied · sort + search · export below</span>
            </div>
            <DataTable data={data} columns={drillCols} pageSize={50} exportFilename="grn-deficit-register" />
          </div>
        </div>
      )}

      </>)}

      {/* ─── Drilldown modal ─────────────────────────────────────────── */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-rose-700">{drill.title}</h3>
                <p className="text-[10px] text-gray-500">{drill.rows.length} records · {currency(drill.rows.reduce((s, r) => s + num(r['Deficit Value']), 0))} deficit · {currency(drill.rows.filter(r => isRecovered(r['Claim Status'], r['Claim Final Status'])).reduce((s, r) => s + num(r['Deficit Value']), 0))} recovered</p>
              </div>
              <button onClick={() => setDrill(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <DataTable data={drill.rows} columns={drillCols} pageSize={25} exportFilename="grn-drill" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── TOP PERFORMERS TAB ─────────────────────────────────────────────── */
function TopPerformersTab({ stats, data, setF, openDrill }) {
  const [mode, setMode] = useState('deficit'); // deficit | recovery | volume

  /* WH used as 'Location' since no city field */
  const sortKey = mode === 'deficit' ? 'deficitVal' : mode === 'recovery' ? 'recoveryPct' : 'count';
  const dir = mode === 'recovery' ? 1 : 1; /* always desc */

  const sortArr = (arr) => [...arr].sort((a, b) => (b[sortKey] - a[sortKey]) * dir);
  const couriers  = sortArr(stats.byCourier).slice(0, 10);
  const platforms = sortArr(stats.byPlatform).slice(0, 10);
  const whs       = sortArr(stats.byWH).slice(0, 10);
  const skus      = sortArr(stats.bySKU).slice(0, 15);

  return (
    <div className="space-y-3">
      {/* Mode switcher */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-[12px] font-bold text-gray-800 flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" /> Top Performers Leaderboard</h3>
          <p className="text-[10px] text-gray-500">Ranked by selected metric · click any row to filter the whole page</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1">
          {[
            { k: 'deficit', l: 'By Deficit ₹' },
            { k: 'recovery', l: 'By Recovery %' },
            { k: 'volume', l: 'By Volume' },
          ].map(m => (
            <button key={m.k} onClick={() => setMode(m.k)} className={`text-[10px] px-3 py-1 rounded ${mode === m.k ? 'bg-white shadow font-bold text-rose-600' : 'text-gray-500'}`}>{m.l}</button>
          ))}
        </div>
      </div>

      {/* 2x2 leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Leaderboard title="Top Couriers" icon={Truck} items={couriers} mode={mode} onPick={(name) => setF('courier', name)} accent="orange" />
        <Leaderboard title="Top Platforms" icon={Building2} items={platforms} mode={mode} onPick={(name) => setF('platform', name)} accent="rose" />
        <Leaderboard title="Top Locations (WH)" icon={MapPin} items={whs} mode={mode} onPick={(name) => setF('wh', name)} accent="indigo" />
        <Leaderboard title="Top SKUs" icon={Package} items={skus} mode={mode} onPick={(name) => openDrill(`SKU ${name}`, r => r['SKU Code'] === name)} accent="emerald" mono />
      </div>

      {/* Worst-of-the-worst combined section */}
      <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-xl p-4">
        <h3 className="text-[12px] font-bold text-red-700 flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4" /> Worst Combinations — Highest Loss</h3>
        <p className="text-[10px] text-gray-600 mb-2">Courier × Platform pairs ranked by total deficit (helps identify which courier-platform combos to renegotiate)</p>
        <WorstCombinations data={data} />
      </div>
    </div>
  );
}

function Leaderboard({ title, icon: Icon, items, mode, onPick, accent, mono }) {
  const max = Math.max(...items.map(i => i.deficitVal), 1);
  const accentColors = { orange: 'bg-orange-500', rose: 'bg-rose-500', indigo: 'bg-indigo-500', emerald: 'bg-emerald-500' };
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
        <Icon className={`w-3.5 h-3.5 text-${accent}-600`} />
        <h3 className="text-[11px] font-bold text-gray-700">{title}</h3>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-[10px]">
        <thead><tr className="border-b border-gray-100 bg-gray-50/30">
          <th className="px-2 py-1.5 text-left font-semibold text-gray-500 w-6">#</th>
          <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Name</th>
          <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Records</th>
          <th className="px-2 py-1.5 text-right font-semibold text-rose-600">Deficit ₹</th>
          <th className="px-2 py-1.5 text-right font-semibold text-emerald-600">Recovery %</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((it, i) => {
            const w = it.deficitVal / max * 100;
            return (
              <tr key={it.name} onClick={() => onPick(it.name)} className="hover:bg-rose-50/40 cursor-pointer">
                <td className="px-2 py-1.5 font-bold text-gray-400">{i + 1}</td>
                <td className={`px-2 py-1.5 ${mono ? 'font-mono text-[9px]' : 'font-medium'} text-gray-800 truncate max-w-[180px]`} title={it.name}>{it.name}</td>
                <td className="px-2 py-1.5 text-right text-gray-600">{it.count}</td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-rose-600 font-bold">{currency(it.deficitVal)}</span>
                    <div className="w-20 h-0.5 bg-gray-100 rounded-full mt-0.5 overflow-hidden"><div className={`h-full ${accentColors[accent]} rounded-full`} style={{ width: `${w}%` }} /></div>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right font-bold" style={{ color: it.recoveryPct >= 70 ? '#059669' : it.recoveryPct >= 40 ? '#d97706' : '#dc2626' }}>{it.recoveryPct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

function WorstCombinations({ data }) {
  const combos = useMemo(() => {
    const m = {};
    data.forEach(r => {
      const c = `${r['Order Type'] || '?'} × ${r['Carrier/Shipping Partner'] || '?'}`;
      if (!m[c]) m[c] = { name: c, count: 0, val: 0, recovered: 0 };
      m[c].count++;
      m[c].val += num(r['Deficit Value']);
      if (isRecovered(r['Claim Status'], r['Claim Final Status'])) m[c].recovered += num(r['Deficit Value']);
    });
    return Object.values(m).map(x => ({ ...x, recoveryPct: x.val > 0 ? (x.recovered / x.val * 100) : 0 })).sort((a, b) => b.val - a.val).slice(0, 10);
  }, [data]);
  const max = Math.max(...combos.map(c => c.val), 1);
  return (
    <div className="space-y-1">
      {combos.map(c => {
        const w = c.val / max * 100;
        return (
          <div key={c.name} className="flex items-center gap-2 text-[10px] bg-white rounded p-1.5 border border-red-100">
            <span className="flex-1 font-medium text-gray-700 truncate">{c.name}</span>
            <span className="w-12 text-right text-gray-500">{c.count}</span>
            <div className="w-40 h-1.5 bg-red-50 rounded-full overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{ width: `${w}%` }} /></div>
            <span className="w-24 text-right text-rose-700 font-bold">{currency(c.val)}</span>
            <span className="w-12 text-right font-bold" style={{ color: c.recoveryPct >= 70 ? '#059669' : c.recoveryPct >= 40 ? '#d97706' : '#dc2626' }}>{c.recoveryPct.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── DEFICIT SOURCES TAB ─────────────────────────────────────────────── */
function DeficitSourcesTab({ data, openDrill }) {
  /* Reason × Courier matrix */
  const matrix = useMemo(() => {
    const reasons = new Set(), couriers = new Set();
    const m = {};
    data.forEach(r => {
      const reason = (r['Claim Reason'] || 'Unknown').toString();
      const courier = (r['Carrier/Shipping Partner'] || 'Unknown').toString();
      reasons.add(reason); couriers.add(courier);
      const k = `${reason}||${courier}`;
      if (!m[k]) m[k] = { count: 0, val: 0 };
      m[k].count++;
      m[k].val += num(r['Deficit Value']);
    });
    /* Limit to top 8 reasons & top 8 couriers by total deficit */
    const reasonTotals = {}, courierTotals = {};
    Object.entries(m).forEach(([k, v]) => { const [reason, courier] = k.split('||'); reasonTotals[reason] = (reasonTotals[reason] || 0) + v.val; courierTotals[courier] = (courierTotals[courier] || 0) + v.val; });
    const topReasons = Object.entries(reasonTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
    const topCouriers = Object.entries(courierTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
    const max = Math.max(...Object.values(m).map(v => v.val), 1);
    return { reasons: topReasons, couriers: topCouriers, m, max };
  }, [data]);

  /* Remarks × Platform similar */
  const matrix2 = useMemo(() => {
    const m = {};
    data.forEach(r => {
      const remarks = (r['GRN Remarks'] || 'Unknown').toString();
      const platform = (r['Order Type'] || 'Unknown').toString();
      const k = `${remarks}||${platform}`;
      if (!m[k]) m[k] = { count: 0, val: 0 };
      m[k].count++;
      m[k].val += num(r['Deficit Value']);
    });
    const remarksTotals = {}, platformTotals = {};
    Object.entries(m).forEach(([k, v]) => { const [remarks, platform] = k.split('||'); remarksTotals[remarks] = (remarksTotals[remarks] || 0) + v.val; platformTotals[platform] = (platformTotals[platform] || 0) + v.val; });
    const topRemarks = Object.entries(remarksTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
    const topPlatforms = Object.entries(platformTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
    const max = Math.max(...Object.values(m).map(v => v.val), 1);
    return { remarks: topRemarks, platforms: topPlatforms, m, max };
  }, [data]);

  /* Root cause: what's the dominant reason? */
  const rootCause = useMemo(() => {
    const reasons = {};
    data.forEach(r => {
      const reason = (r['Claim Reason'] || 'Unknown').toString();
      if (!reasons[reason]) reasons[reason] = { count: 0, val: 0 };
      reasons[reason].count++;
      reasons[reason].val += num(r['Deficit Value']);
    });
    const total = Object.values(reasons).reduce((s, x) => s + x.val, 0);
    return Object.entries(reasons).map(([name, v]) => ({ name, ...v, pct: total > 0 ? (v.val / total * 100) : 0 })).sort((a, b) => b.val - a.val);
  }, [data]);

  return (
    <div className="space-y-3">
      {/* Root cause Pareto */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[12px] font-bold text-gray-800 flex items-center gap-2"><Target className="w-4 h-4 text-rose-500" /> Root Cause — Pareto Analysis</h3>
            <p className="text-[10px] text-gray-500">Top reasons contributing to total deficit (80/20 rule: focus on top contributors)</p>
          </div>
        </div>
        <div className="space-y-1.5">
          {(() => { let cum = 0; return rootCause.slice(0, 10).map((rc, i) => {
            cum += rc.pct;
            const tier = cum <= 80 ? 'bg-red-500' : cum <= 95 ? 'bg-amber-500' : 'bg-gray-300';
            return (
              <div key={rc.name} className="flex items-center gap-2 text-[10px]">
                <span className="w-5 font-bold text-gray-400">{i + 1}</span>
                <span className="flex-1 text-gray-700 truncate" title={rc.name}>{rc.name}</span>
                <div className="w-64 h-4 bg-gray-50 rounded overflow-hidden"><div className={`h-full ${tier} rounded`} style={{ width: `${rc.pct}%` }} /></div>
                <span className="w-12 text-right font-bold text-rose-600">{rc.pct.toFixed(1)}%</span>
                <span className="w-12 text-right text-gray-500">cum {cum.toFixed(0)}%</span>
                <span className="w-24 text-right font-mono text-gray-700">{currency(rc.val)}</span>
              </div>
            );
          }); })()}
        </div>
        <p className="text-[9px] text-gray-400 mt-2">🔴 Top 80% (Vital Few — focus here) · 🟡 80-95% (Important) · ⚪ Trivial Many</p>
      </div>

      {/* Reason × Courier heatmap */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-[12px] font-bold text-gray-800 mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-500" /> Reason × Courier Heatmap</h3>
        <p className="text-[10px] text-gray-500 mb-3">Cell darkness = deficit ₹. Click any cell to drill down.</p>
        <Heatmap rows={matrix.reasons} cols={matrix.couriers} cellGet={(r, c) => matrix.m[`${r}||${c}`] || { count: 0, val: 0 }} max={matrix.max}
          onClick={(reason, courier) => openDrill(`${reason} × ${courier}`, x => x['Claim Reason'] === reason && x['Carrier/Shipping Partner'] === courier)} />
      </div>

      {/* Remarks × Platform heatmap */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-[12px] font-bold text-gray-800 mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-purple-500" /> GRN Remarks × Platform Heatmap</h3>
        <p className="text-[10px] text-gray-500 mb-3">Where does each type of deficit happen?</p>
        <Heatmap rows={matrix2.remarks} cols={matrix2.platforms} cellGet={(r, c) => matrix2.m[`${r}||${c}`] || { count: 0, val: 0 }} max={matrix2.max}
          onClick={(remarks, platform) => openDrill(`${remarks} × ${platform}`, x => x['GRN Remarks'] === remarks && x['Order Type'] === platform)} />
      </div>
    </div>
  );
}

function Heatmap({ rows, cols, cellGet, max, onClick }) {
  if (rows.length === 0 || cols.length === 0) return <p className="text-[10px] text-gray-400">No data</p>;
  return (
    <div className="overflow-x-auto"><table className="text-[9px]">
      <thead><tr>
        <th className="px-2 py-1 text-left bg-gray-50 sticky left-0 z-10"></th>
        {cols.map(c => <th key={c} className="px-2 py-1 text-left font-semibold text-gray-600 min-w-[80px]" title={c}>{c.length > 12 ? c.slice(0, 12) + '…' : c}</th>)}
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r}>
            <th className="px-2 py-1 text-left font-semibold text-gray-700 sticky left-0 bg-white z-10 min-w-[160px]" title={r}>{r.length > 22 ? r.slice(0, 22) + '…' : r}</th>
            {cols.map(c => {
              const cell = cellGet(r, c);
              const intensity = max > 0 ? cell.val / max : 0;
              const bg = intensity > 0 ? `rgba(220, 38, 38, ${Math.min(0.05 + intensity * 0.9, 0.95)})` : '#f9fafb';
              const textColor = intensity > 0.5 ? '#fff' : '#374151';
              return (
                <td key={c} onClick={() => cell.count > 0 && onClick(r, c)}
                  className={`px-2 py-1.5 text-center ${cell.count > 0 ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400' : ''}`}
                  style={{ background: bg, color: textColor }} title={cell.count > 0 ? `${cell.count} records · ${currency(cell.val)}` : ''}>
                  {cell.count > 0 ? <><div className="font-bold">{currency(cell.val)}</div><div className="text-[8px] opacity-80">{cell.count}</div></> : <span className="text-gray-300">—</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

/* ─── CLAIMS WORKFLOW TAB ────────────────────────────────────────────── */
function ClaimsWorkflowTab({ data, stats, openDrill }) {
  /* Funnel: Total → Open → Recovered / Lost */
  const total = data.length;
  const totalVal = data.reduce((s, r) => s + num(r['Deficit Value']), 0);
  const open = data.filter(r => isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status']));
  const recovered = data.filter(r => isRecovered(r['Claim Status'], r['Claim Final Status']));
  const lost = data.filter(r => isLost(r['Claim Final Status']));
  const other = total - open.length - recovered.length - lost.length;
  const openVal = open.reduce((s, r) => s + num(r['Deficit Value']), 0);
  const recVal = recovered.reduce((s, r) => s + num(r['Deficit Value']), 0);
  const lostVal = lost.reduce((s, r) => s + num(r['Deficit Value']), 0);

  /* Status × Holder matrix */
  const statusHolderMatrix = useMemo(() => {
    const m = {}; const statuses = new Set(); const holders = new Set();
    data.forEach(r => {
      const s = (r['Claim Status'] || 'Unknown').toString();
      const h = (r['Claim Holder'] || 'Unknown').toString();
      statuses.add(s); holders.add(h);
      const k = `${s}||${h}`;
      if (!m[k]) m[k] = { count: 0, val: 0 };
      m[k].count++; m[k].val += num(r['Deficit Value']);
    });
    return { statuses: Array.from(statuses), holders: Array.from(holders), m, max: Math.max(...Object.values(m).map(v => v.val), 1) };
  }, [data]);

  return (
    <div className="space-y-3">
      {/* Funnel */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-[12px] font-bold text-gray-800 mb-3 flex items-center gap-2"><Workflow className="w-4 h-4 text-indigo-500" /> Claims Funnel</h3>
        <div className="space-y-2">
          <FunnelStep label="Total deficit records raised" count={total} val={totalVal} max={total} color="bg-gray-400" onClick={() => openDrill('All records', () => true)} />
          <FunnelStep label="Open claims — pending action" count={open.length} val={openVal} max={total} color="bg-amber-500" onClick={() => openDrill('Open claims', r => isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status']))} />
          <FunnelStep label="Recovered ✓" count={recovered.length} val={recVal} max={total} color="bg-emerald-500" onClick={() => openDrill('Recovered', r => isRecovered(r['Claim Status'], r['Claim Final Status']))} />
          <FunnelStep label="Lost / Rejected ✕" count={lost.length} val={lostVal} max={total} color="bg-red-500" onClick={() => openDrill('Lost', r => isLost(r['Claim Final Status']))} />
          {other > 0 && <FunnelStep label="Other / Indeterminate" count={other} val={totalVal - openVal - recVal - lostVal} max={total} color="bg-gray-300" />}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="bg-amber-50 rounded-lg p-2"><p className="text-[9px] text-gray-500 uppercase">Open Exposure</p><p className="text-lg font-bold text-amber-700">{currency(openVal)}</p></div>
          <div className="bg-emerald-50 rounded-lg p-2"><p className="text-[9px] text-gray-500 uppercase">Recovered</p><p className="text-lg font-bold text-emerald-700">{currency(recVal)}</p><p className="text-[9px] text-emerald-600">{totalVal > 0 ? (recVal / totalVal * 100).toFixed(1) : 0}% rate</p></div>
          <div className="bg-red-50 rounded-lg p-2"><p className="text-[9px] text-gray-500 uppercase">Lost</p><p className="text-lg font-bold text-red-700">{currency(lostVal)}</p><p className="text-[9px] text-red-600">{totalVal > 0 ? (lostVal / totalVal * 100).toFixed(1) : 0}% rate</p></div>
        </div>
      </div>

      {/* Status × Holder matrix */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-[12px] font-bold text-gray-800 mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-500" /> Claim Status × Holder Matrix</h3>
        <p className="text-[10px] text-gray-500 mb-3">Where are claims stuck? Cell shows deficit ₹ + record count.</p>
        <Heatmap rows={statusHolderMatrix.statuses.slice(0, 12)} cols={statusHolderMatrix.holders.slice(0, 8)}
          cellGet={(r, c) => statusHolderMatrix.m[`${r}||${c}`] || { count: 0, val: 0 }} max={statusHolderMatrix.max}
          onClick={(s, h) => openDrill(`${s} × ${h}`, x => x['Claim Status'] === s && x['Claim Holder'] === h)} />
      </div>

      {/* Aging heatmap by holder */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-[12px] font-bold text-gray-800 mb-2 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Open Claim Aging × Holder</h3>
        <p className="text-[10px] text-gray-500 mb-3">Find aged claims by responsibility owner.</p>
        {(() => {
          const m = {}; const holders = new Set();
          data.forEach(r => {
            if (isRecovered(r['Claim Status'], r['Claim Final Status'])) return;
            const h = (r['Claim Holder'] || 'Unknown').toString();
            const days = daysSince(r['Claim Date']);
            const b = ageBucket(days);
            holders.add(h);
            const k = `${b}||${h}`;
            if (!m[k]) m[k] = { count: 0, val: 0 };
            m[k].count++; m[k].val += num(r['Deficit Value']);
          });
          const max = Math.max(...Object.values(m).map(v => v.val), 1);
          return (
            <Heatmap rows={AGE_ORDER.filter(a => Object.keys(m).some(k => k.startsWith(a + '||')))} cols={Array.from(holders).slice(0, 8)}
              cellGet={(r, c) => m[`${r}||${c}`] || { count: 0, val: 0 }} max={max}
              onClick={(age, holder) => openDrill(`${age} × ${holder}`, x => {
                if (isRecovered(x['Claim Status'], x['Claim Final Status'])) return false;
                return ageBucket(daysSince(x['Claim Date'])) === age && (x['Claim Holder'] || 'Unknown') === holder;
              })} />
          );
        })()}
      </div>
    </div>
  );
}

function FunnelStep({ label, count, val, max, color, onClick }) {
  const w = max > 0 ? (count / max * 100) : 0;
  return (
    <button onClick={onClick} disabled={!onClick} className={`w-full flex items-center gap-2 text-[11px] ${onClick ? 'hover:bg-gray-50 cursor-pointer' : ''} rounded p-1.5 -mx-1 transition-colors`}>
      <span className="w-56 text-left font-medium text-gray-700">{label}</span>
      <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
        <div className={`h-full ${color} rounded flex items-center px-2 transition-all`} style={{ width: `${w}%` }}>
          <span className="text-[10px] font-bold text-white">{count.toLocaleString('en-IN')} ({w.toFixed(1)}%)</span>
        </div>
      </div>
      <span className="w-28 text-right text-gray-700 font-mono font-bold">{currency(val)}</span>
    </button>
  );
}

/* ─── SMART INSIGHTS STRIP — auto-detected callouts ──────────────────── */
function SmartInsights({ stats, data, setF }) {
  const insights = useMemo(() => {
    const out = [];
    /* 1. Worst courier (highest deficit + lowest recovery) */
    const worstCourier = stats.byCourier.filter(c => c.recoveryPct < 50 && c.deficitVal > 0).sort((a, b) => b.deficitVal - a.deficitVal)[0];
    if (worstCourier) {
      out.push({
        kind: 'critical', icon: Flame, title: 'High-loss courier needs renegotiation',
        body: <><strong>{worstCourier.name}</strong> has <strong className="text-rose-700">{currency(worstCourier.deficitVal)}</strong> deficit with only <strong className="text-red-600">{worstCourier.recoveryPct.toFixed(0)}%</strong> recovery — escalate or switch volumes.</>,
        cta: 'Filter to this courier', onCta: () => setF('courier', worstCourier.name),
      });
    }
    /* 2. Dominant root-cause */
    const totalVal = stats.byReason.reduce((s, r) => s + r.deficitVal, 0);
    const dominant = stats.byReason[0];
    if (dominant && totalVal > 0 && (dominant.deficitVal / totalVal) > 0.3) {
      out.push({
        kind: 'warn', icon: Target, title: 'One reason dominates the deficit',
        body: <><strong>{dominant.name}</strong> accounts for <strong className="text-amber-700">{(dominant.deficitVal / totalVal * 100).toFixed(0)}%</strong> of total deficit ({currency(dominant.deficitVal)}) — fix this root cause first.</>,
        cta: 'Filter to this reason', onCta: () => setF('reason', dominant.name),
      });
    }
    /* 3. Aged claims sitting unrecovered */
    const aged60 = stats.ageBkts['60+d'];
    if (aged60 && aged60.c > 0) {
      out.push({
        kind: 'critical', icon: Clock, title: 'Aged claims at risk of write-off',
        body: <><strong className="text-red-700">{aged60.c}</strong> claims older than 60 days holding <strong>{currency(aged60.v)}</strong> — recovery probability drops sharply after 60 days. Immediate escalation needed.</>,
        cta: 'View aged claims', onCta: null,
      });
    }
    /* 4. Recovery rate health */
    if (stats.recoveryRate > 0) {
      const tone = stats.recoveryRate >= 70 ? 'good' : stats.recoveryRate >= 40 ? 'warn' : 'critical';
      out.push({
        kind: tone, icon: tone === 'good' ? CheckCircle : TrendingUp, title: `Overall recovery health: ${tone === 'good' ? 'strong' : tone === 'warn' ? 'moderate' : 'weak'}`,
        body: <>Recovery rate is <strong className={tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-red-700'}>{stats.recoveryRate.toFixed(1)}%</strong> ({currency(stats.recoveredVal)} of {currency(stats.totalDeficitVal)}). {tone === 'good' ? 'Maintain current discipline.' : 'Push pending claims for closure.'}</>,
        cta: null,
      });
    }
    /* 5. Trend — last month vs prior */
    if (stats.monthArr.length >= 2) {
      const last = stats.monthArr[stats.monthArr.length - 1], prev = stats.monthArr[stats.monthArr.length - 2];
      const delta = last.val - prev.val;
      const deltaPct = prev.val > 0 ? (delta / prev.val * 100) : 0;
      out.push({
        kind: delta > 0 ? 'warn' : 'good', icon: delta > 0 ? ArrowUp : ArrowDown, title: `Month-on-month deficit ${delta > 0 ? 'rose' : 'dropped'}`,
        body: <><strong>{last.month}</strong>: {currency(last.val)} vs <strong>{prev.month}</strong>: {currency(prev.val)} — <strong className={delta > 0 ? 'text-red-700' : 'text-emerald-700'}>{delta > 0 ? '+' : ''}{deltaPct.toFixed(1)}%</strong> change.</>,
        cta: null,
      });
    }
    /* 6. Most common SKU losing */
    const topSKU = stats.bySKU[0];
    if (topSKU && topSKU.count >= 3) {
      out.push({
        kind: 'warn', icon: Package, title: 'A single SKU keeps short-shipping',
        body: <>SKU <strong className="font-mono">{topSKU.name}</strong> appears in <strong>{topSKU.count}</strong> deficit records totaling <strong>{currency(topSKU.deficitVal)}</strong> — check packaging / labelling QC.</>,
        cta: null,
      });
    }
    return out.slice(0, 6);
  }, [stats, data]);

  if (insights.length === 0) return null;
  const toneCfg = {
    critical: { bg: 'bg-red-50 border-red-200', icon: 'text-red-600', title: 'text-red-700' },
    warn: { bg: 'bg-amber-50 border-amber-200', icon: 'text-amber-600', title: 'text-amber-700' },
    good: { bg: 'bg-emerald-50 border-emerald-200', icon: 'text-emerald-600', title: 'text-emerald-700' },
  };
  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4">
      <h3 className="text-[12px] font-bold text-indigo-800 flex items-center gap-2 mb-3"><Brain className="w-4 h-4" /> Smart Insights — Auto-detected from current filter</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {insights.map((ins, i) => { const c = toneCfg[ins.kind]; const Icon = ins.icon; return (
          <div key={i} className={`${c.bg} border rounded-lg p-2.5`}>
            <div className="flex items-start gap-2">
              <Icon className={`w-4 h-4 ${c.icon} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-bold ${c.title} uppercase tracking-wider`}>{ins.title}</p>
                <p className="text-[11px] text-gray-700 mt-0.5 leading-snug">{ins.body}</p>
                {ins.cta && <button onClick={ins.onCta} className={`text-[10px] mt-1 ${c.title} hover:underline font-semibold`}>{ins.cta} →</button>}
              </div>
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}

/* ─── INSIGHTS & PREDICTIONS TAB ─────────────────────────────────────── */
function InsightsTab({ data, stats, openDrill }) {
  /* Time-to-recovery: for recovered claims, days from Claim Date to today (proxy for resolution time) */
  const recoveryTimes = useMemo(() => {
    return data
      .filter(r => isRecovered(r['Claim Status'], r['Claim Final Status']))
      .map(r => daysSince(r['Claim Date']))
      .filter(d => d != null && d >= 0)
      .sort((a, b) => a - b);
  }, [data]);
  const ttrAvg = recoveryTimes.length ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length : 0;
  const ttrP50 = recoveryTimes.length ? recoveryTimes[Math.floor(recoveryTimes.length / 2)] : 0;
  const ttrP90 = recoveryTimes.length ? recoveryTimes[Math.floor(recoveryTimes.length * 0.9)] : 0;
  const ttrMax = recoveryTimes.length ? recoveryTimes[recoveryTimes.length - 1] : 0;

  /* Forecast next month using linear regression on monthly trend */
  const forecast = useMemo(() => {
    if (stats.monthArr.length < 2) return null;
    const pts = stats.monthArr.map((m, i) => ({ x: i, y: m.val }));
    const n = pts.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
    const slope = ((n * sxy - sx * sy) / (n * sxx - sx * sx)) || 0;
    const intercept = (sy - slope * sx) / n;
    const next = Math.max(0, slope * n + intercept);
    const recPts = stats.monthArr.map((m, i) => ({ x: i, y: m.recoveredVal }));
    let rsx = 0, rsy = 0, rsxy = 0, rsxx = 0;
    recPts.forEach(p => { rsx += p.x; rsy += p.y; rsxy += p.x * p.y; rsxx += p.x * p.x; });
    const rSlope = ((n * rsxy - rsx * rsy) / (n * rsxx - rsx * rsx)) || 0;
    const rIntercept = (rsy - rSlope * rsx) / n;
    const nextRec = Math.max(0, rSlope * n + rIntercept);
    return { next, nextRec, slope, direction: slope > 0 ? 'rising' : slope < 0 ? 'falling' : 'stable' };
  }, [stats]);

  /* Critical claims — severity = age * (value / max) */
  const criticalClaims = useMemo(() => {
    const open = data.filter(r => isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status']));
    const maxVal = Math.max(...open.map(r => num(r['Deficit Value'])), 1);
    return open.map(r => {
      const age = daysSince(r['Claim Date']) || 0;
      const val = num(r['Deficit Value']);
      const severity = age * (val / maxVal);
      return { ...r, _age: age, _val: val, _severity: severity };
    }).sort((a, b) => b._severity - a._severity).slice(0, 15);
  }, [data]);

  /* What-if simulator state */
  const [whatIfPct, setWhatIfPct] = useState(50);
  const [whatIfDim, setWhatIfDim] = useState('open'); // open | aged60 | byCourier
  const whatIfResult = useMemo(() => {
    let pool = [];
    if (whatIfDim === 'open') pool = data.filter(r => isOpen(r['Claim Status']) && !isRecovered(r['Claim Status'], r['Claim Final Status']));
    else if (whatIfDim === 'aged60') pool = data.filter(r => {
      if (isRecovered(r['Claim Status'], r['Claim Final Status'])) return false;
      const a = daysSince(r['Claim Date']); return a != null && a > 60;
    });
    else if (whatIfDim === 'highValue') pool = data.filter(r => num(r['Deficit Value']) > 5000 && !isRecovered(r['Claim Status'], r['Claim Final Status']));
    const poolVal = pool.reduce((s, r) => s + num(r['Deficit Value']), 0);
    const additionalRec = poolVal * whatIfPct / 100;
    const newTotalRec = stats.recoveredVal + additionalRec;
    const newRate = stats.totalDeficitVal > 0 ? (newTotalRec / stats.totalDeficitVal * 100) : 0;
    return { poolVal, additionalRec, newTotalRec, newRate, poolCount: pool.length };
  }, [data, whatIfPct, whatIfDim, stats]);

  /* Anomaly: courier or platform whose recovery rate is far below mean */
  const anomalies = useMemo(() => {
    const avgRec = stats.byCourier.reduce((s, c) => s + c.recoveryPct, 0) / Math.max(stats.byCourier.length, 1);
    return stats.byCourier
      .filter(c => c.deficitVal > 10000 && c.recoveryPct < avgRec * 0.5)
      .slice(0, 5);
  }, [stats]);

  return (
    <div className="space-y-3">
      {/* Forecast card */}
      {forecast && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4">
          <h3 className="text-[12px] font-bold text-indigo-800 flex items-center gap-2 mb-3"><Zap className="w-4 h-4" /> Next-Month Forecast</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Predicted deficit</p>
              <p className="text-2xl font-bold text-rose-600">{currency(forecast.next)}</p>
              <p className="text-[9px] text-gray-500">Linear trend, {forecast.direction}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Predicted recovered</p>
              <p className="text-2xl font-bold text-emerald-600">{currency(forecast.nextRec)}</p>
              <p className="text-[9px] text-gray-500">If current closure rate holds</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Predicted loss</p>
              <p className="text-2xl font-bold text-amber-600">{currency(Math.max(0, forecast.next - forecast.nextRec))}</p>
              <p className="text-[9px] text-gray-500">Deficit − recovered</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Trend signal</p>
              <p className="text-2xl font-bold" style={{ color: forecast.slope > 0 ? '#dc2626' : forecast.slope < 0 ? '#059669' : '#6b7280' }}>{forecast.slope > 0 ? '▲' : forecast.slope < 0 ? '▼' : '─'}</p>
              <p className="text-[9px] text-gray-500">{forecast.direction === 'rising' ? 'Deficit increasing' : forecast.direction === 'falling' ? 'Deficit improving' : 'Stable'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Time-to-recovery */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-[12px] font-bold text-gray-800 flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-indigo-500" /> Recovery Speed — Time to Resolution</h3>
        {recoveryTimes.length === 0 ? <p className="text-[11px] text-gray-400">No recovered claims yet to measure</p> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat2 label="Avg" value={`${ttrAvg.toFixed(0)} days`} sub={`across ${recoveryTimes.length} recoveries`} color="indigo" />
            <Stat2 label="P50 (Median)" value={`${ttrP50} days`} sub="half close within" color="emerald" />
            <Stat2 label="P90" value={`${ttrP90} days`} sub="90% close within" color="amber" />
            <Stat2 label="Worst" value={`${ttrMax} days`} sub="longest recovery" color="red" />
          </div>
        )}
      </div>

      {/* Critical claims — severity ranking */}
      <div className="bg-white rounded-xl shadow-sm border border-red-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-red-100 bg-red-50/30">
          <h3 className="text-[12px] font-bold text-red-700 flex items-center gap-2"><Flame className="w-4 h-4" /> Critical Claims — Severity Ranking</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">Severity = Age × Value. Top 15 most urgent open claims.</p>
        </div>
        {criticalClaims.length === 0 ? <p className="text-[11px] text-gray-400 p-4">No open claims to rank</p> : (
          <div className="overflow-x-auto"><table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500 w-6">#</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">AWB / Invoice</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Platform</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Courier</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Holder</th>
              <th className="px-2 py-1.5 text-right font-semibold text-rose-600">Deficit ₹</th>
              <th className="px-2 py-1.5 text-right font-semibold text-amber-600">Age (d)</th>
              <th className="px-2 py-1.5 text-right font-semibold text-red-600">Severity</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {criticalClaims.map((c, i) => (
                <tr key={i} className="hover:bg-red-50/40">
                  <td className="px-2 py-1.5 font-bold text-red-500">{i + 1}</td>
                  <td className="px-2 py-1.5 font-mono">{c['AWB Number']} / {c['Invoice Number']}</td>
                  <td className="px-2 py-1.5">{c['Order Type']}</td>
                  <td className="px-2 py-1.5 truncate max-w-[140px]" title={c['Carrier/Shipping Partner']}>{c['Carrier/Shipping Partner']}</td>
                  <td className="px-2 py-1.5">{c['Claim Holder']}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-rose-600">{currency(c._val)}</td>
                  <td className="px-2 py-1.5 text-right font-bold" style={{ color: c._age > 60 ? '#dc2626' : c._age > 30 ? '#ea580c' : '#d97706' }}>{c._age}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-red-700">{c._severity.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* What-if simulator */}
      <div className="bg-white rounded-xl shadow-sm border border-indigo-100 p-4">
        <h3 className="text-[12px] font-bold text-indigo-700 flex items-center gap-2 mb-3"><Calculator className="w-4 h-4" /> What-If Recovery Simulator</h3>
        <p className="text-[10px] text-gray-500 mb-3">Estimate impact of recovering a % of a specific claim pool.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-[10px] text-gray-600 mb-1 font-medium">Claim pool</label>
            <select value={whatIfDim} onChange={e => setWhatIfDim(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-gray-200 rounded">
              <option value="open">All open claims</option>
              <option value="aged60">Aged 60+ days only</option>
              <option value="highValue">High-value (&gt; ₹5K) open</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1 font-medium">Recovery target</label>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" step="5" value={whatIfPct} onChange={e => setWhatIfPct(parseInt(e.target.value))} className="flex-1" />
              <span className="text-[11px] font-bold text-indigo-700 w-12 text-right">{whatIfPct}%</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1 font-medium">Pool size</label>
            <p className="text-[11px] py-1.5"><strong>{whatIfResult.poolCount}</strong> claims · <strong>{currency(whatIfResult.poolVal)}</strong> at stake</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
            <p className="text-[9px] uppercase text-emerald-600 font-semibold tracking-wider">If achieved:</p>
            <p className="text-lg font-bold text-emerald-700">+{currency(whatIfResult.additionalRec)}</p>
            <p className="text-[9px] text-gray-500">recovered (additional)</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5">
            <p className="text-[9px] uppercase text-indigo-600 font-semibold tracking-wider">New recovery total</p>
            <p className="text-lg font-bold text-indigo-700">{currency(whatIfResult.newTotalRec)}</p>
            <p className="text-[9px] text-gray-500">was {currency(stats.recoveredVal)}</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5">
            <p className="text-[9px] uppercase text-purple-600 font-semibold tracking-wider">New recovery rate</p>
            <p className="text-lg font-bold text-purple-700">{whatIfResult.newRate.toFixed(1)}%</p>
            <p className="text-[9px] text-gray-500">from {stats.recoveryRate.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Anomaly couriers */}
      {anomalies.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-[12px] font-bold text-amber-800 flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4" /> Anomalies — Couriers with Unusually Low Recovery</h3>
          <p className="text-[10px] text-gray-600 mb-2">These couriers have significant deficit but recovery is &lt; 50% of the average rate.</p>
          <div className="space-y-1">
            {anomalies.map(a => (
              <div key={a.name} className="flex items-center gap-2 bg-white rounded p-2 border border-amber-100">
                <Flame className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <span className="flex-1 text-[11px] font-semibold text-gray-800">{a.name}</span>
                <span className="text-[10px] text-gray-500">{a.count} records</span>
                <span className="text-[11px] font-bold text-rose-700 w-24 text-right">{currency(a.deficitVal)}</span>
                <span className="text-[10px] font-bold w-12 text-right" style={{ color: '#dc2626' }}>{a.recoveryPct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat2({ label, value, sub, color = 'indigo' }) {
  const map = { indigo: 'bg-indigo-50 text-indigo-700', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700' };
  return (
    <div className={`${map[color]} rounded-lg p-3 border border-current/10`}>
      <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-[9px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── PIVOT BUILDER ──────────────────────────────────────────────────── */
function PivotBuilder({ data, openDrill }) {
  const DIMS = [
    { k: 'Order Type', l: 'Platform' },
    { k: 'Carrier/Shipping Partner', l: 'Courier' },
    { k: 'WH', l: 'Warehouse' },
    { k: 'Claim Status', l: 'Claim Status' },
    { k: 'Claim Holder', l: 'Holder' },
    { k: 'Claim Reason', l: 'Reason' },
    { k: 'GRN Remarks', l: 'GRN Remarks' },
    { k: 'CN/COF(Couier)', l: 'CN/COF' },
    { k: 'SKU Code', l: 'SKU' },
  ];
  const METRICS = [
    { k: 'count', l: 'Records' },
    { k: 'deficitVal', l: 'Deficit ₹' },
    { k: 'deficitUnits', l: 'Deficit Units' },
    { k: 'recoveredVal', l: 'Recovered ₹' },
    { k: 'recoveryPct', l: 'Recovery %' },
  ];

  const [rowDim, setRowDim] = useState('Order Type');
  const [colDim, setColDim] = useState('Claim Status');
  const [metric, setMetric] = useState('deficitVal');

  const pivot = useMemo(() => {
    const rows = new Set(), cols = new Set();
    const cells = {};
    data.forEach(r => {
      const rk = (r[rowDim] || 'Unknown').toString();
      const ck = (r[colDim] || 'Unknown').toString();
      rows.add(rk); cols.add(ck);
      const key = `${rk}||${ck}`;
      if (!cells[key]) cells[key] = { count: 0, deficitVal: 0, deficitUnits: 0, recoveredVal: 0 };
      cells[key].count++;
      cells[key].deficitVal += num(r['Deficit Value']);
      cells[key].deficitUnits += num(r['Deficit Unit']);
      if (isRecovered(r['Claim Status'], r['Claim Final Status'])) cells[key].recoveredVal += num(r['Deficit Value']);
    });
    /* Compute recovery % */
    Object.values(cells).forEach(c => { c.recoveryPct = c.deficitVal > 0 ? (c.recoveredVal / c.deficitVal * 100) : 0; });
    /* Sort rows / cols by metric total */
    const rowTotals = {}; const colTotals = {};
    Object.entries(cells).forEach(([k, v]) => { const [rk, ck] = k.split('||'); rowTotals[rk] = (rowTotals[rk] || 0) + (v[metric] || 0); colTotals[ck] = (colTotals[ck] || 0) + (v[metric] || 0); });
    const rowsArr = Array.from(rows).sort((a, b) => (rowTotals[b] || 0) - (rowTotals[a] || 0)).slice(0, 15);
    const colsArr = Array.from(cols).sort((a, b) => (colTotals[b] || 0) - (colTotals[a] || 0)).slice(0, 10);
    const max = Math.max(...Object.values(cells).map(c => c[metric] || 0), 1);
    return { rows: rowsArr, cols: colsArr, cells, max, rowTotals, colTotals };
  }, [data, rowDim, colDim, metric]);

  const formatCell = (v) => {
    if (v == null) return '—';
    if (metric === 'count') return v.toLocaleString('en-IN');
    if (metric === 'recoveryPct') return v.toFixed(0) + '%';
    if (metric.includes('Val')) return currency(v);
    return Math.round(v).toLocaleString('en-IN');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-[12px] font-bold text-gray-800 flex items-center gap-2"><Layers className="w-4 h-4 text-indigo-500" /> Pivot Builder</h3>
        <p className="text-[10px] text-gray-500">Pick rows × cols × metric — click any cell to drill</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        <div>
          <label className="block text-[10px] text-gray-600 mb-1 font-medium">Rows</label>
          <select value={rowDim} onChange={e => setRowDim(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-indigo-200 rounded bg-indigo-50/30 text-indigo-700 font-semibold">
            {DIMS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-600 mb-1 font-medium">Columns</label>
          <select value={colDim} onChange={e => setColDim(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-purple-200 rounded bg-purple-50/30 text-purple-700 font-semibold">
            {DIMS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-600 mb-1 font-medium">Metric</label>
          <select value={metric} onChange={e => setMetric(e.target.value)} className="w-full px-2 py-1.5 text-[11px] border border-rose-200 rounded bg-rose-50/30 text-rose-700 font-semibold">
            {METRICS.map(m => <option key={m.k} value={m.k}>{m.l}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto"><table className="text-[9px] w-full">
        <thead><tr>
          <th className="px-2 py-1.5 text-left bg-gray-50 sticky left-0 z-10 font-semibold text-gray-600 min-w-[140px]">{DIMS.find(d => d.k === rowDim)?.l} ↓ / {DIMS.find(d => d.k === colDim)?.l} →</th>
          {pivot.cols.map(c => <th key={c} className="px-2 py-1.5 text-right font-semibold text-gray-600 min-w-[80px]" title={c}>{c.length > 14 ? c.slice(0, 14) + '…' : c}</th>)}
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
                const bg = v != null ? `rgba(99, 102, 241, ${Math.min(0.05 + intensity * 0.7, 0.85)})` : 'transparent';
                const txt = intensity > 0.5 ? '#fff' : '#374151';
                return (
                  <td key={c} className={`px-2 py-1.5 text-right font-mono ${cell ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400' : ''}`}
                    style={{ background: bg, color: txt }}
                    onClick={() => cell && openDrill(`${r} × ${c}`, x => (x[rowDim] || 'Unknown').toString() === r && (x[colDim] || 'Unknown').toString() === c)}>
                    {formatCell(v)}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-right bg-indigo-50 font-bold text-indigo-700">{formatCell(pivot.rowTotals[r])}</td>
            </tr>
          ))}
          <tr className="bg-indigo-100/50 border-t-2 border-indigo-200">
            <th className="px-2 py-1.5 text-left font-bold text-indigo-800 sticky left-0 bg-indigo-100 z-10">Total</th>
            {pivot.cols.map(c => <td key={c} className="px-2 py-1.5 text-right font-bold text-indigo-700">{formatCell(pivot.colTotals[c])}</td>)}
            <td className="px-2 py-1.5 text-right font-bold text-indigo-800 bg-indigo-200">{formatCell(Object.values(pivot.rowTotals).reduce((s, v) => s + v, 0))}</td>
          </tr>
        </tbody>
      </table></div>
    </div>
  );
}

/* ─── Reusable filter dropdown ────────────────────────────────────────── */
function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-gray-500 mb-0.5 font-medium">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={`w-full px-2 py-1 border rounded focus:border-indigo-400 outline-none ${value !== 'all' ? 'border-indigo-300 bg-indigo-50/40 text-indigo-700 font-semibold' : 'border-gray-200'}`}>
        <option value="all">All ({options.length})</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ─── Reusable breakdown panel (clickable rows -> filter) ─────────────── */
function BreakdownPanel({ title, icon: Icon, items, onPick }) {
  const max = Math.max(...items.map(i => i.deficitVal), 1);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-indigo-500" />
        <h3 className="text-[11px] font-bold text-gray-700">{title}</h3>
        <span className="text-[9px] text-gray-400 ml-auto">click row to filter</span>
      </div>
      <div className="divide-y divide-gray-50">
        {items.map(it => {
          const w = it.deficitVal / max * 100;
          return (
            <button key={it.name} onClick={() => onPick(it.name)} className="w-full text-left px-3 py-1.5 hover:bg-indigo-50/40 transition-colors">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="text-gray-700 font-medium truncate flex-1" title={it.name}>{it.name}</span>
                <span className="text-rose-600 font-bold w-24 text-right">{currency(it.deficitVal)}</span>
                <span className="text-gray-400 w-12 text-right">{it.count}</span>
                <span className="font-bold w-12 text-right" style={{ color: it.recoveryPct >= 70 ? '#059669' : it.recoveryPct >= 40 ? '#d97706' : '#dc2626' }}>{it.recoveryPct.toFixed(0)}%</span>
              </div>
              <div className="w-full h-1 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-rose-400 rounded-full" style={{ width: `${w}%` }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
