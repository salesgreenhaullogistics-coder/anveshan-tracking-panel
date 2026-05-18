import React, { useMemo, useState, useCallback } from 'react';
import { useData } from '../context/DataContext';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { BarChart, LineChart, PieChart, DoughnutChart } from '../components/Charts';
import {
  COLORS, groupBy, currency, percent, safeParseDate, formatDate, daysBetween,
  isDelivered, isPartialDelivered, isRTO, isRTODelivered, isInTransit, isOFD, isLost,
} from '../utils/index';
import {
  TrendingUp, TrendingDown, Building2, MapPin, IndianRupee, Brain,
  ArrowUpRight, ArrowDownRight, Minus, X, Eye, AlertTriangle,
  Zap, Target, Lightbulb, ShieldAlert, ArrowRightLeft, BarChart3,
  ChevronRight, ChevronDown, Activity, Package, CheckCircle, RotateCcw,
  Truck, Calendar,
} from 'lucide-react';

/* ─── constants ─── */
const TABS = [
  { key: 'mom', label: 'MoM Performance', icon: TrendingUp },
  { key: 'platform', label: 'Platform Analytics', icon: Building2 },
  { key: 'zone', label: 'Zone & City', icon: MapPin },
  { key: 'cost', label: 'Cost Intelligence', icon: IndianRupee },
  { key: 'insights', label: 'AI Insights', icon: Brain },
];

const MABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ─── helpers ─── */
const fmt = (v) => (v != null && isFinite(v) ? v.toFixed(1) : '—');
const fmtPct = (v) => (v != null && isFinite(v) ? v.toFixed(1) + '%' : '—');

function sortMonths(arr) {
  return [...arr].sort((a, b) => {
    const aI = MABBR.indexOf(a.slice(0, 3)), bI = MABBR.indexOf(b.slice(0, 3));
    const aY = parseInt('20' + a.slice(4)) || 0, bY = parseInt('20' + b.slice(4)) || 0;
    return (aY * 100 + aI) - (bY * 100 + bI);
  });
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx) || 0;
  return { slope, intercept: (sy - slope * sx) / n };
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function zScore(value, mean, std) { return std === 0 ? 0 : (value - mean) / std; }

function heatColor(pct, min, max) {
  if (min === max) return 'rgba(59,130,246,0.15)';
  const t = Math.min(1, Math.max(0, (pct - min) / (max - min)));
  /* green → red: high delivery % = green, low = red */
  const r = Math.round(34 + (1 - t) * (220 - 34));
  const g = Math.round(197 - (1 - t) * (197 - 38));
  const b = Math.round(94 - (1 - t) * (94 - 38));
  return `rgba(${r},${g},${b},0.2)`;
}

function perfColor(pct) {
  if (pct >= 85) return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', tag: 'Good' };
  if (pct >= 70) return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', tag: 'Fair' };
  return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', tag: 'Poor' };
}

function costColor(pct) {
  if (pct > 12) return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', tag: 'High Cost' };
  if (pct > 8) return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', tag: 'Moderate' };
  return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', tag: 'Efficient' };
}

function DeltaBadge({ current, previous, invert = false, suffix = '' }) {
  if (previous == null || previous === 0 || current == null) return <span className="text-[10px] text-gray-400">—</span>;
  const delta = current - previous;
  const improved = invert ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${improved ? 'bg-emerald-50 text-emerald-700' : delta === 0 ? 'bg-gray-50 text-gray-500' : 'bg-red-50 text-red-700'}`}>
      <Icon className="w-3 h-3" />
      {delta > 0 ? '+' : ''}{fmt(delta)}{suffix}
    </span>
  );
}

function MiniSparkline({ values, color = '#3B82F6', width = 60, height = 20 }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`).join(' ');
  return <svg width={width} height={height} className="inline-block"><polyline fill="none" stroke={color} strokeWidth="1.5" points={points} /></svg>;
}

function InsightCard({ icon: Icon, title, description, severity = 'info', onClick }) {
  const s = { critical: 'bg-red-50 border-red-200 text-red-500 text-red-800', warning: 'bg-amber-50 border-amber-200 text-amber-500 text-amber-800', success: 'bg-emerald-50 border-emerald-200 text-emerald-500 text-emerald-800', info: 'bg-blue-50 border-blue-200 text-blue-500 text-blue-800' }[severity] || 'bg-blue-50 border-blue-200 text-blue-500 text-blue-800';
  const [bg, border, iconC, titleC] = s.split(' ');
  return (
    <button onClick={onClick} className={`w-full text-left p-4 rounded-xl border ${border} ${bg} hover:shadow-md transition-all group`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 ${iconC}`} />
        <div className="flex-1 min-w-0">
          <h4 className={`text-xs font-bold ${titleC}`}>{title}</h4>
          <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">{description}</p>
        </div>
        {onClick && <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 mt-0.5 flex-shrink-0" />}
      </div>
    </button>
  );
}

/* ─── Drill-down Modal ─── */
function DrillDownModal({ title, data, onClose }) {
  const columns = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'platform', label: 'Platform' },
    { key: 'vendor', label: 'Courier' },
    { key: 'zone', label: 'Zone' },
    { key: 'destination', label: 'City' },
    { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking', render: (v) => formatDate(v) },
    { key: 'deliveryDate', label: 'Delivery', render: (v) => formatDate(v) },
    { key: 'appointmentDate', label: 'Appointment', render: (v) => formatDate(v) },
    { key: 'logisticsCost', label: 'Cost', render: (v) => currency(parseFloat(v) || 0) },
    { key: 'failureRemarks', label: 'Remarks' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-800">{title} <span className="text-gray-400 font-normal">({data.length.toLocaleString('en-IN')})</span></h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4"><DataTable data={data} columns={columns} exportFilename="analytics-drilldown" pageSize={25} /></div>
      </div>
    </div>
  );
}

/* ─── metric computation helpers (single-pass) ─── */
function computeMetrics(rows) {
  const total = rows.length;
  let delivered = 0, rto = 0, failed = 0, lost = 0, inTransit = 0;
  let tatSum = 0, tatCount = 0, apptTATSum = 0, apptTATCount = 0;
  let totalCost = 0, totalInv = 0;

  for (const r of rows) {
    if (isDelivered(r.status) || isPartialDelivered(r.status)) {
      delivered++;
      if (r.bookingD && r.deliveryD) { const d = daysBetween(r.bookingDate, r.deliveryDate); if (d != null && d >= 0) { tatSum += d; tatCount++; } }
    } else if (isRTO(r.status)) rto++;
    else if (isInTransit(r.status) || isOFD(r.status)) inTransit++;
    else if (isLost(r.status)) lost++;
    else if (!r.hasFutureAppointment) failed++;

    if (r.bookingD && r.appointmentD) { const d = daysBetween(r.bookingDate, r.appointmentDate); if (d != null && d >= 0) { apptTATSum += d; apptTATCount++; } }
    if (r.costNum > 0 && r.invoiceNum > 0) { totalCost += r.costNum; totalInv += r.invoiceNum; }
  }

  return {
    total, delivered, rto, failed, lost, inTransit,
    deliveredPct: total > 0 ? percent(delivered, total) : 0,
    rtoPct: total > 0 ? percent(rto, total) : 0,
    failedPct: total > 0 ? percent(failed, total) : 0,
    avgTAT: tatCount > 0 ? tatSum / tatCount : null,
    avgApptTAT: apptTATCount > 0 ? apptTATSum / apptTATCount : null,
    costPct: totalInv > 0 ? (totalCost / totalInv) * 100 : 0, totalCost, totalInv, rows,
  };
}

/* Lightweight monthly trend — only counts delivered%, no TAT/cost computation */
function computeMonthTrendLight(rows) {
  const byMonth = {};
  for (const r of rows) {
    if (!r.month) continue;
    if (!byMonth[r.month]) byMonth[r.month] = { total: 0, delivered: 0 };
    byMonth[r.month].total++;
    if (isDelivered(r.status) || isPartialDelivered(r.status)) byMonth[r.month].delivered++;
  }
  return sortMonths(Object.keys(byMonth)).map(m => ({ month: m, total: byMonth[m].total, deliveredPct: percent(byMonth[m].delivered, byMonth[m].total) }));
}

function computeGroupedMetrics(rows, key) {
  const groups = groupBy(rows, key);
  return Object.entries(groups)
    .filter(([k]) => k && k !== '' && k !== 'Unknown')
    .map(([label, gRows]) => {
      const metrics = computeMetrics(gRows);
      const monthTrend = computeMonthTrendLight(gRows);
      return { label, ...metrics, monthTrend };
    })
    .sort((a, b) => b.total - a.total);
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */
export default function Analytics() {
  const { data } = useData();
  const [activeTab, setActiveTab] = useState('mom');
  const [drillDown, setDrillDown] = useState(null);

  /* ─── base enrichment (last 12 months only) ─── */
  const classified = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    return data.map(r => {
      const bd = safeParseDate(r.bookingDate);
      return {
        ...r,
        costNum: parseFloat(r.logisticsCost) || 0,
        invoiceNum: parseFloat(r.invoiceValue) || 0,
        bookingD: bd,
        deliveryD: safeParseDate(r.deliveryDate),
        appointmentD: safeParseDate(r.appointmentDate),
        hasFutureAppointment: (() => { const ad = safeParseDate(r.appointmentDate); return ad && ad > now; })(),
      };
    }).filter(r => !r.bookingD || r.bookingD >= cutoff); /* Keep rows with no date (to not lose data) + last 12 months */
  }, [data]);

  /* ─── monthly metrics ─── */
  const monthlyMetrics = useMemo(() => {
    const byMonth = groupBy(classified, 'month');
    const months = sortMonths(Object.keys(byMonth).filter(m => m && m.includes("'")));
    return months.map((m, idx) => {
      const metrics = computeMetrics(byMonth[m]);
      const prev = idx > 0 ? computeMetrics(byMonth[months[idx - 1]]) : null;
      return { month: m, ...metrics, prev };
    });
  }, [classified]);

  /* ─── group stats ─── */
  const platformStats = useMemo(() => computeGroupedMetrics(classified, 'platform'), [classified]);
  const zoneStats = useMemo(() => computeGroupedMetrics(classified, 'zone'), [classified]);
  const cityStats = useMemo(() => computeGroupedMetrics(classified, 'destination'), [classified]);
  const overallMetrics = useMemo(() => computeMetrics(classified), [classified]);

  /* ─── heatmap: zone x platform delivery % ─── */
  const heatmap = useMemo(() => {
    const zones = [...new Set(classified.map(r => r.zone).filter(Boolean))].sort();
    const platforms = [...new Set(classified.map(r => r.platform).filter(Boolean))].sort();
    const cells = {};
    let min = 100, max = 0;
    for (const r of classified) {
      if (!r.zone || !r.platform) continue;
      const key = `${r.zone}||${r.platform}`;
      if (!cells[key]) cells[key] = { total: 0, delivered: 0, rows: [] };
      cells[key].total++;
      if (isDelivered(r.status) || isPartialDelivered(r.status)) cells[key].delivered++;
      cells[key].rows.push(r);
    }
    for (const c of Object.values(cells)) {
      c.pct = c.total > 0 ? percent(c.delivered, c.total) : 0;
      if (c.total >= 3) { if (c.pct < min) min = c.pct; if (c.pct > max) max = c.pct; }
    }
    return { zones, platforms, cells, min, max };
  }, [classified]);

  /* ─── AI insights ─── */
  const aiInsights = useMemo(() => {
    const observations = [];
    const anomalies = [];
    const recommendations = [];

    // Overall assessment
    const ov = overallMetrics;
    if (ov.deliveredPct >= 85) observations.push({ icon: CheckCircle, title: `Delivery rate at ${fmtPct(ov.deliveredPct)}`, description: `Overall delivery performance is healthy with ${ov.delivered.toLocaleString('en-IN')} out of ${ov.total.toLocaleString('en-IN')} shipments delivered.`, severity: 'success' });
    else observations.push({ icon: AlertTriangle, title: `Delivery rate at ${fmtPct(ov.deliveredPct)} — below 85% target`, description: `${(ov.total - ov.delivered).toLocaleString('en-IN')} shipments not yet delivered. Focus on reducing failures and RTO.`, severity: 'warning' });

    if (ov.rtoPct > 8) observations.push({ icon: RotateCcw, title: `RTO rate is ${fmtPct(ov.rtoPct)}`, description: `RTO is above 8% threshold. ${ov.rto.toLocaleString('en-IN')} shipments returned. This adds significant logistics cost.`, severity: 'critical' });

    // MoM trend
    if (monthlyMetrics.length >= 2) {
      const latest = monthlyMetrics[monthlyMetrics.length - 1];
      const prev = monthlyMetrics[monthlyMetrics.length - 2];
      const delDelta = latest.deliveredPct - prev.deliveredPct;
      if (Math.abs(delDelta) > 1) {
        observations.push({ icon: delDelta > 0 ? TrendingUp : TrendingDown, title: `Delivery rate ${delDelta > 0 ? 'improved' : 'declined'} by ${fmt(Math.abs(delDelta))}pp MoM`, description: `${latest.month}: ${fmtPct(latest.deliveredPct)} vs ${prev.month}: ${fmtPct(prev.deliveredPct)}.`, severity: delDelta > 0 ? 'success' : 'warning' });
      }
      const rtoDelta = latest.rtoPct - prev.rtoPct;
      if (rtoDelta > 2) observations.push({ icon: TrendingUp, title: `RTO increased by ${fmt(rtoDelta)}pp MoM`, description: `${latest.month}: ${fmtPct(latest.rtoPct)} vs ${prev.month}: ${fmtPct(prev.rtoPct)}. Investigate root causes.`, severity: 'critical' });
    }

    // Platform anomalies
    const globalDelPcts = platformStats.map(p => p.deliveredPct);
    const globalDelMean = globalDelPcts.length ? globalDelPcts.reduce((a, b) => a + b, 0) / globalDelPcts.length : 0;
    const globalDelStd = stdDev(globalDelPcts);
    for (const p of platformStats) {
      const z = zScore(p.deliveredPct, globalDelMean, globalDelStd);
      if (z < -2 && p.total > 10) {
        anomalies.push({ icon: ShieldAlert, title: `${p.label}: Low delivery at ${fmtPct(p.deliveredPct)}`, description: `${fmt(Math.abs(z))} std dev below average (${fmtPct(globalDelMean)}). ${p.total} shipments affected.`, severity: 'critical', rows: p.rows });
      }
    }

    // Zone TAT anomalies
    const zoneTATs = zoneStats.filter(z => z.avgTAT != null).map(z => z.avgTAT);
    const tatMean = zoneTATs.length ? zoneTATs.reduce((a, b) => a + b, 0) / zoneTATs.length : 0;
    const tatStd = stdDev(zoneTATs);
    for (const z of zoneStats) {
      if (z.avgTAT != null && zScore(z.avgTAT, tatMean, tatStd) > 2 && z.total > 10) {
        anomalies.push({ icon: AlertTriangle, title: `${z.label}: High TAT at ${fmt(z.avgTAT)} days`, description: `${fmt(zScore(z.avgTAT, tatMean, tatStd))} std dev above average (${fmt(tatMean)} days). ${z.delivered} delivered shipments.`, severity: 'warning', rows: z.rows });
      }
    }

    // Cost anomalies
    const costPcts = platformStats.filter(p => p.costPct > 0).map(p => p.costPct);
    const costMean = costPcts.length ? costPcts.reduce((a, b) => a + b, 0) / costPcts.length : 0;
    const costStd = stdDev(costPcts);
    for (const p of platformStats) {
      if (p.costPct > 0 && zScore(p.costPct, costMean, costStd) > 2 && p.total > 10) {
        anomalies.push({ icon: IndianRupee, title: `${p.label}: High cost at ${fmtPct(p.costPct)}`, description: `Cost is ${fmt(zScore(p.costPct, costMean, costStd))} std dev above average (${fmtPct(costMean)}). Total cost: ${currency(p.totalCost)}.`, severity: 'warning', rows: p.rows });
      }
    }

    // Recommendations
    const sortedByDel = [...platformStats].sort((a, b) => b.deliveredPct - a.deliveredPct);
    if (sortedByDel.length >= 2) {
      const best = sortedByDel[0];
      const worst = sortedByDel[sortedByDel.length - 1];
      if (worst.deliveredPct < best.deliveredPct - 10 && worst.total > 10) {
        recommendations.push({ icon: ArrowRightLeft, title: `Investigate ${worst.label} delivery issues`, description: `${worst.label} delivers at ${fmtPct(worst.deliveredPct)} vs ${best.label} at ${fmtPct(best.deliveredPct)}. A ${fmt(best.deliveredPct - worst.deliveredPct)}pp gap suggests operational issues.`, severity: 'info' });
      }
    }

    const highRTOPlatforms = platformStats.filter(p => p.rtoPct > 10 && p.total > 20);
    for (const p of highRTOPlatforms.slice(0, 2)) {
      recommendations.push({ icon: RotateCcw, title: `Reduce RTO on ${p.label} (${fmtPct(p.rtoPct)})`, description: `${p.rto} RTO shipments from ${p.total} total. Reducing RTO by 20% could save ~${currency(p.totalCost * (p.rtoPct / 100) * 0.2)}.`, severity: 'warning' });
    }

    const highCostZones = zoneStats.filter(z => z.costPct > 12 && z.total > 20);
    for (const z of highCostZones.slice(0, 2)) {
      const lowCostZone = zoneStats.filter(z2 => z2.costPct < 8 && z2.total > 20)[0];
      recommendations.push({ icon: MapPin, title: `Optimize cost in ${z.label} zone (${fmtPct(z.costPct)})`, description: `${z.label} has high logistics cost. ${lowCostZone ? `Compare with ${lowCostZone.label} at ${fmtPct(lowCostZone.costPct)}.` : 'Review courier contracts and routing.'}`, severity: 'warning' });
    }

    if (ov.avgTAT != null && ov.avgTAT > 5) {
      recommendations.push({ icon: Truck, title: `TAT averaging ${fmt(ov.avgTAT)} days — room for improvement`, description: `Consider optimizing fulfillment processes. Target: <4 days TAT for improved customer satisfaction.`, severity: 'info' });
    }

    // Predictions
    let predictions = null;
    if (monthlyMetrics.length >= 3) {
      const points = monthlyMetrics.map((m, i) => ({ x: i, y: m.deliveredPct }));
      const { slope, intercept } = linearRegression(points);
      const next3 = [1, 2, 3].map(offset => ({ month: `+${offset}M`, pct: Math.max(0, Math.min(100, slope * (points.length - 1 + offset) + intercept)) }));
      predictions = { slope, next3, direction: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable' };
    }

    return { observations, anomalies, recommendations, predictions };
  }, [overallMetrics, monthlyMetrics, platformStats, zoneStats]);

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === t.key ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-200' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
        <span className="text-[10px] text-gray-400 ml-auto">{classified.length.toLocaleString('en-IN')} shipments</span>
      </div>

      {activeTab === 'mom' && <MoMTab data={monthlyMetrics} overall={overallMetrics} classified={classified} onDrill={setDrillDown} />}
      {activeTab === 'platform' && <PlatformTab stats={platformStats} monthlyMetrics={monthlyMetrics} classified={classified} onDrill={setDrillDown} />}
      {activeTab === 'zone' && <ZoneCityTab zoneStats={zoneStats} cityStats={cityStats} heatmap={heatmap} platformStats={platformStats} classified={classified} onDrill={setDrillDown} />}
      {activeTab === 'cost' && <CostTab classified={classified} platformStats={platformStats} zoneStats={zoneStats} cityStats={cityStats} monthlyMetrics={monthlyMetrics} onDrill={setDrillDown} />}
      {activeTab === 'insights' && <AITab insights={aiInsights} monthlyMetrics={monthlyMetrics} platformStats={platformStats} zoneStats={zoneStats} overallMetrics={overallMetrics} onDrill={setDrillDown} />}

      {drillDown && <DrillDownModal title={drillDown.title} data={drillDown.data} onClose={() => setDrillDown(null)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB 1: MoM PERFORMANCE
   ═══════════════════════════════════════════ */
function MoMTab({ data: months, overall, classified, onDrill }) {
  const current = months.length > 0 ? months[months.length - 1] : null;
  const prev = months.length > 1 ? months[months.length - 2] : null;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Delivered %" value={current ? fmtPct(current.deliveredPct) : '—'} icon={CheckCircle} color="green"
          change={current && prev ? parseFloat((current.deliveredPct - prev.deliveredPct).toFixed(1)) : undefined} subtitle={current?.month} />
        <KPICard title="RTO %" value={current ? fmtPct(current.rtoPct) : '—'} icon={RotateCcw} color="red"
          subtitle={current?.month} />
        <KPICard title="Avg TAT" value={current?.avgTAT != null ? fmt(current.avgTAT) + ' days' : '—'} icon={Truck} color="purple" subtitle="Booked → Delivered" />
        <KPICard title="Appt TAT" value={current?.avgApptTAT != null ? fmt(current.avgApptTAT) + ' days' : '—'} icon={Calendar} color="blue" subtitle="Booked → Appointment" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <LineChart title="Delivery & RTO % Trend" labels={months.map(m => m.month)}
            datasets={[
              { label: 'Delivered %', data: months.map(m => parseFloat(m.deliveredPct.toFixed(1))), color: '#10B981', fill: true },
              { label: 'RTO %', data: months.map(m => parseFloat(m.rtoPct.toFixed(1))), color: '#EF4444' },
            ]} height={220} />
        </div>
        <div className="chart-container">
          <LineChart title="TAT Trend (Days)" labels={months.map(m => m.month)}
            datasets={[
              { label: 'Booked→Delivered', data: months.map(m => m.avgTAT != null ? parseFloat(m.avgTAT.toFixed(1)) : null), color: '#8B5CF6' },
              { label: 'Booked→Appointment', data: months.map(m => m.avgApptTAT != null ? parseFloat(m.avgApptTAT.toFixed(1)) : null), color: '#3B82F6' },
            ]} height={220} />
        </div>
      </div>

      <div className="chart-container">
        <BarChart title="Monthly Shipment Volume" labels={months.map(m => m.month)}
          datasets={[
            { label: 'Delivered', data: months.map(m => m.delivered), color: '#10B981' },
            { label: 'RTO', data: months.map(m => m.rto), color: '#EF4444' },
            { label: 'Failed', data: months.map(m => m.failed), color: '#F59E0B' },
            { label: 'In-Transit', data: months.map(m => m.inTransit), color: '#6366F1' },
          ]}
          options={{ plugins: { legend: { display: true, position: 'top', labels: { font: { size: 10 }, padding: 10 } } } }}
          stacked height={220} />
      </div>

      {/* Monthly Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Month-on-Month Performance</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Click any value to drill down — Delivered, RTO, Failed show only that status</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase">Month</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Booked</th>
              <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 uppercase">Delivered</th>
              <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 uppercase">Del %</th>
              <th className="px-3 py-2.5 text-center font-semibold text-gray-400 uppercase">MoM</th>
              <th className="px-3 py-2.5 text-right font-semibold text-red-500 uppercase">RTO</th>
              <th className="px-3 py-2.5 text-right font-semibold text-red-500 uppercase">RTO %</th>
              <th className="px-3 py-2.5 text-center font-semibold text-gray-400 uppercase">MoM</th>
              <th className="px-3 py-2.5 text-right font-semibold text-indigo-500 uppercase">In-Transit</th>
              <th className="px-3 py-2.5 text-right font-semibold text-amber-600 uppercase">Failed</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">TAT</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Appt TAT</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Cost %</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {months.map(m => {
                const pc = perfColor(m.deliveredPct);
                const drill = (label, fn) => onDrill({ title: `${m.month} — ${label}`, data: m.rows.filter(fn) });
                return (
                  <tr key={m.month} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-gray-800">{m.month}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{m.total.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2.5 text-right cursor-pointer" onClick={() => drill(`Delivered (${m.delivered})`, r => isDelivered(r.status) || isPartialDelivered(r.status))}><span className="text-emerald-600 font-medium underline underline-offset-2 decoration-emerald-200">{m.delivered.toLocaleString('en-IN')}</span></td>
                    <td className="px-3 py-2.5 text-right"><span className={`font-bold ${pc.text}`}>{fmtPct(m.deliveredPct)}</span></td>
                    <td className="px-3 py-2.5 text-center"><DeltaBadge current={m.deliveredPct} previous={m.prev?.deliveredPct} suffix="pp" /></td>
                    <td className="px-3 py-2.5 text-right cursor-pointer" onClick={() => drill(`RTO (${m.rto})`, r => isRTO(r.status))}><span className="text-red-500 font-medium underline underline-offset-2 decoration-red-200">{m.rto.toLocaleString('en-IN')}</span></td>
                    <td className="px-3 py-2.5 text-right text-red-600">{fmtPct(m.rtoPct)}</td>
                    <td className="px-3 py-2.5 text-center"><DeltaBadge current={m.rtoPct} previous={m.prev?.rtoPct} invert suffix="pp" /></td>
                    <td className="px-3 py-2.5 text-right cursor-pointer" onClick={() => drill(`In-Transit (${m.inTransit})`, r => isInTransit(r.status) || isOFD(r.status))}><span className="text-indigo-600 underline underline-offset-2 decoration-indigo-200">{m.inTransit.toLocaleString('en-IN')}</span></td>
                    <td className="px-3 py-2.5 text-right cursor-pointer" onClick={() => drill(`Failed (${m.failed})`, r => !(isDelivered(r.status)||isPartialDelivered(r.status)) && !(isInTransit(r.status)||isOFD(r.status)) && !isRTO(r.status) && !isLost(r.status) && !r.hasFutureAppointment)}><span className="text-amber-600 underline underline-offset-2 decoration-amber-200">{m.failed.toLocaleString('en-IN')}</span></td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{m.avgTAT != null ? fmt(m.avgTAT) + 'd' : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{m.avgApptTAT != null ? fmt(m.avgApptTAT) + 'd' : '—'}</td>
                    <td className="px-3 py-2.5 text-right"><span className={`${costColor(m.costPct).text}`}>{fmtPct(m.costPct)}</span></td>
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
   TAB 2: PLATFORM ANALYTICS (Enhanced)
   ═══════════════════════════════════════════ */
function PlatformTab({ stats, monthlyMetrics, classified, onDrill }) {
  const [drillPlatform, setDrillPlatform] = useState(null);
  const [expMonth, setExpMonth] = useState(null);
  const [drillZone, setDrillZone] = useState(null);
  const [viewMode, setViewMode] = useState('table'); /* table | compare */
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  const best = stats.length > 0 ? [...stats].sort((a, b) => b.deliveredPct - a.deliveredPct)[0] : null;
  const worst = stats.length > 1 ? [...stats].filter(p => p.total > 10).sort((a, b) => a.deliveredPct - b.deliveredPct)[0] : null;

  /* Health score: 0-100 composite */
  const withScore = useMemo(() => stats.map(p => {
    const delScore = Math.min(100, p.deliveredPct * 1.1);
    const rtoScore = Math.max(0, 100 - p.rtoPct * 5);
    const tatScore = p.avgTAT != null ? Math.max(0, 100 - (p.avgTAT - 3) * 10) : 50;
    const costScore = Math.max(0, 100 - p.costPct * 5);
    const score = Math.round(delScore * 0.4 + rtoScore * 0.25 + tatScore * 0.2 + costScore * 0.15);
    return { ...p, healthScore: Math.min(100, Math.max(0, score)) };
  }), [stats]);

  /* Platform MoM breakdown */
  const platformMoM = useMemo(() => {
    if (!drillPlatform) return [];
    const rows = classified.filter(r => r.platform === drillPlatform);
    const byMonth = groupBy(rows, 'month');
    const months = sortMonths(Object.keys(byMonth).filter(m => m && m.includes("'")));
    return months.map((m, idx) => {
      const metrics = computeMetrics(byMonth[m]);
      const prev = idx > 0 ? computeMetrics(byMonth[months[idx - 1]]) : null;
      return { month: m, ...metrics, prev };
    });
  }, [drillPlatform, classified]);

  /* Zone drill-down data */
  const zoneBreakdown = useMemo(() => {
    if (!drillPlatform) return [];
    return computeGroupedMetrics(classified.filter(r => r.platform === drillPlatform), 'zone');
  }, [drillPlatform, classified]);

  const cityBreakdown = useMemo(() => {
    if (!drillPlatform || !drillZone) return [];
    return computeGroupedMetrics(classified.filter(r => r.platform === drillPlatform && r.zone === drillZone), 'destination');
  }, [drillPlatform, drillZone, classified]);

  /* Courier breakdown for expanded platform */
  const courierBreakdown = useMemo(() => {
    if (!drillPlatform) return [];
    return computeGroupedMetrics(classified.filter(r => r.platform === drillPlatform), 'vendor');
  }, [drillPlatform, classified]);

  /* Failure reason analysis for expanded platform */
  const failureAnalysis = useMemo(() => {
    if (!drillPlatform) return { reasons: [], topZones: [], topCouriers: [], statusBreakdown: [], monthlyNonDel: [] };
    const pRows = classified.filter(r => r.platform === drillPlatform);
    const nonDel = pRows.filter(r => !(isDelivered(r.status) || isPartialDelivered(r.status)));

    /* Status-wise split of non-delivered */
    let rtoCount = 0, intransitCount = 0, lostCount = 0, otherCount = 0;
    const rtoRows = [], intransitRows = [], lostRows = [], otherRows = [];
    const remarkCounts = {};
    nonDel.forEach(r => {
      if (isRTO(r.status)) { rtoCount++; rtoRows.push(r); }
      else if (isInTransit(r.status) || isOFD(r.status)) { intransitCount++; intransitRows.push(r); }
      else if (isLost(r.status)) { lostCount++; lostRows.push(r); }
      else { otherCount++; otherRows.push(r); }
      const rm = (r.failureRemarks || '').trim();
      const key = rm && rm !== 'NA' && rm !== '-' ? rm : 'No remark available';
      remarkCounts[key] = (remarkCounts[key] || 0) + 1;
    });
    const reasons = Object.entries(remarkCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    /* Top reasons per status */
    const getTopReasons = (sRows) => {
      const rc = {};
      sRows.forEach(r => { const rm = (r.failureRemarks || '').trim(); const k = rm && rm !== 'NA' && rm !== '-' ? rm : 'No remark'; rc[k] = (rc[k] || 0) + 1; });
      return Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 5);
    };
    const statusBreakdown = [
      { label: 'RTO', count: rtoCount, rows: rtoRows, color: 'red', icon: RotateCcw, reasons: getTopReasons(rtoRows) },
      { label: 'In-Transit', count: intransitCount, rows: intransitRows, color: 'indigo', icon: Truck, reasons: getTopReasons(intransitRows) },
      { label: 'Lost', count: lostCount, rows: lostRows, color: 'gray', icon: AlertTriangle, reasons: getTopReasons(lostRows) },
      { label: 'Other/Failed', count: otherCount, rows: otherRows, color: 'amber', icon: Package, reasons: getTopReasons(otherRows) },
    ].filter(s => s.count > 0);

    /* MoM non-delivered trend */
    const byMonth = groupBy(nonDel, 'month');
    const monthlyNonDel = sortMonths(Object.keys(byMonth).filter(m => m && m.includes("'"))).map(m => {
      const mRows = byMonth[m];
      const mRemarks = {};
      mRows.forEach(r => { const rm = (r.failureRemarks || '').trim(); const k = rm && rm !== 'NA' && rm !== '-' ? rm : null; if (k) mRemarks[k] = (mRemarks[k] || 0) + 1; });
      const topReason = Object.entries(mRemarks).sort((a, b) => b[1] - a[1])[0] || null;
      return { month: m, total: mRows.length,
        rto: mRows.filter(r => isRTO(r.status)).length,
        intransit: mRows.filter(r => isInTransit(r.status) || isOFD(r.status)).length,
        lost: mRows.filter(r => isLost(r.status)).length,
        other: mRows.filter(r => !isRTO(r.status) && !(isInTransit(r.status) || isOFD(r.status)) && !isLost(r.status)).length,
        topReason, rows: mRows,
      };
    });

    /* Zone & Courier breakdown */
    const zoneNonDel = {};
    nonDel.forEach(r => { const z = r.zone || 'Unknown'; zoneNonDel[z] = (zoneNonDel[z] || 0) + 1; });
    const topZones = Object.entries(zoneNonDel).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const courierNonDel = {};
    nonDel.forEach(r => { const c = r.vendor || 'Unknown'; courierNonDel[c] = (courierNonDel[c] || 0) + 1; });
    const topCouriers = Object.entries(courierNonDel).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { reasons, topZones, topCouriers, totalNonDel: nonDel.length, nonDelRows: nonDel, statusBreakdown, monthlyNonDel, rtoRows, intransitRows, lostRows, otherRows };
  }, [drillPlatform, classified]);

  /* AI Root Cause for expanded platform */
  const platformRootCause = useMemo(() => {
    if (!drillPlatform) return [];
    const p = withScore.find(x => x.label === drillPlatform);
    if (!p) return [];
    const causes = [];
    const globalAvgDel = stats.reduce((s, x) => s + x.deliveredPct, 0) / (stats.length || 1);
    const globalAvgTAT = stats.filter(x => x.avgTAT != null).reduce((s, x) => s + x.avgTAT, 0) / (stats.filter(x => x.avgTAT != null).length || 1);
    const globalAvgRTO = stats.reduce((s, x) => s + x.rtoPct, 0) / (stats.length || 1);
    const globalAvgCost = stats.filter(x => x.costPct > 0).reduce((s, x) => s + x.costPct, 0) / (stats.filter(x => x.costPct > 0).length || 1);

    /* Delivery analysis */
    if (p.deliveredPct < globalAvgDel - 5) causes.push({ icon: TrendingDown, title: `Low delivery rate: ${fmtPct(p.deliveredPct)} vs avg ${fmtPct(globalAvgDel)}`, description: `${fmt(globalAvgDel - p.deliveredPct)}pp below average. ${p.total - p.delivered} shipments not delivered out of ${p.total}.`, severity: 'critical' });
    else if (p.deliveredPct >= globalAvgDel) causes.push({ icon: CheckCircle, title: `Delivery rate above average: ${fmtPct(p.deliveredPct)}`, description: `${fmt(p.deliveredPct - globalAvgDel)}pp above platform average of ${fmtPct(globalAvgDel)}.`, severity: 'success' });

    /* RTO analysis */
    if (p.rtoPct > globalAvgRTO * 1.5 && p.rto > 5) causes.push({ icon: RotateCcw, title: `High RTO: ${fmtPct(p.rtoPct)} vs avg ${fmtPct(globalAvgRTO)}`, description: `${p.rto} returns from ${p.total} shipments. RTO adds ~2x shipping cost. Estimated extra cost: ${currency(p.totalCost * (p.rtoPct / 100) * 0.5)}.`, severity: 'critical' });
    else if (p.rtoPct <= globalAvgRTO && p.total > 20) causes.push({ icon: CheckCircle, title: `RTO within healthy range: ${fmtPct(p.rtoPct)}`, description: `Below platform average of ${fmtPct(globalAvgRTO)}.`, severity: 'success' });

    /* TAT analysis */
    if (p.avgTAT != null && p.avgTAT > globalAvgTAT * 1.3) {
      causes.push({ icon: Truck, title: `Slow TAT: ${fmt(p.avgTAT)}d vs avg ${fmt(globalAvgTAT)}d`, description: `${fmt(p.avgTAT - globalAvgTAT)} days slower than average. Slow delivery increases RTO risk and customer complaints.`, severity: 'warning' });
      /* Which zones slow it down? */
      const slowZones = zoneBreakdown.filter(z => z.avgTAT != null && z.avgTAT > p.avgTAT).slice(0, 3);
      if (slowZones.length > 0) causes.push({ icon: MapPin, title: `Slowest zones: ${slowZones.map(z => z.label).join(', ')}`, description: `These zones have TAT above ${fmt(p.avgTAT)}d: ${slowZones.map(z => `${z.label} (${fmt(z.avgTAT)}d)`).join(', ')}.`, severity: 'info' });
    }

    /* Cost analysis */
    if (p.costPct > 0 && p.costPct > globalAvgCost * 1.3) {
      causes.push({ icon: IndianRupee, title: `High cost: ${fmtPct(p.costPct)} vs avg ${fmtPct(globalAvgCost)}`, description: `Total logistics cost: ${currency(p.totalCost)} on ${currency(p.totalInv)} invoice value. ${fmt((p.costPct / globalAvgCost - 1) * 100)}% above average.`, severity: 'warning' });
      /* Which zones drive cost? */
      const highCostZones = zoneBreakdown.filter(z => z.costPct > p.costPct).slice(0, 3);
      if (highCostZones.length > 0) causes.push({ icon: MapPin, title: `High-cost zones: ${highCostZones.map(z => z.label).join(', ')}`, description: `Zones above platform average: ${highCostZones.map(z => `${z.label} (${fmtPct(z.costPct)})`).join(', ')}.`, severity: 'info' });
    }

    /* MoM trend analysis */
    if (platformMoM.length >= 3) {
      const recent3 = platformMoM.slice(-3);
      const delTrend = recent3[recent3.length - 1].deliveredPct - recent3[0].deliveredPct;
      if (delTrend < -5) causes.push({ icon: TrendingDown, title: `Declining delivery trend: ${fmt(delTrend)}pp over last 3 months`, description: `From ${fmtPct(recent3[0].deliveredPct)} to ${fmtPct(recent3[recent3.length - 1].deliveredPct)}. Investigate operational changes.`, severity: 'critical' });
      else if (delTrend > 5) causes.push({ icon: TrendingUp, title: `Improving delivery trend: +${fmt(delTrend)}pp over last 3 months`, description: `From ${fmtPct(recent3[0].deliveredPct)} to ${fmtPct(recent3[recent3.length - 1].deliveredPct)}. Current strategy is working.`, severity: 'success' });
      const rtoTrend = recent3[recent3.length - 1].rtoPct - recent3[0].rtoPct;
      if (rtoTrend > 3) causes.push({ icon: TrendingUp, title: `RTO rising: +${fmt(rtoTrend)}pp over last 3 months`, description: `RTO increased from ${fmtPct(recent3[0].rtoPct)} to ${fmtPct(recent3[recent3.length - 1].rtoPct)}. Check product quality, address accuracy, COD ratio.`, severity: 'warning' });
    }

    /* Failure reason insight */
    if (failureAnalysis.reasons.length > 0 && failureAnalysis.reasons[0][0] !== 'No remark available') {
      causes.push({ icon: AlertTriangle, title: `Top failure reason: ${failureAnalysis.reasons[0][0]}`, description: `${failureAnalysis.reasons[0][1]} shipments failed with this reason (${fmtPct(failureAnalysis.reasons[0][1] / (failureAnalysis.totalNonDel || 1) * 100)} of non-delivered).`, severity: 'warning' });
    }

    if (causes.length === 0) causes.push({ icon: CheckCircle, title: 'No significant issues detected', description: 'All metrics are within healthy ranges.', severity: 'success' });
    return causes;
  }, [drillPlatform, withScore, stats, zoneBreakdown, platformMoM, failureAnalysis]);

  /* Compare data */
  const compareData = useMemo(() => {
    if (!compareA || !compareB || compareA === compareB) return null;
    const a = withScore.find(p => p.label === compareA);
    const b = withScore.find(p => p.label === compareB);
    if (!a || !b) return null;
    return { a, b };
  }, [compareA, compareB, withScore]);

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total Platforms" value={stats.length} icon={Building2} color="blue" />
        <KPICard title="Avg Delivery %" value={stats.length ? fmtPct(stats.reduce((s, p) => s + p.deliveredPct, 0) / stats.length) : '—'} icon={CheckCircle} color="green" />
        <KPICard title="Best Platform" value={best?.label || '—'} icon={TrendingUp} color="green" subtitle={best ? fmtPct(best.deliveredPct) : ''} />
        <KPICard title="Worst Platform" value={worst?.label || '—'} icon={TrendingDown} color="red" subtitle={worst ? fmtPct(worst.deliveredPct) : ''} />
      </div>

      {/* Best/Worst Cards */}
      {best && worst && best.label !== worst.label && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl border border-emerald-200 p-4">
            <div className="flex items-center justify-between">
              <div><div className="flex items-center gap-2 mb-1"><CheckCircle className="w-4 h-4 text-emerald-500" /><span className="text-[11px] font-bold text-emerald-700 uppercase">Best Performer</span></div>
              <p className="text-xl font-bold text-emerald-800">{best.label}</p>
              <p className="text-[10px] text-emerald-600 mt-0.5">Del: {fmtPct(best.deliveredPct)} | RTO: {fmtPct(best.rtoPct)} | TAT: {best.avgTAT != null ? fmt(best.avgTAT) + 'd' : '—'}</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-emerald-700">{withScore.find(p => p.label === best.label)?.healthScore || 0}</p><p className="text-[9px] text-emerald-500">Health Score</p></div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-red-100/50 rounded-xl border border-red-200 p-4">
            <div className="flex items-center justify-between">
              <div><div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-red-500" /><span className="text-[11px] font-bold text-red-700 uppercase">Needs Improvement</span></div>
              <p className="text-xl font-bold text-red-800">{worst.label}</p>
              <p className="text-[10px] text-red-600 mt-0.5">Del: {fmtPct(worst.deliveredPct)} | RTO: {fmtPct(worst.rtoPct)} | TAT: {worst.avgTAT != null ? fmt(worst.avgTAT) + 'd' : '—'}</p></div>
              <div className="text-center"><p className="text-2xl font-bold text-red-700">{withScore.find(p => p.label === worst.label)?.healthScore || 0}</p><p className="text-[9px] text-red-500">Health Score</p></div>
            </div>
          </div>
        </div>
      )}

      {/* View toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setViewMode('table')} className={`tab-btn ${viewMode === 'table' ? 'tab-btn-active' : 'tab-btn-inactive'}`}>Platform Table</button>
        <button onClick={() => setViewMode('compare')} className={`tab-btn ${viewMode === 'compare' ? 'tab-btn-active' : 'tab-btn-inactive'}`}>Compare Platforms</button>
        <button onClick={() => setViewMode('charts')} className={`tab-btn ${viewMode === 'charts' ? 'tab-btn-active' : 'tab-btn-inactive'}`}>Trend Charts</button>
        <button onClick={() => setViewMode('share')} className={`tab-btn ${viewMode === 'share' ? 'tab-btn-active' : 'tab-btn-inactive'}`}>Volume Share</button>
      </div>

      {/* ── TABLE VIEW ── */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Platform Performance — Last 12 Months</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Click platform for MoM breakdown + Zone drill-down</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase">Platform</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Booked</th>
                <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 uppercase">Del</th>
                <th className="px-3 py-2.5 text-right font-semibold text-red-500 uppercase">RTO</th>
                <th className="px-3 py-2.5 text-right font-semibold text-indigo-500 uppercase">Transit</th>
                <th className="px-3 py-2.5 text-right font-semibold text-amber-600 uppercase">Other</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase">Status Breakdown</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">TAT</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Cost %</th>
                <th className="px-3 py-2.5 text-center font-semibold text-indigo-500 uppercase">Score</th>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-500 uppercase">Tag</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {withScore.map(p => {
                  const pc = perfColor(p.deliveredPct);
                  const isExp = drillPlatform === p.label;
                  const other = p.failed + p.lost;
                  const delW = p.total > 0 ? (p.delivered / p.total * 100) : 0;
                  const rtoW = p.total > 0 ? (p.rto / p.total * 100) : 0;
                  const intW = p.total > 0 ? (p.inTransit / p.total * 100) : 0;
                  const othW = p.total > 0 ? (other / p.total * 100) : 0;
                  return (
                    <React.Fragment key={p.label}>
                      <tr className={`hover:bg-gray-50 cursor-pointer ${isExp ? 'bg-indigo-50/50' : ''}`}
                        onClick={() => { setDrillPlatform(isExp ? null : p.label); setDrillZone(null); }}>
                        <td className="px-3 py-2.5 font-medium text-indigo-700 flex items-center gap-1">
                          {isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{p.label}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{p.total.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-600 font-medium">{p.delivered.toLocaleString('en-IN')}<span className="text-[9px] text-emerald-400 ml-0.5">({fmt(delW)}%)</span></td>
                        <td className="px-3 py-2.5 text-right text-red-500">{p.rto.toLocaleString('en-IN')}<span className="text-[9px] text-red-300 ml-0.5">({fmt(rtoW)}%)</span></td>
                        <td className="px-3 py-2.5 text-right text-indigo-500">{p.inTransit.toLocaleString('en-IN')}<span className="text-[9px] text-indigo-300 ml-0.5">({fmt(intW)}%)</span></td>
                        <td className="px-3 py-2.5 text-right text-amber-600">{other.toLocaleString('en-IN')}<span className="text-[9px] text-amber-300 ml-0.5">({fmt(othW)}%)</span></td>
                        <td className="px-3 py-2 min-w-[140px]">
                          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 w-full" title={`Del:${fmt(delW)}% | RTO:${fmt(rtoW)}% | Transit:${fmt(intW)}% | Other:${fmt(othW)}%`}>
                            {delW > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${delW}%` }} />}
                            {rtoW > 0 && <div className="bg-red-400 transition-all" style={{ width: `${rtoW}%` }} />}
                            {intW > 0 && <div className="bg-indigo-400 transition-all" style={{ width: `${intW}%` }} />}
                            {othW > 0 && <div className="bg-amber-400 transition-all" style={{ width: `${othW}%` }} />}
                          </div>
                          <div className="flex gap-2 mt-0.5 text-[8px] text-gray-400">
                            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Del</span>
                            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />RTO</span>
                            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />Transit</span>
                            {othW > 0 && <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />Other</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{p.avgTAT != null ? fmt(p.avgTAT) + 'd' : '—'}</td>
                        <td className="px-3 py-2.5 text-right"><span className={costColor(p.costPct).text}>{fmtPct(p.costPct)}</span></td>
                        <td className="px-3 py-2.5 text-center"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${p.healthScore >= 75 ? 'bg-emerald-100 text-emerald-700' : p.healthScore >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{p.healthScore}</span></td>
                        <td className="px-3 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${pc.bg} ${pc.text} border ${pc.border}`}>{pc.tag}</span></td>
                      </tr>

                      {/* ── Expanded: MoM Breakdown + Zone Drill-down ── */}
                      {isExp && (
                        <tr><td colSpan={11} className="p-0">
                          <div className="bg-indigo-50/20 border-t border-indigo-100">
                            {/* MoM Breakdown Table */}
                            <div className="px-4 py-3 border-b border-indigo-100">
                              <h4 className="text-[11px] font-bold text-indigo-700 flex items-center gap-1.5 mb-2"><TrendingUp className="w-3.5 h-3.5" /> MoM Breakdown — {p.label}</h4>
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
                                <div className="chart-container lg:col-span-2">
                                  <LineChart title={`${p.label} — Delivery & RTO Trend`}
                                    labels={platformMoM.map(m => m.month)}
                                    datasets={[
                                      { label: 'Del %', data: platformMoM.map(m => parseFloat(m.deliveredPct.toFixed(1))), color: '#10B981', fill: true },
                                      { label: 'RTO %', data: platformMoM.map(m => parseFloat(m.rtoPct.toFixed(1))), color: '#EF4444' },
                                    ]} height={180} />
                                </div>
                                <div className="chart-container">
                                  <BarChart title="Monthly Volume"
                                    labels={platformMoM.map(m => m.month)}
                                    datasets={[{ label: 'Shipments', data: platformMoM.map(m => m.total), color: '#6366F1' }]}
                                    height={180} />
                                </div>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-[10px]">
                                  <thead><tr className="border-b border-indigo-200 bg-indigo-50/50">
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Month</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Booked</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-emerald-600">Del</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-emerald-600">Del %</th>
                                    <th className="px-2 py-1.5 text-center font-semibold text-gray-400">MoM</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-red-500">RTO</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-red-500">RTO %</th>
                                    <th className="px-2 py-1.5 text-center font-semibold text-gray-400">MoM</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-indigo-500">Transit</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-amber-600">Other</th>
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Breakdown</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-gray-500">TAT</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Cost %</th>
                                  </tr></thead>
                                  <tbody className="divide-y divide-indigo-50">
                                    {platformMoM.map(m => {
                                      const oth = m.failed + m.lost;
                                      const dW = m.total > 0 ? (m.delivered / m.total * 100) : 0;
                                      const rW = m.total > 0 ? (m.rto / m.total * 100) : 0;
                                      const iW = m.total > 0 ? (m.inTransit / m.total * 100) : 0;
                                      const oW = m.total > 0 ? (oth / m.total * 100) : 0;
                                      return (
                                      <tr key={m.month} className="hover:bg-indigo-50/30 transition-colors">
                                        <td className="px-2 py-1.5 font-medium text-gray-700">{m.month}</td>
                                        <td className="px-2 py-1.5 text-right text-gray-600">{m.total}</td>
                                        <td className="px-2 py-1.5 text-right text-emerald-600 cursor-pointer" onClick={() => onDrill({ title: `${p.label} — ${m.month} — Delivered`, data: m.rows.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)) })}><span className="underline underline-offset-2 decoration-emerald-200">{m.delivered}</span></td>
                                        <td className="px-2 py-1.5 text-right"><span className={perfColor(m.deliveredPct).text}>{fmtPct(m.deliveredPct)}</span></td>
                                        <td className="px-2 py-1.5 text-center"><DeltaBadge current={m.deliveredPct} previous={m.prev?.deliveredPct} suffix="pp" /></td>
                                        <td className="px-2 py-1.5 text-right text-red-500 cursor-pointer" onClick={() => onDrill({ title: `${p.label} — ${m.month} — RTO`, data: m.rows.filter(r => isRTO(r.status)) })}><span className="underline underline-offset-2 decoration-red-200">{m.rto}</span></td>
                                        <td className="px-2 py-1.5 text-right text-red-600">{fmtPct(m.rtoPct)}</td>
                                        <td className="px-2 py-1.5 text-center"><DeltaBadge current={m.rtoPct} previous={m.prev?.rtoPct} invert suffix="pp" /></td>
                                        <td className="px-2 py-1.5 text-right text-indigo-500 cursor-pointer" onClick={() => onDrill({ title: `${p.label} — ${m.month} — In-Transit`, data: m.rows.filter(r => isInTransit(r.status) || isOFD(r.status)) })}><span className="underline underline-offset-2 decoration-indigo-200">{m.inTransit}</span></td>
                                        <td className="px-2 py-1.5 text-right text-amber-600">{oth > 0 ? oth : '—'}</td>
                                        <td className="px-2 py-1 min-w-[100px]">
                                          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 w-full">
                                            {dW > 0 && <div className="bg-emerald-500" style={{ width: `${dW}%` }} />}
                                            {rW > 0 && <div className="bg-red-400" style={{ width: `${rW}%` }} />}
                                            {iW > 0 && <div className="bg-indigo-400" style={{ width: `${iW}%` }} />}
                                            {oW > 0 && <div className="bg-amber-400" style={{ width: `${oW}%` }} />}
                                          </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-gray-600">{m.avgTAT != null ? fmt(m.avgTAT) + 'd' : '—'}</td>
                                        <td className="px-2 py-1.5 text-right"><span className={costColor(m.costPct).text}>{fmtPct(m.costPct)}</span></td>
                                      </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* AI Root Cause Analysis */}
                            {platformRootCause.length > 0 && (
                              <div className="px-4 py-3 border-b border-indigo-100">
                                <h4 className="text-[11px] font-bold text-indigo-700 flex items-center gap-1.5 mb-2"><Brain className="w-3.5 h-3.5" /> AI Root Cause Analysis — {p.label}</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {platformRootCause.map((rc, i) => <InsightCard key={i} icon={rc.icon} title={rc.title} description={rc.description} severity={rc.severity} />)}
                                </div>
                              </div>
                            )}

                            {/* Courier Performance */}
                            {courierBreakdown.length > 0 && (
                              <div className="px-4 py-3 border-b border-indigo-100">
                                <h4 className="text-[11px] font-bold text-indigo-700 flex items-center gap-1.5 mb-2"><Truck className="w-3.5 h-3.5" /> Courier Performance — {p.label}</h4>
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
                                  <div className="lg:col-span-2 overflow-x-auto">
                                    <table className="w-full text-[10px]">
                                      <thead><tr className="border-b border-indigo-100 bg-indigo-50/30">
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Courier</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Total</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-emerald-600">Del %</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-red-500">RTO %</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-indigo-500">Transit %</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-amber-600">Other %</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Breakdown</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-gray-500">TAT</th>
                                        <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Cost %</th>
                                      </tr></thead>
                                      <tbody className="divide-y divide-indigo-50">
                                        {courierBreakdown.map(c => {
                                          const cOth = c.failed + c.lost;
                                          const cdW = c.total > 0 ? (c.delivered / c.total * 100) : 0;
                                          const crW = c.total > 0 ? (c.rto / c.total * 100) : 0;
                                          const ciW = c.total > 0 ? (c.inTransit / c.total * 100) : 0;
                                          const coW = c.total > 0 ? (cOth / c.total * 100) : 0;
                                          const cDrill = (lbl, fn) => onDrill({ title: `${p.label} → ${c.label} — ${lbl}`, data: c.rows.filter(fn) });
                                          return (
                                          <tr key={c.label} className="hover:bg-indigo-50/30 transition-colors">
                                            <td className="px-2 py-1.5 font-medium text-gray-700">{c.label}</td>
                                            <td className="px-2 py-1.5 text-right text-gray-600">{c.total}</td>
                                            <td className="px-2 py-1.5 text-right cursor-pointer" onClick={() => cDrill(`Delivered (${c.delivered})`, r => isDelivered(r.status) || isPartialDelivered(r.status))}><span className={`${perfColor(c.deliveredPct).text} underline underline-offset-2`}>{fmtPct(c.deliveredPct)}</span></td>
                                            <td className="px-2 py-1.5 text-right cursor-pointer" onClick={() => cDrill(`RTO (${c.rto})`, r => isRTO(r.status))}><span className="text-red-500 underline underline-offset-2 decoration-red-200">{fmtPct(c.rtoPct)}</span></td>
                                            <td className="px-2 py-1.5 text-right cursor-pointer" onClick={() => cDrill(`In-Transit (${c.inTransit})`, r => isInTransit(r.status) || isOFD(r.status))}><span className="text-indigo-500 underline underline-offset-2 decoration-indigo-200">{fmtPct(ciW)}</span></td>
                                            <td className="px-2 py-1.5 text-right text-amber-600">{coW > 0 ? fmtPct(coW) : '—'}</td>
                                            <td className="px-2 py-1 min-w-[80px]">
                                              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 w-full">
                                                {cdW > 0 && <div className="bg-emerald-500" style={{ width: `${cdW}%` }} />}
                                                {crW > 0 && <div className="bg-red-400" style={{ width: `${crW}%` }} />}
                                                {ciW > 0 && <div className="bg-indigo-400" style={{ width: `${ciW}%` }} />}
                                                {coW > 0 && <div className="bg-amber-400" style={{ width: `${coW}%` }} />}
                                              </div>
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-gray-600">{c.avgTAT != null ? fmt(c.avgTAT) + 'd' : '—'}</td>
                                            <td className="px-2 py-1.5 text-right"><span className={costColor(c.costPct).text}>{fmtPct(c.costPct)}</span></td>
                                          </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="chart-container">
                                    <PieChart title="Courier Volume Share" labels={courierBreakdown.slice(0, 6).map(c => c.label)} data={courierBreakdown.slice(0, 6).map(c => c.total)} height={180} />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Failure & Non-Delivered Analysis */}
                            {failureAnalysis.totalNonDel > 0 && (
                              <div className="px-4 py-3 border-b border-indigo-100">
                                <h4 className="text-[11px] font-bold text-red-700 flex items-center gap-1.5 mb-3"><AlertTriangle className="w-3.5 h-3.5" /> Non-Delivered Analysis — {p.label} ({failureAnalysis.totalNonDel} shipments)</h4>

                                {/* Status-wise breakdown with reasons */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                                  {failureAnalysis.statusBreakdown.map(s => {
                                    const Icon = s.icon;
                                    const colorMap = { red: 'border-red-200 bg-red-50/80', indigo: 'border-indigo-200 bg-indigo-50/80', gray: 'border-gray-200 bg-gray-50/80', amber: 'border-amber-200 bg-amber-50/80' };
                                    const textMap = { red: 'text-red-700', indigo: 'text-indigo-700', gray: 'text-gray-700', amber: 'text-amber-700' };
                                    const badgeMap = { red: 'bg-red-100 text-red-600', indigo: 'bg-indigo-100 text-indigo-600', gray: 'bg-gray-100 text-gray-600', amber: 'bg-amber-100 text-amber-600' };
                                    return (
                                      <div key={s.label} className={`rounded-xl border ${colorMap[s.color]} overflow-hidden`}>
                                        <button onClick={() => onDrill({ title: `${p.label} — ${s.label} (${s.count})`, data: s.rows })}
                                          className="w-full p-3 text-left hover:brightness-95 transition-all">
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-1.5"><Icon className={`w-3.5 h-3.5 ${textMap[s.color]}`} /><span className={`text-[10px] font-bold ${textMap[s.color]} uppercase`}>{s.label}</span></div>
                                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${badgeMap[s.color]}`}>{fmtPct(s.count / failureAnalysis.totalNonDel * 100)}</span>
                                          </div>
                                          <p className={`text-2xl font-bold ${textMap[s.color]}`}>{s.count.toLocaleString('en-IN')}</p>
                                        </button>
                                        {/* Top reasons for this status */}
                                        {s.reasons.length > 0 && s.reasons[0][0] !== 'No remark' && (
                                          <div className="px-3 pb-2 pt-1 border-t border-dashed border-gray-200/60">
                                            <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Top Reasons</p>
                                            {s.reasons.slice(0, 3).map(([reason, cnt]) => (
                                              <div key={reason} className="flex items-center justify-between text-[9px] py-0.5 cursor-pointer hover:bg-white/50 rounded px-0.5"
                                                onClick={() => onDrill({ title: `${p.label} — ${s.label} — ${reason}`, data: s.rows.filter(r => { const rm = (r.failureRemarks || '').trim(); return reason === 'No remark' ? (!rm || rm === 'NA' || rm === '-') : rm === reason; }) })}>
                                                <span className="text-gray-600 truncate mr-1 flex-1">{reason}</span>
                                                <span className={`font-semibold ${textMap[s.color]}`}>{cnt}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* MoM Non-Delivered Trend */}
                                {failureAnalysis.monthlyNonDel.length > 0 && (
                                  <div className="mb-3">
                                    <p className="text-[10px] font-semibold text-gray-600 mb-2">MoM Non-Delivered Trend — Click any month to see all reasons</p>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                      <div className="chart-container">
                                        <BarChart title="Non-Delivered by Month & Status"
                                          labels={failureAnalysis.monthlyNonDel.map(m => m.month)}
                                          datasets={[
                                            { label: 'RTO', data: failureAnalysis.monthlyNonDel.map(m => m.rto), color: '#EF4444' },
                                            { label: 'In-Transit', data: failureAnalysis.monthlyNonDel.map(m => m.intransit), color: '#6366F1' },
                                            { label: 'Lost', data: failureAnalysis.monthlyNonDel.map(m => m.lost), color: '#9CA3AF' },
                                            { label: 'Other', data: failureAnalysis.monthlyNonDel.map(m => m.other), color: '#F59E0B' },
                                          ]}
                                          options={{ plugins: { legend: { display: true, position: 'top', labels: { font: { size: 9 }, padding: 8 } } } }}
                                          stacked height={160} />
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-[10px]">
                                          <thead><tr className="border-b border-red-100 bg-red-50/30">
                                            <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Month</th>
                                            <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Total</th>
                                            <th className="px-2 py-1.5 text-right font-semibold text-red-500">RTO</th>
                                            <th className="px-2 py-1.5 text-right font-semibold text-indigo-500">Transit</th>
                                            <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Lost</th>
                                            <th className="px-2 py-1.5 text-right font-semibold text-amber-600">Other</th>
                                            <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Top Reason</th>
                                          </tr></thead>
                                          <tbody className="divide-y divide-red-50">
                                            {failureAnalysis.monthlyNonDel.map(m => {
                                              const isMonthExp = expMonth === m.month;
                                              /* All reasons for this month */
                                              const monthReasons = (() => {
                                                const rc = {};
                                                m.rows.forEach(r => { const rm = (r.failureRemarks || '').trim(); const k = rm && rm !== 'NA' && rm !== '-' ? rm : 'No remark available'; rc[k] = (rc[k] || 0) + 1; });
                                                return Object.entries(rc).sort((a, b) => b[1] - a[1]);
                                              })();
                                              return (
                                              <React.Fragment key={m.month}>
                                              <tr className={`hover:bg-red-50/30 transition-colors cursor-pointer ${isMonthExp ? 'bg-red-50/40' : ''}`} onClick={() => setExpMonth(isMonthExp ? null : m.month)}>
                                                <td className="px-2 py-1 font-medium text-gray-700 flex items-center gap-1">{isMonthExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{m.month}</td>
                                                <td className="px-2 py-1 text-right text-gray-600">{m.total}</td>
                                                <td className="px-2 py-1 text-right text-red-500 cursor-pointer underline decoration-red-200" onClick={e => { e.stopPropagation(); onDrill({ title: `${p.label} — ${m.month} — RTO`, data: m.rows.filter(r => isRTO(r.status)) }); }}>{m.rto || '—'}</td>
                                                <td className="px-2 py-1 text-right text-indigo-500 cursor-pointer underline decoration-indigo-200" onClick={e => { e.stopPropagation(); onDrill({ title: `${p.label} — ${m.month} — In-Transit`, data: m.rows.filter(r => isInTransit(r.status) || isOFD(r.status)) }); }}>{m.intransit || '—'}</td>
                                                <td className="px-2 py-1 text-right text-gray-500">{m.lost || '—'}</td>
                                                <td className="px-2 py-1 text-right text-amber-600">{m.other || '—'}</td>
                                                <td className="px-2 py-1 text-left text-[9px] text-gray-500 truncate max-w-[120px]">{m.topReason ? <span>{m.topReason[0]} <span className="text-red-500 font-semibold">({m.topReason[1]})</span></span> : '—'}</td>
                                              </tr>
                                              {/* Expanded: All reasons for this month */}
                                              {isMonthExp && (
                                                <tr><td colSpan={7} className="px-3 py-2 bg-red-50/20">
                                                  <p className="text-[9px] font-bold text-red-700 uppercase mb-1.5">All Reasons — {m.month} ({m.total} non-delivered)</p>
                                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                                                    {monthReasons.map(([reason, cnt]) => (
                                                      <div key={reason} className="flex items-center justify-between text-[10px] py-0.5 px-1.5 rounded hover:bg-red-100/50 cursor-pointer"
                                                        onClick={() => onDrill({ title: `${p.label} — ${m.month} — ${reason}`, data: m.rows.filter(r => { const rm = (r.failureRemarks || '').trim(); return reason === 'No remark available' ? (!rm || rm === 'NA' || rm === '-') : rm === reason; }) })}>
                                                        <span className="text-gray-700 truncate mr-2 flex-1">{reason}</span>
                                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                                          <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(100, (cnt / m.total) * 100)}%` }} /></div>
                                                          <span className="text-red-600 font-semibold w-6 text-right">{cnt}</span>
                                                        </div>
                                                      </div>
                                                    ))}
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
                                )}

                                {/* Failure Reasons + Zone/Courier breakdown */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                  <div className="bg-white rounded-lg border border-red-100 p-3">
                                    <p className="text-[10px] font-semibold text-red-700 mb-2">Top Failure Reasons</p>
                                    <div className="space-y-1">
                                      {failureAnalysis.reasons.slice(0, 8).map(([reason, count]) => (
                                        <div key={reason} className="flex items-center justify-between text-[10px] py-0.5 px-1 rounded hover:bg-red-50 cursor-pointer"
                                          onClick={() => onDrill({ title: `${p.label} — ${reason}`, data: failureAnalysis.nonDelRows.filter(r => { const rm = (r.failureRemarks || '').trim(); return reason === 'No remark available' ? (!rm || rm === 'NA' || rm === '-') : rm === reason; }) })}>
                                          <span className="text-gray-700 truncate mr-2 flex-1">{reason}</span>
                                          <span className="text-red-600 font-semibold">{count}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-amber-100 p-3">
                                    <p className="text-[10px] font-semibold text-amber-700 mb-2">Worst Zones (Non-Delivered)</p>
                                    <div className="space-y-1">
                                      {failureAnalysis.topZones.map(([zone, count]) => (
                                        <div key={zone} className="flex items-center justify-between text-[10px] py-0.5 cursor-pointer hover:bg-amber-50 rounded px-1"
                                          onClick={() => onDrill({ title: `${p.label} → ${zone} — Non-Delivered`, data: failureAnalysis.nonDelRows.filter(r => (r.zone || 'Unknown') === zone) })}>
                                          <span className="text-gray-700">{zone}</span>
                                          <div className="flex items-center gap-2">
                                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, (count / failureAnalysis.totalNonDel) * 100)}%` }} /></div>
                                            <span className="text-amber-600 font-semibold w-8 text-right">{count}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="bg-white rounded-lg border border-blue-100 p-3">
                                    <p className="text-[10px] font-semibold text-blue-700 mb-2">Worst Couriers (Non-Delivered)</p>
                                    <div className="space-y-1">
                                      {failureAnalysis.topCouriers.map(([courier, count]) => (
                                        <div key={courier} className="flex items-center justify-between text-[10px] py-0.5 cursor-pointer hover:bg-blue-50 rounded px-1"
                                          onClick={() => onDrill({ title: `${p.label} → ${courier} — Non-Delivered`, data: failureAnalysis.nonDelRows.filter(r => (r.vendor || 'Unknown') === courier) })}>
                                          <span className="text-gray-700">{courier}</span>
                                          <div className="flex items-center gap-2">
                                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (count / failureAnalysis.totalNonDel) * 100)}%` }} /></div>
                                            <span className="text-blue-600 font-semibold w-8 text-right">{count}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Zone Breakdown */}
                            <div className="px-4 py-3">
                              <h4 className="text-[11px] font-bold text-indigo-700 flex items-center gap-1.5 mb-2"><MapPin className="w-3.5 h-3.5" /> Zone Breakdown — {p.label}</h4>
                              <table className="w-full text-[10px]">
                                <thead><tr className="border-b border-indigo-100">
                                  <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Zone</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Total</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-emerald-600">Del %</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-red-500">RTO %</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-indigo-500">Transit %</th>
                                  <th className="px-2 py-1.5 text-left font-semibold text-gray-500">Breakdown</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500">TAT</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500">Cost %</th>
                                </tr></thead>
                                <tbody className="divide-y divide-indigo-50">
                                  {zoneBreakdown.map(z => {
                                    const zExp = drillZone === z.label;
                                    const zOth = z.failed + z.lost;
                                    const zdW = z.total > 0 ? (z.delivered / z.total * 100) : 0;
                                    const zrW = z.total > 0 ? (z.rto / z.total * 100) : 0;
                                    const ziW = z.total > 0 ? (z.inTransit / z.total * 100) : 0;
                                    const zoW = z.total > 0 ? (zOth / z.total * 100) : 0;
                                    const zDrill = (lbl, fn) => { event?.stopPropagation?.(); onDrill({ title: `${p.label} → ${z.label} — ${lbl}`, data: z.rows.filter(fn) }); };
                                    return (
                                      <React.Fragment key={z.label}>
                                        <tr className={`hover:bg-indigo-50/50 cursor-pointer ${zExp ? 'bg-indigo-100/30' : ''}`} onClick={() => setDrillZone(zExp ? null : z.label)}>
                                          <td className="px-2 py-1.5 font-medium text-gray-700 flex items-center gap-1">{zExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{z.label}</td>
                                          <td className="px-2 py-1.5 text-right text-gray-600">{z.total}</td>
                                          <td className="px-2 py-1.5 text-right cursor-pointer" onClick={e => { e.stopPropagation(); zDrill(`Delivered (${z.delivered})`, r => isDelivered(r.status) || isPartialDelivered(r.status)); }}><span className={`${perfColor(z.deliveredPct).text} underline underline-offset-2`}>{fmtPct(z.deliveredPct)}</span></td>
                                          <td className="px-2 py-1.5 text-right cursor-pointer" onClick={e => { e.stopPropagation(); zDrill(`RTO (${z.rto})`, r => isRTO(r.status)); }}><span className="text-red-500 underline underline-offset-2 decoration-red-200">{fmtPct(z.rtoPct)}</span></td>
                                          <td className="px-2 py-1.5 text-right cursor-pointer" onClick={e => { e.stopPropagation(); zDrill(`In-Transit (${z.inTransit})`, r => isInTransit(r.status) || isOFD(r.status)); }}><span className="text-indigo-500 underline underline-offset-2 decoration-indigo-200">{fmtPct(ziW)}</span></td>
                                          <td className="px-2 py-1 min-w-[70px]"><div className="flex h-2 rounded-full overflow-hidden bg-gray-100 w-full">{zdW > 0 && <div className="bg-emerald-500" style={{ width: `${zdW}%` }} />}{zrW > 0 && <div className="bg-red-400" style={{ width: `${zrW}%` }} />}{ziW > 0 && <div className="bg-indigo-400" style={{ width: `${ziW}%` }} />}{zoW > 0 && <div className="bg-amber-400" style={{ width: `${zoW}%` }} />}</div></td>
                                          <td className="px-2 py-1.5 text-right text-gray-600">{z.avgTAT != null ? fmt(z.avgTAT) + 'd' : '—'}</td>
                                          <td className="px-2 py-1.5 text-right"><span className={costColor(z.costPct).text}>{fmtPct(z.costPct)}</span></td>
                                        </tr>
                                        {zExp && cityBreakdown.length > 0 && (
                                          <tr><td colSpan={7} className="px-4 py-2 bg-indigo-50/20">
                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                              {cityBreakdown.slice(0, 16).map(c => (
                                                <button key={c.label} onClick={() => onDrill({ title: `${p.label} → ${z.label} → ${c.label}`, data: c.rows })}
                                                  className={`text-left p-2 rounded-lg border ${perfColor(c.deliveredPct).border} ${perfColor(c.deliveredPct).bg} hover:shadow-md transition-all`}>
                                                  <p className="text-[10px] font-semibold text-gray-700 truncate">{c.label}</p>
                                                  <div className="flex items-center justify-between mt-0.5">
                                                    <span className="text-[9px] text-gray-500">{c.total} orders</span>
                                                    <span className={`text-[10px] font-bold ${perfColor(c.deliveredPct).text}`}>{fmtPct(c.deliveredPct)}</span>
                                                  </div>
                                                </button>
                                              ))}
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
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── COMPARE VIEW ── */}
      {viewMode === 'compare' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={compareA} onChange={e => setCompareA(e.target.value)} className="filter-select text-[11px] px-2 py-1.5 min-w-[140px]">
              <option value="">Select Platform A</option>
              {stats.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
            <span className="text-[11px] text-gray-400 font-bold">VS</span>
            <select value={compareB} onChange={e => setCompareB(e.target.value)} className="filter-select text-[11px] px-2 py-1.5 min-w-[140px]">
              <option value="">Select Platform B</option>
              {stats.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
          {compareData && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500">Metric</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-indigo-600">{compareData.a.label}</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-purple-600">{compareData.b.label}</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-gray-500">Winner</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {[
                    { label: 'Volume', a: compareData.a.total, b: compareData.b.total, fmt: v => v.toLocaleString('en-IN'), higher: true },
                    { label: 'Delivered %', a: compareData.a.deliveredPct, b: compareData.b.deliveredPct, fmt: fmtPct, higher: true },
                    { label: 'RTO %', a: compareData.a.rtoPct, b: compareData.b.rtoPct, fmt: fmtPct, higher: false },
                    { label: 'Avg TAT', a: compareData.a.avgTAT, b: compareData.b.avgTAT, fmt: v => v != null ? fmt(v) + 'd' : '—', higher: false },
                    { label: 'Cost %', a: compareData.a.costPct, b: compareData.b.costPct, fmt: fmtPct, higher: false },
                    { label: 'Health Score', a: compareData.a.healthScore, b: compareData.b.healthScore, fmt: v => String(v), higher: true },
                  ].map(row => {
                    const aWins = row.a != null && row.b != null && (row.higher ? row.a > row.b : row.a < row.b);
                    const bWins = row.a != null && row.b != null && (row.higher ? row.b > row.a : row.b < row.a);
                    return (
                      <tr key={row.label}>
                        <td className="px-4 py-2.5 font-medium text-gray-700">{row.label}</td>
                        <td className={`px-4 py-2.5 text-center font-semibold ${aWins ? 'text-emerald-600 bg-emerald-50/50' : 'text-gray-600'}`}>{row.fmt(row.a)}</td>
                        <td className={`px-4 py-2.5 text-center font-semibold ${bWins ? 'text-emerald-600 bg-emerald-50/50' : 'text-gray-600'}`}>{row.fmt(row.b)}</td>
                        <td className="px-4 py-2.5 text-center text-[10px] font-bold">{aWins ? <span className="text-indigo-600">{compareData.a.label}</span> : bWins ? <span className="text-purple-600">{compareData.b.label}</span> : <span className="text-gray-400">Tie</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!compareData && <p className="text-center text-[11px] text-gray-400 py-8">Select two platforms above to compare</p>}
        </div>
      )}

      {/* ── TREND CHARTS VIEW ── */}
      {viewMode === 'charts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container">
            <LineChart title="Delivery % by Platform (Top 5)" labels={(() => { const allM = new Set(); stats.slice(0,5).forEach(p => p.monthTrend.forEach(m => allM.add(m.month))); return sortMonths([...allM]); })()}
              datasets={stats.slice(0, 5).map((p, i) => {
                const map = {}; p.monthTrend.forEach(m => { map[m.month] = m.deliveredPct; });
                const allM = (() => { const s = new Set(); stats.slice(0,5).forEach(pp => pp.monthTrend.forEach(m => s.add(m.month))); return sortMonths([...s]); })();
                return { label: p.label, data: allM.map(m => map[m] != null ? parseFloat(map[m].toFixed(1)) : null), color: COLORS[i] };
              })} height={250} />
          </div>
          <div className="chart-container">
            <BarChart title="RTO % by Platform"
              labels={stats.filter(p => p.total > 20).slice(0, 10).map(p => p.label)}
              datasets={[{ label: 'RTO %', data: stats.filter(p => p.total > 20).slice(0, 10).map(p => parseFloat(p.rtoPct.toFixed(1))),
                backgroundColor: stats.filter(p => p.total > 20).slice(0, 10).map(p => p.rtoPct > 10 ? '#EF4444' : p.rtoPct > 5 ? '#F59E0B' : '#10B981') }]}
              height={250} />
          </div>
          <div className="chart-container">
            <BarChart title="Avg TAT by Platform (Days)"
              labels={stats.filter(p => p.avgTAT != null && p.total > 20).slice(0, 10).map(p => p.label)}
              datasets={[{ label: 'TAT', data: stats.filter(p => p.avgTAT != null && p.total > 20).slice(0, 10).map(p => parseFloat(p.avgTAT.toFixed(1))),
                backgroundColor: stats.filter(p => p.avgTAT != null && p.total > 20).slice(0, 10).map(p => p.avgTAT > 10 ? '#EF4444' : p.avgTAT > 7 ? '#F59E0B' : '#10B981') }]}
              height={250} />
          </div>
          <div className="chart-container">
            <BarChart title="Health Score by Platform"
              labels={withScore.filter(p => p.total > 20).slice(0, 10).map(p => p.label)}
              datasets={[{ label: 'Score', data: withScore.filter(p => p.total > 20).slice(0, 10).map(p => p.healthScore),
                backgroundColor: withScore.filter(p => p.total > 20).slice(0, 10).map(p => p.healthScore >= 75 ? '#10B981' : p.healthScore >= 50 ? '#F59E0B' : '#EF4444') }]}
              height={250} />
          </div>
        </div>
      )}

      {/* ── VOLUME SHARE VIEW ── */}
      {viewMode === 'share' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container">
            <PieChart title="Volume Share by Platform" labels={stats.slice(0, 10).map(p => p.label)} data={stats.slice(0, 10).map(p => p.total)} height={280} />
          </div>
          <div className="chart-container">
            <DoughnutChart title="Cost Share by Platform" labels={stats.filter(p => p.totalCost > 0).slice(0, 10).map(p => p.label)} data={stats.filter(p => p.totalCost > 0).slice(0, 10).map(p => parseFloat(p.totalCost.toFixed(0)))} height={280} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB 3: ZONE & CITY
   ═══════════════════════════════════════════ */
function ZoneCityTab({ zoneStats, cityStats, heatmap, platformStats, classified, onDrill }) {
  const [expanded, setExpanded] = useState(null);
  const [viewMode, setViewMode] = useState('table');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total Zones" value={zoneStats.length} icon={MapPin} color="blue" />
        <KPICard title="Total Cities" value={cityStats.length} icon={Building2} color="purple" />
        <KPICard title="Best Zone" value={zoneStats.length > 0 ? [...zoneStats].sort((a, b) => b.deliveredPct - a.deliveredPct)[0].label : '—'} icon={CheckCircle} color="green"
          subtitle={zoneStats.length > 0 ? fmtPct([...zoneStats].sort((a, b) => b.deliveredPct - a.deliveredPct)[0].deliveredPct) : ''} />
        <KPICard title="Worst Zone" value={zoneStats.filter(z => z.total > 10).length > 0 ? [...zoneStats].filter(z => z.total > 10).sort((a, b) => a.deliveredPct - b.deliveredPct)[0].label : '—'} icon={AlertTriangle} color="red"
          subtitle={zoneStats.filter(z => z.total > 10).length > 0 ? fmtPct([...zoneStats].filter(z => z.total > 10).sort((a, b) => a.deliveredPct - b.deliveredPct)[0].deliveredPct) : ''} />
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        <button onClick={() => setViewMode('table')} className={`tab-btn ${viewMode === 'table' ? 'tab-btn-active' : 'tab-btn-inactive'}`}>Table View</button>
        <button onClick={() => setViewMode('heatmap')} className={`tab-btn ${viewMode === 'heatmap' ? 'tab-btn-active' : 'tab-btn-inactive'}`}>Heatmap</button>
      </div>

      {viewMode === 'table' && (
        <>
          {/* Zone chart */}
          <div className="chart-container">
            <BarChart title="Zone-wise Delivery %" labels={zoneStats.map(z => z.label)}
              datasets={[{ label: 'Delivered %', data: zoneStats.map(z => parseFloat(z.deliveredPct.toFixed(1))),
                backgroundColor: zoneStats.map(z => z.deliveredPct >= 85 ? '#10B981' : z.deliveredPct >= 70 ? '#F59E0B' : '#EF4444') }]}
              height={220}
              options={{ onClick: (_, els) => { if (els.length > 0) { const z = zoneStats[els[0].index]; if (z) onDrill({ title: `Zone: ${z.label}`, data: z.rows }); } } }}
            />
          </div>

          {/* Zone table with expandable cities */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Zone Performance</h3>
              <p className="text-[10px] text-gray-400 mt-0.5">Click zone to expand city-level data</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase">Zone</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 uppercase">Del %</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-red-500 uppercase">RTO %</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-indigo-500 uppercase">Transit %</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase">Breakdown</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">TAT</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Cost %</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-gray-500 uppercase">Trend</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-gray-500 uppercase">Tag</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {zoneStats.map(z => {
                    const pc = perfColor(z.deliveredPct);
                    const isExp = expanded === z.label;
                    const zoneCities = isExp ? computeGroupedMetrics(classified.filter(r => r.zone === z.label), 'destination') : [];
                    const zOth = z.failed + z.lost;
                    const zdW = z.total > 0 ? (z.delivered / z.total * 100) : 0;
                    const zrW = z.total > 0 ? (z.rto / z.total * 100) : 0;
                    const ziW = z.total > 0 ? (z.inTransit / z.total * 100) : 0;
                    const zoW = z.total > 0 ? (zOth / z.total * 100) : 0;
                    const zDrill = (lbl, fn) => onDrill({ title: `Zone: ${z.label} — ${lbl}`, data: z.rows.filter(fn) });
                    return (
                      <React.Fragment key={z.label}>
                        <tr className={`hover:bg-gray-50 cursor-pointer ${pc.bg}`} onClick={() => setExpanded(isExp ? null : z.label)}>
                          <td className="px-3 py-2.5 font-medium text-gray-800 flex items-center gap-1">{isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{z.label}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{z.total.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2.5 text-right cursor-pointer" onClick={e => { e.stopPropagation(); zDrill(`Delivered (${z.delivered})`, r => isDelivered(r.status) || isPartialDelivered(r.status)); }}><span className={`font-bold ${pc.text} underline underline-offset-2`}>{fmtPct(z.deliveredPct)}</span></td>
                          <td className="px-3 py-2.5 text-right cursor-pointer" onClick={e => { e.stopPropagation(); zDrill(`RTO (${z.rto})`, r => isRTO(r.status)); }}><span className="text-red-500 underline underline-offset-2 decoration-red-200">{fmtPct(z.rtoPct)}</span></td>
                          <td className="px-3 py-2.5 text-right cursor-pointer" onClick={e => { e.stopPropagation(); zDrill(`In-Transit (${z.inTransit})`, r => isInTransit(r.status) || isOFD(r.status)); }}><span className="text-indigo-500 underline underline-offset-2 decoration-indigo-200">{fmtPct(ziW)}</span></td>
                          <td className="px-3 py-2 min-w-[100px]"><div className="flex h-2 rounded-full overflow-hidden bg-gray-100 w-full">{zdW > 0 && <div className="bg-emerald-500" style={{ width: `${zdW}%` }} />}{zrW > 0 && <div className="bg-red-400" style={{ width: `${zrW}%` }} />}{ziW > 0 && <div className="bg-indigo-400" style={{ width: `${ziW}%` }} />}{zoW > 0 && <div className="bg-amber-400" style={{ width: `${zoW}%` }} />}</div></td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{z.avgTAT != null ? fmt(z.avgTAT) + 'd' : '—'}</td>
                          <td className="px-3 py-2.5 text-right"><span className={costColor(z.costPct).text}>{fmtPct(z.costPct)}</span></td>
                          <td className="px-3 py-2.5 text-center"><MiniSparkline values={z.monthTrend.map(m => m.deliveredPct)} color={z.deliveredPct >= 80 ? '#10B981' : '#EF4444'} /></td>
                          <td className="px-3 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${pc.bg} ${pc.text} border ${pc.border}`}>{pc.tag}</span></td>
                        </tr>
                        {isExp && zoneCities.length > 0 && (
                          <tr><td colSpan={10} className="px-4 py-3 bg-gray-50/50">
                            <h5 className="text-[10px] font-bold text-gray-600 mb-2">Cities in {z.label}</h5>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                              {zoneCities.slice(0, 16).map(c => {
                                const ccOth = c.failed + c.lost;
                                return (
                                <div key={c.label} className={`text-left p-2 rounded-lg border ${perfColor(c.deliveredPct).border} ${perfColor(c.deliveredPct).bg}`}>
                                  <p className="text-[10px] font-semibold text-gray-700 truncate">{c.label}</p>
                                  <p className="text-[9px] text-gray-400">{c.total} orders</p>
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    <span className="text-[8px] text-emerald-600 cursor-pointer underline" onClick={() => onDrill({ title: `${z.label} → ${c.label} — Delivered`, data: c.rows.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)) })}>Del:{c.delivered}</span>
                                    {c.rto > 0 && <span className="text-[8px] text-red-500 cursor-pointer underline" onClick={() => onDrill({ title: `${z.label} → ${c.label} — RTO`, data: c.rows.filter(r => isRTO(r.status)) })}>RTO:{c.rto}</span>}
                                    {c.inTransit > 0 && <span className="text-[8px] text-indigo-500 cursor-pointer underline" onClick={() => onDrill({ title: `${z.label} → ${c.label} — Transit`, data: c.rows.filter(r => isInTransit(r.status) || isOFD(r.status)) })}>Trn:{c.inTransit}</span>}
                                    {ccOth > 0 && <span className="text-[8px] text-amber-600">Oth:{ccOth}</span>}
                                  </div>
                                </div>
                                );
                              })}
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
        </>
      )}

      {viewMode === 'heatmap' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Delivery % Heatmap — Zone × Platform</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Click any cell for shipment details</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-bold text-gray-600 sticky left-0 bg-gray-50 z-10">Zone \ Platform</th>
                {heatmap.platforms.map(p => <th key={p} className="px-3 py-2.5 text-center font-semibold text-gray-600 whitespace-nowrap">{p}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {heatmap.zones.map(z => (
                  <tr key={z} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">{z}</td>
                    {heatmap.platforms.map(p => {
                      const cell = heatmap.cells[`${z}||${p}`];
                      if (!cell || cell.total === 0) return <td key={p} className="px-3 py-2 text-center text-gray-300 text-[10px]">—</td>;
                      const pc = perfColor(cell.pct);
                      return (
                        <td key={p} className="px-2 py-1.5 text-center">
                          <button onClick={() => onDrill({ title: `${z} × ${p}`, data: cell.rows })}
                            className="w-full px-2 py-1.5 rounded-lg text-[11px] font-bold hover:shadow-md hover:scale-105 transition-all"
                            style={{ backgroundColor: heatColor(cell.pct, heatmap.min, heatmap.max) }}>
                            <span className={pc.text}>{fmtPct(cell.pct)}</span><br />
                            <span className="text-[9px] font-normal text-gray-500">{cell.total}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 text-[10px] text-gray-500">
            <span className="font-semibold">Legend:</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.2)' }} /> &gt;85% Good</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.2)' }} /> 70-85% Fair</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(220,38,38,0.2)' }} /> &lt;70% Poor</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB 4: COST INTELLIGENCE
   ═══════════════════════════════════════════ */
function CostTab({ classified, platformStats, zoneStats, cityStats, monthlyMetrics, onDrill }) {
  const [expandedPlatform, setExpandedPlatform] = useState(null);

  const overallCost = useMemo(() => {
    const rows = classified.filter(r => r.costNum > 0 && r.invoiceNum > 0);
    const totalCost = rows.reduce((s, r) => s + r.costNum, 0);
    const totalInv = rows.reduce((s, r) => s + r.invoiceNum, 0);
    return { totalCost, totalInv, costPct: totalInv > 0 ? (totalCost / totalInv) * 100 : 0, count: rows.length };
  }, [classified]);

  const highestCostPlatform = platformStats.filter(p => p.costPct > 0 && p.total > 10).sort((a, b) => b.costPct - a.costPct)[0];
  const highestCostZone = zoneStats.filter(z => z.costPct > 0 && z.total > 10).sort((a, b) => b.costPct - a.costPct)[0];

  /* Root cause analysis for highest cost platform */
  const rootCause = useMemo(() => {
    if (!highestCostPlatform) return [];
    const p = highestCostPlatform;
    const causes = [];
    const globalAvgTAT = platformStats.filter(x => x.avgTAT != null).reduce((s, x) => s + x.avgTAT, 0) / (platformStats.filter(x => x.avgTAT != null).length || 1);
    if (p.avgTAT != null && p.avgTAT > globalAvgTAT * 1.3) causes.push({ icon: Truck, title: 'High TAT', description: `${p.label} TAT is ${fmt(p.avgTAT)} days vs avg ${fmt(globalAvgTAT)} days. Longer transit increases cost.`, severity: 'warning' });
    const globalRtoPct = platformStats.reduce((s, x) => s + x.rtoPct, 0) / platformStats.length;
    if (p.rtoPct > globalRtoPct * 1.5) causes.push({ icon: RotateCcw, title: 'High RTO rate', description: `${p.label} RTO at ${fmtPct(p.rtoPct)} vs avg ${fmtPct(globalRtoPct)}. Returns add double shipping cost.`, severity: 'critical' });
    if (p.failedPct > 5) causes.push({ icon: AlertTriangle, title: 'Failed delivery attempts', description: `${fmtPct(p.failedPct)} of shipments failed. Re-attempts increase cost per shipment.`, severity: 'warning' });
    const zones = computeGroupedMetrics(classified.filter(r => r.platform === p.label && r.costNum > 0 && r.invoiceNum > 0), 'zone');
    const highCostZones = zones.filter(z => z.costPct > 12);
    if (highCostZones.length > 0) causes.push({ icon: MapPin, title: 'Zone inefficiency', description: `${highCostZones.length} zones have >12% cost: ${highCostZones.slice(0, 3).map(z => `${z.label} (${fmtPct(z.costPct)})`).join(', ')}.`, severity: 'warning' });
    if (causes.length === 0) causes.push({ icon: Lightbulb, title: 'No clear root cause detected', description: `High cost may be due to distance, weight, or vendor pricing. Review contracts.`, severity: 'info' });
    return causes;
  }, [highestCostPlatform, platformStats, classified]);

  /* Cost trend prediction */
  const costPrediction = useMemo(() => {
    if (monthlyMetrics.length < 3) return null;
    const points = monthlyMetrics.map((m, i) => ({ x: i, y: m.costPct }));
    const { slope, intercept } = linearRegression(points);
    const next3 = [1, 2, 3].map(offset => ({ month: `+${offset}M`, pct: Math.max(0, slope * (points.length - 1 + offset) + intercept) }));
    return { slope, next3, direction: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable' };
  }, [monthlyMetrics]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total Cost" value={currency(overallCost.totalCost)} icon={IndianRupee} color="orange" subtitle={`${overallCost.count} orders`} />
        <KPICard title="Avg Cost %" value={fmtPct(overallCost.costPct)} icon={Target} color="blue" />
        <KPICard title="Highest Cost Platform" value={highestCostPlatform?.label || '—'} icon={Building2} color="red" subtitle={highestCostPlatform ? fmtPct(highestCostPlatform.costPct) : ''} />
        <KPICard title="Highest Cost Zone" value={highestCostZone?.label || '—'} icon={MapPin} color="red" subtitle={highestCostZone ? fmtPct(highestCostZone.costPct) : ''} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart title="Cost % by Platform" labels={platformStats.filter(p => p.costPct > 0).slice(0, 10).map(p => p.label)}
            datasets={[{ label: 'Cost %', data: platformStats.filter(p => p.costPct > 0).slice(0, 10).map(p => parseFloat(p.costPct.toFixed(1))),
              backgroundColor: platformStats.filter(p => p.costPct > 0).slice(0, 10).map(p => p.costPct > 12 ? '#EF4444' : p.costPct > 8 ? '#F59E0B' : '#10B981') }]}
            height={220} />
        </div>
        <div className="chart-container">
          <LineChart title="Cost % Trend"
            labels={[...monthlyMetrics.map(m => m.month), ...(costPrediction?.next3.map(p => p.month) || [])]}
            datasets={[
              { label: 'Actual', data: [...monthlyMetrics.map(m => parseFloat(m.costPct.toFixed(1))), ...(costPrediction?.next3.map(() => null) || [])], color: '#F59E0B' },
              ...(costPrediction ? [{ label: 'Forecast', data: [...monthlyMetrics.map(() => null).slice(0, -1), parseFloat(monthlyMetrics[monthlyMetrics.length - 1]?.costPct.toFixed(1)), ...costPrediction.next3.map(p => parseFloat(p.pct.toFixed(1)))], color: '#8B5CF6', borderDash: [5, 5] }] : []),
            ]}
            height={220} />
        </div>
      </div>

      {/* Root cause for highest cost platform */}
      {highestCostPlatform && (
        <div className="bg-red-50/50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2 mb-3"><Brain className="w-4 h-4" /> Root Cause Analysis — {highestCostPlatform.label} ({fmtPct(highestCostPlatform.costPct)} cost)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {rootCause.map((rc, i) => <InsightCard key={i} icon={rc.icon} title={rc.title} description={rc.description} severity={rc.severity} />)}
          </div>
        </div>
      )}

      {/* Platform cost table with expandable zones */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Cost Breakdown — Platform → Zone → City</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase">Entity</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Orders</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Invoice</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Cost</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase">Cost %</th>
              <th className="px-3 py-2.5 text-center font-semibold text-gray-500 uppercase">Tag</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {platformStats.filter(p => p.costPct > 0).map(p => {
                const cc = costColor(p.costPct);
                const isExp = expandedPlatform === p.label;
                const zones = isExp ? computeGroupedMetrics(classified.filter(r => r.platform === p.label && r.costNum > 0 && r.invoiceNum > 0), 'zone').sort((a, b) => b.costPct - a.costPct) : [];
                return (
                  <React.Fragment key={p.label}>
                    <tr className={`hover:bg-gray-50 cursor-pointer ${cc.bg}`} onClick={() => setExpandedPlatform(isExp ? null : p.label)}>
                      <td className="px-3 py-2.5 font-medium text-gray-800 flex items-center gap-1">{isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{p.label}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{p.total.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{currency(p.totalInv)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{currency(p.totalCost)}</td>
                      <td className="px-3 py-2.5 text-right"><span className={`font-bold ${cc.text}`}>{fmtPct(p.costPct)}</span></td>
                      <td className="px-3 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cc.bg} ${cc.text} border ${cc.border}`}>{cc.tag}</span></td>
                    </tr>
                    {isExp && zones.map(z => (
                      <tr key={`${p.label}-${z.label}`} className="bg-gray-50/50 hover:bg-gray-100/50 cursor-pointer" onClick={() => onDrill({ title: `${p.label} → ${z.label} (Cost)`, data: z.rows })}>
                        <td className="px-3 py-2 text-gray-600 pl-8">↳ {z.label}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{z.total}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{currency(z.totalInv)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{currency(z.totalCost)}</td>
                        <td className="px-3 py-2 text-right"><span className={costColor(z.costPct).text}>{fmtPct(z.costPct)}</span></td>
                        <td className="px-3 py-2 text-center"><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${costColor(z.costPct).bg} ${costColor(z.costPct).text}`}>{costColor(z.costPct).tag}</span></td>
                      </tr>
                    ))}
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
   TAB 5: AI INSIGHTS
   ═══════════════════════════════════════════ */
function AITab({ insights, monthlyMetrics, platformStats, zoneStats, overallMetrics, onDrill }) {
  const { observations, anomalies, recommendations, predictions } = insights;

  const best = platformStats.length > 0 ? [...platformStats].sort((a, b) => b.deliveredPct - a.deliveredPct)[0] : null;
  const worst = platformStats.filter(p => p.total > 10).length > 0 ? [...platformStats].filter(p => p.total > 10).sort((a, b) => a.deliveredPct - b.deliveredPct)[0] : null;

  return (
    <div className="space-y-4">
      {/* Predictions */}
      {predictions && (
        <div className={`rounded-xl border p-4 ${predictions.direction === 'up' ? 'bg-emerald-50 border-emerald-200' : predictions.direction === 'down' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Zap className={`w-4 h-4 ${predictions.direction === 'up' ? 'text-emerald-500' : predictions.direction === 'down' ? 'text-red-500' : 'text-blue-500'}`} />
            Delivery Rate Prediction
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-gray-700 mb-2">
                Based on {monthlyMetrics.length} months, delivery rate is trending <strong>{predictions.direction === 'up' ? 'upward' : predictions.direction === 'down' ? 'downward' : 'stable'}</strong>.
              </p>
              <div className="flex gap-3">
                {predictions.next3.map((p, i) => (
                  <div key={i} className="bg-white/60 rounded-lg px-3 py-2 text-center">
                    <p className="text-[9px] text-gray-400 uppercase font-semibold">{p.month}</p>
                    <p className={`text-sm font-bold ${perfColor(p.pct).text}`}>{fmtPct(p.pct)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <LineChart
                labels={[...monthlyMetrics.map(m => m.month), ...predictions.next3.map(p => p.month)]}
                datasets={[
                  { label: 'Actual', data: [...monthlyMetrics.map(m => parseFloat(m.deliveredPct.toFixed(1))), ...predictions.next3.map(() => null)], color: '#10B981' },
                  { label: 'Forecast', data: [...monthlyMetrics.map(() => null).slice(0, -1), parseFloat(monthlyMetrics[monthlyMetrics.length - 1]?.deliveredPct.toFixed(1)), ...predictions.next3.map(p => parseFloat(p.pct.toFixed(1)))], color: '#8B5CF6', borderDash: [5, 5] },
                ]}
                height={150} />
            </div>
          </div>
        </div>
      )}

      {/* Observations */}
      {observations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-indigo-500" /> Key Observations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {observations.map((o, i) => <InsightCard key={i} icon={o.icon} title={o.title} description={o.description} severity={o.severity} />)}
          </div>
        </div>
      )}

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><ShieldAlert className="w-4 h-4 text-red-500" /> Anomaly Detection ({anomalies.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {anomalies.map((a, i) => <InsightCard key={i} icon={a.icon} title={a.title} description={a.description} severity={a.severity}
              onClick={a.rows ? () => onDrill({ title: `Anomaly: ${a.title}`, data: a.rows }) : undefined} />)}
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

      {/* Comparative: Best vs Worst */}
      {best && worst && best.label !== worst.label && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><ArrowRightLeft className="w-4 h-4 text-indigo-500" /> Comparative Analysis</h3>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-500">Metric</th>
                <th className="px-4 py-2.5 text-center font-semibold text-emerald-600">{best.label} (Best)</th>
                <th className="px-4 py-2.5 text-center font-semibold text-red-500">{worst.label} (Worst)</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-500">Gap</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { label: 'Delivered %', best: best.deliveredPct, worst: worst.deliveredPct, suffix: '%' },
                  { label: 'RTO %', best: best.rtoPct, worst: worst.rtoPct, suffix: '%', invert: true },
                  { label: 'Failure %', best: best.failedPct, worst: worst.failedPct, suffix: '%', invert: true },
                  { label: 'Avg TAT', best: best.avgTAT, worst: worst.avgTAT, suffix: 'd', invert: true },
                  { label: 'Cost %', best: best.costPct, worst: worst.costPct, suffix: '%', invert: true },
                  { label: 'Volume', best: best.total, worst: worst.total, suffix: '' },
                ].map(row => {
                  const gap = row.best != null && row.worst != null ? row.best - row.worst : null;
                  return (
                    <tr key={row.label}>
                      <td className="px-4 py-2 font-medium text-gray-700">{row.label}</td>
                      <td className="px-4 py-2 text-center text-emerald-600 font-semibold">{row.best != null ? fmt(row.best) + row.suffix : '—'}</td>
                      <td className="px-4 py-2 text-center text-red-500 font-semibold">{row.worst != null ? fmt(row.worst) + row.suffix : '—'}</td>
                      <td className="px-4 py-2 text-center">{gap != null ? <span className={`text-[10px] font-bold ${(row.invert ? gap < 0 : gap > 0) ? 'text-emerald-600' : 'text-red-500'}`}>{gap > 0 ? '+' : ''}{fmt(gap)}{row.suffix}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {observations.length === 0 && anomalies.length === 0 && recommendations.length === 0 && !predictions && (
        <div className="text-center py-12 text-gray-400">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Not enough data to generate AI insights.</p>
        </div>
      )}
    </div>
  );
}
