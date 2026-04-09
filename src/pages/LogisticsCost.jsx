import React, { useMemo, useState, useCallback } from 'react';
import { useData } from '../context/DataContext';
import { isRTO } from '../utils/index';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { BarChart, LineChart, PieChart } from '../components/Charts';
import { COLORS, groupBy, currency, percent } from '../utils/index';
import {
  IndianRupee, TrendingUp, TrendingDown, AlertTriangle, Package, MapPin,
  Layers, BarChart3, Brain, ChevronRight, X, Eye,
  Zap, Target, ArrowRightLeft, Lightbulb, ShieldAlert, Tag,
  Filter, RotateCcw, Calendar, Building2, ArrowUpRight, RotateCw, FileWarning,
} from 'lucide-react';

/* ─── constants ─── */
const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'zone', label: 'Zone Analysis', icon: MapPin },
  { key: 'platform', label: 'Platform Analysis', icon: Building2 },
  { key: 'matrix', label: 'Cost Matrix', icon: Layers },
  { key: 'insights', label: 'AI Insights', icon: Brain },
];

const FLOW_MODES = [
  { key: 'all', label: 'All', icon: Package },
  { key: 'forward', label: 'Forward', icon: ArrowUpRight },
  { key: 'rto', label: 'RTO', icon: RotateCw },
];

const HIGH_COST_THRESHOLD = 12;
const MEDIUM_COST_THRESHOLD = 8;
const ANOMALY_Z_THRESHOLD = 2;

/* ─── helpers ─── */
const fmt = (v) => (v != null && isFinite(v) ? v.toFixed(1) : '0.0');
const fmtPct = (v) => fmt(v) + '%';

function costColor(pct) {
  if (pct > HIGH_COST_THRESHOLD) return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'badge-red', tag: 'High Cost' };
  if (pct > MEDIUM_COST_THRESHOLD) return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'badge-yellow', tag: 'Needs Attention' };
  return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', badge: 'badge-green', tag: 'Optimized' };
}

function heatColor(pct, min, max) {
  if (min === max) return 'rgba(59,130,246,0.15)';
  const t = Math.min(1, Math.max(0, (pct - min) / (max - min)));
  const r = Math.round(34 + t * (220 - 34));
  const g = Math.round(197 + t * (38 - 197));
  const b = Math.round(94 + t * (38 - 94));
  return `rgba(${r},${g},${b},0.25)`;
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx) || 0;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function zScore(value, mean, std) { return std === 0 ? 0 : (value - mean) / std; }

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function sortMonths(arr) {
  const mAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return [...arr].sort((a, b) => {
    const aI = mAbbr.indexOf(a.slice(0,3)), bI = mAbbr.indexOf(b.slice(0,3));
    const aY = parseInt('20' + a.slice(4)) || 0, bY = parseInt('20' + b.slice(4)) || 0;
    return (aY * 100 + aI) - (bY * 100 + bI);
  });
}

function computeAggregates(rows) {
  const totalInv = rows.reduce((s, r) => s + r.invoiceNum, 0);
  const totalCost = rows.reduce((s, r) => s + r.costNum, 0);
  const avgCostPct = totalInv > 0 ? (totalCost / totalInv) * 100 : 0;
  return { totalInv, totalCost, avgCostPct, count: rows.length };
}

function computeGroupStats(rows, groupKey) {
  const groups = groupBy(rows, groupKey);
  return Object.entries(groups).map(([label, gRows]) => {
    const totalInv = gRows.reduce((s, r) => s + r.invoiceNum, 0);
    const totalCost = gRows.reduce((s, r) => s + r.costNum, 0);
    const costPct = totalInv > 0 ? (totalCost / totalInv) * 100 : 0;
    const pcts = gRows.map((r) => r.costPct);
    const months = {};
    for (const r of gRows) {
      if (!r.month) continue;
      if (!months[r.month]) months[r.month] = { inv: 0, cost: 0 };
      months[r.month].inv += r.invoiceNum;
      months[r.month].cost += r.costNum;
    }
    const monthTrend = Object.entries(months).map(([m, v]) => ({ month: m, pct: v.inv > 0 ? (v.cost / v.inv) * 100 : 0 }));
    return { label, totalInv, totalCost, costPct, count: gRows.length, std: stdDev(pcts), monthTrend, rows: gRows };
  }).sort((a, b) => b.costPct - a.costPct);
}

function computeMonthlyTrend(rows) {
  const groups = {};
  for (const r of rows) {
    if (!r.month) continue;
    if (!groups[r.month]) groups[r.month] = { inv: 0, cost: 0, count: 0 };
    groups[r.month].inv += r.invoiceNum;
    groups[r.month].cost += r.costNum;
    groups[r.month].count++;
  }
  return Object.entries(groups)
    .map(([month, v]) => ({ month, pct: v.inv > 0 ? (v.cost / v.inv) * 100 : 0, cost: v.cost, inv: v.inv, count: v.count }))
    .sort((a, b) => {
      const mAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const aI = mAbbr.indexOf(a.month.slice(0,3)), bI = mAbbr.indexOf(b.month.slice(0,3));
      const aY = parseInt('20' + a.month.slice(4)) || 0, bY = parseInt('20' + b.month.slice(4)) || 0;
      return (aY * 100 + aI) - (bY * 100 + bI);
    });
}

function computeMatrix(rows) {
  const zones = [...new Set(rows.map((r) => r.zone).filter(Boolean))].sort();
  const platforms = [...new Set(rows.map((r) => r.platform).filter(Boolean))].sort();
  const cells = {};
  let min = Infinity, max = -Infinity;
  for (const r of rows) {
    const key = `${r.zone}||${r.platform}`;
    if (!cells[key]) cells[key] = { inv: 0, cost: 0, count: 0, rows: [] };
    cells[key].inv += r.invoiceNum;
    cells[key].cost += r.costNum;
    cells[key].count++;
    cells[key].rows.push(r);
  }
  for (const c of Object.values(cells)) {
    c.pct = c.inv > 0 ? (c.cost / c.inv) * 100 : 0;
    if (c.pct < min) min = c.pct;
    if (c.pct > max) max = c.pct;
  }
  return { zones, platforms, cells, min, max };
}

/* ─── DRILL-DOWN MODAL ─── */
function DrillDownModal({ title, data, onClose }) {
  const columns = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'platform', label: 'Platform' },
    { key: 'vendor', label: 'Courier' },
    { key: 'zone', label: 'Zone' },
    { key: 'destination', label: 'Destination' },
    { key: 'invoiceValue', label: 'Invoice Value', render: (v) => currency(parseFloat(v) || 0) },
    { key: 'logisticsCost', label: 'Cost', render: (v) => currency(parseFloat(v) || 0) },
    { key: 'costPct', label: 'Cost %', render: (_, row) => {
      const pct = row.costPct || 0;
      const c = costColor(pct);
      return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>{fmtPct(pct)}</span>;
    }},
    { key: 'flowType', label: 'Type', render: (v) => (
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${v === 'RTO' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>{v}</span>
    )},
    { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking Date' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          <DataTable data={data} columns={columns} exportFilename="logistics-cost-drilldown" pageSize={25} />
        </div>
      </div>
    </div>
  );
}

/* ─── MINI SPARKLINE ─── */
function MiniSparkline({ values, color = '#3B82F6', width = 60, height = 20 }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

/* ─── INSIGHT CARD ─── */
function InsightCard({ icon: Icon, title, description, severity = 'info', onClick }) {
  const severityMap = {
    critical: { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-500', title: 'text-red-800' },
    warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-500', title: 'text-amber-800' },
    success: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-500', title: 'text-emerald-800' },
    info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-500', title: 'text-blue-800' },
  };
  const s = severityMap[severity] || severityMap.info;
  return (
    <button onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border ${s.border} ${s.bg} hover:shadow-md transition-all group`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5"><Icon className={`w-5 h-5 ${s.icon}`} /></div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-xs font-bold ${s.title}`}>{title}</h4>
          <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">{description}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 mt-0.5 flex-shrink-0" />
      </div>
    </button>
  );
}

/* ─── FORWARD vs RTO COMPARISON PANEL ─── */
function ForwardRtoCompare({ fwd, rto, label, onDrillDown }) {
  if (!fwd && !rto) return null;
  const fwdPct = fwd?.costPct ?? 0;
  const rtoPct = rto?.costPct ?? 0;
  const diff = rtoPct - fwdPct;
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-gray-600">{label}</h4>
        {diff !== 0 && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${diff > 0 ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
            RTO is {diff > 0 ? '+' : ''}{fmt(diff)}pp vs Forward
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-100">
        {[{ data: fwd, type: 'Forward', color: 'blue', icon: ArrowUpRight },
          { data: rto, type: 'RTO', color: 'orange', icon: RotateCw }].map(({ data, type, color, icon: Icon }) => (
          <button key={type} onClick={() => data && onDrillDown({ title: `${label} — ${type} (${data.count} orders)`, data: data.rows })}
            className="p-3 text-left hover:bg-gray-50/50 transition-colors">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className={`w-3.5 h-3.5 text-${color}-500`} />
              <span className={`text-[10px] font-bold text-${color}-600 uppercase`}>{type}</span>
            </div>
            {data ? (
              <>
                <p className={`text-lg font-bold ${costColor(data.costPct).text}`}>{fmtPct(data.costPct)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{data.count.toLocaleString('en-IN')} orders | {currency(data.totalCost)}</p>
                <div className="mt-1.5">
                  <MiniSparkline values={data.monthTrend?.map(m => m.pct) || []} color={data.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : '#3B82F6'} />
                </div>
              </>
            ) : (
              <p className="text-[10px] text-gray-300 mt-1">No data</p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */
export default function LogisticsCost() {
  const { data } = useData();
  const [activeTab, setActiveTab] = useState('overview');
  const [drillDown, setDrillDown] = useState(null);
  const [flowMode, setFlowMode] = useState('all');

  /* ─── filters ─── */
  const [filterZone, setFilterZone] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const clearLocalFilters = useCallback(() => {
    setFilterZone(''); setFilterPlatform(''); setFilterDateFrom(''); setFilterDateTo('');
  }, []);

  /* ─── base data with Forward/RTO tagging ─── */
  const allCostData = useMemo(() => {
    return data
      .map((r) => ({
        ...r,
        costNum: parseFloat(r.logisticsCost) || 0,
        invoiceNum: parseFloat(r.invoiceValue) || 0,
        flowType: isRTO(r.status) ? 'RTO' : 'Forward',
      }))
      .filter((r) => r.costNum > 0 && r.invoiceNum > 0)
      .filter((r) => {
        if (filterZone && r.zone !== filterZone) return false;
        if (filterPlatform && r.platform !== filterPlatform) return false;
        if (filterDateFrom) { const d = new Date(r.bookingDate); if (!isNaN(d) && d < new Date(filterDateFrom)) return false; }
        if (filterDateTo) { const d = new Date(r.bookingDate); if (!isNaN(d) && d > new Date(filterDateTo)) return false; }
        return true;
      })
      .map((r) => ({ ...r, costPct: (r.costNum / r.invoiceNum) * 100 }));
  }, [data, filterZone, filterPlatform, filterDateFrom, filterDateTo]);

  /* ─── split by flow mode ─── */
  const costData = useMemo(() => {
    if (flowMode === 'forward') return allCostData.filter((r) => r.flowType === 'Forward');
    if (flowMode === 'rto') return allCostData.filter((r) => r.flowType === 'RTO');
    return allCostData;
  }, [allCostData, flowMode]);

  const fwdData = useMemo(() => allCostData.filter((r) => r.flowType === 'Forward'), [allCostData]);
  const rtoData = useMemo(() => allCostData.filter((r) => r.flowType === 'RTO'), [allCostData]);

  /* ─── missing cost data (logistics cost blank/0/missing) ─── */
  const missingCostData = useMemo(() => {
    return data
      .filter((r) => {
        const cost = parseFloat(r.logisticsCost);
        const inv = parseFloat(r.invoiceValue) || 0;
        return (!cost || cost <= 0) && inv > 0;
      })
      .filter((r) => {
        if (filterZone && r.zone !== filterZone) return false;
        if (filterPlatform && r.platform !== filterPlatform) return false;
        if (filterDateFrom) { const d = new Date(r.bookingDate); if (!isNaN(d) && d < new Date(filterDateFrom)) return false; }
        if (filterDateTo) { const d = new Date(r.bookingDate); if (!isNaN(d) && d > new Date(filterDateTo)) return false; }
        return true;
      })
      .map((r) => ({ ...r, costNum: 0, invoiceNum: parseFloat(r.invoiceValue) || 0, costPct: 0, flowType: isRTO(r.status) ? 'RTO' : 'Forward' }));
  }, [data, filterZone, filterPlatform, filterDateFrom, filterDateTo]);

  /* ─── unique values for filter dropdowns ─── */
  const uniqueZones = useMemo(() => [...new Set(data.map((r) => r.zone).filter(Boolean))].sort(), [data]);
  const uniquePlatforms = useMemo(() => [...new Set(data.map((r) => r.platform).filter(Boolean))].sort(), [data]);

  /* ─── aggregate stats ─── */
  const totals = useMemo(() => computeAggregates(costData), [costData]);
  const fwdTotals = useMemo(() => computeAggregates(fwdData), [fwdData]);
  const rtoTotals = useMemo(() => computeAggregates(rtoData), [rtoData]);

  /* ─── zone/platform aggregates ─── */
  const zoneStats = useMemo(() => computeGroupStats(costData, 'zone'), [costData]);
  const platformStats = useMemo(() => computeGroupStats(costData, 'platform'), [costData]);
  const fwdZoneStats = useMemo(() => computeGroupStats(fwdData, 'zone'), [fwdData]);
  const rtoZoneStats = useMemo(() => computeGroupStats(rtoData, 'zone'), [rtoData]);
  const fwdPlatStats = useMemo(() => computeGroupStats(fwdData, 'platform'), [fwdData]);
  const rtoPlatStats = useMemo(() => computeGroupStats(rtoData, 'platform'), [rtoData]);

  /* ─── monthly trend ─── */
  const monthlyTrend = useMemo(() => computeMonthlyTrend(costData), [costData]);
  const fwdMonthly = useMemo(() => computeMonthlyTrend(fwdData), [fwdData]);
  const rtoMonthly = useMemo(() => computeMonthlyTrend(rtoData), [rtoData]);

  /* ─── matrix ─── */
  const matrixData = useMemo(() => computeMatrix(costData), [costData]);

  /* ─── anomalies ─── */
  const anomalies = useMemo(() => {
    const results = [];
    const allPcts = costData.map((r) => r.costPct);
    const globalMean = allPcts.length ? allPcts.reduce((a, b) => a + b, 0) / allPcts.length : 0;
    const globalStd = stdDev(allPcts);

    for (const z of zoneStats) {
      const zs = zScore(z.costPct, globalMean, globalStd);
      if (Math.abs(zs) > ANOMALY_Z_THRESHOLD) {
        results.push({ type: 'zone', label: z.label, costPct: z.costPct, zScore: zs, count: z.count,
          severity: zs > 3 ? 'critical' : 'warning',
          message: `${z.label} has ${fmtPct(z.costPct)} logistics cost (${fmt(Math.abs(zs))} std dev ${zs > 0 ? 'above' : 'below'} avg)`, rows: z.rows });
      }
    }
    for (const p of platformStats) {
      const zs = zScore(p.costPct, globalMean, globalStd);
      if (Math.abs(zs) > ANOMALY_Z_THRESHOLD) {
        results.push({ type: 'platform', label: p.label, costPct: p.costPct, zScore: zs, count: p.count,
          severity: zs > 3 ? 'critical' : 'warning',
          message: `${p.label} has ${fmtPct(p.costPct)} logistics cost (${fmt(Math.abs(zs))} std dev ${zs > 0 ? 'above' : 'below'} avg)`, rows: p.rows });
      }
    }
    const orderAnomalies = costData.filter((r) => Math.abs(zScore(r.costPct, globalMean, globalStd)) > ANOMALY_Z_THRESHOLD)
      .sort((a, b) => b.costPct - a.costPct).slice(0, 10);
    if (orderAnomalies.length > 0) {
      results.push({ type: 'orders', label: 'High-cost Orders', costPct: orderAnomalies[0].costPct, count: orderAnomalies.length,
        severity: 'warning', message: `${orderAnomalies.length} orders have abnormally high cost % (up to ${fmtPct(orderAnomalies[0].costPct)})`, rows: orderAnomalies });
    }
    for (const [key, cell] of Object.entries(matrixData.cells)) {
      if (cell.count < 3) continue;
      const zs = zScore(cell.pct, globalMean, globalStd);
      if (zs > ANOMALY_Z_THRESHOLD) {
        const [zone, platform] = key.split('||');
        results.push({ type: 'combo', label: `${zone} via ${platform}`, costPct: cell.pct, zScore: zs, count: cell.count,
          severity: zs > 3 ? 'critical' : 'warning',
          message: `Orders in ${zone} via ${platform} have ${fmtPct(cell.pct)} cost — ${fmt(Math.abs(zs))} std dev above avg`, rows: cell.rows });
      }
    }

    // RTO vs Forward anomaly
    if (rtoTotals.count > 5 && fwdTotals.count > 5 && rtoTotals.avgCostPct > fwdTotals.avgCostPct * 1.5) {
      results.push({ type: 'flow', label: 'RTO Cost Premium', costPct: rtoTotals.avgCostPct, count: rtoTotals.count,
        severity: rtoTotals.avgCostPct > fwdTotals.avgCostPct * 2 ? 'critical' : 'warning',
        message: `RTO shipments cost ${fmtPct(rtoTotals.avgCostPct)} vs Forward at ${fmtPct(fwdTotals.avgCostPct)} — ${fmt((rtoTotals.avgCostPct / fwdTotals.avgCostPct - 1) * 100)}% premium. Reducing RTO rate could save ${currency(rtoTotals.totalCost * 0.3)}.`,
        rows: rtoData });
    }

    return results.sort((a, b) => (b.zScore || b.costPct) - (a.zScore || a.costPct));
  }, [costData, zoneStats, platformStats, matrixData, fwdTotals, rtoTotals, rtoData]);

  /* ─── recommendations ─── */
  const recommendations = useMemo(() => {
    const recs = [];
    if (platformStats.length < 2) return recs;
    const sorted = [...platformStats].sort((a, b) => a.costPct - b.costPct);
    const best = sorted[0]; const worst = sorted[sorted.length - 1];

    if (worst && best && worst.costPct > best.costPct * 1.3) {
      const savings = ((worst.costPct - best.costPct) / worst.costPct * 100).toFixed(0);
      recs.push({ icon: ArrowRightLeft, title: `Shift volume from ${worst.label} to ${best.label}`,
        description: `${worst.label} costs ${fmtPct(worst.costPct)} vs ${best.label} at ${fmtPct(best.costPct)}. Shifting 30% volume could reduce cost by ~${savings}%.`, severity: 'info' });
    }
    const highZones = zoneStats.filter((z) => z.costPct > HIGH_COST_THRESHOLD);
    const lowZones = zoneStats.filter((z) => z.costPct <= MEDIUM_COST_THRESHOLD);
    for (const hz of highZones.slice(0, 2)) {
      if (lowZones.length > 0) {
        recs.push({ icon: MapPin, title: `Optimize routing for ${hz.label}`,
          description: `${hz.label} has ${fmtPct(hz.costPct)} cost with ${hz.count} shipments. Consider strategy similar to ${lowZones[0].label} (${fmtPct(lowZones[0].costPct)}).`, severity: 'warning' });
      }
    }
    if (monthlyTrend.length >= 3) {
      const recent = monthlyTrend.slice(-3);
      const trend = recent[recent.length - 1].pct - recent[0].pct;
      if (trend > 2) recs.push({ icon: TrendingUp, title: 'Rising cost trend detected',
        description: `Cost % increased by ${fmt(trend)}pp over last 3 months. Review vendor contracts.`, severity: 'critical' });
      else if (trend < -2) recs.push({ icon: TrendingDown, title: 'Cost optimization is working',
        description: `Cost % decreased by ${fmt(Math.abs(trend))}pp over last 3 months. Continue current strategy.`, severity: 'success' });
    }
    // RTO-specific recommendation
    if (rtoTotals.count > 10 && rtoTotals.avgCostPct > fwdTotals.avgCostPct * 1.3) {
      recs.push({ icon: RotateCw, title: 'Reduce RTO to cut logistics cost',
        description: `RTO shipments average ${fmtPct(rtoTotals.avgCostPct)} cost vs ${fmtPct(fwdTotals.avgCostPct)} for Forward. ${rtoTotals.count} RTO orders cost ${currency(rtoTotals.totalCost)} — reducing RTO rate by 20% could save ~${currency(rtoTotals.totalCost * 0.2)}.`,
        severity: 'warning' });
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const diff = ((sorted[j].costPct - sorted[i].costPct) / sorted[i].costPct * 100);
        if (diff > 15 && sorted[j].count > 10) {
          recs.push({ icon: Lightbulb, title: `${sorted[j].label} is ${diff.toFixed(0)}% more expensive than ${sorted[i].label}`,
            description: `${sorted[j].label} (${fmtPct(sorted[j].costPct)}, ${sorted[j].count} shipments) vs ${sorted[i].label} (${fmtPct(sorted[i].costPct)}, ${sorted[i].count} shipments).`, severity: 'info' });
          break;
        }
      }
      if (recs.length >= 7) break;
    }
    return recs;
  }, [platformStats, zoneStats, monthlyTrend, fwdTotals, rtoTotals]);

  /* ─── predictions ─── */
  const predictions = useMemo(() => {
    if (monthlyTrend.length < 3) return null;
    const points = monthlyTrend.map((m, i) => ({ x: i, y: m.pct }));
    const { slope, intercept } = linearRegression(points);
    const next3 = [1, 2, 3].map((offset) => ({ month: `+${offset}M`, pct: Math.max(0, slope * (points.length - 1 + offset) + intercept) }));
    return { slope, intercept, next3, direction: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable' };
  }, [monthlyTrend]);

  const bestZone = useMemo(() => zoneStats.length ? zoneStats[zoneStats.length - 1] : null, [zoneStats]);
  const worstPlatform = useMemo(() => platformStats.length ? platformStats[0] : null, [platformStats]);
  const savingsOpportunity = useMemo(() => {
    if (!bestZone || zoneStats.length < 2) return 0;
    return zoneStats.filter((z) => z.costPct > bestZone.costPct)
      .reduce((s, z) => s + (z.costPct - bestZone.costPct) / 100 * z.totalInv, 0);
  }, [zoneStats, bestZone]);

  const hasFilters = filterZone || filterPlatform || filterDateFrom || filterDateTo;

  /* ═══ RENDER ═══ */
  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === t.key ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        {FLOW_MODES.map((f) => {
          const Icon = f.icon;
          const active = flowMode === f.key;
          return (
            <button key={f.key} onClick={() => setFlowMode(f.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                active
                  ? f.key === 'rto' ? 'bg-orange-500 text-white shadow-sm' : f.key === 'forward' ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-700 text-white shadow-sm'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200'}`}>
              <Icon className="w-3 h-3" />{f.label}
              {f.key === 'forward' && <span className="text-[9px] opacity-70 ml-0.5">({fwdData.length})</span>}
              {f.key === 'rto' && <span className="text-[9px] opacity-70 ml-0.5">({rtoData.length})</span>}
            </button>
          );
        })}
      </div>

      {/* Filters Bar */}
      <div className="bg-white rounded-xl border border-gray-100 px-4 py-2.5 flex flex-wrap items-center gap-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        <select value={filterZone} onChange={(e) => setFilterZone(e.target.value)} className="filter-select text-[11px] px-2 py-1 min-w-[100px]">
          <option value="">All Zones</option>
          {uniqueZones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)} className="filter-select text-[11px] px-2 py-1 min-w-[100px]">
          <option value="">All Platforms</option>
          {uniquePlatforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3 text-gray-400" />
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="filter-input text-[11px] px-2 py-1 w-[120px]" />
          <span className="text-gray-400 text-[10px]">to</span>
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="filter-input text-[11px] px-2 py-1 w-[120px]" />
        </div>
        {hasFilters && (
          <button onClick={clearLocalFilters} className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">
          {costData.length.toLocaleString('en-IN')} orders
          {flowMode === 'all' && ` (${fwdData.length} fwd + ${rtoData.length} rto)`}
          {missingCostData.length > 0 && <span className="text-amber-500 ml-1">| {missingCostData.length} cost not entered</span>}
        </span>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab costData={costData} totals={totals} fwdTotals={fwdTotals} rtoTotals={rtoTotals}
          zoneStats={zoneStats} platformStats={platformStats} fwdZoneStats={fwdZoneStats} rtoZoneStats={rtoZoneStats}
          fwdPlatStats={fwdPlatStats} rtoPlatStats={rtoPlatStats}
          monthlyTrend={monthlyTrend} fwdMonthly={fwdMonthly} rtoMonthly={rtoMonthly}
          bestZone={bestZone} worstPlatform={worstPlatform} savingsOpportunity={savingsOpportunity}
          anomalies={anomalies} predictions={predictions} flowMode={flowMode}
          missingCostData={missingCostData} onDrillDown={setDrillDown} />
      )}
      {activeTab === 'zone' && (
        <ZoneAnalysisTab zoneStats={zoneStats} fwdZoneStats={fwdZoneStats} rtoZoneStats={rtoZoneStats}
          totals={totals} flowMode={flowMode} onDrillDown={setDrillDown} />
      )}
      {activeTab === 'platform' && (
        <PlatformAnalysisTab platformStats={platformStats} fwdPlatStats={fwdPlatStats} rtoPlatStats={rtoPlatStats}
          monthlyTrend={monthlyTrend} totals={totals} flowMode={flowMode} onDrillDown={setDrillDown} />
      )}
      {activeTab === 'matrix' && <CostMatrixTab matrixData={matrixData} onDrillDown={setDrillDown} />}
      {activeTab === 'insights' && (
        <AIInsightsTab anomalies={anomalies} recommendations={recommendations} predictions={predictions}
          monthlyTrend={monthlyTrend} fwdMonthly={fwdMonthly} rtoMonthly={rtoMonthly}
          zoneStats={zoneStats} platformStats={platformStats} fwdTotals={fwdTotals} rtoTotals={rtoTotals}
          matrixData={matrixData} onDrillDown={setDrillDown} />
      )}

      {drillDown && <DrillDownModal title={drillDown.title} data={drillDown.data} onClose={() => setDrillDown(null)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB: OVERVIEW
   ═══════════════════════════════════════════ */
function OverviewTab({ costData, totals, fwdTotals, rtoTotals, zoneStats, platformStats,
  fwdZoneStats, rtoZoneStats, fwdPlatStats, rtoPlatStats,
  monthlyTrend, fwdMonthly, rtoMonthly, bestZone, worstPlatform, savingsOpportunity,
  anomalies, predictions, flowMode, missingCostData, onDrillDown }) {

  const [showMissing, setShowMissing] = useState(false);

  /* group missing by platform for summary */
  const missingByPlatform = useMemo(() => {
    const groups = {};
    for (const r of (missingCostData || [])) {
      const p = r.platform || 'Unknown';
      if (!groups[p]) groups[p] = { count: 0, totalInv: 0, fwd: 0, rto: 0 };
      groups[p].count++;
      groups[p].totalInv += r.invoiceNum;
      if (r.flowType === 'RTO') groups[p].rto++; else groups[p].fwd++;
    }
    return Object.entries(groups).sort((a, b) => b[1].count - a[1].count);
  }, [missingCostData]);

  return (
    <div className="space-y-4">
      {/* Logistics Cost Not Entered Alert */}
      {missingCostData && missingCostData.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <button onClick={() => setShowMissing(!showMissing)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100/50 transition-colors text-left">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg"><FileWarning className="w-5 h-5 text-amber-600" /></div>
              <div>
                <h3 className="text-sm font-bold text-amber-800">Logistics Cost Not Entered</h3>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  <strong>{missingCostData.length.toLocaleString('en-IN')}</strong> orders have blank or zero logistics cost
                  — excluded from all calculations to prevent incorrect data.
                  Invoice value at risk: <strong>{currency(missingCostData.reduce((s, r) => s + r.invoiceNum, 0))}</strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-lg">
                {missingCostData.filter(r => r.flowType === 'Forward').length} Fwd + {missingCostData.filter(r => r.flowType === 'RTO').length} RTO
              </span>
              <ChevronRight className={`w-4 h-4 text-amber-400 transition-transform ${showMissing ? 'rotate-90' : ''}`} />
            </div>
          </button>
          {showMissing && (
            <div className="border-t border-amber-200 p-4 space-y-3">
              {/* Summary by platform */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {missingByPlatform.map(([platform, info]) => (
                  <div key={platform} className="bg-white/70 rounded-lg p-2.5 border border-amber-100">
                    <p className="text-[10px] font-semibold text-gray-600 truncate">{platform}</p>
                    <p className="text-sm font-bold text-amber-800 mt-0.5">{info.count}</p>
                    <p className="text-[9px] text-gray-400">{info.fwd} fwd + {info.rto} rto</p>
                    <p className="text-[9px] text-amber-600 mt-0.5">{currency(info.totalInv)} invoice</p>
                  </div>
                ))}
              </div>
              {/* View full table */}
              <button onClick={() => onDrillDown({ title: `Logistics Cost Not Entered — ${missingCostData.length} orders`, data: missingCostData })}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors">
                <Eye className="w-3.5 h-3.5" /> View all {missingCostData.length.toLocaleString('en-IN')} orders with missing cost
              </button>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Avg Cost %" value={fmtPct(totals.avgCostPct)} icon={IndianRupee} color="blue" subtitle={`${totals.count} orders`} />
        <KPICard title="Best Zone" value={bestZone ? bestZone.label : '-'} icon={MapPin} color="green" subtitle={bestZone ? fmtPct(bestZone.costPct) : ''} />
        <KPICard title="Worst Platform" value={worstPlatform ? worstPlatform.label : '-'} icon={Building2} color="red" subtitle={worstPlatform ? fmtPct(worstPlatform.costPct) : ''} />
        <KPICard title="Savings Opportunity" value={currency(savingsOpportunity)} icon={Target} color="purple" />
      </div>

      {/* Forward vs RTO Summary Strip */}
      {fwdTotals.count > 0 && rtoTotals.count > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl border border-blue-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-blue-500" />
              <span className="text-[11px] font-bold text-blue-700 uppercase">Forward Shipments</span>
            </div>
            <p className="text-2xl font-bold text-blue-800">{fmtPct(fwdTotals.avgCostPct)}</p>
            <p className="text-[10px] text-blue-500 mt-0.5">{fwdTotals.count.toLocaleString('en-IN')} orders | {currency(fwdTotals.totalCost)} cost</p>
          </div>
          <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-xl border border-orange-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <RotateCw className="w-4 h-4 text-orange-500" />
              <span className="text-[11px] font-bold text-orange-700 uppercase">RTO Shipments</span>
            </div>
            <p className="text-2xl font-bold text-orange-800">{fmtPct(rtoTotals.avgCostPct)}</p>
            <p className="text-[10px] text-orange-500 mt-0.5">{rtoTotals.count.toLocaleString('en-IN')} orders | {currency(rtoTotals.totalCost)} cost</p>
          </div>
          <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowRightLeft className="w-4 h-4 text-gray-500" />
              <span className="text-[11px] font-bold text-gray-600 uppercase">RTO Premium</span>
            </div>
            <p className={`text-2xl font-bold ${rtoTotals.avgCostPct > fwdTotals.avgCostPct ? 'text-red-600' : 'text-emerald-600'}`}>
              {rtoTotals.avgCostPct > fwdTotals.avgCostPct ? '+' : ''}{fmt(rtoTotals.avgCostPct - fwdTotals.avgCostPct)}pp
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              RTO is {fmt(Math.abs((rtoTotals.avgCostPct / fwdTotals.avgCostPct - 1) * 100))}% {rtoTotals.avgCostPct > fwdTotals.avgCostPct ? 'more expensive' : 'cheaper'}
            </p>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="chart-container">
          <BarChart title="Zone-wise Cost %" labels={zoneStats.map((z) => z.label)}
            datasets={[{ label: 'Cost %', data: zoneStats.map((z) => parseFloat(z.costPct.toFixed(1))),
              backgroundColor: zoneStats.map((z) => z.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : z.costPct > MEDIUM_COST_THRESHOLD ? '#F59E0B' : '#10B981') }]}
            height={220}
            options={{ onClick: (_, els) => { if (els.length > 0) { const z = zoneStats[els[0].index]; if (z) onDrillDown({ title: `Zone: ${z.label} — ${z.count} orders`, data: z.rows }); } } }}
          />
        </div>
        <div className="chart-container">
          <LineChart title="Cost % Trend — Forward vs RTO"
            labels={(() => {
              const allM = new Set([...fwdMonthly.map(m => m.month), ...rtoMonthly.map(m => m.month)]);
              return sortMonths([...allM]);
            })()}
            datasets={[
              { label: 'Forward', data: (() => { const map = {}; fwdMonthly.forEach(m => { map[m.month] = m.pct; }); const allM = sortMonths([...new Set([...fwdMonthly.map(m => m.month), ...rtoMonthly.map(m => m.month)])]); return allM.map(m => map[m] != null ? parseFloat(map[m].toFixed(1)) : null); })(), color: '#3B82F6', fill: true },
              { label: 'RTO', data: (() => { const map = {}; rtoMonthly.forEach(m => { map[m.month] = m.pct; }); const allM = sortMonths([...new Set([...fwdMonthly.map(m => m.month), ...rtoMonthly.map(m => m.month)])]); return allM.map(m => map[m] != null ? parseFloat(map[m].toFixed(1)) : null); })(), color: '#F97316' },
            ]}
            height={220}
          />
        </div>
        <div className="chart-container">
          <PieChart title="Platform Cost Distribution" labels={platformStats.slice(0, 8).map((p) => p.label)}
            data={platformStats.slice(0, 8).map((p) => parseFloat(p.totalCost.toFixed(0)))} height={220} />
        </div>
      </div>

      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" /> Cost Efficiency Alerts ({anomalies.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {anomalies.slice(0, 6).map((a, i) => (
              <button key={i} onClick={() => onDrillDown({ title: `Anomaly: ${a.label}`, data: a.rows })}
                className="flex items-center gap-2 p-2.5 bg-white/80 rounded-lg border border-red-100 hover:shadow-md transition-all text-left">
                <ShieldAlert className={`w-4 h-4 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-gray-800 truncate">{a.label}</p>
                  <p className="text-[10px] text-gray-500">{fmtPct(a.costPct)} cost — {a.count} orders</p>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${costColor(a.costPct).bg} ${costColor(a.costPct).text}`}>
                  {costColor(a.costPct).tag}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top 5 with Forward/RTO side-by-side comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Top 5 Highest Cost Zones</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {zoneStats.slice(0, 5).map((z) => {
              const c = costColor(z.costPct);
              const fwd = fwdZoneStats.find(f => f.label === z.label);
              const rto = rtoZoneStats.find(r => r.label === z.label);
              return (
                <button key={z.label} onClick={() => onDrillDown({ title: `Zone: ${z.label}`, data: z.rows })}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors text-left">
                  <div>
                    <span className="text-xs font-medium text-gray-800">{z.label}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {fwd && <span className="text-[9px] text-blue-500">Fwd: {fmtPct(fwd.costPct)}</span>}
                      {rto && <span className="text-[9px] text-orange-500">RTO: {fmtPct(rto.costPct)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MiniSparkline values={z.monthTrend.map((m) => m.pct)} color={z.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : '#3B82F6'} />
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${c.bg} ${c.text}`}>{fmtPct(z.costPct)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Top 5 Highest Cost Platforms</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {platformStats.slice(0, 5).map((p) => {
              const c = costColor(p.costPct);
              const fwd = fwdPlatStats.find(f => f.label === p.label);
              const rto = rtoPlatStats.find(r => r.label === p.label);
              return (
                <button key={p.label} onClick={() => onDrillDown({ title: `Platform: ${p.label}`, data: p.rows })}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors text-left">
                  <div>
                    <span className="text-xs font-medium text-gray-800">{p.label}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {fwd && <span className="text-[9px] text-blue-500">Fwd: {fmtPct(fwd.costPct)}</span>}
                      {rto && <span className="text-[9px] text-orange-500">RTO: {fmtPct(rto.costPct)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MiniSparkline values={p.monthTrend.map((m) => m.pct)} color={p.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : '#3B82F6'} />
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${c.bg} ${c.text}`}>{fmtPct(p.costPct)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB: ZONE ANALYSIS
   ═══════════════════════════════════════════ */
function ZoneAnalysisTab({ zoneStats, fwdZoneStats, rtoZoneStats, totals, flowMode, onDrillDown }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KPICard title="Total Zones" value={zoneStats.length} icon={MapPin} color="blue" />
        <KPICard title="High Cost Zones" value={zoneStats.filter((z) => z.costPct > HIGH_COST_THRESHOLD).length} icon={AlertTriangle} color="red" subtitle={`>${HIGH_COST_THRESHOLD}%`} />
        <KPICard title="Efficient Zones" value={zoneStats.filter((z) => z.costPct <= MEDIUM_COST_THRESHOLD).length} icon={Target} color="green" subtitle={`<${MEDIUM_COST_THRESHOLD}%`} />
      </div>

      {/* Zone Chart */}
      <div className="chart-container">
        <BarChart title="Zone-wise Logistics Cost %" labels={zoneStats.map((z) => z.label)}
          datasets={[{ label: 'Cost %', data: zoneStats.map((z) => parseFloat(z.costPct.toFixed(1))),
            backgroundColor: zoneStats.map((z) => z.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : z.costPct > MEDIUM_COST_THRESHOLD ? '#F59E0B' : '#10B981') }]}
          height={240}
          options={{ onClick: (_, els) => { if (els.length > 0) { const z = zoneStats[els[0].index]; if (z) onDrillDown({ title: `Zone: ${z.label} — ${z.count} orders`, data: z.rows }); } } }}
        />
      </div>

      {/* Forward vs RTO Zone Comparison */}
      {flowMode === 'all' && fwdZoneStats.length > 0 && rtoZoneStats.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-indigo-500" /> Forward vs RTO — Zone Comparison
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {zoneStats.slice(0, 6).map((z) => {
              const fwd = fwdZoneStats.find(f => f.label === z.label);
              const rto = rtoZoneStats.find(r => r.label === z.label);
              return <ForwardRtoCompare key={z.label} fwd={fwd} rto={rto} label={z.label} onDrillDown={onDrillDown} />;
            })}
          </div>
        </div>
      )}

      {/* Zone Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Zone-wise Breakdown</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Click any zone to drill down</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Zone</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Shipments</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Invoice Value</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Cost</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Cost %</th>
                {flowMode === 'all' && <>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-blue-500 uppercase">Fwd %</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-orange-500 uppercase">RTO %</th>
                </>}
                <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Trend</th>
                <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Tag</th>
                <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {zoneStats.map((z) => {
                const c = costColor(z.costPct);
                const isExp = expanded === z.label;
                const fwd = fwdZoneStats.find(f => f.label === z.label);
                const rto = rtoZoneStats.find(r => r.label === z.label);
                return (
                  <React.Fragment key={z.label}>
                    <tr className={`hover:bg-gray-50 cursor-pointer ${c.bg}`} onClick={() => setExpanded(isExp ? null : z.label)}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{z.label}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{z.count.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{currency(z.totalInv)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{currency(z.totalCost)}</td>
                      <td className="px-4 py-2.5 text-right"><span className={`font-bold ${c.text}`}>{fmtPct(z.costPct)}</span></td>
                      {flowMode === 'all' && <>
                        <td className="px-4 py-2.5 text-right text-blue-600 text-[11px]">{fwd ? fmtPct(fwd.costPct) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-orange-600 text-[11px]">{rto ? fmtPct(rto.costPct) : '—'}</td>
                      </>}
                      <td className="px-4 py-2.5 text-center"><MiniSparkline values={z.monthTrend.map(m => m.pct)} color={z.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : '#3B82F6'} /></td>
                      <td className="px-4 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${c.bg} ${c.text} border ${c.border}`}>{c.tag}</span></td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={(e) => { e.stopPropagation(); onDrillDown({ title: `Zone: ${z.label}`, data: z.rows }); }}
                          className="p-1 rounded hover:bg-blue-100 text-blue-500"><Eye className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                    {isExp && z.monthTrend.length > 0 && (
                      <tr><td colSpan={flowMode === 'all' ? 10 : 8} className="px-4 py-3 bg-gray-50/50">
                        <div className="max-w-md">
                          <BarChart title={`${z.label} — Monthly Cost %`} labels={z.monthTrend.map(m => m.month)}
                            datasets={[{ label: 'Cost %', data: z.monthTrend.map(m => parseFloat(m.pct.toFixed(1))), color: '#3B82F6' }]} height={140} />
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB: PLATFORM ANALYSIS
   ═══════════════════════════════════════════ */
function PlatformAnalysisTab({ platformStats, fwdPlatStats, rtoPlatStats, monthlyTrend, totals, flowMode, onDrillDown }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KPICard title="Total Platforms" value={platformStats.length} icon={Building2} color="blue" />
        <KPICard title="Most Expensive" value={platformStats[0]?.label || '-'} icon={TrendingUp} color="red" subtitle={platformStats[0] ? fmtPct(platformStats[0].costPct) : ''} />
        <KPICard title="Most Efficient" value={platformStats[platformStats.length - 1]?.label || '-'} icon={TrendingDown} color="green"
          subtitle={platformStats[platformStats.length - 1] ? fmtPct(platformStats[platformStats.length - 1].costPct) : ''} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart title="Platform-wise Cost %" labels={platformStats.map(p => p.label)}
            datasets={[{ label: 'Cost %', data: platformStats.map(p => parseFloat(p.costPct.toFixed(1))),
              backgroundColor: platformStats.map(p => p.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : p.costPct > MEDIUM_COST_THRESHOLD ? '#F59E0B' : '#10B981') }]}
            height={240}
            options={{ onClick: (_, els) => { if (els.length > 0) { const p = platformStats[els[0].index]; if (p) onDrillDown({ title: `Platform: ${p.label}`, data: p.rows }); } } }}
          />
        </div>
        <div className="chart-container">
          {platformStats.length > 0 && (() => {
            const allMonths = new Set();
            platformStats.forEach(p => p.monthTrend.forEach(m => allMonths.add(m.month)));
            const sorted = sortMonths([...allMonths]);
            return (
              <LineChart title="Platform Cost Trend Over Time" labels={sorted}
                datasets={platformStats.slice(0, 5).map((p, i) => {
                  const map = {}; p.monthTrend.forEach(m => { map[m.month] = m.pct; });
                  return { label: p.label, data: sorted.map(m => map[m] != null ? parseFloat(map[m].toFixed(1)) : null), color: COLORS[i] };
                })} height={240} />
            );
          })()}
        </div>
      </div>

      {/* Forward vs RTO Platform Comparison */}
      {flowMode === 'all' && fwdPlatStats.length > 0 && rtoPlatStats.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-indigo-500" /> Forward vs RTO — Platform Comparison
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {platformStats.slice(0, 6).map((p) => {
              const fwd = fwdPlatStats.find(f => f.label === p.label);
              const rto = rtoPlatStats.find(r => r.label === p.label);
              return <ForwardRtoCompare key={p.label} fwd={fwd} rto={rto} label={p.label} onDrillDown={onDrillDown} />;
            })}
          </div>
        </div>
      )}

      {/* AI Comparison Insights */}
      {platformStats.length >= 2 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2 mb-3"><Brain className="w-4 h-4" /> AI Platform Comparison</h3>
          <div className="space-y-2">
            {(() => {
              const insights = [];
              const sorted = [...platformStats].sort((a, b) => a.costPct - b.costPct);
              for (let i = 0; i < sorted.length - 1; i++) {
                const diff = ((sorted[i + 1].costPct - sorted[i].costPct) / sorted[i].costPct * 100);
                if (diff > 10) {
                  insights.push(
                    <div key={i} className="flex items-start gap-2 p-2 bg-white/60 rounded-lg">
                      <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] text-gray-700">
                        <strong>{sorted[i + 1].label}</strong> is <strong>{diff.toFixed(0)}%</strong> more expensive than <strong>{sorted[i].label}</strong>
                        ({fmtPct(sorted[i + 1].costPct)} vs {fmtPct(sorted[i].costPct)}).
                      </p>
                    </div>
                  );
                }
                if (insights.length >= 4) break;
              }
              return insights.length > 0 ? insights : <p className="text-[11px] text-gray-500">All platforms have similar cost efficiency.</p>;
            })()}
          </div>
        </div>
      )}

      {/* Platform Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Platform Comparison Table</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase">Platform</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Volume</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Invoice Value</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Cost</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Cost %</th>
                {flowMode === 'all' && <>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-blue-500 uppercase">Fwd %</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-orange-500 uppercase">RTO %</th>
                </>}
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Avg/Ship</th>
                <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Trend</th>
                <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Tag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {platformStats.map((p) => {
                const c = costColor(p.costPct);
                const fwd = fwdPlatStats.find(f => f.label === p.label);
                const rto = rtoPlatStats.find(r => r.label === p.label);
                return (
                  <tr key={p.label} className={`hover:bg-gray-50 cursor-pointer ${c.bg}`} onClick={() => onDrillDown({ title: `Platform: ${p.label}`, data: p.rows })}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{p.label}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{p.count.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{currency(p.totalInv)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{currency(p.totalCost)}</td>
                    <td className="px-4 py-2.5 text-right"><span className={`font-bold ${c.text}`}>{fmtPct(p.costPct)}</span></td>
                    {flowMode === 'all' && <>
                      <td className="px-4 py-2.5 text-right text-blue-600 text-[11px]">{fwd ? fmtPct(fwd.costPct) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-orange-600 text-[11px]">{rto ? fmtPct(rto.costPct) : '—'}</td>
                    </>}
                    <td className="px-4 py-2.5 text-right text-gray-600">{currency(p.totalCost / p.count)}</td>
                    <td className="px-4 py-2.5 text-center"><MiniSparkline values={p.monthTrend.map(m => m.pct)} color={p.costPct > HIGH_COST_THRESHOLD ? '#EF4444' : '#3B82F6'} /></td>
                    <td className="px-4 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${c.bg} ${c.text} border ${c.border}`}>{c.tag}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB: COST MATRIX
   ═══════════════════════════════════════════ */
function CostMatrixTab({ matrixData, onDrillDown }) {
  const { zones, platforms, cells, min, max } = matrixData;
  if (zones.length === 0 || platforms.length === 0) {
    return <div className="text-center text-gray-400 py-12 text-sm">No data available for the cost matrix.</div>;
  }
  const zoneTotals = {}; const platTotals = {};
  for (const z of zones) { let inv = 0, cost = 0; for (const p of platforms) { const c = cells[`${z}||${p}`]; if (c) { inv += c.inv; cost += c.cost; } } zoneTotals[z] = inv > 0 ? (cost / inv) * 100 : 0; }
  for (const p of platforms) { let inv = 0, cost = 0; for (const z of zones) { const c = cells[`${z}||${p}`]; if (c) { inv += c.inv; cost += c.cost; } } platTotals[p] = inv > 0 ? (cost / inv) * 100 : 0; }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Zone x Platform Cost Matrix</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Heatmap of Logistics Cost % — click any cell for order details</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left text-[10px] font-bold text-gray-600 uppercase sticky left-0 bg-gray-50 z-10">Zone \ Platform</th>
                {platforms.map(p => <th key={p} className="px-3 py-2.5 text-center text-[10px] font-semibold text-gray-600 uppercase whitespace-nowrap">{p}</th>)}
                <th className="px-3 py-2.5 text-center text-[10px] font-bold text-gray-700 uppercase bg-gray-100">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {zones.map(z => (
                <tr key={z} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-800 text-[11px] sticky left-0 bg-white z-10 border-r border-gray-100">{z}</td>
                  {platforms.map(p => {
                    const cell = cells[`${z}||${p}`];
                    if (!cell || cell.count === 0) return <td key={p} className="px-3 py-2 text-center text-[10px] text-gray-300">—</td>;
                    const c = costColor(cell.pct);
                    return (
                      <td key={p} className="px-2 py-1.5 text-center">
                        <button onClick={() => onDrillDown({ title: `${z} via ${p} — ${cell.count} orders`, data: cell.rows })}
                          className="w-full px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:shadow-md hover:scale-105"
                          style={{ backgroundColor: heatColor(cell.pct, min, max) }}>
                          <span className={c.text}>{fmtPct(cell.pct)}</span><br />
                          <span className="text-[9px] font-normal text-gray-500">{cell.count} orders</span>
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center bg-gray-50"><span className={`text-[11px] font-bold ${costColor(zoneTotals[z]).text}`}>{fmtPct(zoneTotals[z])}</span></td>
                </tr>
              ))}
              <tr className="bg-gray-100 border-t-2 border-gray-200">
                <td className="px-3 py-2 font-bold text-gray-700 text-[11px] sticky left-0 bg-gray-100 z-10">Total</td>
                {platforms.map(p => <td key={p} className="px-3 py-2 text-center"><span className={`text-[11px] font-bold ${costColor(platTotals[p]).text}`}>{fmtPct(platTotals[p])}</span></td>)}
                <td className="px-3 py-2 text-center bg-gray-200">
                  <span className="text-[11px] font-bold text-gray-800">{fmtPct((() => { let inv = 0, cost = 0; for (const c of Object.values(cells)) { inv += c.inv; cost += c.cost; } return inv > 0 ? (cost / inv) * 100 : 0; })())}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center gap-4 px-4 py-2 bg-white rounded-lg border border-gray-100 text-[10px] text-gray-500">
        <span className="font-semibold">Legend:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.25)' }} /> &lt;{MEDIUM_COST_THRESHOLD}% Efficient</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.25)' }} /> {MEDIUM_COST_THRESHOLD}-{HIGH_COST_THRESHOLD}% Moderate</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(220,38,38,0.25)' }} /> &gt;{HIGH_COST_THRESHOLD}% High Cost</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB: AI INSIGHTS
   ═══════════════════════════════════════════ */
function AIInsightsTab({ anomalies, recommendations, predictions, monthlyTrend, fwdMonthly, rtoMonthly,
  zoneStats, platformStats, fwdTotals, rtoTotals, matrixData, onDrillDown }) {

  return (
    <div className="space-y-4">
      {/* Forward vs RTO Cost Insight Panel */}
      {fwdTotals.count > 0 && rtoTotals.count > 0 && (
        <div className="bg-gradient-to-r from-blue-50 via-white to-orange-50 rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
            <ArrowRightLeft className="w-4 h-4 text-indigo-500" /> Forward vs RTO Cost Impact
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-white/80 rounded-lg">
                <span className="text-[11px] text-gray-600">Forward Avg Cost %</span>
                <span className="text-sm font-bold text-blue-700">{fmtPct(fwdTotals.avgCostPct)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-white/80 rounded-lg">
                <span className="text-[11px] text-gray-600">RTO Avg Cost %</span>
                <span className="text-sm font-bold text-orange-700">{fmtPct(rtoTotals.avgCostPct)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-white/80 rounded-lg">
                <span className="text-[11px] text-gray-600">RTO Premium</span>
                <span className={`text-sm font-bold ${rtoTotals.avgCostPct > fwdTotals.avgCostPct ? 'text-red-600' : 'text-emerald-600'}`}>
                  {rtoTotals.avgCostPct > fwdTotals.avgCostPct ? '+' : ''}{fmt(rtoTotals.avgCostPct - fwdTotals.avgCostPct)}pp
                </span>
              </div>
              <div className="flex items-center justify-between p-2 bg-white/80 rounded-lg">
                <span className="text-[11px] text-gray-600">RTO Share of Total Cost</span>
                <span className="text-sm font-bold text-gray-700">{fmtPct(rtoTotals.totalCost / (fwdTotals.totalCost + rtoTotals.totalCost) * 100)}</span>
              </div>
            </div>
            <div>
              <LineChart
                labels={(() => { const allM = new Set([...fwdMonthly.map(m => m.month), ...rtoMonthly.map(m => m.month)]); return sortMonths([...allM]); })()}
                datasets={[
                  { label: 'Forward', data: (() => { const map = {}; fwdMonthly.forEach(m => { map[m.month] = m.pct; }); return sortMonths([...new Set([...fwdMonthly.map(m => m.month), ...rtoMonthly.map(m => m.month)])]).map(m => map[m] != null ? parseFloat(map[m].toFixed(1)) : null); })(), color: '#3B82F6' },
                  { label: 'RTO', data: (() => { const map = {}; rtoMonthly.forEach(m => { map[m.month] = m.pct; }); return sortMonths([...new Set([...fwdMonthly.map(m => m.month), ...rtoMonthly.map(m => m.month)])]).map(m => map[m] != null ? parseFloat(map[m].toFixed(1)) : null); })(), color: '#F97316' },
                ]}
                height={160}
              />
            </div>
          </div>
        </div>
      )}

      {/* Prediction */}
      {predictions && (
        <div className={`rounded-xl border p-4 ${predictions.direction === 'up' ? 'bg-red-50 border-red-200' : predictions.direction === 'down' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Zap className={`w-4 h-4 ${predictions.direction === 'up' ? 'text-red-500' : predictions.direction === 'down' ? 'text-emerald-500' : 'text-blue-500'}`} />
            Cost Trend Prediction
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-gray-700 mb-2">
                Based on {monthlyTrend.length} months, cost is trending <strong>{predictions.direction === 'up' ? 'upward' : predictions.direction === 'down' ? 'downward' : 'stable'}</strong>
                {predictions.slope !== 0 && ` at ${fmt(Math.abs(predictions.slope))}pp per month`}.
              </p>
              <div className="flex gap-3">
                {predictions.next3.map((p, i) => (
                  <div key={i} className="bg-white/60 rounded-lg px-3 py-2 text-center">
                    <p className="text-[9px] text-gray-400 uppercase font-semibold">{p.month}</p>
                    <p className={`text-sm font-bold ${costColor(p.pct).text}`}>{fmtPct(p.pct)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <LineChart
                labels={[...monthlyTrend.map(m => m.month), ...predictions.next3.map(p => p.month)]}
                datasets={[
                  { label: 'Actual', data: [...monthlyTrend.map(m => parseFloat(m.pct.toFixed(1))), ...predictions.next3.map(() => null)], color: '#3B82F6' },
                  { label: 'Forecast', data: [...monthlyTrend.map(() => null).slice(0, -1), parseFloat(monthlyTrend[monthlyTrend.length - 1]?.pct.toFixed(1)), ...predictions.next3.map(p => parseFloat(p.pct.toFixed(1)))], color: '#8B5CF6', borderDash: [5, 5] },
                ]}
                height={150}
              />
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4 text-amber-500" /> Smart Recommendations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recommendations.map((r, i) => <InsightCard key={i} icon={r.icon} title={r.title} description={r.description} severity={r.severity} />)}
          </div>
        </div>
      )}

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><ShieldAlert className="w-4 h-4 text-red-500" /> Anomaly Detection ({anomalies.length})</h3>
          <div className="space-y-2">
            {anomalies.map((a, i) => (
              <InsightCard key={i} icon={a.severity === 'critical' ? AlertTriangle : ShieldAlert} title={a.label} description={a.message} severity={a.severity}
                onClick={() => onDrillDown({ title: `Anomaly: ${a.label}`, data: a.rows })} />
            ))}
          </div>
        </div>
      )}

      {/* Auto-tags */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><Tag className="w-4 h-4 text-indigo-500" /> Auto-Tagged Zones & Platforms</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50"><h4 className="text-[11px] font-semibold text-gray-600">Zone Tags</h4></div>
            <div className="divide-y divide-gray-50">
              {zoneStats.map(z => { const c = costColor(z.costPct); return (
                <div key={z.label} className="flex items-center justify-between px-4 py-2">
                  <span className="text-[11px] text-gray-700">{z.label}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${c.bg} ${c.text} border ${c.border}`}>{c.tag}</span>
                </div>
              ); })}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50"><h4 className="text-[11px] font-semibold text-gray-600">Platform Tags</h4></div>
            <div className="divide-y divide-gray-50">
              {platformStats.map(p => { const c = costColor(p.costPct); return (
                <div key={p.label} className="flex items-center justify-between px-4 py-2">
                  <span className="text-[11px] text-gray-700">{p.label}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${c.bg} ${c.text} border ${c.border}`}>{c.tag}</span>
                </div>
              ); })}
            </div>
          </div>
        </div>
      </div>

      {anomalies.length === 0 && recommendations.length === 0 && !predictions && (
        <div className="text-center py-12 text-gray-400">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Not enough data to generate AI insights.</p>
        </div>
      )}
    </div>
  );
}
