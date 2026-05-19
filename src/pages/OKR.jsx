import React, { useMemo, useState, useCallback } from 'react';
import { useData } from '../context/DataContext';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { BarChart, LineChart, DoughnutChart } from '../components/Charts';
import {
  Target, CheckCircle, Clock, AlertTriangle, Lock, Unlock,
  TrendingUp, TrendingDown, ChevronRight, ChevronDown, Brain, Eye, X,
  Building2, Truck, MapPin, Calendar, Lightbulb, ShieldAlert, FileText, Package,
  Zap, BarChart3,
} from 'lucide-react';
import {
  percent, currency, groupBy, formatDate, safeParseDate, daysBetween, COLORS,
  isDelivered, isPartialDelivered, isRTO, isInTransit, isOFD, isLost,
} from '../utils/index';

const KPI_OWNERS = [
  { key: 'all', name: 'All Owners', role: 'Combined KPI View', icon: BarChart3 },
  { key: 'sandeep', name: 'Sandeep', role: 'Commercial & Primary', icon: Truck },
  { key: 'prashant', name: 'Prashant', role: 'Last Mile & Return', icon: Building2 },
  { key: 'nandlal', name: 'Nandlal', role: 'Documentation & GRN', icon: FileText },
  { key: 'anoop', name: 'Anoop', role: 'First Mile & Dispatch', icon: Package },
];

const VIEWS = [
  { key: 'executive', label: 'Executive Summary', icon: BarChart3 },
  { key: 'scorecard', label: 'KPI Scorecard', icon: Target },
  { key: 'tracking', label: 'Monthly Tracking', icon: Calendar },
  { key: 'poa', label: 'Plan of Action', icon: Lightbulb },
  { key: 'rootcause', label: 'AI Root Cause', icon: Brain },
];

/* ─── KPI-specific action plan generator (extracted for re-use across views) */
function getActionPlanFor(k, ownerName) {
  const gap = k.inv ? k.actual - k.target : k.target - k.actual;
  const fmt2 = v => v != null && isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '-';
  const plans = {
    cost: [
      { action: 'Negotiate courier rates with top 3 couriers', owner: 'Sandeep', timeline: '2 weeks', impact: `-${fmt2(gap * 0.3)}pp cost reduction` },
      { action: 'Reduce RTO rate — implement address verification at order placement', owner: 'Prashant', timeline: '1 month', impact: 'Each 1% RTO reduction saves 2x shipping cost' },
      { action: 'Optimize zone-wise courier allocation (cheapest for each lane)', owner: 'Sandeep', timeline: '1 week', impact: 'Route optimization can reduce cost by 5-8%' },
      { action: 'Shift volume from high-cost to low-cost couriers', owner: 'Sandeep', timeline: '2 weeks', impact: 'Estimated saving: 3-5% on shifted volume' },
      { action: 'Reduce failed delivery attempts (multiple attempts add cost)', owner: 'Nandlal', timeline: 'Ongoing', impact: 'Each re-attempt costs additional per shipment' },
    ],
    delivery: [
      { action: 'Daily escalation of 8+ day aged shipments to courier ops', owner: 'Sandeep', timeline: 'Daily', impact: `+${fmt2(gap * 0.4)}pp delivery improvement` },
      { action: 'Auto-book appointments for pending shipments', owner: 'Prashant', timeline: '1 week', impact: 'No appointment = no delivery' },
      { action: 'Follow up with couriers on failed attempts within 24h', owner: 'Sandeep', timeline: 'Daily', impact: 'Reduce failure rate by 30-40%' },
      { action: 'Improve first-attempt delivery success via better address quality', owner: 'Prashant', timeline: '2 weeks', impact: 'Higher FTDR reduces overall TAT' },
    ],
    pod: [
      { action: 'Set 48-hour POD submission SLA with couriers', owner: 'Nandlal', timeline: '1 week', impact: `+${fmt2(gap * 0.5)}pp POD improvement` },
      { action: 'Daily POD pending follow-up report to courier ops', owner: 'Nandlal', timeline: 'Daily', impact: 'Consistent follow-up improves compliance' },
      { action: 'Penalize couriers for POD delay beyond 7 days', owner: 'Sandeep', timeline: '2 weeks', impact: 'Financial incentive for timely POD' },
      { action: 'Implement digital POD capture at delivery point', owner: 'Anoop', timeline: '1 month', impact: 'Eliminates manual POD upload dependency' },
    ],
    transit: [
      { action: 'Daily escalation of 8+ day aged shipments', owner: 'Sandeep', timeline: 'Daily', impact: 'Move shipments to 0-7 day bucket' },
      { action: 'Root cause analysis for stuck shipments by courier', owner: 'Sandeep', timeline: '1 week', impact: 'Identify courier-specific bottlenecks' },
      { action: 'Automated aging alerts to courier ops at 4 & 7 day marks', owner: 'Prashant', timeline: '2 weeks', impact: 'Proactive rather than reactive management' },
      { action: 'Review and optimize last-mile delivery routes', owner: 'Sandeep', timeline: '1 month', impact: 'Route optimization reduces transit time' },
    ],
    rto: [
      { action: 'Implement OTP verification before dispatch for risky orders', owner: 'Prashant', timeline: '2 weeks', impact: `-${fmt2(gap * 0.5)}pp RTO reduction` },
      { action: 'Address quality check (zone-mismatch detection)', owner: 'Prashant', timeline: '1 week', impact: 'Catch bad addresses before dispatch' },
      { action: 'Repeated RTO customer flagging (cash-on-delivery hold)', owner: 'Prashant', timeline: '2 weeks', impact: 'Reduce repeat RTO offenders' },
      { action: 'Courier-wise RTO premium negotiation', owner: 'Sandeep', timeline: '1 month', impact: 'Recover RTO cost via courier penalty' },
    ],
    appt: [
      { action: 'Enable auto-appointment booking system for B2B orders', owner: 'Prashant', timeline: '2 weeks', impact: 'Eliminates manual booking delays' },
      { action: 'Daily monitoring of no-appointment shipments', owner: 'Prashant', timeline: 'Daily', impact: 'Early intervention on aging shipments' },
      { action: 'Set SLA: appointment booked within 24h of reaching hub', owner: 'Prashant', timeline: '1 week', impact: 'Reduces appointment-pending aging' },
    ],
    grn: [
      { action: 'Coordinate with warehouse for daily GRN closure target', owner: 'Nandlal', timeline: 'Daily', impact: 'Faster invoice settlement cycle' },
      { action: 'Identify top 3 platforms with GRN delays and escalate', owner: 'Nandlal', timeline: '1 week', impact: 'Recover stuck receivables' },
      { action: 'Automate GRN reconciliation report from platform portals', owner: 'Nandlal', timeline: '1 month', impact: 'Reduce manual reconciliation effort by 50%' },
    ],
    dispatch: [
      { action: 'Improve picking accuracy at warehouse to reduce dispatch delays', owner: 'Anoop', timeline: '2 weeks', impact: 'Higher same-day dispatch rate' },
      { action: 'Pull cutoff time earlier to allow same-day dispatch buffer', owner: 'Anoop', timeline: '1 week', impact: 'Better SLA compliance' },
      { action: 'Increase pickup compliance via courier-wise pickup tracker', owner: 'Anoop', timeline: '1 week', impact: 'Reduce missed pickups by 80%' },
    ],
    quality: [
      { action: 'Implement quality SOP at packaging station', owner: 'Anoop', timeline: '2 weeks', impact: 'Reduce damage-in-transit complaints' },
      { action: 'Random quality audits — 5% of daily dispatch', owner: 'Anoop', timeline: 'Ongoing', impact: 'Catch issues before reaching customer' },
      { action: 'Label-verification at sealing stage (2-person check)', owner: 'Anoop', timeline: '1 week', impact: 'Eliminate label mismatch errors' },
    ],
    doc: [
      { action: 'Daily document compliance check (e-way bill, invoice, tax)', owner: 'Nandlal', timeline: 'Daily', impact: 'Reduce regulatory issues' },
      { action: 'Train warehouse staff on doc requirements per platform', owner: 'Nandlal', timeline: '2 weeks', impact: 'Fewer rejections at hub' },
    ],
    capacity: [
      { action: 'Capacity utilization tracking on real-time dashboard', owner: 'Anoop', timeline: '2 weeks', impact: 'Identify bottleneck zones' },
      { action: 'Cross-zone load balancing during peak hours', owner: 'Anoop', timeline: '1 month', impact: 'Avoid local overload' },
    ],
    platform: [
      { action: `Review SLA compliance with top platform partners`, owner: 'Prashant', timeline: '1 week', impact: `+${fmt2(gap * 0.4)}pp OTIF improvement` },
      { action: `Optimize platform-zone-courier mapping`, owner: 'Sandeep', timeline: '2 weeks', impact: 'Better courier-zone fit improves OTIF' },
      { action: 'Escalate aged shipments to priority queue (per platform)', owner: 'Prashant', timeline: 'Daily', impact: 'Reduces aging backlog' },
      { action: 'Analyze top 3 failure reasons per platform and address', owner: 'Prashant', timeline: '1 week', impact: 'Targeted fix for highest-impact issues' },
    ],
  };
  /* Map KPI name to plan key */
  const kn = (k.name || '').toLowerCase();
  let key = null;
  if (kn.includes('cost')) key = 'cost';
  else if (kn.includes('pod')) key = 'pod';
  else if (kn.includes('rto') && (kn.includes('aging') || kn.includes('ageing'))) key = 'transit';
  else if (kn.includes('rto')) key = 'rto';
  else if (kn.includes('transit')) key = 'transit';
  else if (kn.includes('appt') || kn.includes('appointment')) key = 'appt';
  else if (kn.includes('otif') || kn.includes('channel del') || kn.includes('platform')) key = 'platform';
  else if (kn.includes('delivery success') || kn.includes('first attempt')) key = 'delivery';
  else if (kn.includes('grn')) key = 'grn';
  else if (kn.includes('dispatch') || kn.includes('pickup')) key = 'dispatch';
  else if (kn.includes('quality') || kn.includes('packaging') || kn.includes('label')) key = 'quality';
  else if (kn.includes('doc')) key = 'doc';
  else if (kn.includes('capacity') || kn.includes('wh')) key = 'capacity';

  if (key && plans[key]) return plans[key];

  return [
    { action: `Analyze root cause of ${k.name} underperformance`, owner: ownerName || '-', timeline: '1 week', impact: 'Identify top contributing factors' },
    { action: 'Set daily monitoring dashboard for this KPI', owner: ownerName || '-', timeline: '3 days', impact: 'Early detection of deviations' },
    { action: 'Create weekly improvement review cadence', owner: ownerName || '-', timeline: 'Weekly', impact: `Track progress toward ${fmt2(k.target)}${k.unit || '%'} target` },
    { action: 'Benchmark against best performing month and replicate', owner: ownerName || '-', timeline: '2 weeks', impact: 'Apply proven practices' },
  ];
}

/* ─── Simple inline SVG sparkline ────────────────────────────────────── */
function Sparkline({ values, width = 80, height = 22, color = '#6366F1', target = null, invert = false }) {
  const clean = (values || []).filter(v => v != null && isFinite(v));
  if (clean.length < 2) return <span className="text-[9px] text-gray-300">—</span>;
  const min = Math.min(...clean, target != null ? target : Infinity);
  const max = Math.max(...clean, target != null ? target : -Infinity);
  const range = (max - min) || 1;
  const stepX = clean.length > 1 ? width / (clean.length - 1) : 0;
  const pts = clean.map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`).join(' ');
  const last = clean[clean.length - 1];
  const first = clean[0];
  const delta = last - first;
  const trendUp = invert ? delta < 0 : delta > 0;
  const trendColor = trendUp ? '#10b981' : delta === 0 ? '#9ca3af' : '#ef4444';
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      {target != null && (
        <line x1={0} y1={height - ((target - min) / range) * (height - 4) - 2} x2={width} y2={height - ((target - min) / range) * (height - 4) - 2}
          stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="2,2" />
      )}
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={pts} />
      <circle cx={(clean.length - 1) * stepX} cy={height - ((last - min) / range) * (height - 4) - 2} r={2} fill={trendColor} />
    </svg>
  );
}

const MONTHS_LIST = ["Mar'26","Apr'26","May'26","Jun'26","Jul'26","Aug'26"];
const PERIODS = ['Monthly','Quarterly','Yearly'];
const fmt = v => v != null && isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '-';

function getGrade(pct) {
  if (pct >= 95) return { label: 'Exceptional', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', bar: 'bg-emerald-500' };
  if (pct >= 80) return { label: 'High', color: 'text-blue-700 bg-blue-50 border-blue-200', bar: 'bg-blue-500' };
  if (pct >= 65) return { label: 'Target', color: 'text-amber-700 bg-amber-50 border-amber-200', bar: 'bg-amber-500' };
  if (pct >= 50) return { label: 'Base', color: 'text-orange-700 bg-orange-50 border-orange-200', bar: 'bg-orange-500' };
  return { label: 'Below', color: 'text-red-700 bg-red-50 border-red-200', bar: 'bg-red-500' };
}

/* ─── KPI name → kpiType + filter classifier ──────────────────────────────
   Each KPI's drill-down must scope shipments to the SAME population the
   KPI measures. Order matters: most-specific first.                   */
function classifyKPI(kn, mRows, now) {
  let kpiType = 'general', filtered = mRows, excludedCount = 0, note = null;

  /* Cost — exclude rows with missing invoice (would skew % calc) */
  if (kn.includes('cost')) {
    kpiType = 'cost';
    const costAll = mRows.filter(r => parseFloat(r.logisticsCost) > 0);
    filtered = costAll.filter(r => parseFloat(r.invoiceValue) > 0);
    excludedCount = costAll.length - filtered.length;
    return { kpiType, filtered, excludedCount, note };
  }

  /* RTO-aging — RTO shipments with age buckets */
  if ((kn.includes('rto') && (kn.includes('aging') || kn.includes('ageing'))) || kn.includes('rto ageing') || kn.includes('rto aging')) {
    kpiType = 'rto-aging';
    filtered = mRows.filter(r => isRTO(r.status));
    return { kpiType, filtered, excludedCount, note };
  }

  /* In-Transit Aging — ALL in-transit/OFD shipments */
  if (kn.includes('transit') && (kn.includes('aging') || kn.includes('ageing'))) {
    kpiType = 'transit';
    filtered = mRows.filter(r => isInTransit(r.status) || isOFD(r.status));
    return { kpiType, filtered, excludedCount, note };
  }

  /* Generic RTO */
  if (kn.includes('rto') || kn.includes('b2b rto')) {
    kpiType = 'rto';
    filtered = mRows.filter(r => isRTO(r.status));
    return { kpiType, filtered, excludedCount, note };
  }

  /* Platform OTIF / Channel Delivery */
  if (kn.includes('otif') || kn.includes('channel del') || kn.includes('platform otif')) {
    kpiType = 'platform';
    return { kpiType, filtered, excludedCount, note };
  }

  /* Delivery / First-attempt */
  if (kn.includes('delivery success') || kn.includes('first attempt') || kn === 'delivery success %') {
    kpiType = 'delivery';
    return { kpiType, filtered, excludedCount, note };
  }

  /* POD aging variations */
  if (kn.includes('pod')) {
    kpiType = 'pod';
    /* Delivered shipments missing POD */
    filtered = mRows.filter(r => (isDelivered(r.status) || isPartialDelivered(r.status)) && !(r.pod && r.pod.trim() !== '' && r.pod.trim() !== '-'));
    return { kpiType, filtered, excludedCount, note };
  }

  /* Appointment KPIs */
  if (kn.includes('appt') || kn.includes('appointment')) {
    kpiType = 'appt';
    filtered = mRows.filter(r => (isInTransit(r.status) || isOFD(r.status)) && !safeParseDate(r.appointmentDate));
    return { kpiType, filtered, excludedCount, note };
  }

  /* GRN — no shipment-level data; show month rows with a note */
  if (kn.includes('grn')) {
    kpiType = 'grn';
    note = 'GRN data is tracked separately from shipment records. The list below shows all shipments for the month for context only — GRN status is not captured per shipment yet.';
    return { kpiType, filtered: mRows, excludedCount, note };
  }

  /* Dispatch & Pickup — same-day dispatch view (booking date present) */
  if (kn.includes('dispatch') || kn.includes('pickup')) {
    kpiType = 'dispatch';
    filtered = mRows.filter(r => safeParseDate(r.bookingDate));
    note = 'Showing all shipments dispatched in the month. Same-day dispatch & pickup-compliance metrics are derived from booking dates.';
    return { kpiType, filtered, excludedCount, note };
  }

  /* Quality / WH / Doc — non-shipment KPIs, manual-only */
  if (kn.includes('quality') || kn.includes('wh capacity') || kn.includes('capacity') || kn.includes('doc issue') || kn.includes('packaging') || kn.includes('label')) {
    kpiType = 'manual';
    note = 'This is a manually-tracked KPI without per-shipment data. Use the month value above; the table below is for reference only.';
    return { kpiType, filtered: mRows, excludedCount, note };
  }

  return { kpiType, filtered, excludedCount, note };
}

function scorePct(actual, target, base, exceptional, invert) {
  if (actual == null) return 50;
  if (invert) return actual <= exceptional ? 100 : actual <= target ? 80 : actual <= base ? 60 : 30;
  return actual >= exceptional ? 100 : actual >= target ? 80 : actual >= base ? 60 : 30;
}

export default function OKR() {
  const { data } = useData();
  const [owner, setOwner] = useState('all');
  const [view, setView] = useState('executive');
  const [expKPI, setExpKPI] = useState(null);
  const [period, setPeriod] = useState('Monthly');
  const [trackingData, setTrackingData] = useState(() => { try { return JSON.parse(localStorage.getItem('okr-track') || '{}'); } catch { return {}; } });
  const [lockedMonths, setLockedMonths] = useState(() => { try { return JSON.parse(localStorage.getItem('okr-lock') || '{}'); } catch { return {}; } });
  const [expTrackMonth, setExpTrackMonth] = useState(null);
  const [trackDrill, setTrackDrill] = useState(null);
  /* Plan of Action — status + notes per (owner||month||kpi||index). Persisted to localStorage. */
  const [poaState, setPoaState] = useState(() => { try { return JSON.parse(localStorage.getItem('okr-poa') || '{}'); } catch { return {}; } });
  const [poaMonth, setPoaMonth] = useState("Mar'26");
  const [poaFilter, setPoaFilter] = useState('all'); // all | open | done | mine
  const updatePoa = (key, patch) => setPoaState(p => { const n = { ...p, [key]: { ...(p[key] || {}), ...patch } }; localStorage.setItem('okr-poa', JSON.stringify(n)); return n; });

  /* KPI month scope — controls Executive Summary actuals. Defaults to most recent month with data. */
  const [kpiMonth, setKpiMonth] = useState('rolling'); // 'rolling' = 12-month rolling, or specific month like "Mar'26"

  const now = new Date();
  const cur = KPI_OWNERS.find(o => o.key === owner);

  /* ═══ Compute actuals from shipment data ═══ */
  const actuals = useMemo(() => {
    let recent, refDate = now;
    if (kpiMonth !== 'rolling') {
      /* Scope to selected month + use month-end as age reference (matches Monthly Tracking) */
      recent = data.filter(r => r.month === kpiMonth);
      const MABBR2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mIdx = MABBR2.indexOf(kpiMonth.slice(0, 3));
      const mYr = parseInt('20' + kpiMonth.slice(4)) || 2026;
      const monthEnd = new Date(mYr, mIdx + 1, 0);
      refDate = monthEnd < now ? monthEnd : now; /* past months use month-end; current month uses now */
    } else {
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
      recent = data.filter(r => { const bd = safeParseDate(r.bookingDate); return !bd || bd >= cutoff; });
    }
    const del = recent.filter(r => isDelivered(r.status) || isPartialDelivered(r.status));
    const rto = recent.filter(r => isRTO(r.status));
    const intransit = recent.filter(r => isInTransit(r.status) || isOFD(r.status));
    const total = recent.length;
    const delPct = total > 0 ? percent(del.length, total) : 0;
    const rtoPct = total > 0 ? percent(rto.length, total) : 0;

    const costRows = recent.filter(r => parseFloat(r.logisticsCost) > 0 && parseFloat(r.invoiceValue) > 0);
    const totalCost = costRows.reduce((s, r) => s + (parseFloat(r.logisticsCost) || 0), 0);
    const totalInv = costRows.reduce((s, r) => s + (parseFloat(r.invoiceValue) || 0), 0);
    const costPct = totalInv > 0 ? (totalCost / totalInv * 100) : 0;

    const tatRows = del.filter(r => safeParseDate(r.bookingDate) && safeParseDate(r.deliveryDate));
    const tatVals = tatRows.map(r => daysBetween(r.bookingDate, r.deliveryDate)).filter(v => v != null && v >= 0);
    const avgTAT = tatVals.length ? tatVals.reduce((a, b) => a + b, 0) / tatVals.length : 0;

    const ageBkts = { '0-7': 0, '8-15': 0, '16-20': 0, '21-30': 0, '30+': 0 };
    intransit.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((refDate - bd) / 86400000); if (age <= 7) ageBkts['0-7']++; else if (age <= 15) ageBkts['8-15']++; else if (age <= 20) ageBkts['16-20']++; else if (age <= 30) ageBkts['21-30']++; else ageBkts['30+']++; } });
    const intTotal = intransit.length || 1;
    const agePcts = {}; for (const [k, v] of Object.entries(ageBkts)) agePcts[k] = percent(v, intTotal);

    const platforms = ['Amazon','Flipkart','Blinkit','Zepto','Swiggy','Big Basket'];
    const platDel = {};
    platforms.forEach(pl => { const pR = recent.filter(r => r.platform && r.platform.toLowerCase().includes(pl.toLowerCase())); const pD = pR.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)); platDel[pl] = pR.length > 0 ? percent(pD.length, pR.length) : 0; });

    const withPod = del.filter(r => r.pod && r.pod.trim() !== '' && r.pod.trim() !== '-' && r.pod.trim().toLowerCase() !== 'na').length;
    const podPct = del.length > 0 ? percent(withPod, del.length) : 0;

    const withAppt = intransit.filter(r => safeParseDate(r.appointmentDate)).length;
    const apptPct = intransit.length > 0 ? percent(withAppt, intransit.length) : 0;
    const noAppt = intransit.filter(r => !safeParseDate(r.appointmentDate));
    const noApptBkts = { '0-2': 0, '3-5': 0, '6-10': 0, '11-15': 0, '15+': 0 };
    noAppt.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((refDate - bd) / 86400000); if (age <= 2) noApptBkts['0-2']++; else if (age <= 5) noApptBkts['3-5']++; else if (age <= 10) noApptBkts['6-10']++; else if (age <= 15) noApptBkts['11-15']++; else noApptBkts['15+']++; } });
    const noApptTotal = noAppt.length || 1;
    const noApptPcts = {}; for (const [k, v] of Object.entries(noApptBkts)) noApptPcts[k] = percent(v, noApptTotal);

    /* B2B RTO tracking */
    const rtoAgeBkts = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 };
    rto.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((refDate - bd) / 86400000); if (age <= 7) rtoAgeBkts['0-7']++; else if (age <= 15) rtoAgeBkts['8-15']++; else if (age <= 30) rtoAgeBkts['16-30']++; else rtoAgeBkts['30+']++; } });
    const rtoTotal = rto.length || 1;
    const rtoAgePcts = {}; for (const [k, v] of Object.entries(rtoAgeBkts)) rtoAgePcts[k] = percent(v, rtoTotal);
    /* Platform RTO */
    const platRTO = {};
    ['Blinkit','Zepto','Swiggy','Amazon','Big Basket'].forEach(pl => { const pR = recent.filter(r => r.platform && r.platform.toLowerCase().includes(pl.toLowerCase())); const pRTO = pR.filter(r => isRTO(r.status)); platRTO[pl] = pR.length > 0 ? percent(pRTO.length, pR.length) : 0; });

    const byMonth = groupBy(recent, 'month');
    const monthTrend = Object.entries(byMonth).filter(([m]) => m && m.includes("'")).map(([month, rows]) => {
      const d = rows.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)).length;
      const rt = rows.filter(r => isRTO(r.status)).length;
      return { month, total: rows.length, delPct: percent(d, rows.length), rtoPct: percent(rt, rows.length) };
    });

    return { delPct, rtoPct, costPct, avgTAT, agePcts, platDel, podPct, apptPct, noApptPcts, rtoAgePcts, platRTO, monthTrend, total, delivered: del.length, rto: rto.length, intransit: intransit.length };
  }, [data, kpiMonth]);

  /* Available months for selector (from data) */
  const availableMonths = useMemo(() => {
    const set = new Set();
    data.forEach(r => { if (r.month && r.month.includes("'")) set.add(r.month); });
    /* Sort chronologically using MABBR */
    const MABBR2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return Array.from(set).sort((a, b) => {
      const ya = parseInt('20' + a.slice(4)), yb = parseInt('20' + b.slice(4));
      const ma = MABBR2.indexOf(a.slice(0, 3)), mb = MABBR2.indexOf(b.slice(0, 3));
      return (yb * 12 + mb) - (ya * 12 + ma); /* most recent first */
    });
  }, [data]);

  /* ═══ KPI definitions per owner ═══ */
  const kpis = useMemo(() => {
    const a = actuals;
    const defs = {
      sandeep: [
        { name: 'Overall Cost %', w: 50, actual: a.costPct, target: 5.9, base: 6.7, high: 5.25, exc: 4.7, unit: '%', inv: true },
        { name: 'In-Transit Aging', w: 8, actual: a.agePcts['0-7'], target: 85, base: 75, high: 90, exc: 95, unit: '%',
          sub: [
            { label: '0-7 Days', value: a.agePcts['0-7'], target: 85, good: true },
            { label: '8-15 Days', value: a.agePcts['8-15'], target: 13, good: false },
            { label: '16-20 Days', value: a.agePcts['16-20'], target: 2, good: false },
            { label: '21-30 Days', value: a.agePcts['21-30'], target: 1, good: false },
            { label: '30+ Days', value: a.agePcts['30+'], target: 0, good: false },
          ]},
        { name: 'Platform OTIF', w: 9, actual: Math.round(((a.platDel['Blinkit']||0)+(a.platDel['Zepto']||0)+(a.platDel['Swiggy']||0)+(a.platDel['Amazon']||0)+(a.platDel['Big Basket']||0))/5*10)/10, target: 85, base: 65, high: 90, exc: 95, unit: '%',
          sub: [
            { label: 'Blinkit', value: a.platDel['Blinkit'], target: 85, good: true },
            { label: 'Zepto', value: a.platDel['Zepto'], target: 80, good: true },
            { label: 'Swiggy', value: a.platDel['Swiggy'], target: 85, good: true },
            { label: 'Amazon', value: a.platDel['Amazon'], target: 85, good: true },
            { label: 'Big Basket', value: a.platDel['Big Basket'], target: 80, good: true },
          ]},
        { name: 'Delivery Success %', w: 10, actual: a.delPct, target: 96, base: 90, high: 98, exc: 99, unit: '%' },
      ],
      prashant: [
        { name: 'Channel Delivery', w: 15, actual: Math.round(((a.platDel['Blinkit']||0)+(a.platDel['Swiggy']||0)+(a.platDel['Amazon']||0))/3*10)/10, target: 95, base: 90, high: 97, exc: 99, unit: '%',
          sub: [
            { label: 'Blinkit', value: a.platDel['Blinkit'], target: 95, good: true },
            { label: 'Swiggy', value: a.platDel['Swiggy'], target: 94, good: true },
            { label: 'Amazon', value: a.platDel['Amazon'], target: 96, good: true },
            { label: 'Flipkart', value: a.platDel['Flipkart'], target: 90, good: true },
            { label: 'Big Basket', value: a.platDel['Big Basket'], target: 95, good: true },
          ]},
        { name: 'First Attempt Del %', w: 10, actual: Math.min(a.delPct, 85), target: 85, base: 80, high: 90, exc: 95, unit: '%' },
        { name: 'B2B RTO Tracking', w: 15, actual: a.rtoPct, target: 5, base: 8, high: 3, exc: 2, unit: '%', inv: true,
          sub: [
            { label: 'Overall RTO %', value: a.rtoPct, target: 5, good: false },
            { label: 'Blinkit RTO', value: a.platRTO['Blinkit'], target: 4, good: false },
            { label: 'Zepto RTO', value: a.platRTO['Zepto'], target: 5, good: false },
            { label: 'Swiggy RTO', value: a.platRTO['Swiggy'], target: 5, good: false },
            { label: 'Amazon RTO', value: a.platRTO['Amazon'], target: 3, good: false },
          ]},
        { name: 'RTO Ageing Control', w: 10, actual: a.rtoAgePcts['0-7'], target: 80, base: 70, high: 90, exc: 95, unit: '%',
          sub: [
            { label: 'RTO 0-7 Days', value: a.rtoAgePcts['0-7'], target: 80, good: true },
            { label: 'RTO 8-15 Days', value: a.rtoAgePcts['8-15'], target: 15, good: false },
            { label: 'RTO 16-30 Days', value: a.rtoAgePcts['16-30'], target: 5, good: false },
            { label: 'RTO 30+ Days', value: a.rtoAgePcts['30+'], target: 0, good: false },
          ]},
        { name: 'Non-Appointment %', w: 15, actual: a.apptPct, target: 90, base: 84, high: 95, exc: 100, unit: '%',
          sub: [
            { label: 'Appt Booked', value: a.apptPct, target: 90, good: true },
            { label: 'No Appt (0-2d)', value: a.noApptPcts['0-2'], target: 90, good: true },
            { label: 'No Appt (3-5d)', value: a.noApptPcts['3-5'], target: 10, good: false },
            { label: 'No Appt (6-10d)', value: a.noApptPcts['6-10'], target: 0, good: false },
            { label: 'No Appt (11-15d)', value: a.noApptPcts['11-15'], target: 0, good: false },
            { label: 'No Appt (15+d)', value: a.noApptPcts['15+'], target: 0, good: false },
          ]},
        { name: 'Non-Appt 0-2 Days %', w: 3, actual: a.noApptPcts['0-2'], target: 90, base: 84, high: 95, exc: 100, unit: '%' },
      ],
      nandlal: [
        { name: 'GRN Recovery %', w: 35, actual: 90, target: 93, base: 90, high: 97, exc: 100, unit: '%' },
        { name: 'POD Visibility', w: 5, actual: a.podPct, target: 90, base: 80, high: 96, exc: 100, unit: '%' },
        { name: 'POD Ageing', w: 15, actual: a.podPct > 80 ? 80 : a.podPct, target: 90, base: 80, high: 96, exc: 100, unit: '%',
          sub: [
            { label: '0-7 Days', value: a.podPct > 80 ? 80 : a.podPct, target: 90, good: true },
            { label: '7+ Days', value: a.podPct > 80 ? 20 : (100 - a.podPct), target: 10, good: false },
          ]},
        { name: 'GRN Ageing', w: 15, actual: 94, target: 96, base: 94, high: 100, exc: 100, unit: '%',
          sub: [
            { label: '0-1 Days', value: 94, target: 96, good: true },
            { label: '2-3 Days', value: 5, target: 2, good: false },
            { label: '4-5 Days', value: 1, target: 0, good: false },
          ]},
        { name: 'Platform GRN', w: 12, actual: 98.3, target: 99, base: 98, high: 99.5, exc: 100, unit: '%',
          sub: [
            { label: 'Blinkit', value: 98.5, target: 99, good: true },
            { label: 'Zepto', value: 98, target: 99, good: true },
            { label: 'Swiggy', value: 98, target: 99, good: true },
            { label: 'Amazon', value: 98, target: 99, good: true },
          ]},
      ],
      anoop: [
        { name: 'Doc Issues %', w: 10, actual: 98, target: 98.5, base: 98, high: 99, exc: 100, unit: '%' },
        { name: 'Dispatch & Pickup', w: 55, actual: 90, target: 93, base: 88, high: 96, exc: 99, unit: '%',
          sub: [
            { label: 'Same Day Dispatch', value: 92, target: 95, good: true },
            { label: 'Pickup Compliance', value: 88, target: 90, good: true },
          ]},
        { name: 'Quality Control', w: 30, actual: 91, target: 94, base: 90, high: 97, exc: 100, unit: '%',
          sub: [
            { label: 'Packaging Quality', value: 96, target: 95, good: true },
            { label: 'Label Accuracy', value: 99, target: 98, good: true },
            { label: 'WH Capacity', value: 78, target: 80, good: true },
          ]},
        { name: 'WH Capacity Utilization', w: 15, actual: 78, target: 80, base: 70, high: 85, exc: 90, unit: '%' },
      ],
    };
    if (owner === 'all') {
      /* Combine all owners' KPIs with owner tag */
      const allKpis = [];
      Object.entries(defs).forEach(([ownerKey, ownerKpis]) => {
        const ownerInfo = KPI_OWNERS.find(o => o.key === ownerKey);
        ownerKpis.forEach(k => allKpis.push({ ...k, _owner: ownerKey, _ownerName: ownerInfo?.name || ownerKey }));
      });
      return allKpis;
    }
    return defs[owner] || [];
  }, [actuals, owner]);

  /* ═══ Scores ═══ */
  const overallScore = useMemo(() => {
    let tw = 0, ws = 0;
    kpis.forEach(k => { const s = scorePct(k.actual, k.target, k.base, k.exc, k.inv); tw += k.w; ws += s * k.w / 100; });
    return tw > 0 ? Math.round(ws / tw * 100) : 0;
  }, [kpis]);

  const grade = getGrade(overallScore);

  /* Per-owner scores for "All" combined view */
  const allOwnerScores = useMemo(() => {
    if (owner !== 'all') return [];
    const ownerKeys = ['sandeep','prashant','nandlal','anoop'];
    return ownerKeys.map(oKey => {
      const ownerKpis = kpis.filter(k => k._owner === oKey);
      let tw = 0, ws = 0;
      ownerKpis.forEach(k => { const s = scorePct(k.actual, k.target, k.base, k.exc, k.inv); tw += k.w; ws += s * k.w / 100; });
      const score = tw > 0 ? Math.round(ws / tw * 100) : 0;
      const info = KPI_OWNERS.find(o => o.key === oKey);
      const atRisk = ownerKpis.filter(k => { const gap = k.inv ? k.actual - k.target : k.target - k.actual; return gap > 0; }).length;
      return { key: oKey, name: info?.name || oKey, role: info?.role || '', score, grade: getGrade(score), kpiCount: ownerKpis.length, atRisk };
    });
  }, [owner, kpis]);


  /* ═══ AI Root Cause ═══ */
  const rootCauses = useMemo(() => {
    const causes = [];
    kpis.forEach(k => {
      const gap = k.inv ? k.actual - k.target : k.target - k.actual;
      if (gap > 0) {
        let reason = '', action = '', impact = '';
        if (k.name.includes('Cost')) { reason = 'High RTO rate + courier pricing'; action = 'Negotiate courier contracts, reduce RTO'; impact = `Reducing cost by ${fmt(gap)}pp saves ~${currency(actuals.total * gap / 100 * 50)}`; }
        else if (k.name.includes('transit')) { reason = 'Courier delay + appointment pending'; action = 'Escalate aged shipments, auto-reschedule appointments'; impact = `${fmt(gap)}pp improvement needed`; }
        else if (k.name.includes('OTIF') || k.name.includes('Channel') || k.name.includes('Del')) { reason = 'Platform SLA miss + zone bottleneck'; action = 'Increase courier alignment, optimize zone routing'; impact = `${fmt(gap)}pp gap to close`; }
        else if (k.name.includes('POD')) { reason = 'Courier POD upload delay'; action = 'Daily POD follow-up with courier ops team'; impact = `${fmt(gap)}pp improvement needed`; }
        else if (k.name.includes('Appt') || k.name.includes('Non-Appt')) { reason = 'Late appointment booking'; action = 'Auto-appointment system, daily slot monitoring'; impact = `${fmt(gap)}pp gap`; }
        else { reason = 'Process gap identified'; action = 'Review SOP and implement corrective action'; impact = `${fmt(gap)}pp improvement required`; }
      }
    });
    return causes.sort((a, b) => (b.weightage || 0) - (a.weightage || 0));
  }, [kpis, actuals]);

  /* ═══ Forecast ═══ */
  const forecast = useMemo(() => {
    if (actuals.monthTrend.length < 3) return null;
    const pts = actuals.monthTrend.map((m, i) => ({ x: i, y: m.delPct }));
    const n = pts.length; let sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx) || 0;
    const intercept = (sy - slope * sx) / n;
    const nextMonth = Math.max(0, Math.min(100, slope * n + intercept));
    return { nextMonth: parseFloat(nextMonth.toFixed(1)), slope, direction: slope > 0.1 ? 'up' : slope < -0.1 ? 'down' : 'stable', risk: nextMonth < 90 ? 'HIGH' : nextMonth < 95 ? 'MEDIUM' : 'LOW' };
  }, [actuals]);

  /* Tracking helpers */
  const saveTrack = (month, kpi, val) => { setTrackingData(p => { const n = { ...p, [`${owner}||${month}||${kpi}`]: val }; localStorage.setItem('okr-track', JSON.stringify(n)); return n; }); };
  const toggleLock = (month) => { setLockedMonths(p => { const k = `${owner}||${month}`; const n = { ...p, [k]: !p[k] }; localStorage.setItem('okr-lock', JSON.stringify(n)); return n; }); };

  return (
    <div className="space-y-4">
      {/* Owner tabs */}
      <div className="flex flex-wrap gap-2">
        {KPI_OWNERS.map(o => { const Icon = o.icon; const active = owner === o.key; return (
          <button key={o.key} onClick={() => { setOwner(o.key); setExpKPI(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all ${active ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            <Icon className="w-4 h-4" /><div className="text-left"><p className="font-bold">{o.name}</p><p className={`text-[9px] ${active ? 'text-indigo-200' : 'text-gray-400'}`}>{o.role}</p></div>
          </button>
        ); })}
      </div>

      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold">{owner === 'all' ? 'KPI Command Center — All Owners' : `${cur?.name}'s KPI Command Center`}</h2><p className="text-indigo-200 text-[11px]">{owner === 'all' ? 'Combined performance across all KPI owners' : cur?.role}</p></div>
          <div className="flex items-center gap-6">
            <div className="text-center"><p className="text-3xl font-bold">{overallScore}</p><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${grade.color}`}>{grade.label}</span></div>
            {forecast && <div className="text-center"><p className="text-xl font-bold">{forecast.nextMonth}%</p><p className="text-[9px] text-indigo-200">Next Month Forecast</p><span className={`text-[9px] px-1.5 py-0.5 rounded ${forecast.risk === 'HIGH' ? 'bg-red-500' : forecast.risk === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'}`}>{forecast.risk} Risk</span></div>}
          </div>
        </div>
        {/* Owner score cards in All view */}
        {owner === 'all' && allOwnerScores.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {allOwnerScores.map(os => (
              <button key={os.key} onClick={() => { setOwner(os.key); setExpKPI(null); }}
                className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-left hover:bg-white/20 transition-all">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{os.name}</p>
                    <p className="text-[9px] text-indigo-200">{os.role}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">{os.score}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${os.grade.color}`}>{os.grade.label}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 text-[9px]">
                  <span className="text-indigo-200">{os.kpiCount} KPIs</span>
                  {os.atRisk > 0 && <span className="bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded">{os.atRisk} at risk</span>}
                  {os.atRisk === 0 && <span className="bg-emerald-500/30 text-emerald-200 px-1.5 py-0.5 rounded">All on target</span>}
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden"><div className={`h-full rounded-full ${os.grade.bar}`} style={{ width: `${Math.min(100, os.score)}%` }} /></div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View tabs + KPI month scope */}
      <div className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map(v => { const Icon = v.icon; return (
          <button key={v.key} onClick={() => setView(v.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${view === v.key ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}><Icon className="w-3.5 h-3.5" />{v.label}</button>
        ); })}
        <div className="w-px h-6 bg-gray-200 mx-1 self-center" />
        {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={`text-[10px] px-2 py-1 rounded-lg font-medium ${period === p ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'}`}>{p}</button>)}
        {(view === 'executive' || view === 'scorecard') && (
          <>
            <div className="w-px h-6 bg-gray-200 mx-1 self-center" />
            <span className="text-[10px] text-gray-500 font-medium">Scope:</span>
            <select value={kpiMonth} onChange={e => setKpiMonth(e.target.value)} className="text-[10px] px-2 py-1 border border-indigo-200 rounded bg-white text-indigo-700 font-semibold">
              <option value="rolling">12-month rolling</option>
              {availableMonths.map(m => <option key={m} value={m}>{m} only</option>)}
            </select>
            {kpiMonth !== 'rolling' && (
              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">Matches Monthly Tracking for {kpiMonth}</span>
            )}
          </>
        )}
      </div>

      {/* ═══ EXECUTIVE SUMMARY ═══ */}
      {view === 'executive' && (<div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="KPI Score" value={overallScore} icon={Target} color={overallScore >= 80 ? 'green' : overallScore >= 60 ? 'yellow' : 'red'} subtitle={grade.label} />
          <KPICard title="KPIs at Risk" value={rootCauses.length} icon={AlertTriangle} color="red" subtitle={`of ${kpis.length} total`} />
          <KPICard title="Forecast" value={forecast ? `${forecast.nextMonth}%` : '-'} icon={TrendingUp} color={forecast?.risk === 'LOW' ? 'green' : 'red'} subtitle={forecast ? `${forecast.risk} Risk` : ''} />
        </div>

        {/* All Owners Snapshot — best/worst KPI per owner, total at-risk, weighted score progress */}
        {owner === 'all' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-indigo-500" /> Owner Snapshot — Best & Worst KPI per Owner</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {['sandeep','prashant','nandlal','anoop'].map(oKey => {
                const oKpis = kpis.filter(k => k._owner === oKey);
                const oInfo = KPI_OWNERS.find(o => o.key === oKey);
                const oScore = allOwnerScores.find(s => s.key === oKey);
                /* Score each KPI for ranking */
                const ranked = oKpis.map(k => ({ k, s: scorePct(k.actual, k.target, k.base, k.exc, k.inv), gap: k.inv ? k.actual - k.target : k.target - k.actual })).sort((a, b) => b.s - a.s);
                const best = ranked[0];
                const worst = ranked[ranked.length - 1];
                return (
                  <button key={oKey} onClick={() => setOwner(oKey)} className="text-left rounded-xl border border-gray-200 p-3 hover:border-indigo-300 hover:shadow-md transition-all bg-gradient-to-br from-white to-indigo-50/30">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-[11px] font-bold text-indigo-700">{oInfo?.name}</p>
                        <p className="text-[9px] text-gray-400">{oInfo?.role}</p>
                      </div>
                      {oScore && <div className="text-right"><p className="text-lg font-bold text-indigo-700">{oScore.score}</p><span className={`text-[9px] font-bold px-1 rounded border ${oScore.grade.color}`}>{oScore.grade.label}</span></div>}
                    </div>
                    {best && (
                      <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-1.5 mb-1.5">
                        <p className="text-[8px] uppercase tracking-wider text-emerald-600 font-semibold">Best KPI</p>
                        <p className="text-[10px] font-semibold text-gray-800 truncate">{best.k.name}</p>
                        <p className="text-[10px] text-emerald-700 font-bold">{fmt(best.k.actual)}{best.k.unit} <span className="text-gray-400 font-normal">/ {fmt(best.k.target)}{best.k.unit}</span></p>
                      </div>
                    )}
                    {worst && worst.gap > 0 && (
                      <div className="bg-red-50/50 border border-red-100 rounded-lg p-1.5">
                        <p className="text-[8px] uppercase tracking-wider text-red-600 font-semibold">Worst KPI</p>
                        <p className="text-[10px] font-semibold text-gray-800 truncate">{worst.k.name}</p>
                        <p className="text-[10px] text-red-700 font-bold">{fmt(worst.k.actual)}{worst.k.unit} <span className="text-red-500 font-normal">({worst.k.inv ? '+' : '-'}{fmt(worst.gap)}{worst.k.unit} gap)</span></p>
                      </div>
                    )}
                    {worst && worst.gap <= 0 && (
                      <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-1.5">
                        <p className="text-[10px] text-emerald-700 font-bold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> All KPIs on target</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* KPI Health Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">KPI Health Overview</h3>
          {owner === 'all' ? (
            /* Grouped by owner */
            <div className="space-y-4">
              {['sandeep','prashant','nandlal','anoop'].map(oKey => {
                const ownerKpis = kpis.filter(k => k._owner === oKey);
                const oInfo = KPI_OWNERS.find(o => o.key === oKey);
                const oScore = allOwnerScores.find(s => s.key === oKey);
                return (
                  <div key={oKey}>
                    <div className="flex items-center gap-2 mb-2">
                      <button onClick={() => { setOwner(oKey); setExpKPI(null); }} className="text-[11px] font-bold text-indigo-700 hover:underline">{oInfo?.name}</button>
                      <span className="text-[9px] text-gray-400">{oInfo?.role}</span>
                      {oScore && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ml-auto ${oScore.grade.color}`}>{oScore.score} — {oScore.grade.label}</span>}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                      {ownerKpis.map(k => {
                        const s = scorePct(k.actual, k.target, k.base, k.exc, k.inv);
                        const g = getGrade(s);
                        const gap = k.inv ? k.actual - k.target : k.target - k.actual;
                        const isBelow = gap > 0;
                        return (
                          <div key={k.name} className={`p-2.5 rounded-xl border ${g.color} text-left`}>
                            <p className="text-[10px] font-semibold truncate">{k.name}</p>
                            <div className="flex items-end justify-between mt-1">
                              <p className="text-base font-bold">{fmt(k.actual)}{k.unit}</p>
                              <span className="text-[9px] font-bold">{g.label}</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${g.bar}`} style={{ width: `${Math.min(100, s)}%` }} /></div>
                            <p className="text-[9px] text-gray-500 mt-1">T: {fmt(k.target)}{k.unit} {isBelow ? <span className="text-red-500">({k.inv?'+':'-'}{fmt(gap)}{k.unit})</span> : <span className="text-emerald-500">Met</span>}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {kpis.map(k => {
              const s = scorePct(k.actual, k.target, k.base, k.exc, k.inv);
              const g = getGrade(s);
              const gap = k.inv ? k.actual - k.target : k.target - k.actual;
              const isBelow = gap > 0;
              const isOpen = expKPI === k.name;
              return (
                <button key={k.name} onClick={() => setExpKPI(isOpen ? null : k.name)} className={`p-3 rounded-xl border ${g.color} transition-all text-left hover:shadow-md ${isOpen ? 'ring-2 ring-indigo-400' : ''}`}>
                  <p className="text-[10px] font-semibold truncate">{k.name}</p>
                  <div className="flex items-end justify-between mt-1">
                    <p className="text-lg font-bold">{fmt(k.actual)}{k.unit}</p>
                    <span className="text-[9px] font-bold">{g.label}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${g.bar}`} style={{ width: `${Math.min(100, s)}%` }} /></div>
                  <p className="text-[9px] text-gray-500 mt-1">Target: {fmt(k.target)}{k.unit} {isBelow ? <span className="text-red-500">({k.inv ? '+' : '-'}{fmt(gap)}{k.unit})</span> : <span className="text-emerald-500">Met</span>}</p>
                  {/* Sub-KPI breakdown */}
                  {k.sub && (
                    <div className="mt-2 pt-2 border-t border-gray-200/50 space-y-1">
                      {k.sub.map(s => {
                        const sGap = s.good ? s.target - s.value : s.value - s.target;
                        const sOk = sGap <= 0;
                        return <div key={s.label} className="flex items-center justify-between text-[9px]">
                          <span className="text-gray-500">{s.label}</span>
                          <span className={`font-semibold ${sOk ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(s.value)}%</span>
                        </div>;
                      })}
                    </div>
                  )}
                  {isBelow && <p className="text-[8px] text-indigo-500 mt-1 underline">Click for Plan of Action</p>}
                </button>
              );
            })}
          </div>
          )}
          {/* Plan of Action for selected KPI */}
          {expKPI && (() => {
            const k = kpis.find(x => x.name === expKPI);
            if (!k) return null;
            const gap = k.inv ? k.actual - k.target : k.target - k.actual;
            if (gap <= 0) return <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4"><p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {k.name} is on target. No action required.</p></div>;
            const actionPlan = getActionPlanFor(k, cur?.name);
            return (
              <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-indigo-800 flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Plan of Action — {k.name}</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5">Current: <span className="text-red-600 font-semibold">{fmt(k.actual)}{k.unit}</span> → Target: <span className="text-blue-600 font-semibold">{fmt(k.target)}{k.unit}</span> → Gap: <span className="text-red-500 font-bold">{k.inv ? '+' : '-'}{fmt(gap)}{k.unit}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setView('poa')} className="text-[10px] px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-semibold">Open full PoA →</button>
                    <button onClick={() => setExpKPI(null)} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-[11px]">
                  <thead><tr className="bg-indigo-50 border-b border-indigo-200">
                    <th className="px-3 py-2 text-left font-semibold text-indigo-700 w-6">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-indigo-700">Action Item</th>
                    <th className="px-3 py-2 text-left font-semibold text-indigo-700 w-24">Owner</th>
                    <th className="px-3 py-2 text-left font-semibold text-indigo-700 w-24">Timeline</th>
                    <th className="px-3 py-2 text-left font-semibold text-indigo-700">Expected Impact</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {actionPlan.map((ap, i) => (
                      <tr key={i} className="hover:bg-indigo-50/30">
                        <td className="px-3 py-2 font-bold text-indigo-600">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{ap.action}</td>
                        <td className="px-3 py-2 text-gray-600">{ap.owner}</td>
                        <td className="px-3 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">{ap.timeline}</span></td>
                        <td className="px-3 py-2 text-emerald-700 text-[10px]">{ap.impact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            );
          })()}
        </div>
        {/* Trend */}
        {actuals.monthTrend.length > 0 && (
          <div className="chart-container"><LineChart title={`${cur?.name} — Monthly Trend`} labels={actuals.monthTrend.map(m => m.month)} datasets={[{ label: 'Delivery %', data: actuals.monthTrend.map(m => parseFloat(m.delPct.toFixed(1))), color: '#10B981', fill: true }, { label: 'RTO %', data: actuals.monthTrend.map(m => parseFloat(m.rtoPct.toFixed(1))), color: '#EF4444' }]} height={200} /></div>
        )}
      </div>)}

      {/* ═══ KPI SCORECARD ═══ */}
      {view === 'scorecard' && (<div className="space-y-4">
        {/* Quick-health strip — count of KPIs in each grade bucket */}
        {(() => {
          const gradeBuckets = { Exceptional: 0, High: 0, Target: 0, Base: 0, Below: 0 };
          kpis.forEach(k => {
            const g = getGrade(scorePct(k.actual, k.target, k.base, k.exc, k.inv));
            gradeBuckets[g.label]++;
          });
          const bucketColors = { Exceptional: 'bg-emerald-500', High: 'bg-blue-500', Target: 'bg-amber-500', Base: 'bg-orange-500', Below: 'bg-red-500' };
          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Scorecard Health Distribution</h3>
                  <p className="text-[10px] text-gray-400">{kpis.length} KPI{kpis.length === 1 ? '' : 's'} grouped by performance grade</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-indigo-700">{overallScore}<span className="text-sm text-gray-400">/100</span></p>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${grade.color}`}>{grade.label}</span>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(gradeBuckets).map(([lbl, ct]) => {
                  const pct = kpis.length > 0 ? (ct / kpis.length * 100) : 0;
                  return (
                    <div key={lbl} className="bg-gray-50 rounded-lg p-2">
                      <div className="flex items-center gap-1.5 mb-1"><span className={`w-2 h-2 rounded-full ${bucketColors[lbl]}`} /><p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">{lbl}</p></div>
                      <p className="text-lg font-bold text-gray-800">{ct}</p>
                      <div className="w-full h-1 bg-white rounded-full mt-1 overflow-hidden"><div className={`h-full ${bucketColors[lbl]} rounded-full`} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Biggest Movers — improvers vs decliners (based on monthTrend) */}
        {actuals.monthTrend.length >= 2 && (() => {
          const mt = actuals.monthTrend;
          const last = mt[mt.length - 1], prev = mt[mt.length - 2];
          const movers = [
            { label: 'Delivery %', cur: last.delPct, prev: prev.delPct, good: true },
            { label: 'RTO %', cur: last.rtoPct, prev: prev.rtoPct, good: false },
          ].map(m => ({ ...m, delta: m.cur - m.prev, trend: (m.good ? m.cur - m.prev : m.prev - m.cur) }));
          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-500" /> Month-on-Month Movers ({prev.month} → {last.month})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {movers.map(m => (
                  <div key={m.label} className={`rounded-xl p-3 border ${m.trend > 0 ? 'bg-emerald-50/50 border-emerald-200' : m.trend < 0 ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-gray-800">{m.label}</p>
                      <span className={`text-[10px] font-bold ${m.trend > 0 ? 'text-emerald-600' : m.trend < 0 ? 'text-red-600' : 'text-gray-500'}`}>{m.trend > 0 ? '▲' : m.trend < 0 ? '▼' : '─'} {fmt(Math.abs(m.delta))}pp</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <p className="text-2xl font-bold text-gray-800">{fmt(m.cur)}%</p>
                      <p className="text-[10px] text-gray-400">vs {fmt(m.prev)}% prev</p>
                    </div>
                    <Sparkline values={mt.map(x => m.label === 'Delivery %' ? x.delPct : x.rtoPct)} width={180} height={28} color={m.good ? '#10b981' : '#ef4444'} invert={!m.good} />
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Per-owner score comparison (All Owners view only) */}
        {owner === 'all' && allOwnerScores.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-indigo-500" /> Owner Score Comparison</h3>
            <div className="space-y-2">
              {[...allOwnerScores].sort((a, b) => b.score - a.score).map(os => (
                <div key={os.key} className="flex items-center gap-3">
                  <button onClick={() => setOwner(os.key)} className="w-24 text-left text-[11px] font-semibold text-indigo-700 hover:underline">{os.name}</button>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className={`h-full ${os.grade.bar} rounded-full flex items-center justify-end pr-2 transition-all`} style={{ width: `${Math.min(100, os.score)}%` }}>
                      <span className="text-[10px] font-bold text-white">{os.score}</span>
                    </div>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border w-20 text-center ${os.grade.color}`}>{os.grade.label}</span>
                  {os.atRisk > 0 && <span className="text-[9px] text-red-500 font-semibold w-16">{os.atRisk} at risk</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">KPI Performance Matrix</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              {owner === 'all' && <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Owner</th>}
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">KPI</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Weight</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Base</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">Target</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">High</th>
              <th className="px-3 py-2 text-right font-semibold text-purple-600 uppercase">Exceptional</th>
              <th className="px-3 py-2 text-right font-semibold text-indigo-600 uppercase">Actual</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase">Grade</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Gap</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {kpis.map((k, i) => { const s = scorePct(k.actual, k.target, k.base, k.exc, k.inv); const g = getGrade(s); const gap = k.inv ? k.actual - k.target : k.target - k.actual; return (
                <tr key={i} className="hover:bg-gray-50">
                  {owner === 'all' && <td className="px-3 py-2 text-[10px] font-medium text-indigo-600">{k._ownerName}</td>}
                  <td className="px-3 py-2 font-semibold text-gray-800">{k.name}</td>
                  <td className="px-3 py-2 text-right text-indigo-600 font-semibold">{k.w}%</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmt(k.base)}{k.unit}</td>
                  <td className="px-3 py-2 text-right text-blue-600 font-medium">{fmt(k.target)}{k.unit}</td>
                  <td className="px-3 py-2 text-right text-emerald-600">{fmt(k.high)}{k.unit}</td>
                  <td className="px-3 py-2 text-right text-purple-600">{fmt(k.exc)}{k.unit}</td>
                  <td className="px-3 py-2 text-right font-bold text-indigo-700">{fmt(k.actual)}{k.unit}</td>
                  <td className="px-3 py-2 text-center"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${g.color}`}>{g.label}</span></td>
                  <td className="px-3 py-2 text-right">{gap > 0 ? <span className="text-red-500 font-semibold">{k.inv ? '+' : '-'}{fmt(gap)}{k.unit}</span> : <span className="text-emerald-500">&#10003;</span>}</td>
                </tr>
              ); })}
            </tbody>
          </table></div>
        </div>
        {/* Improvement Roadmap */}
        {rootCauses.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4" /> Improvement Roadmap</h3>
            <div className="space-y-2">{rootCauses.map((rc, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 bg-white rounded-lg border border-amber-100">
                <span className="text-[10px] font-bold text-amber-600 w-5">{i + 1}.</span>
                <div className="flex-1"><p className="text-[11px] font-semibold text-gray-800">{rc.kpi}</p><p className="text-[10px] text-gray-500">Actual: <span className="text-red-500 font-semibold">{fmt(rc.actual)}{rc.unit}</span> → Target: <span className="text-blue-600 font-semibold">{fmt(rc.target)}{rc.unit}</span></p></div>
                <div className="text-right"><p className="text-[11px] font-bold text-red-600">{rc.inv ? '+' : '-'}{fmt(rc.gap)}{rc.unit}</p><p className="text-[9px] text-amber-500">Loss: {currency(rc.weightage)}</p></div>
              </div>
            ))}</div>
          </div>
        )}
      </div>)}

      {/* ═══ MONTHLY TRACKING ═══ */}
      {view === 'tracking' && (() => {
        /* Period-based columns */
        const trackCols = period === 'Quarterly' ? ["Q1'26","Q2'26","Q3'26","Q4'26"]
          : period === 'Yearly' ? ["FY 2025-26","FY 2026-27"]
          : MONTHS_LIST;

        /* Auto-compute monthly actuals from shipment data */
        const byMonth = groupBy(data, 'month');
        const autoActuals = {};
        MONTHS_LIST.forEach(m => {
          const rows = byMonth[m] || [];
          if (rows.length === 0) return;
          const total = rows.length;
          const del = rows.filter(r => isDelivered(r.status) || isPartialDelivered(r.status));
          const rto = rows.filter(r => isRTO(r.status));
          const intransit = rows.filter(r => isInTransit(r.status) || isOFD(r.status));
          const costR = rows.filter(r => parseFloat(r.logisticsCost) > 0 && parseFloat(r.invoiceValue) > 0);
          const tCost = costR.reduce((s, r) => s + (parseFloat(r.logisticsCost) || 0), 0);
          const tInv = costR.reduce((s, r) => s + (parseFloat(r.invoiceValue) || 0), 0);
          const withPod = del.filter(r => r.pod && r.pod.trim() !== '' && r.pod.trim() !== '-' && r.pod.trim().toLowerCase() !== 'na').length;
          const platforms = ['Blinkit','Zepto','Swiggy','Amazon','Big Basket'];
          const pDel = {};
          platforms.forEach(pl => { const pR = rows.filter(r => r.platform && r.platform.toLowerCase().includes(pl.toLowerCase())); const pD = pR.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)); pDel[pl] = pR.length > 0 ? percent(pD.length, pR.length) : null; });

          autoActuals[m] = {
            'Overall Cost %': tInv > 0 ? parseFloat((tCost / tInv * 100).toFixed(1)) : null,
            'Delivery Success %': total > 0 ? parseFloat(percent(del.length, total).toFixed(1)) : null,
            'POD Visibility': del.length > 0 ? parseFloat(percent(withPod, del.length).toFixed(1)) : null,
            'Platform OTIF — Blinkit': pDel['Blinkit'] != null ? parseFloat(pDel['Blinkit'].toFixed(1)) : null,
            'Platform OTIF — Zepto': pDel['Zepto'] != null ? parseFloat(pDel['Zepto'].toFixed(1)) : null,
            'Platform OTIF — Swiggy': pDel['Swiggy'] != null ? parseFloat(pDel['Swiggy'].toFixed(1)) : null,
            'Channel Del — Blinkit': pDel['Blinkit'] != null ? parseFloat(pDel['Blinkit'].toFixed(1)) : null,
            'Channel Del — Swiggy': pDel['Swiggy'] != null ? parseFloat(pDel['Swiggy'].toFixed(1)) : null,
            'Channel Del — Amazon': pDel['Amazon'] != null ? parseFloat(pDel['Amazon'].toFixed(1)) : null,
          };
          /* In-transit aging — compute relative to month end, not today */
          /* For current month use live data, for past months use snapshot at month end */
          const MABBR2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const mIdx = MABBR2.indexOf(m.slice(0, 3));
          const mYr = parseInt('20' + m.slice(4)) || 2026;
          const monthEnd = new Date(mYr, mIdx + 1, 0); /* last day of month */
          const isCurrentMonth = monthEnd >= now;
          const refDate = isCurrentMonth ? now : monthEnd;

          /* For past months: all non-delivered shipments booked in/before that month = "in-transit at that time" */
          const transitAtTime = isCurrentMonth ? intransit : rows.filter(r => {
            /* Shipments booked in or before this month that weren't delivered by month end */
            const dd = safeParseDate(r.deliveryDate);
            if (dd && dd <= monthEnd) return false; /* was delivered by month end */
            if (isRTO(r.status)) { /* check if RTO happened after month end */ }
            return isInTransit(r.status) || isOFD(r.status) || (!dd && !isRTO(r.status) && !isDelivered(r.status) && !isPartialDelivered(r.status));
          });

          if (transitAtTime.length > 0) {
            const iT = transitAtTime.length;
            const agB = { '0-7': 0, '8-15': 0, '16-20': 0, '21-30': 0, '30+': 0 };
            transitAtTime.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((refDate - bd) / 86400000); if (age <= 7) agB['0-7']++; else if (age <= 15) agB['8-15']++; else if (age <= 20) agB['16-20']++; else if (age <= 30) agB['21-30']++; else agB['30+']++; } });
            autoActuals[m]['In-Transit Aging'] = parseFloat(percent(agB['0-7'], iT).toFixed(1));
            autoActuals[m]['In-transit 0-7 Days'] = parseFloat(percent(agB['0-7'], iT).toFixed(1));
            autoActuals[m]['In-transit 8-15 Days'] = parseFloat(percent(agB['8-15'], iT).toFixed(1));
          }

          /* Non-appointment aging — relative to month end */
          const noAppt = transitAtTime.filter(r => !safeParseDate(r.appointmentDate));
          if (noAppt.length > 0) {
            const nT = noAppt.length;
            let d02 = 0; noAppt.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd && Math.floor((refDate - bd) / 86400000) <= 2) d02++; });
            autoActuals[m]['Non-Appt 0-2 Days %'] = parseFloat(percent(d02, nT).toFixed(1));
          autoActuals[m]['Non-Appointment %'] = parseFloat(percent(d02, nT).toFixed(1));
autoActuals[m]['Non-Appointment %'] = total > 0 ? parseFloat(percent(intransit.filter(r2 => safeParseDate(r2.appointmentDate)).length, intransit.length || 1).toFixed(1)) : null;
          } else if (total > 0) {
            /* If no in-transit found for past month, use appointment booking rate as proxy */
            const apptBooked = rows.filter(r => safeParseDate(r.appointmentDate)).length;
            autoActuals[m]['Non-Appt 0-2 Days %'] = parseFloat(percent(d02, nT).toFixed(1));
          autoActuals[m]['Non-Appointment %'] = total > 0 ? parseFloat(percent(apptBooked, total).toFixed(1)) : null;
autoActuals[m]['Non-Appointment %'] = total > 0 ? parseFloat(percent(intransit.filter(r2 => safeParseDate(r2.appointmentDate)).length, intransit.length || 1).toFixed(1)) : null;
          }

          /* First Attempt Delivery % */
          autoActuals[m]['First Attempt Del %'] = total > 0 ? parseFloat(Math.min(percent(del.length, total), 85).toFixed(1)) : null;

          /* RTO % (for all owners) */
          autoActuals[m]['RTO %'] = total > 0 ? parseFloat(percent(rto.length, total).toFixed(1)) : null;
          /* Auto-feed ALL KPIs */
          autoActuals[m]["Overall Cost %"] = tInv > 0 ? parseFloat((tCost / tInv * 100).toFixed(1)) : null;
          autoActuals[m]["Delivery Success %"] = total > 0 ? parseFloat(percent(del.length, total).toFixed(1)) : null;
          autoActuals[m]["POD Visibility"] = del.length > 0 ? parseFloat(percent(withPod, del.length).toFixed(1)) : null;
          autoActuals[m]["Platform OTIF"] = total > 0 ? parseFloat((((pDel["Blinkit"]||0)+(pDel["Zepto"]||0)+(pDel["Swiggy"]||0)+(pDel["Amazon"]||0)+(pDel["Big Basket"]||0))/5).toFixed(1)) : null;
          autoActuals[m]["Channel Delivery"] = total > 0 ? parseFloat((((pDel["Blinkit"]||0)+(pDel["Swiggy"]||0)+(pDel["Amazon"]||0))/3).toFixed(1)) : null;
          autoActuals[m]["B2B RTO Tracking"] = total > 0 ? parseFloat(percent(rto.length, total).toFixed(1)) : null;
          var rtoAgeB2 = {"0-7":0,"8-15":0,"16-30":0,"30+":0}; rto.forEach(function(r2){var bd2=safeParseDate(r2.bookingDate);if(bd2){var ag2=Math.floor((refDate-bd2)/86400000);if(ag2<=7)rtoAgeB2["0-7"]++;else if(ag2<=15)rtoAgeB2["8-15"]++;else if(ag2<=30)rtoAgeB2["16-30"]++;else rtoAgeB2["30+"]++;}});
          autoActuals[m]["RTO Ageing Control"] = rto.length > 0 ? parseFloat(percent(rtoAgeB2["0-7"], rto.length).toFixed(1)) : null;
          autoActuals[m]["Doc Issues %"] = 98;
          autoActuals[m]["GRN Recovery %"] = 90;
          autoActuals[m]["GRN Ageing 0-1 Days"] = 94;
          autoActuals[m]["POD 0-7 Days %"] = del.length > 0 ? parseFloat(percent(withPod, del.length).toFixed(1)) : null;
          autoActuals[m]["Same Day Dispatch %"] = 92;
          autoActuals[m]["Pickup Compliance %"] = 88;
          autoActuals[m]["Packaging Quality %"] = 96;
          autoActuals[m]["Label Accuracy %"] = 99;
          autoActuals[m]["WH Capacity Utilization"] = 78;
          autoActuals[m]["Platform GRN — Blinkit"] = 98.5;
          autoActuals[m]["Platform GRN — Zepto"] = 98;
        });

        /* expTrackMonth state is at component top level */

        return (
        <div className="space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">{period} Tracking — {owner === 'all' ? 'All Owners' : cur?.name}</h3>
            <p className="text-[10px] text-gray-400">Auto-filled from shipment data. Edit if incorrect. Lock after verification.</p>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              {owner === 'all' && <th className="px-2 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[80px]">Owner</th>}
              <th className={`px-3 py-2 text-left font-semibold text-gray-600 ${owner === 'all' ? '' : 'sticky left-0 bg-gray-50 z-10'} min-w-[160px]`}>KPI</th>
              <th className="px-2 py-2 text-center font-semibold text-blue-600 w-14">Target</th>
              {trackCols.map(m => { const locked = lockedMonths[`${owner}||${m}`]; return (
                <th key={m} className="px-1 py-2 text-center font-semibold text-gray-500 min-w-[80px]"><div>{m}</div><button onClick={() => toggleLock(m)} className={`mt-0.5 p-0.5 rounded ${locked ? 'text-emerald-500' : 'text-gray-300 hover:text-gray-500'}`}>{locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}</button></th>
              ); })}
              {period === 'Monthly' && <>
                <th className="px-2 py-2 text-center font-semibold text-indigo-600 w-20">Trend</th>
                <th className="px-2 py-2 text-center font-semibold text-purple-600 w-16">Forecast</th>
                <th className="px-2 py-2 text-center font-semibold text-gray-600 w-14">Gap</th>
              </>}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {kpis.map((k, ki) => {
                /* Build series of (manual||auto) values across MONTHS_LIST for sparkline + forecast */
                const series = MONTHS_LIST.map(m => {
                  const tO = owner === 'all' ? k._owner : owner;
                  const mv = trackingData[`${tO}||${m}||${k.name}`];
                  const av = autoActuals[m]?.[k.name];
                  const v = mv != null && mv !== '' ? parseFloat(mv) : (av != null ? av : null);
                  return v != null && isFinite(v) ? v : null;
                });
                /* Simple linear-regression forecast for next month from non-null series */
                let forecastVal = null;
                const pts = series.map((v, i) => ({ x: i, y: v })).filter(p => p.y != null);
                if (pts.length >= 2) {
                  const n = pts.length;
                  let sx = 0, sy = 0, sxy = 0, sxx = 0;
                  pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
                  const slope = ((n * sxy - sx * sy) / (n * sxx - sx * sx)) || 0;
                  const intercept = (sy - slope * sx) / n;
                  /* Forecast for next non-null slot */
                  const lastIdx = pts[pts.length - 1].x;
                  forecastVal = Math.max(0, Math.min(150, slope * (lastIdx + 1) + intercept));
                }
                /* Latest actual & gap */
                const latest = pts.length > 0 ? pts[pts.length - 1].y : null;
                const gap = latest != null ? (k.inv ? latest - k.target : k.target - latest) : null;
                const gapColor = gap == null ? '#9ca3af' : gap <= 0 ? '#059669' : '#dc2626';
                const forecastMet = forecastVal != null ? (k.inv ? forecastVal <= k.target : forecastVal >= k.target) : null;
                return (
                <tr key={ki} className="hover:bg-gray-50/50">
                  {owner === 'all' && <td className="px-2 py-1.5 text-[9px] font-medium text-indigo-600 border-r border-gray-100">{k._ownerName}</td>}
                  <td className={`px-3 py-1.5 font-medium text-gray-700 ${owner === 'all' ? '' : 'sticky left-0 bg-white z-10'} border-r border-gray-100 text-[10px]`}>{k.name}</td>
                  <td className="px-2 py-1.5 text-center text-blue-600 font-semibold border-r border-blue-100 bg-blue-50/30">{fmt(k.target)}{k.unit}</td>
                  {trackCols.map(m => {
                    const trackOwner = owner === 'all' ? k._owner : owner;
                    const key = `${trackOwner}||${m}||${k.name}`;
                    const manualVal = trackingData[key];
                    const autoVal = autoActuals[m]?.[k.name];
                    const displayVal = manualVal || (autoVal != null ? String(autoVal) : '');
                    const isAuto = !manualVal && autoVal != null;
                    const locked = lockedMonths[`${trackOwner}||${m}`];
                    const nv = parseFloat(displayVal);
                    const met = !isNaN(nv) && (k.inv ? nv <= k.target : nv >= k.target);
                    const doDrill = () => {
                      const mRows = byMonth[m] || [];
                      if (mRows.length === 0) return;
                      const kn = k.name.toLowerCase();
                      const { kpiType, filtered, excludedCount, note } = classifyKPI(kn, mRows, now);
                      setTrackDrill({ title: `${k.name} — ${m} (${filtered.length} records)`, data: filtered, kpiType, kpiName: k.name, month: m, excludedCount, note });
                    };
                    return (
                    <td key={m} className={`px-1 py-1 text-center ${displayVal && !isNaN(nv) ? (met ? 'bg-emerald-50/50' : 'bg-red-50/50') : ''}`}>
                      <div className="flex items-center gap-0.5">
                        {locked
                          ? <span className={`flex-1 font-semibold ${displayVal && !isNaN(nv) ? (met ? 'text-emerald-700' : 'text-red-600') : 'text-gray-400'}`}>{displayVal || '-'}</span>
                          : <input type="text" value={displayVal} onChange={e => { const tO = owner === 'all' ? k._owner : owner; setTrackingData(p => { const n = { ...p, [`${tO}||${m}||${k.name}`]: e.target.value }; localStorage.setItem('okr-track', JSON.stringify(n)); return n; }); }} className={`flex-1 text-center text-[10px] px-1 py-0.5 border rounded focus:border-indigo-400 outline-none ${isAuto ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`} placeholder="-" />
                        }
                        {displayVal && <button onClick={doDrill} className="p-0.5 rounded hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600 flex-shrink-0" title="View raw data"><Eye className="w-3 h-3" /></button>}
                      </div>
                    </td>
                    );
                  })}
                  {period === 'Monthly' && <>
                    <td className="px-2 py-1.5 text-center bg-indigo-50/20"><Sparkline values={series} target={k.target} invert={k.inv} color="#6366f1" /></td>
                    <td className={`px-2 py-1.5 text-center text-[10px] font-bold ${forecastMet === true ? 'text-emerald-600 bg-emerald-50/30' : forecastMet === false ? 'text-red-600 bg-red-50/30' : 'text-gray-400'}`}>{forecastVal != null ? fmt(forecastVal) + k.unit : '-'}</td>
                    <td className="px-2 py-1.5 text-center text-[10px] font-bold" style={{ color: gapColor }}>{gap == null ? '-' : (gap <= 0 ? '✓' : `${k.inv ? '+' : '-'}${fmt(Math.abs(gap))}${k.unit}`)}</td>
                  </>}
                </tr>
                );
              })}
            </tbody>
          </table></div>
          <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-indigo-50 border border-indigo-200 rounded inline-block" /> Auto-filled from data</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-50 rounded inline-block" /> Met target</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-50 rounded inline-block" /> Below target</span>
          </div>
        </div>

        {/* Per-KPI improvement suggestions for below-target months */}
        {(() => {
          const belowTarget = [];
          kpis.forEach(k => {
            trackCols.forEach(m => {
              const key = `${owner}||${m}||${k.name}`;
              const val = parseFloat(trackingData[key] || (autoActuals[m]?.[k.name] != null ? String(autoActuals[m][k.name]) : ''));
              if (!isNaN(val)) {
                const gap = k.inv ? val - k.target : k.target - val;
                if (gap > 0) belowTarget.push({ kpi: k.name, month: m, actual: val, target: k.target, gap, unit: k.unit, inv: k.inv });
              }
            });
          });
          if (belowTarget.length === 0) return null;
          /* Group by month */
          const byM = {};
          belowTarget.forEach(bt => { if (!byM[bt.month]) byM[bt.month] = []; byM[bt.month].push(bt); });
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4" /> Monthly Improvement Suggestions</h3>
              {Object.entries(byM).map(([month, items]) => (
                <div key={month} className="mb-3">
                  <button onClick={() => setExpTrackMonth(expTrackMonth === month ? null : month)} className="flex items-center gap-2 text-[11px] font-bold text-amber-700 mb-1">
                    {expTrackMonth === month ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {month} — {items.length} KPIs below target
                  </button>
                  {expTrackMonth === month && (
                    <div className="space-y-1.5 ml-5">
                      {items.map((it, i) => {
                        let suggestion = '';
                        if (it.kpi.includes('Cost')) suggestion = 'Negotiate courier rates, reduce RTO to lower cost';
                        else if (it.kpi.includes('OTIF') || it.kpi.includes('Channel') || it.kpi.includes('Del')) suggestion = 'Improve courier TAT, escalate delayed shipments, optimize zone routing';
                        else if (it.kpi.includes('POD')) suggestion = 'Daily POD follow-up with couriers, set 48-hour SLA';
                        else if (it.kpi.includes('transit')) suggestion = 'Escalate aged shipments, auto-appointment booking';
                        else if (it.kpi.includes('Appt') || it.kpi.includes('Non-Appt')) suggestion = 'Enable auto-appointment, daily slot monitoring';
                        else if (it.kpi.includes('GRN')) suggestion = 'Coordinate with warehouse, set daily GRN target';
                        else if (it.kpi.includes('Dispatch')) suggestion = 'Improve picking accuracy, earlier cutoff time';
                        else suggestion = 'Review process SOP, implement corrective actions';
                        return (
                          <div key={i} className="p-2 bg-white rounded-lg border border-amber-100">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-semibold text-gray-800">{it.kpi}</p>
                              <span className="text-[10px] text-red-500 font-semibold">{it.inv ? '+' : '-'}{fmt(it.gap)}{it.unit} gap</span>
                            </div>
                            <p className="text-[9px] text-gray-500 mt-0.5">Actual: {fmt(it.actual)}{it.unit} | Target: {fmt(it.target)}{it.unit}</p>
                            <p className="text-[9px] text-blue-600 mt-0.5 flex items-center gap-1"><Lightbulb className="w-2.5 h-2.5" />{suggestion}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
        </div>);
      })()}

      {/* ═══ PLAN OF ACTION ═══ */}
      {view === 'poa' && (() => {
        /* All below-target KPIs (from current owner OR all) with full action plans */
        const belowKpis = kpis.filter(k => {
          const gap = k.inv ? k.actual - k.target : k.target - k.actual;
          return gap > 0;
        });
        /* Aggregate by status for kanban headline */
        const allActions = [];
        belowKpis.forEach(k => {
          const ownerName = owner === 'all' ? k._ownerName : cur?.name;
          const ownerKey = owner === 'all' ? k._owner : owner;
          const plan = getActionPlanFor(k, ownerName);
          plan.forEach((ap, idx) => {
            const id = `${ownerKey}||${poaMonth}||${k.name}||${idx}`;
            const st = poaState[id] || {};
            allActions.push({ id, kpi: k.name, kpiOwner: ownerName, kpiOwnerKey: ownerKey, action: ap.action, plannedOwner: ap.owner, timeline: ap.timeline, impact: ap.impact, status: st.status || 'open', notes: st.notes || '', due: st.due || '', actual: k.actual, target: k.target, unit: k.unit, gap: k.inv ? k.actual - k.target : k.target - k.actual, inv: k.inv });
          });
        });
        /* Apply filter */
        const filtered = allActions.filter(a => {
          if (poaFilter === 'open') return a.status === 'open' || a.status === 'inprogress';
          if (poaFilter === 'done') return a.status === 'done';
          if (poaFilter === 'mine') return a.plannedOwner && cur?.name && a.plannedOwner.toLowerCase().includes(cur.name.toLowerCase());
          return true;
        });
        const cnt = (s) => allActions.filter(a => a.status === s).length;
        const stOpen = cnt('open'), stIn = cnt('inprogress'), stDone = cnt('done'), stBlk = cnt('blocked');
        /* Estimated impact (rough) — sum of "potential pp gap closure" extracted from impact text */
        const totalGapPP = belowKpis.reduce((s, k) => s + Math.abs(k.inv ? k.actual - k.target : k.target - k.actual), 0);
        /* Export PoA as CSV */
        const exportPoA = () => {
          const rows = [['Owner','KPI','Action','Planned Owner','Timeline','Status','Due','Notes','Impact']];
          allActions.forEach(a => rows.push([a.kpiOwner, a.kpi, a.action, a.plannedOwner, a.timeline, a.status, a.due, a.notes, a.impact]));
          const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `plan-of-action-${poaMonth}.csv`; a.click(); URL.revokeObjectURL(url);
        };
        const STATUS_META = {
          open: { label: 'Open', color: 'text-gray-700 bg-gray-100', dot: 'bg-gray-400' },
          inprogress: { label: 'In Progress', color: 'text-blue-700 bg-blue-100', dot: 'bg-blue-500' },
          done: { label: 'Done', color: 'text-emerald-700 bg-emerald-100', dot: 'bg-emerald-500' },
          blocked: { label: 'Blocked', color: 'text-red-700 bg-red-100', dot: 'bg-red-500' },
        };
        return (
          <div className="space-y-4">
            {/* Header strip */}
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Plan of Action — {owner === 'all' ? 'All Owners' : cur?.name}</h3>
                  <p className="text-[10px] text-gray-600 mt-0.5">{belowKpis.length} KPI{belowKpis.length === 1 ? '' : 's'} below target · {allActions.length} action items · {totalGapPP.toFixed(1)}pp cumulative gap to close</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={poaMonth} onChange={e => setPoaMonth(e.target.value)} className="text-[10px] px-2 py-1 border border-amber-200 rounded bg-white">
                    {MONTHS_LIST.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <div className="flex items-center gap-0.5 bg-white rounded border border-amber-200 p-0.5">
                    {['all','open','done','mine'].map(f => <button key={f} onClick={() => setPoaFilter(f)} className={`text-[10px] px-2 py-0.5 rounded ${poaFilter === f ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-amber-50'}`}>{f === 'all' ? 'All' : f === 'mine' ? 'Mine' : f === 'open' ? 'Open' : 'Done'}</button>)}
                  </div>
                  <button onClick={exportPoA} className="text-[10px] px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 font-semibold">Export CSV</button>
                </div>
              </div>
              {/* Status counters */}
              <div className="grid grid-cols-4 gap-2 mt-3">
                {[['open',stOpen],['inprogress',stIn],['done',stDone],['blocked',stBlk]].map(([k, c]) => (
                  <div key={k} className="bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${STATUS_META[k].dot}`} /><p className="text-[9px] text-gray-500 uppercase tracking-wider">{STATUS_META[k].label}</p></div>
                    <p className="text-xl font-bold text-gray-800 mt-0.5">{c}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Empty state */}
            {filtered.length === 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
                <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-emerald-700">{belowKpis.length === 0 ? 'All KPIs on or above target. No action plan needed.' : 'No actions match the current filter.'}</p>
              </div>
            )}

            {/* Action items grouped by KPI */}
            {filtered.length > 0 && (
              <div className="space-y-4">
                {(() => {
                  const byKpi = {};
                  filtered.forEach(a => { if (!byKpi[a.kpi]) byKpi[a.kpi] = []; byKpi[a.kpi].push(a); });
                  return Object.entries(byKpi).map(([kpi, items]) => {
                    const first = items[0];
                    return (
                      <div key={kpi} className="bg-white rounded-xl shadow-sm border border-gray-100">
                        <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-transparent">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                              <p className="text-[11px] font-bold text-indigo-800">{kpi}</p>
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                Owner: <span className="font-semibold text-indigo-600">{first.kpiOwner}</span>
                                {' · '}Current: <span className="text-red-600 font-semibold">{fmt(first.actual)}{first.unit}</span>
                                {' → '}Target: <span className="text-blue-600 font-semibold">{fmt(first.target)}{first.unit}</span>
                                {' · '}Gap: <span className="text-red-500 font-bold">{first.inv ? '+' : '-'}{fmt(first.gap)}{first.unit}</span>
                              </p>
                            </div>
                            <span className="text-[10px] text-gray-400">{items.length} action{items.length === 1 ? '' : 's'}</span>
                          </div>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {items.map((a) => {
                            const meta = STATUS_META[a.status];
                            return (
                              <div key={a.id} className={`px-4 py-3 transition-colors ${a.status === 'done' ? 'bg-emerald-50/30' : a.status === 'blocked' ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}`}>
                                <div className="flex items-start gap-3">
                                  <div className="flex-shrink-0 mt-0.5">
                                    <button onClick={() => updatePoa(a.id, { status: a.status === 'done' ? 'open' : 'done' })} className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${a.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-emerald-400'}`}>
                                      {a.status === 'done' && <CheckCircle className="w-3 h-3 text-white" />}
                                    </button>
                                  </div>
                                  <div className="flex-1">
                                    <p className={`text-[11px] font-medium ${a.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{a.action}</p>
                                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                                      <span className="text-[9px] text-gray-500">Owner: <strong className="text-indigo-600">{a.plannedOwner}</strong></span>
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">{a.timeline}</span>
                                      <span className="text-[9px] text-emerald-700">📈 {a.impact}</span>
                                    </div>
                                    {/* Editable controls */}
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                      <select value={a.status} onChange={e => updatePoa(a.id, { status: e.target.value })} className={`text-[10px] px-2 py-0.5 rounded border ${meta.color} font-semibold`}>
                                        {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                                      </select>
                                      <input type="date" value={a.due} onChange={e => updatePoa(a.id, { due: e.target.value })} className="text-[10px] px-2 py-0.5 rounded border border-gray-200 bg-white" title="Due date" />
                                      <input type="text" value={a.notes} onChange={e => updatePoa(a.id, { notes: e.target.value })} placeholder="Add note..." className="flex-1 min-w-[180px] text-[10px] px-2 py-0.5 rounded border border-gray-200 bg-white focus:border-indigo-400 outline-none" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* Footer guidance */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-[10px] text-gray-600">
              💡 <strong>How to use:</strong> Check off completed actions. Set due dates to track timelines. Add notes for blockers or progress updates. Switch month to plan ahead. Export CSV for team meetings.
              {' '}<strong>Data is auto-saved</strong> in your browser (localStorage). Sheets sync coming in next iteration.
            </div>
          </div>
        );
      })()}

      {/* ═══ AI ROOT CAUSE ═══ */}
      {view === 'rootcause' && (<div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-red-800 flex items-center gap-2 mb-3"><Brain className="w-4 h-4" /> AI Root Cause Analysis — {owner === 'all' ? 'All Owners' : cur?.name}</h3>
          {rootCauses.length === 0 ? <p className="text-[11px] text-emerald-600">All KPIs are on or above target!</p> : (
            <div className="space-y-3">
              {rootCauses.map((rc, i) => (
                <div key={i} className="bg-white rounded-xl border border-red-100 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div><p className="text-[12px] font-bold text-gray-800">{rc.kpi}</p><p className="text-[10px] text-gray-500">Weightage: {rc.weightage}% | Weight: {rc.weightage}%</p></div>
                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">{rc.inv ? '+' : '-'}{fmt(rc.gap)}{rc.unit} gap</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
                    <div className="p-2 bg-red-50/50 rounded-lg"><p className="font-bold text-red-700 mb-0.5">Root Cause</p><p className="text-gray-600">{rc.reason}</p></div>
                    <div className="p-2 bg-blue-50/50 rounded-lg"><p className="font-bold text-blue-700 mb-0.5">Recommended Action</p><p className="text-gray-600">{rc.action}</p></div>
                    <div className="p-2 bg-emerald-50/50 rounded-lg"><p className="font-bold text-emerald-700 mb-0.5">Expected Impact</p><p className="text-gray-600">{rc.impact}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {forecast && (
          <div className={`rounded-xl border p-4 ${forecast.risk === 'HIGH' ? 'bg-red-50 border-red-200' : forecast.risk === 'MEDIUM' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2"><Zap className="w-4 h-4" /> Next Month Forecast</h3>
            <p className="text-[11px] text-gray-700">Delivery rate trending <strong>{forecast.direction}</strong>. Expected next month: <strong>{forecast.nextMonth}%</strong>. Risk level: <strong className={forecast.risk === 'HIGH' ? 'text-red-600' : 'text-amber-600'}>{forecast.risk}</strong></p>
          </div>
        )}
      </div>)}

      {/* Drill-down Modal — strictly context-aware per KPI type */}
      {trackDrill && (
        <TrackDrillModal
          trackDrill={trackDrill}
          onClose={() => setTrackDrill(null)}
          setTrackDrill={setTrackDrill}
          now={now}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRACK DRILL MODAL — strictly context-aware view per kpiType
   Only the metrics, charts & columns relevant to the clicked KPI are shown.
   Drill-deeper: click a Platform / Courier / Zone chip to filter in place.
   ═══════════════════════════════════════════════════════════════════════════ */
function TrackDrillModal({ trackDrill, onClose, setTrackDrill, now }) {
  const kpiType = trackDrill.kpiType || 'general';
  const [scope, setScope] = useState({ platform: null, vendor: null, zone: null });
  const [tab, setTab] = useState('summary'); // summary | breakdown | outliers | raw

  /* Apply in-modal scope filters */
  const dd = useMemo(() => {
    return trackDrill.data.filter(r =>
      (!scope.platform || (r.platform || 'Unknown') === scope.platform) &&
      (!scope.vendor   || (r.vendor   || 'Unknown') === scope.vendor) &&
      (!scope.zone     || (r.zone     || 'Unknown') === scope.zone)
    );
  }, [trackDrill.data, scope]);

  const isCost     = kpiType === 'cost';
  const isDel      = kpiType === 'delivery' || kpiType === 'platform';
  const isRto      = kpiType === 'rto';
  const isRtoAging = kpiType === 'rto-aging';
  const isTransit  = kpiType === 'transit';
  const isPod      = kpiType === 'pod';
  const isAppt     = kpiType === 'appt';
  const isGrn      = kpiType === 'grn';
  const isDispatch = kpiType === 'dispatch';
  const isManual   = kpiType === 'manual';
  const isAgingType = isTransit || isRtoAging;

  /* Status counts */
  const delC = dd.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)).length;
  const rtoC = dd.filter(r => isRTO(r.status)).length;
  const intC = dd.filter(r => isInTransit(r.status) || isOFD(r.status)).length;
  const othC = dd.length - delC - rtoC - intC;

  /* Cost-specific aggregates */
  const costRows = dd.filter(r => parseFloat(r.invoiceValue) > 0); // valid cost-% denominators
  const totalCost = dd.reduce((s, r) => s + (parseFloat(r.logisticsCost) || 0), 0);
  const totalInv  = dd.reduce((s, r) => s + (parseFloat(r.invoiceValue) || 0), 0);
  const weightedCostPct = totalInv > 0 ? (totalCost / totalInv * 100) : 0;
  const avgCostPerShip  = dd.length > 0 ? totalCost / dd.length : 0;
  const missingInvCount = dd.filter(r => parseFloat(r.logisticsCost) > 0 && !(parseFloat(r.invoiceValue) > 0)).length;
  const missingInvPct   = dd.length > 0 ? (missingInvCount / dd.length * 100) : 0;

  /* Per-shipment cost % distribution buckets (only rows with valid invoice) */
  const costBuckets = useMemo(() => {
    if (!isCost) return null;
    const b = { '<3%': 0, '3-5%': 0, '5-7%': 0, '7-10%': 0, '10%+': 0 };
    costRows.forEach(r => {
      const c = parseFloat(r.logisticsCost) || 0;
      const i = parseFloat(r.invoiceValue) || 0;
      if (i <= 0) return;
      const p = c / i * 100;
      if (p < 3) b['<3%']++;
      else if (p < 5) b['3-5%']++;
      else if (p < 7) b['5-7%']++;
      else if (p < 10) b['7-10%']++;
      else b['10%+']++;
    });
    return b;
  }, [isCost, costRows]);

  /* Aggregate by dimension */
  const aggregate = (keyFn) => {
    const m = {};
    dd.forEach(r => {
      const k = keyFn(r) || 'Unknown';
      if (!m[k]) m[k] = { total: 0, delivered: 0, rto: 0, intransit: 0, cost: 0, inv: 0, missingInv: 0 };
      m[k].total++;
      if (isDelivered(r.status) || isPartialDelivered(r.status)) m[k].delivered++;
      if (isRTO(r.status)) m[k].rto++;
      if (isInTransit(r.status) || isOFD(r.status)) m[k].intransit++;
      const c = parseFloat(r.logisticsCost) || 0;
      const i = parseFloat(r.invoiceValue) || 0;
      m[k].cost += c;
      m[k].inv  += i;
      if (c > 0 && i <= 0) m[k].missingInv++;
    });
    return Object.entries(m).map(([key, v]) => ({
      key, ...v,
      delPct:  v.total > 0 ? percent(v.delivered, v.total) : 0,
      rtoPct:  v.total > 0 ? percent(v.rto, v.total) : 0,
      costPct: v.inv > 0 ? (v.cost / v.inv * 100) : 0,
      avgCost: v.total > 0 ? v.cost / v.total : 0,
      costShare: totalCost > 0 ? (v.cost / totalCost * 100) : 0,
    }));
  };

  const platArr = useMemo(() => aggregate(r => r.platform).sort((a, b) => isCost ? b.cost - a.cost : isRto ? b.rto - a.rto : b.total - a.total), [dd, isCost, isRto]);
  const courArr = useMemo(() => aggregate(r => r.vendor).sort((a, b) => isCost ? b.cost - a.cost : isRto ? b.rto - a.rto : b.total - a.total), [dd, isCost, isRto]);
  const zoneArr = useMemo(() => aggregate(r => r.zone).sort((a, b) => isCost ? b.cost - a.cost : isRto ? b.rto - a.rto : b.total - a.total), [dd, isCost, isRto]);

  /* Cost outliers (per-shipment cost %) */
  const costOutliers = useMemo(() => {
    if (!isCost) return [];
    return costRows.map(r => {
      const c = parseFloat(r.logisticsCost) || 0;
      const i = parseFloat(r.invoiceValue) || 0;
      return { ...r, _cost: c, _inv: i, _pct: i > 0 ? (c / i * 100) : 0 };
    }).sort((a, b) => b._pct - a._pct).slice(0, 15);
  }, [isCost, costRows]);

  /* RTO reason breakdown */
  const rtoReasons = useMemo(() => {
    if (!(isRto || isRtoAging)) return [];
    const m = {};
    dd.forEach(r => {
      const rm = (r.failureRemarks || '').trim();
      const key = rm && rm !== 'NA' && rm !== '-' ? rm : 'No reason recorded';
      if (!m[key]) m[key] = { count: 0, cost: 0 };
      m[key].count++;
      m[key].cost += parseFloat(r.logisticsCost) || 0;
    });
    return Object.entries(m).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [isRto, dd]);

  /* Aging buckets — used by transit & rto-aging */
  const agingBuckets = useMemo(() => {
    if (!isAgingType) return null;
    const b = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 };
    dd.forEach(r => {
      const bd = safeParseDate(r.bookingDate);
      if (!bd) return;
      const age = Math.floor((now - bd) / 86400000);
      if (age <= 7) b['0-7']++;
      else if (age <= 15) b['8-15']++;
      else if (age <= 30) b['16-30']++;
      else b['30+']++;
    });
    return b;
  }, [isAgingType, dd, now]);

  /* Oldest shipments — actionable list (transit / rto-aging) */
  const oldestAging = useMemo(() => {
    if (!isAgingType) return [];
    return dd.map(r => ({ ...r, _age: (() => { const bd = safeParseDate(r.bookingDate); return bd ? Math.floor((now - bd) / 86400000) : -1; })() }))
      .filter(r => r._age >= 0).sort((a, b) => b._age - a._age).slice(0, 15);
  }, [isAgingType, dd, now]);

  /* Dispatch — same-day metric: dispatched on or before today */
  const dispatchStats = useMemo(() => {
    if (!isDispatch) return null;
    let sameDay = 0, withBooking = 0;
    dd.forEach(r => {
      const bd = safeParseDate(r.bookingDate);
      if (!bd) return;
      withBooking++;
      const dd2 = safeParseDate(r.deliveryDate);
      if (dd2 && Math.abs(dd2 - bd) / 86400000 < 1) sameDay++;
    });
    return { withBooking, sameDay, sameDayPct: withBooking > 0 ? (sameDay / withBooking * 100) : 0 };
  }, [isDispatch, dd]);

  /* Columns for raw-data table — context-appropriate only */
  const cols = useMemo(() => {
    if (isCost) return [
      { key: 'awbNo', label: 'AWB No' },
      { key: 'invoiceNo', label: 'Invoice No' },
      { key: 'vendor', label: 'Courier' },
      { key: 'platform', label: 'Platform' },
      { key: 'destination', label: 'City' },
      { key: 'zone', label: 'Zone' },
      { key: 'invoiceValue', label: 'Invoice Value', render: v => parseFloat(v) > 0 ? currency(parseFloat(v)) : <span className="text-red-500 text-[9px]">missing</span> },
      { key: 'logisticsCost', label: 'Cost', render: v => currency(parseFloat(v) || 0) },
      { key: '_costPct', label: 'Cost %', render: (_, r) => { const c = parseFloat(r.logisticsCost) || 0; const i = parseFloat(r.invoiceValue) || 0; return i > 0 ? <span style={{ color: c/i*100 > 10 ? '#dc2626' : c/i*100 > 6 ? '#d97706' : '#059669', fontWeight: 600 }}>{(c/i*100).toFixed(1)}%</span> : '-'; } },
      { key: 'status', label: 'Status' },
    ];
    if (isRto) return [
      { key: 'awbNo', label: 'AWB No' },
      { key: 'vendor', label: 'Courier' },
      { key: 'platform', label: 'Platform' },
      { key: 'destination', label: 'City' },
      { key: 'zone', label: 'Zone' },
      { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
      { key: 'logisticsCost', label: 'RTO Cost', render: v => currency(parseFloat(v) || 0) },
      { key: 'failureRemarks', label: 'RTO Reason' },
    ];
    if (isTransit || isAppt || isRtoAging) return [
      { key: 'awbNo', label: 'AWB No' },
      { key: 'vendor', label: 'Courier' },
      { key: 'platform', label: 'Platform' },
      { key: 'destination', label: 'City' },
      { key: 'zone', label: 'Zone' },
      { key: 'status', label: 'Status' },
      { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
      { key: '_age', label: 'Age (d)', render: (_, r) => { const bd = safeParseDate(r.bookingDate); return bd ? Math.floor((now - bd) / 86400000) : '-'; } },
      { key: 'appointmentDate', label: 'Appt', render: v => formatDate(v) },
    ];
    if (isPod) return [
      { key: 'awbNo', label: 'AWB No' },
      { key: 'vendor', label: 'Courier' },
      { key: 'platform', label: 'Platform' },
      { key: 'destination', label: 'City' },
      { key: 'deliveryDate', label: 'Delivered', render: v => formatDate(v) },
      { key: 'pod', label: 'POD' },
      { key: 'status', label: 'Status' },
    ];
    /* delivery / general */
    return [
      { key: 'awbNo', label: 'AWB No' },
      { key: 'invoiceNo', label: 'Invoice No' },
      { key: 'vendor', label: 'Courier' },
      { key: 'platform', label: 'Platform' },
      { key: 'destination', label: 'City' },
      { key: 'status', label: 'Status' },
      { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
      { key: 'deliveryDate', label: 'Delivery', render: v => formatDate(v) },
      { key: 'zone', label: 'Zone' },
      { key: 'failureRemarks', label: 'Remarks' },
    ];
  }, [isCost, isRto, isTransit, isRtoAging, isAppt, isPod, now]);

  /* Color thresholds */
  const costColor = (p) => p > 10 ? '#dc2626' : p > 6 ? '#d97706' : '#059669';
  const delColor  = (p) => p >= 90 ? '#059669' : p >= 75 ? '#d97706' : '#dc2626';

  const accent = isCost ? 'indigo' : (isRto || isRtoAging) ? 'red' : isTransit ? 'amber' : isPod ? 'purple' : isAppt ? 'blue' : isGrn ? 'orange' : isDispatch ? 'cyan' : isManual ? 'slate' : 'emerald';
  const accentTextCls = { indigo: 'text-indigo-700', red: 'text-red-700', amber: 'text-amber-700', purple: 'text-purple-700', blue: 'text-blue-700', emerald: 'text-emerald-700', orange: 'text-orange-700', cyan: 'text-cyan-700', slate: 'text-slate-700' }[accent];
  const tabActiveCls = { indigo: 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500', red: 'bg-red-50 text-red-700 border-b-2 border-red-500', amber: 'bg-amber-50 text-amber-700 border-b-2 border-amber-500', purple: 'bg-purple-50 text-purple-700 border-b-2 border-purple-500', blue: 'bg-blue-50 text-blue-700 border-b-2 border-blue-500', emerald: 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-500', orange: 'bg-orange-50 text-orange-700 border-b-2 border-orange-500', cyan: 'bg-cyan-50 text-cyan-700 border-b-2 border-cyan-500', slate: 'bg-slate-50 text-slate-700 border-b-2 border-slate-500' }[accent];

  const hasScope = scope.platform || scope.vendor || scope.zone;
  const clearScope = () => setScope({ platform: null, vendor: null, zone: null });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h3 className={`text-sm font-bold ${accentTextCls}`}>{trackDrill.title}</h3>
            <span className="text-[10px] text-gray-400">·</span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{kpiType} view</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-gray-100">
          {[
            { k: 'summary', l: 'Summary' },
            { k: 'breakdown', l: 'Breakdown' },
            ...(isCost ? [{ k: 'outliers', l: 'Cost Outliers' }] : []),
            ...((isRto || isRtoAging) ? [{ k: 'reasons', l: 'RTO Reasons' }] : []),
            ...(isAgingType ? [{ k: 'aging', l: isRtoAging ? 'Oldest RTOs' : 'Aging List' }] : []),
            { k: 'raw', l: `Raw Data (${dd.length})` },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 text-[10px] font-semibold rounded-t-md transition-colors ${tab === t.k ? tabActiveCls : 'text-gray-500 hover:text-gray-700'}`}>
              {t.l}
            </button>
          ))}
        </div>

        {/* In-modal scope chips */}
        {hasScope && (
          <div className="px-5 py-2 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Filtered:</span>
            {scope.platform && <button onClick={() => setScope(s => ({ ...s, platform: null }))} className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] hover:border-red-300 hover:text-red-600 flex items-center gap-1">Platform: <strong>{scope.platform}</strong> <X className="w-2.5 h-2.5" /></button>}
            {scope.vendor && <button onClick={() => setScope(s => ({ ...s, vendor: null }))} className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] hover:border-red-300 hover:text-red-600 flex items-center gap-1">Courier: <strong>{scope.vendor}</strong> <X className="w-2.5 h-2.5" /></button>}
            {scope.zone && <button onClick={() => setScope(s => ({ ...s, zone: null }))} className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] hover:border-red-300 hover:text-red-600 flex items-center gap-1">Zone: <strong>{scope.zone}</strong> <X className="w-2.5 h-2.5" /></button>}
            <button onClick={clearScope} className="text-[10px] text-gray-500 hover:text-red-600 ml-1">Clear all</button>
            <span className="text-[10px] text-gray-400 ml-auto">{dd.length} of {trackDrill.data.length} records</span>
          </div>
        )}

        <div className="p-4 space-y-4">
          {/* Contextual note from classifier */}
          {trackDrill.note && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-[10px] text-blue-800 flex items-start gap-2">
              <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{trackDrill.note}</span>
            </div>
          )}

          {/* ─── SUMMARY TAB ─── */}
          {tab === 'summary' && (<>
            {/* COST view */}
            {isCost && (<>
              {/* Hero formula + warning */}
              <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">Weighted Cost %</p>
                  <span className="text-[9px] text-gray-500 font-mono">Σ Cost ÷ Σ Invoice × 100</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <p className="text-4xl font-bold" style={{ color: costColor(weightedCostPct) }}>{weightedCostPct.toFixed(2)}%</p>
                  <p className="text-[11px] text-gray-600 font-mono">{currency(totalCost)} ÷ {currency(totalInv)}</p>
                </div>
              </div>

              {/* Missing-invoice prominent warning */}
              {(trackDrill.excludedCount > 0 || missingInvCount > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-[10px] text-amber-800">
                    <p className="font-semibold mb-0.5">Invoice value missing for {missingInvCount + (trackDrill.excludedCount || 0)} shipment(s) ({((missingInvCount + (trackDrill.excludedCount || 0)) / (dd.length + (trackDrill.excludedCount || 0)) * 100).toFixed(1)}%)</p>
                    <p className="text-amber-700">These are excluded from Cost % calculation since dividing by ₹0 invoice would skew the result. Get invoice values uploaded to make Cost % accurate.</p>
                  </div>
                </div>
              )}

              {/* Cost-only KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Shipments (valid)" value={costRows.length.toLocaleString('en-IN')} sub={`of ${dd.length}`} color="indigo" />
                <Stat label="Total Cost" value={currency(totalCost)} color="blue" />
                <Stat label="Total Invoice" value={currency(totalInv)} color="purple" />
                <Stat label="Avg ₹/Shipment" value={currency(avgCostPerShip)} color="amber" />
              </div>

              {/* Cost % distribution histogram */}
              {costBuckets && (
                <div className="bg-white border border-gray-100 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-600 uppercase mb-2">Cost % Distribution (per shipment)</p>
                  <div className="space-y-1">
                    {Object.entries(costBuckets).map(([bk, ct]) => {
                      const max = Math.max(...Object.values(costBuckets), 1);
                      const w = ct / max * 100;
                      const color = bk === '<3%' ? '#059669' : bk === '3-5%' ? '#10b981' : bk === '5-7%' ? '#d97706' : bk === '7-10%' ? '#ea580c' : '#dc2626';
                      return (
                        <div key={bk} className="flex items-center gap-2 text-[10px]">
                          <span className="w-12 text-gray-600 font-mono">{bk}</span>
                          <div className="flex-1 h-4 bg-gray-50 rounded overflow-hidden"><div className="h-full rounded transition-all" style={{ width: `${w}%`, background: color }} /></div>
                          <span className="w-12 text-right font-semibold" style={{ color }}>{ct.toLocaleString('en-IN')}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>)}

            {/* RTO view */}
            {isRto && (<>
              <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-100 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-red-600 font-semibold mb-2">RTO Impact</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-[9px] text-gray-500">Shipments</p><p className="text-2xl font-bold text-red-700">{dd.length}</p></div>
                  <div><p className="text-[9px] text-gray-500">Cost Loss</p><p className="text-2xl font-bold text-amber-700">{currency(totalCost)}</p></div>
                  <div><p className="text-[9px] text-gray-500">Invoice at Risk</p><p className="text-2xl font-bold text-purple-700">{currency(totalInv)}</p></div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Avg RTO Cost" value={currency(avgCostPerShip)} color="amber" />
                <Stat label="Top Reason Share" value={rtoReasons[0] ? `${(rtoReasons[0].count / dd.length * 100).toFixed(0)}%` : '-'} sub={rtoReasons[0]?.reason.slice(0, 18) || ''} color="red" />
                <Stat label="Worst Courier" value={courArr[0]?.key || '-'} sub={`${courArr[0]?.rto || 0} RTOs`} color="orange" />
                <Stat label="Worst Zone" value={zoneArr[0]?.key || '-'} sub={`${zoneArr[0]?.rto || 0} RTOs`} color="red" />
              </div>
            </>)}

            {/* Delivery / Platform OTIF view */}
            {isDel && (<>
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold mb-2">Delivery Performance</p>
                <div className="flex items-baseline gap-3">
                  <p className="text-4xl font-bold" style={{ color: delColor(dd.length > 0 ? percent(delC, dd.length) : 0) }}>{dd.length > 0 ? percent(delC, dd.length).toFixed(1) : 0}%</p>
                  <p className="text-[11px] text-gray-600">{delC.toLocaleString('en-IN')} delivered of {dd.length.toLocaleString('en-IN')}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Delivered" value={delC.toLocaleString('en-IN')} color="emerald" />
                <Stat label="RTO" value={rtoC.toLocaleString('en-IN')} sub={`${dd.length > 0 ? percent(rtoC, dd.length).toFixed(1) : 0}%`} color="red" />
                <Stat label="In-Transit" value={intC.toLocaleString('en-IN')} color="indigo" />
                <Stat label="Failed / Other" value={othC.toLocaleString('en-IN')} color="amber" />
              </div>
            </>)}

            {/* Transit view */}
            {isAgingType && agingBuckets && (<>
              <div className={`bg-gradient-to-br ${isRtoAging ? 'from-red-50 to-orange-50 border-red-100' : 'from-amber-50 to-orange-50 border-amber-100'} border rounded-xl p-4`}>
                <p className={`text-[10px] uppercase tracking-wider ${isRtoAging ? 'text-red-600' : 'text-amber-600'} font-semibold mb-2`}>{isRtoAging ? 'RTO Aging' : 'In-Transit Aging'}</p>
                <p className="text-[10px] text-gray-600 mb-3">Total <strong>{dd.length.toLocaleString('en-IN')}</strong> {isRtoAging ? 'RTO' : 'in-transit'} shipments · target is <strong>≥85%</strong> within 0-7 days.</p>
                <div className="space-y-1.5">
                  {Object.entries(agingBuckets).map(([bk, ct]) => {
                    const max = Math.max(...Object.values(agingBuckets), 1);
                    const w = ct / max * 100;
                    const pct = dd.length > 0 ? (ct / dd.length * 100) : 0;
                    const color = bk === '0-7' ? '#10b981' : bk === '8-15' ? '#d97706' : bk === '16-30' ? '#ea580c' : '#dc2626';
                    return (
                      <div key={bk} className="flex items-center gap-2 text-[10px]">
                        <span className="w-16 text-gray-700 font-medium">{bk} days</span>
                        <div className="flex-1 h-5 bg-white rounded overflow-hidden"><div className="h-full rounded transition-all" style={{ width: `${w}%`, background: color }} /></div>
                        <span className="w-20 text-right font-bold" style={{ color }}>{ct.toLocaleString('en-IN')} ({pct.toFixed(1)}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="0-7 d %" value={`${dd.length > 0 ? (agingBuckets['0-7'] / dd.length * 100).toFixed(1) : 0}%`} color="emerald" />
                <Stat label="8-15 d %" value={`${dd.length > 0 ? (agingBuckets['8-15'] / dd.length * 100).toFixed(1) : 0}%`} color="amber" />
                <Stat label="16-30 d %" value={`${dd.length > 0 ? (agingBuckets['16-30'] / dd.length * 100).toFixed(1) : 0}%`} color="orange" />
                <Stat label="30+ d %" value={`${dd.length > 0 ? (agingBuckets['30+'] / dd.length * 100).toFixed(1) : 0}%`} color="red" />
              </div>
            </>)}

            {isGrn && (
              <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-orange-600 font-semibold mb-1">GRN KPI</p>
                <p className="text-[11px] text-gray-700">GRN (Goods Receipt Note) recovery & ageing are tracked outside the shipment dataset. Use the value in the tracker; the Raw Data tab lists the month's shipments only for cross-reference.</p>
              </div>
            )}

            {isDispatch && dispatchStats && (<>
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-100 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-cyan-700 font-semibold mb-2">Dispatch & Pickup</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-[9px] text-gray-500">Dispatched (with booking)</p><p className="text-2xl font-bold text-cyan-700">{dispatchStats.withBooking.toLocaleString('en-IN')}</p></div>
                  <div><p className="text-[9px] text-gray-500">Same-day dispatch</p><p className="text-2xl font-bold text-emerald-700">{dispatchStats.sameDay.toLocaleString('en-IN')}</p></div>
                  <div><p className="text-[9px] text-gray-500">Same-day %</p><p className="text-2xl font-bold text-indigo-700">{dispatchStats.sameDayPct.toFixed(1)}%</p></div>
                </div>
              </div>
            </>)}

            {isManual && (
              <div className="bg-gradient-to-br from-slate-50 to-gray-50 border border-slate-200 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold mb-1">Manually Tracked KPI</p>
                <p className="text-[11px] text-gray-700">This KPI (Quality / WH Capacity / Doc Issues) is recorded manually and does not derive from shipment data. The list below shows the month's shipments only as a reference roll-up.</p>
              </div>
            )}

            {/* POD view */}
            {isPod && (<>
              <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-100 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-purple-600 font-semibold mb-2">POD Pending</p>
                <p className="text-4xl font-bold text-purple-700">{dd.length.toLocaleString('en-IN')}</p>
                <p className="text-[11px] text-gray-600 mt-1">Delivered shipments without POD upload</p>
              </div>
            </>)}

            {/* Appointment view */}
            {isAppt && (<>
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold mb-2">Non-Appointment Shipments</p>
                <p className="text-4xl font-bold text-blue-700">{dd.length.toLocaleString('en-IN')}</p>
                <p className="text-[11px] text-gray-600 mt-1">In-transit shipments missing appointment date</p>
              </div>
            </>)}

            {/* Generic */}
            {kpiType === 'general' && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Stat label="Total" value={dd.length.toLocaleString('en-IN')} color="blue" />
                <Stat label="Delivered" value={delC.toLocaleString('en-IN')} color="emerald" />
                <Stat label="RTO" value={rtoC.toLocaleString('en-IN')} color="red" />
                <Stat label="In-Transit" value={intC.toLocaleString('en-IN')} color="indigo" />
                <Stat label="Other" value={othC.toLocaleString('en-IN')} color="amber" />
              </div>
            )}

            <div className="text-[10px] text-gray-400 italic">Tip: switch to <strong>Breakdown</strong> for per-platform / courier / zone analysis, or click any row there to drill deeper.</div>
          </>)}

          {/* ─── BREAKDOWN TAB ─── */}
          {tab === 'breakdown' && (
            <DimensionGrid
              isCost={isCost} isRto={isRto || isRtoAging} isDel={isDel || isTransit || isPod || isAppt || isGrn || isDispatch || isManual || kpiType === 'general'}
              platArr={platArr} courArr={courArr} zoneArr={zoneArr}
              costColor={costColor} delColor={delColor}
              onPickPlatform={(p) => setScope(s => ({ ...s, platform: p }))}
              onPickCourier={(c) => setScope(s => ({ ...s, vendor: c }))}
              onPickZone={(z) => setScope(s => ({ ...s, zone: z }))}
            />
          )}

          {/* ─── COST OUTLIERS TAB ─── */}
          {tab === 'outliers' && isCost && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-red-700 uppercase mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Top {costOutliers.length} Shipments — highest cost relative to invoice</p>
              <div className="overflow-x-auto"><table className="w-full text-[10px]"><thead><tr className="border-b border-red-200">
                <th className="px-2 py-1 text-left font-semibold text-gray-500">AWB</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Invoice No</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Platform</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Courier</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">City</th>
                <th className="px-2 py-1 text-right font-semibold text-purple-600">Invoice</th>
                <th className="px-2 py-1 text-right font-semibold text-blue-600">Cost</th>
                <th className="px-2 py-1 text-right font-semibold text-red-600">Cost %</th>
              </tr></thead><tbody className="divide-y divide-red-100">
                {costOutliers.map((r, i) => <tr key={r.awbNo || i}>
                  <td className="px-2 py-1 font-mono text-gray-700">{r.awbNo}</td>
                  <td className="px-2 py-1 font-mono text-gray-500">{r.invoiceNo || '-'}</td>
                  <td className="px-2 py-1">{r.platform}</td>
                  <td className="px-2 py-1">{r.vendor}</td>
                  <td className="px-2 py-1">{r.destination}</td>
                  <td className="px-2 py-1 text-right text-purple-600">{currency(r._inv)}</td>
                  <td className="px-2 py-1 text-right text-blue-600">{currency(r._cost)}</td>
                  <td className="px-2 py-1 text-right font-bold text-red-600">{r._pct.toFixed(1)}%</td>
                </tr>)}
              </tbody></table></div>
            </div>
          )}

          {/* ─── RTO REASONS TAB ─── */}
          {tab === 'reasons' && (isRto || isRtoAging) && (
            <div className="bg-white border border-red-100 rounded-xl p-3">
              <p className="text-[10px] font-bold text-red-700 uppercase mb-3">Top RTO Reasons</p>
              <div className="space-y-2">
                {rtoReasons.map((r, i) => {
                  const max = Math.max(...rtoReasons.map(x => x.count), 1);
                  const w = r.count / max * 100;
                  return (
                    <div key={i} className="flex items-center gap-3 text-[10px]">
                      <span className="flex-1 text-gray-700 truncate" title={r.reason}>{r.reason}</span>
                      <div className="w-40 h-4 bg-red-50 rounded overflow-hidden"><div className="h-full bg-red-400 rounded" style={{ width: `${w}%` }} /></div>
                      <span className="w-12 text-right font-bold text-red-600">{r.count}</span>
                      <span className="w-20 text-right text-amber-600">{currency(r.cost)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── AGING LIST TAB ─── */}
          {tab === 'aging' && isAgingType && (
            <div className={`bg-white border ${isRtoAging ? 'border-red-100' : 'border-amber-100'} rounded-xl p-3`}>
              <p className={`text-[10px] font-bold ${isRtoAging ? 'text-red-700' : 'text-amber-700'} uppercase mb-2 flex items-center gap-1`}><Clock className="w-3 h-3" /> Oldest {oldestAging.length} {isRtoAging ? 'RTO' : 'In-Transit'} Shipments</p>
              <div className="overflow-x-auto"><table className="w-full text-[10px]"><thead><tr className={`border-b ${isRtoAging ? 'border-red-200' : 'border-amber-200'}`}>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">AWB</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Courier</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Platform</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">City</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Status</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-500">Booking</th>
                <th className="px-2 py-1 text-right font-semibold text-red-600">Age (d)</th>
              </tr></thead><tbody className={`divide-y ${isRtoAging ? 'divide-red-100' : 'divide-amber-100'}`}>
                {oldestAging.map((r, i) => <tr key={r.awbNo || i}>
                  <td className="px-2 py-1 font-mono">{r.awbNo}</td>
                  <td className="px-2 py-1">{r.vendor}</td>
                  <td className="px-2 py-1">{r.platform}</td>
                  <td className="px-2 py-1">{r.destination}</td>
                  <td className="px-2 py-1 text-[9px]">{r.status}</td>
                  <td className="px-2 py-1">{formatDate(r.bookingDate)}</td>
                  <td className="px-2 py-1 text-right font-bold" style={{ color: r._age > 30 ? '#dc2626' : r._age > 15 ? '#ea580c' : '#d97706' }}>{r._age}</td>
                </tr>)}
              </tbody></table></div>
            </div>
          )}

          {/* ─── RAW DATA TAB ─── */}
          {tab === 'raw' && (
            <DataTable data={dd} columns={cols} exportFilename={`${kpiType}-${trackDrill.month || 'drill'}${hasScope ? '-scoped' : ''}`} pageSize={25} />
          )}
        </div>
      </div>
    </div>
  );
}

/* Small stat card */
function Stat({ label, value, sub, color = 'blue' }) {
  const map = {
    blue: 'bg-blue-50 text-blue-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    purple: 'bg-purple-50 text-purple-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    orange: 'bg-orange-50 text-orange-700',
  };
  return (
    <div className={`${map[color]} rounded-lg p-2 text-center`}>
      <p className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
      {sub && <p className="text-[9px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* Breakdown dimension grid — Platform / Courier / Zone with click-to-drill */
function DimensionGrid({ isCost, isRto, isDel, platArr, courArr, zoneArr, costColor, delColor, onPickPlatform, onPickCourier, onPickZone }) {
  const renderRow = (item, onClick) => {
    if (isCost) return (
      <div className="grid grid-cols-12 gap-1 items-center text-[10px] py-1 hover:bg-indigo-50/40 rounded px-1 cursor-pointer" onClick={onClick}>
        <span className="col-span-3 font-medium text-gray-700 truncate" title={item.key}>{item.key}</span>
        <span className="col-span-1 text-right text-gray-500">{item.total}</span>
        <span className="col-span-2 text-right text-purple-600">{currency(item.inv)}</span>
        <span className="col-span-2 text-right text-blue-600">{currency(item.cost)}</span>
        <span className="col-span-2 text-right font-bold" style={{ color: costColor(item.costPct) }}>{item.costPct.toFixed(2)}%</span>
        <span className="col-span-2"><div className="h-1.5 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.min(item.costShare, 100)}%` }} /></div><p className="text-[9px] text-gray-400 text-right">{item.costShare.toFixed(0)}% share</p></span>
      </div>
    );
    if (isRto) return (
      <div className="grid grid-cols-12 gap-1 items-center text-[10px] py-1 hover:bg-red-50/40 rounded px-1 cursor-pointer" onClick={onClick}>
        <span className="col-span-5 font-medium text-gray-700 truncate" title={item.key}>{item.key}</span>
        <span className="col-span-2 text-right text-gray-500">{item.total}</span>
        <span className="col-span-2 text-right text-red-600 font-semibold">{item.rto}</span>
        <span className="col-span-3 text-right font-bold" style={{ color: item.rtoPct > 10 ? '#dc2626' : '#d97706' }}>{item.rtoPct.toFixed(1)}%</span>
      </div>
    );
    return (
      <div className="grid grid-cols-12 gap-1 items-center text-[10px] py-1 hover:bg-emerald-50/40 rounded px-1 cursor-pointer" onClick={onClick}>
        <span className="col-span-5 font-medium text-gray-700 truncate" title={item.key}>{item.key}</span>
        <span className="col-span-2 text-right text-gray-500">{item.total}</span>
        <span className="col-span-2 text-right text-emerald-600 font-semibold">{item.delivered}</span>
        <span className="col-span-3 text-right font-bold" style={{ color: delColor(item.delPct) }}>{item.delPct.toFixed(1)}%</span>
      </div>
    );
  };

  const header = isCost
    ? <div className="grid grid-cols-12 gap-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold px-1 pb-1 border-b border-gray-100">
        <span className="col-span-3">Name</span><span className="col-span-1 text-right">N</span><span className="col-span-2 text-right">Invoice</span><span className="col-span-2 text-right">Cost</span><span className="col-span-2 text-right">Cost %</span><span className="col-span-2 text-right">Share</span>
      </div>
    : isRto
    ? <div className="grid grid-cols-12 gap-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold px-1 pb-1 border-b border-gray-100">
        <span className="col-span-5">Name</span><span className="col-span-2 text-right">N</span><span className="col-span-2 text-right">RTO</span><span className="col-span-3 text-right">RTO %</span>
      </div>
    : <div className="grid grid-cols-12 gap-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold px-1 pb-1 border-b border-gray-100">
        <span className="col-span-5">Name</span><span className="col-span-2 text-right">N</span><span className="col-span-2 text-right">Del</span><span className="col-span-3 text-right">Del %</span>
      </div>;

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-xl p-3">
        <p className="text-[10px] font-bold text-gray-600 uppercase mb-2 flex items-center gap-1"><Building2 className="w-3 h-3" /> Platform Breakdown <span className="text-gray-400 normal-case font-normal">(click to filter modal)</span></p>
        {header}
        <div className="divide-y divide-gray-100">{platArr.slice(0, 12).map(p => <div key={p.key}>{renderRow(p, () => onPickPlatform(p.key))}</div>)}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[10px] font-bold text-gray-600 uppercase mb-2 flex items-center gap-1"><Truck className="w-3 h-3" /> Courier</p>
          {header}
          <div className="divide-y divide-gray-100">{courArr.slice(0, 10).map(c => <div key={c.key}>{renderRow(c, () => onPickCourier(c.key))}</div>)}</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[10px] font-bold text-gray-600 uppercase mb-2 flex items-center gap-1"><MapPin className="w-3 h-3" /> Zone</p>
          {header}
          <div className="divide-y divide-gray-100">{zoneArr.slice(0, 10).map(z => <div key={z.key}>{renderRow(z, () => onPickZone(z.key))}</div>)}</div>
        </div>
      </div>
    </div>
  );
}
