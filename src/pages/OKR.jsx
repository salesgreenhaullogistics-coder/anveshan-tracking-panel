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
  { key: 'sandeep', name: 'Sandeep', role: 'Commercial & Primary', icon: Truck },
  { key: 'prashant', name: 'Prashant', role: 'Last Mile & Return', icon: Building2 },
  { key: 'nandlal', name: 'Nandlal', role: 'Documentation & GRN', icon: FileText },
  { key: 'anoop', name: 'Anoop', role: 'First Mile & Dispatch', icon: Package },
];

const VIEWS = [
  { key: 'executive', label: 'Executive Summary', icon: BarChart3 },
  { key: 'scorecard', label: 'KPI Scorecard', icon: Target },
  { key: 'tracking', label: 'Monthly Tracking', icon: Calendar },
  { key: 'rootcause', label: 'AI Root Cause', icon: Brain },
];

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

function scorePct(actual, target, base, exceptional, invert) {
  if (actual == null) return 50;
  if (invert) return actual <= exceptional ? 100 : actual <= target ? 80 : actual <= base ? 60 : 30;
  return actual >= exceptional ? 100 : actual >= target ? 80 : actual >= base ? 60 : 30;
}

export default function OKR() {
  const { data } = useData();
  const [owner, setOwner] = useState('sandeep');
  const [view, setView] = useState('executive');
  const [expKPI, setExpKPI] = useState(null);
  const [period, setPeriod] = useState('Monthly');
  const [trackingData, setTrackingData] = useState(() => { try { return JSON.parse(localStorage.getItem('okr-track') || '{}'); } catch { return {}; } });
  const [lockedMonths, setLockedMonths] = useState(() => { try { return JSON.parse(localStorage.getItem('okr-lock') || '{}'); } catch { return {}; } });
  const [expTrackMonth, setExpTrackMonth] = useState(null);
  const [trackDrill, setTrackDrill] = useState(null);

  const now = new Date();
  const cur = KPI_OWNERS.find(o => o.key === owner);

  /* ═══ Compute actuals from shipment data ═══ */
  const actuals = useMemo(() => {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const recent = data.filter(r => { const bd = safeParseDate(r.bookingDate); return !bd || bd >= cutoff; });
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
    intransit.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((now - bd) / 86400000); if (age <= 7) ageBkts['0-7']++; else if (age <= 15) ageBkts['8-15']++; else if (age <= 20) ageBkts['16-20']++; else if (age <= 30) ageBkts['21-30']++; else ageBkts['30+']++; } });
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
    noAppt.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((now - bd) / 86400000); if (age <= 2) noApptBkts['0-2']++; else if (age <= 5) noApptBkts['3-5']++; else if (age <= 10) noApptBkts['6-10']++; else if (age <= 15) noApptBkts['11-15']++; else noApptBkts['15+']++; } });
    const noApptTotal = noAppt.length || 1;
    const noApptPcts = {}; for (const [k, v] of Object.entries(noApptBkts)) noApptPcts[k] = percent(v, noApptTotal);

    /* B2B RTO tracking */
    const rtoAgeBkts = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 };
    rto.forEach(r => { const bd = safeParseDate(r.bookingDate); if (bd) { const age = Math.floor((now - bd) / 86400000); if (age <= 7) rtoAgeBkts['0-7']++; else if (age <= 15) rtoAgeBkts['8-15']++; else if (age <= 30) rtoAgeBkts['16-30']++; else rtoAgeBkts['30+']++; } });
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
        { name: 'Non-Appt 0-2 Days %', w: 3, actual: a.noApptPcts['0-2'], target: 90, base: 84, high: 95, exc: 100, unit: '%' },
        { name: 'POD Visibility', w: 5, actual: a.podPct, target: 90, base: 80, high: 96, exc: 100, unit: '%' },
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
        { name: 'Doc Issues %', w: 5, actual: 98, target: 98.5, base: 98, high: 99, exc: 100, unit: '%' },
      ],
      nandlal: [
        { name: 'GRN Recovery %', w: 35, actual: 90, target: 93, base: 90, high: 97, exc: 100, unit: '%' },
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
        { name: 'Doc Issues %', w: 10, actual: 98, target: 98.5, base: 98, high: 99, exc: 100, unit: '%' },
      ],
      anoop: [
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
    return defs[owner] || [];
  }, [actuals, owner]);

  /* ═══ Scores ═══ */
  const overallScore = useMemo(() => {
    let tw = 0, ws = 0;
    kpis.forEach(k => { const s = scorePct(k.actual, k.target, k.base, k.exc, k.inv); tw += k.w; ws += s * k.w / 100; });
    return tw > 0 ? Math.round(ws / tw * 100) : 0;
  }, [kpis]);

  const grade = getGrade(overallScore);


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
          <div><h2 className="text-lg font-bold">{cur?.name}'s KPI Command Center</h2><p className="text-indigo-200 text-[11px]">{cur?.role}</p></div>
          <div className="flex items-center gap-6">
            <div className="text-center"><p className="text-3xl font-bold">{overallScore}</p><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${grade.color}`}>{grade.label}</span></div>
            {forecast && <div className="text-center"><p className="text-xl font-bold">{forecast.nextMonth}%</p><p className="text-[9px] text-indigo-200">Next Month Forecast</p><span className={`text-[9px] px-1.5 py-0.5 rounded ${forecast.risk === 'HIGH' ? 'bg-red-500' : forecast.risk === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'}`}>{forecast.risk} Risk</span></div>}
          </div>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map(v => { const Icon = v.icon; return (
          <button key={v.key} onClick={() => setView(v.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${view === v.key ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}><Icon className="w-3.5 h-3.5" />{v.label}</button>
        ); })}
        <div className="w-px h-6 bg-gray-200 mx-1 self-center" />
        {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={`text-[10px] px-2 py-1 rounded-lg font-medium ${period === p ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'}`}>{p}</button>)}
      </div>

      {/* ═══ EXECUTIVE SUMMARY ═══ */}
      {view === 'executive' && (<div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="KPI Score" value={overallScore} icon={Target} color={overallScore >= 80 ? 'green' : overallScore >= 60 ? 'yellow' : 'red'} subtitle={grade.label} />
          <KPICard title="KPIs at Risk" value={rootCauses.length} icon={AlertTriangle} color="red" subtitle={`of ${kpis.length} total`} />
          <KPICard title="Forecast" value={forecast ? `${forecast.nextMonth}%` : '-'} icon={TrendingUp} color={forecast?.risk === 'LOW' ? 'green' : 'red'} subtitle={forecast ? `${forecast.risk} Risk` : ''} />
        </div>

        {/* KPI Health Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">KPI Health Overview</h3>
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
          {/* Plan of Action for selected KPI */}
          {expKPI && (() => {
            const k = kpis.find(x => x.name === expKPI);
            if (!k) return null;
            const gap = k.inv ? k.actual - k.target : k.target - k.actual;
            if (gap <= 0) return <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4"><p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {k.name} is on target. No action required.</p></div>;

            /* KPI-specific action plans */
            const plans = {
              'Overall Cost %': [
                { action: 'Negotiate courier rates with top 3 couriers', owner: 'Sandeep', timeline: '2 weeks', impact: `-${fmt(gap * 0.3)}pp cost reduction` },
                { action: 'Reduce RTO rate — implement address verification', owner: 'Nandlal', timeline: '1 month', impact: 'Each 1% RTO reduction saves 2x shipping' },
                { action: 'Optimize zone-wise courier allocation', owner: 'Sandeep', timeline: '1 week', impact: 'Route optimization can reduce cost by 5-8%' },
                { action: 'Shift volume from high-cost to low-cost couriers', owner: 'Sandeep', timeline: '2 weeks', impact: 'Estimated saving: 3-5% on shifted volume' },
                { action: 'Reduce failed delivery attempts (multiple attempts add cost)', owner: 'Nandlal', timeline: 'Ongoing', impact: 'Each re-attempt costs additional per shipment' },
              ],
              'Delivery Success %': [
                { action: 'Escalate 8+ day aged shipments daily', owner: 'Sandeep', timeline: 'Daily', impact: `+${fmt(gap * 0.4)}pp delivery improvement` },
                { action: 'Auto-book appointments for pending shipments', owner: 'Nandlal', timeline: '1 week', impact: 'No appointment = no delivery' },
                { action: 'Follow up with couriers on failed attempts', owner: 'Sandeep', timeline: 'Daily', impact: 'Reduce failure rate by 30-40%' },
                { action: 'Improve first-attempt delivery success', owner: 'Nandlal', timeline: '2 weeks', impact: 'Higher FTDR reduces overall TAT' },
              ],
              'POD Visibility': [
                { action: 'Set 48-hour POD submission SLA with couriers', owner: 'Prashant', timeline: '1 week', impact: `+${fmt(gap * 0.5)}pp POD improvement` },
                { action: 'Daily POD pending follow-up report to courier ops', owner: 'Prashant', timeline: 'Daily', impact: 'Consistent follow-up improves compliance' },
                { action: 'Penalize couriers for POD delay beyond 7 days', owner: 'Sandeep', timeline: '2 weeks', impact: 'Financial incentive for timely POD' },
                { action: 'Implement digital POD capture at delivery point', owner: 'Anoop', timeline: '1 month', impact: 'Eliminates manual POD upload dependency' },
              ],
            };
            /* Generic plan for KPIs without specific plan */
            const defaultPlan = [
              { action: `Analyze root cause of ${k.name} underperformance`, owner: cur?.name || '-', timeline: '1 week', impact: 'Identify top contributing factors' },
              { action: 'Set daily monitoring dashboard for this KPI', owner: cur?.name || '-', timeline: '3 days', impact: 'Early detection of deviations' },
              { action: 'Create weekly improvement review cadence', owner: cur?.name || '-', timeline: 'Weekly', impact: `Track progress toward ${fmt(k.target)}${k.unit} target` },
              { action: 'Benchmark against best performing month and replicate', owner: cur?.name || '-', timeline: '2 weeks', impact: 'Apply proven practices' },
            ];
            /* Match plan — check partial name matches */
            let actionPlan = defaultPlan;
            for (const [key, plan] of Object.entries(plans)) {
              if (k.name.toLowerCase().includes(key.toLowerCase().split(' ')[0])) { actionPlan = plan; break; }
            }
            /* Platform-specific plans */
            if (k.name.includes('OTIF') || k.name.includes('Channel Del')) {
              const pl = k.name.split('—')[1]?.trim() || k.name;
              actionPlan = [
                { action: `Review ${pl} SLA compliance with courier partners`, owner: 'Nandlal', timeline: '1 week', impact: `+${fmt(gap * 0.4)}pp ${pl} delivery improvement` },
                { action: `Optimize ${pl} zone-wise courier mapping`, owner: 'Sandeep', timeline: '2 weeks', impact: 'Better courier-zone fit improves OTIF' },
                { action: `Escalate ${pl} aged shipments to priority queue`, owner: 'Nandlal', timeline: 'Daily', impact: 'Reduces aging backlog' },
                { action: `Analyze ${pl} failure reasons and address top 3`, owner: 'Nandlal', timeline: '1 week', impact: 'Targeted fix for highest-impact issues' },
              ];
            }
            if (k.name.includes('Non-Appt') || k.name.includes('Appt')) {
              actionPlan = [
                { action: 'Enable auto-appointment booking system', owner: 'Nandlal', timeline: '2 weeks', impact: 'Eliminates manual booking delays' },
                { action: 'Daily monitoring of no-appointment shipments', owner: 'Sandeep', timeline: 'Daily', impact: 'Early intervention on aging shipments' },
                { action: 'Set appointment booking SLA: within 24 hours of reaching hub', owner: 'Nandlal', timeline: '1 week', impact: 'Reduces appointment pending aging' },
              ];
            }
            if (k.name.includes('transit')) {
              actionPlan = [
                { action: 'Daily escalation of 8+ day aged shipments', owner: 'Sandeep', timeline: 'Daily', impact: `Move shipments to 0-7 day bucket` },
                { action: 'Root cause analysis for stuck shipments by courier', owner: 'Sandeep', timeline: '1 week', impact: 'Identify courier-specific bottlenecks' },
                { action: 'Implement automated aging alerts to courier ops', owner: 'Nandlal', timeline: '2 weeks', impact: 'Proactive rather than reactive management' },
                { action: 'Review and optimize last-mile delivery routes', owner: 'Sandeep', timeline: '1 month', impact: 'Route optimization reduces transit time' },
              ];
            }

            return (
              <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-indigo-800 flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Plan of Action — {k.name}</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5">Current: <span className="text-red-600 font-semibold">{fmt(k.actual)}{k.unit}</span> → Target: <span className="text-blue-600 font-semibold">{fmt(k.target)}{k.unit}</span> → Gap: <span className="text-red-500 font-bold">{k.inv ? '+' : '-'}{fmt(gap)}{k.unit}</span></p>
                  </div>
                  <button onClick={() => setExpKPI(null)} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">KPI Performance Matrix</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
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
            <h3 className="text-sm font-semibold text-gray-700">{period} Tracking — {cur?.name}</h3>
            <p className="text-[10px] text-gray-400">Auto-filled from shipment data. Edit if incorrect. Lock after verification.</p>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-[10px]">
            <thead><tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[160px]">KPI</th>
              <th className="px-2 py-2 text-center font-semibold text-blue-600 w-14">Target</th>
              {trackCols.map(m => { const locked = lockedMonths[`${owner}||${m}`]; return (
                <th key={m} className="px-1 py-2 text-center font-semibold text-gray-500 min-w-[80px]"><div>{m}</div><button onClick={() => toggleLock(m)} className={`mt-0.5 p-0.5 rounded ${locked ? 'text-emerald-500' : 'text-gray-300 hover:text-gray-500'}`}>{locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}</button></th>
              ); })}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {kpis.map((k, ki) => (
                <tr key={ki} className="hover:bg-gray-50/50">
                  <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white z-10 border-r border-gray-100 text-[10px]">{k.name}</td>
                  <td className="px-2 py-1.5 text-center text-blue-600 font-semibold border-r border-blue-100 bg-blue-50/30">{fmt(k.target)}{k.unit}</td>
                  {trackCols.map(m => {
                    const key = `${owner}||${m}||${k.name}`;
                    const manualVal = trackingData[key];
                    const autoVal = autoActuals[m]?.[k.name];
                    const displayVal = manualVal || (autoVal != null ? String(autoVal) : '');
                    const isAuto = !manualVal && autoVal != null;
                    const locked = lockedMonths[`${owner}||${m}`];
                    const nv = parseFloat(displayVal);
                    const met = !isNaN(nv) && (k.inv ? nv <= k.target : nv >= k.target);
                    const doDrill = () => {
                      const mRows = byMonth[m] || [];
                      if (mRows.length === 0) return;
                      let filtered = mRows;
                      const kn = k.name.toLowerCase();
                      let kpiType = 'general';
                      let excludedCount = 0;
                      if (kn.includes('cost')) {
                        kpiType = 'cost';
                        const costAll = mRows.filter(r => parseFloat(r.logisticsCost) > 0);
                        filtered = costAll.filter(r => parseFloat(r.invoiceValue) > 0);
                        excludedCount = costAll.length - filtered.length;
                      }
                      else if (kn.includes('transit 0-7')) { kpiType = 'transit'; filtered = mRows.filter(r => (isInTransit(r.status)||isOFD(r.status)) && safeParseDate(r.bookingDate) && Math.floor((now-safeParseDate(r.bookingDate))/86400000)<=7); }
                      else if (kn.includes('transit 8-15')) { kpiType = 'transit'; filtered = mRows.filter(r => { if (!(isInTransit(r.status)||isOFD(r.status))) return false; const bd = safeParseDate(r.bookingDate); if (!bd) return false; const age = Math.floor((now-bd)/86400000); return age > 7 && age <= 15; }); }
                      else if (kn.includes('transit 30')) { kpiType = 'transit'; filtered = mRows.filter(r => (isInTransit(r.status)||isOFD(r.status)) && safeParseDate(r.bookingDate) && Math.floor((now-safeParseDate(r.bookingDate))/86400000)>30); }
                      else if (kn.includes('rto')) { kpiType = 'rto'; filtered = mRows.filter(r => isRTO(r.status)); }
                      else if (kn.includes('otif') || kn.includes('channel del')) { kpiType = 'platform'; const pl = k.name.split('—')[1]?.trim(); if (pl) filtered = mRows.filter(r => r.platform && r.platform.toLowerCase().includes(pl.toLowerCase())); }
                      else if (kn.includes('delivery success') || kn.includes('first attempt')) { kpiType = 'delivery'; filtered = mRows.filter(r => isDelivered(r.status)||isPartialDelivered(r.status)); }
                      else if (kn.includes('pod')) { kpiType = 'pod'; filtered = mRows.filter(r => (isDelivered(r.status)||isPartialDelivered(r.status)) && !(r.pod && r.pod.trim() !== '' && r.pod.trim() !== '-')); }
                      else if (kn.includes('appt') || kn.includes('non-appt')) { kpiType = 'appt'; filtered = mRows.filter(r => (isInTransit(r.status)||isOFD(r.status)) && !safeParseDate(r.appointmentDate)); }
                      setTrackDrill({ title: `${k.name} — ${m} (${filtered.length} records)`, data: filtered, kpiType, kpiName: k.name, month: m, excludedCount });
                    };
                    return (
                    <td key={m} className={`px-1 py-1 text-center ${displayVal && !isNaN(nv) ? (met ? 'bg-emerald-50/50' : 'bg-red-50/50') : ''}`}>
                      <div className="flex items-center gap-0.5">
                        {locked
                          ? <span className={`flex-1 font-semibold ${displayVal && !isNaN(nv) ? (met ? 'text-emerald-700' : 'text-red-600') : 'text-gray-400'}`}>{displayVal || '-'}</span>
                          : <input type="text" value={displayVal} onChange={e => saveTrack(m, k.name, e.target.value)} className={`flex-1 text-center text-[10px] px-1 py-0.5 border rounded focus:border-indigo-400 outline-none ${isAuto ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`} placeholder="-" />
                        }
                        {displayVal && <button onClick={doDrill} className="p-0.5 rounded hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600 flex-shrink-0" title="View raw data"><Eye className="w-3 h-3" /></button>}
                      </div>
                    </td>
                    );
                  })}
                </tr>
              ))}
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

      {/* ═══ AI ROOT CAUSE ═══ */}
      {view === 'rootcause' && (<div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-red-800 flex items-center gap-2 mb-3"><Brain className="w-4 h-4" /> AI Root Cause Analysis — {cur?.name}</h3>
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

      {/* Drill-down Modal — context-aware per KPI type */}
      {trackDrill && (() => {
        const dd = trackDrill.data;
        const kpiType = trackDrill.kpiType || 'general';
        const isCost = kpiType === 'cost';
        const isDel = kpiType === 'delivery' || kpiType === 'platform';
        const isRto = kpiType === 'rto';
        const isTransit = kpiType === 'transit';
        const isPod = kpiType === 'pod';
        const isAppt = kpiType === 'appt';

        const delC = dd.filter(r=>isDelivered(r.status)||isPartialDelivered(r.status)).length;
        const rtoC = dd.filter(r=>isRTO(r.status)).length;
        const intC = dd.filter(r=>isInTransit(r.status)||isOFD(r.status)).length;
        const othC = dd.length - delC - rtoC - intC;

        /* Aggregations */
        const platSum = {};
        dd.forEach(r => { const p = r.platform || 'Unknown'; if (!platSum[p]) platSum[p] = { total: 0, delivered: 0, rto: 0, cost: 0, inv: 0 }; platSum[p].total++; if (isDelivered(r.status)||isPartialDelivered(r.status)) platSum[p].delivered++; if (isRTO(r.status)) platSum[p].rto++; platSum[p].cost += parseFloat(r.logisticsCost)||0; platSum[p].inv += parseFloat(r.invoiceValue)||0; });
        const platArr = Object.entries(platSum).map(([p,v]) => ({platform:p,...v,delPct:v.total>0?percent(v.delivered,v.total):0,rtoPct:v.total>0?percent(v.rto,v.total):0,costPct:v.inv>0?(v.cost/v.inv*100):0,avgCost:v.total>0?v.cost/v.total:0})).sort((a,b)=> isCost ? b.cost-a.cost : b.total-a.total);

        const courSum = {};
        dd.forEach(r => { const c = r.vendor || 'Unknown'; if (!courSum[c]) courSum[c] = { total: 0, delivered: 0, rto: 0, cost: 0, inv: 0 }; courSum[c].total++; if (isDelivered(r.status)||isPartialDelivered(r.status)) courSum[c].delivered++; if (isRTO(r.status)) courSum[c].rto++; courSum[c].cost += parseFloat(r.logisticsCost)||0; courSum[c].inv += parseFloat(r.invoiceValue)||0; });
        const courArr = Object.entries(courSum).map(([c,v]) => ({courier:c,...v,delPct:v.total>0?percent(v.delivered,v.total):0,rtoPct:v.total>0?percent(v.rto,v.total):0,costPct:v.inv>0?(v.cost/v.inv*100):0,avgCost:v.total>0?v.cost/v.total:0})).sort((a,b)=> isCost ? b.cost-a.cost : b.total-a.total);

        const zoneSum = {};
        dd.forEach(r => { const z = r.zone || 'Unknown'; if (!zoneSum[z]) zoneSum[z] = { total: 0, delivered: 0, rto: 0, cost: 0, inv: 0 }; zoneSum[z].total++; if (isDelivered(r.status)||isPartialDelivered(r.status)) zoneSum[z].delivered++; if (isRTO(r.status)) zoneSum[z].rto++; zoneSum[z].cost += parseFloat(r.logisticsCost)||0; zoneSum[z].inv += parseFloat(r.invoiceValue)||0; });
        const zoneArr = Object.entries(zoneSum).map(([z,v]) => ({zone:z,...v,delPct:v.total>0?percent(v.delivered,v.total):0,rtoPct:v.total>0?percent(v.rto,v.total):0,costPct:v.inv>0?(v.cost/v.inv*100):0,avgCost:v.total>0?v.cost/v.total:0})).sort((a,b)=> isCost ? b.cost-a.cost : b.total-a.total);

        /* Cost-specific metrics */
        const totalCost = dd.reduce((s, r) => s + (parseFloat(r.logisticsCost) || 0), 0);
        const totalInv = dd.reduce((s, r) => s + (parseFloat(r.invoiceValue) || 0), 0);
        const weightedCostPct = totalInv > 0 ? (totalCost / totalInv * 100) : 0;
        const avgCostPerShip = dd.length > 0 ? totalCost / dd.length : 0;
        const costOutliers = isCost ? [...dd].map(r => ({ ...r, _cost: parseFloat(r.logisticsCost)||0, _inv: parseFloat(r.invoiceValue)||0, _pct: (parseFloat(r.invoiceValue)||0) > 0 ? (parseFloat(r.logisticsCost)||0)/(parseFloat(r.invoiceValue)||1)*100 : 0 })).sort((a,b)=>b._pct-a._pct).slice(0,10) : [];

        /* Transit aging buckets */
        let transitBuckets = null;
        if (isTransit) {
          const buck = { '0-7':0, '8-15':0, '16-30':0, '30+':0 };
          dd.forEach(r => { const bd = safeParseDate(r.bookingDate); if (!bd) return; const age = Math.floor((now-bd)/86400000); if (age<=7) buck['0-7']++; else if (age<=15) buck['8-15']++; else if (age<=30) buck['16-30']++; else buck['30+']++; });
          transitBuckets = buck;
        }

        /* Columns for data table — context-aware */
        let cols = [
          { key: 'awbNo', label: 'AWB No' }, { key: 'invoiceNo', label: 'Invoice No' }, { key: 'vendor', label: 'Courier' },
          { key: 'platform', label: 'Platform' }, { key: 'destination', label: 'City' }, { key: 'status', label: 'Status' },
          { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) }, { key: 'deliveryDate', label: 'Delivery', render: v => formatDate(v) },
          { key: 'zone', label: 'Zone' }, { key: 'failureRemarks', label: 'Remarks' },
        ];
        if (isCost) cols = [
          { key: 'awbNo', label: 'AWB No' }, { key: 'invoiceNo', label: 'Invoice No' }, { key: 'vendor', label: 'Courier' },
          { key: 'platform', label: 'Platform' }, { key: 'destination', label: 'City' }, { key: 'zone', label: 'Zone' },
          { key: 'invoiceValue', label: 'Invoice Value', render: v => currency(parseFloat(v) || 0) },
          { key: 'logisticsCost', label: 'Cost', render: v => currency(parseFloat(v) || 0) },
          { key: '_costPct', label: 'Cost %', render: (_, r) => { const c=parseFloat(r.logisticsCost)||0; const i=parseFloat(r.invoiceValue)||0; return i>0?(c/i*100).toFixed(1)+'%':'-'; } },
          { key: 'status', label: 'Status' },
        ];
        else if (isRto) cols = [
          { key: 'awbNo', label: 'AWB No' }, { key: 'vendor', label: 'Courier' }, { key: 'platform', label: 'Platform' },
          { key: 'destination', label: 'City' }, { key: 'zone', label: 'Zone' },
          { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
          { key: 'logisticsCost', label: 'RTO Cost', render: v => currency(parseFloat(v) || 0) },
          { key: 'failureRemarks', label: 'RTO Reason' },
        ];
        else if (isTransit || isAppt) cols = [
          { key: 'awbNo', label: 'AWB No' }, { key: 'vendor', label: 'Courier' }, { key: 'platform', label: 'Platform' },
          { key: 'destination', label: 'City' }, { key: 'zone', label: 'Zone' }, { key: 'status', label: 'Status' },
          { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
          { key: '_age', label: 'Age (days)', render: (_, r) => { const bd = safeParseDate(r.bookingDate); return bd ? Math.floor((now-bd)/86400000) : '-'; } },
          { key: 'appointmentDate', label: 'Appt', render: v => formatDate(v) },
        ];
        else if (isPod) cols = [
          { key: 'awbNo', label: 'AWB No' }, { key: 'vendor', label: 'Courier' }, { key: 'platform', label: 'Platform' },
          { key: 'destination', label: 'City' }, { key: 'deliveryDate', label: 'Delivered', render: v => formatDate(v) },
          { key: 'pod', label: 'POD' }, { key: 'status', label: 'Status' },
        ];

        return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">{trackDrill.title}</h3>
              <button onClick={() => setTrackDrill(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* Context note when records were excluded from cost calc */}
              {isCost && trackDrill.excludedCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[10px] text-amber-700">
                  <span className="font-semibold">Note:</span> {trackDrill.excludedCount} shipment(s) with cost but missing invoice value were excluded — they would skew the Cost % calculation.
                </div>
              )}

              {/* Context-aware top metric cards */}
              {isCost && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="bg-blue-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Shipments</p><p className="text-lg font-bold text-blue-700">{dd.length}</p></div>
                  <div className="bg-indigo-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Total Cost</p><p className="text-lg font-bold text-indigo-700">{currency(totalCost)}</p></div>
                  <div className="bg-purple-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Invoice Value</p><p className="text-lg font-bold text-purple-700">{currency(totalInv)}</p></div>
                  <div className="bg-red-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Weighted Cost %</p><p className="text-lg font-bold text-red-600">{weightedCostPct.toFixed(2)}%</p></div>
                  <div className="bg-amber-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Avg ₹/Shipment</p><p className="text-lg font-bold text-amber-700">{currency(avgCostPerShip)}</p></div>
                </div>
              )}
              {isDel && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-blue-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Total</p><p className="text-lg font-bold text-blue-700">{dd.length}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Delivered</p><p className="text-lg font-bold text-emerald-700">{delC}</p></div>
                  <div className="bg-indigo-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Delivery %</p><p className="text-lg font-bold text-indigo-700">{dd.length>0?percent(delC,dd.length).toFixed(1):0}%</p></div>
                  <div className="bg-red-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">RTO</p><p className="text-lg font-bold text-red-600">{rtoC}</p></div>
                </div>
              )}
              {isRto && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-red-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">RTO Shipments</p><p className="text-lg font-bold text-red-600">{dd.length}</p></div>
                  <div className="bg-amber-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">RTO Cost Loss</p><p className="text-lg font-bold text-amber-700">{currency(totalCost)}</p></div>
                  <div className="bg-purple-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Invoice at Risk</p><p className="text-lg font-bold text-purple-700">{currency(totalInv)}</p></div>
                  <div className="bg-indigo-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Avg ₹/RTO</p><p className="text-lg font-bold text-indigo-700">{currency(avgCostPerShip)}</p></div>
                </div>
              )}
              {isTransit && transitBuckets && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="bg-blue-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">In-Transit</p><p className="text-lg font-bold text-blue-700">{dd.length}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">0-7 days</p><p className="text-lg font-bold text-emerald-700">{transitBuckets['0-7']}</p></div>
                  <div className="bg-amber-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">8-15 days</p><p className="text-lg font-bold text-amber-700">{transitBuckets['8-15']}</p></div>
                  <div className="bg-orange-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">16-30 days</p><p className="text-lg font-bold text-orange-700">{transitBuckets['16-30']}</p></div>
                  <div className="bg-red-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">30+ days</p><p className="text-lg font-bold text-red-600">{transitBuckets['30+']}</p></div>
                </div>
              )}
              {(isPod || isAppt || kpiType === 'general') && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="bg-blue-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Total</p><p className="text-lg font-bold text-blue-700">{dd.length}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Delivered</p><p className="text-lg font-bold text-emerald-700">{delC}</p></div>
                  <div className="bg-red-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">RTO</p><p className="text-lg font-bold text-red-600">{rtoC}</p></div>
                  <div className="bg-indigo-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">In-Transit</p><p className="text-lg font-bold text-indigo-600">{intC}</p></div>
                  <div className="bg-amber-50 rounded-lg p-2 text-center"><p className="text-[9px] text-gray-500">Other</p><p className="text-lg font-bold text-amber-600">{othC}</p></div>
                </div>
              )}

              {/* Platform Breakdown — columns vary by context */}
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-600 uppercase mb-2">Platform Breakdown</p>
                <div className="overflow-x-auto"><table className="w-full text-[10px]"><thead><tr className="border-b border-gray-200">
                  <th className="px-2 py-1 text-left font-semibold text-gray-500">Platform</th>
                  <th className="px-2 py-1 text-right font-semibold text-gray-500">Total</th>
                  {isCost && <>
                    <th className="px-2 py-1 text-right font-semibold text-purple-600">Invoice</th>
                    <th className="px-2 py-1 text-right font-semibold text-blue-600">Cost</th>
                    <th className="px-2 py-1 text-right font-semibold text-blue-600">Cost %</th>
                    <th className="px-2 py-1 text-right font-semibold text-amber-600">Avg ₹/Ship</th>
                  </>}
                  {!isCost && <>
                    <th className="px-2 py-1 text-right font-semibold text-emerald-600">Del</th>
                    <th className="px-2 py-1 text-right font-semibold text-emerald-600">Del %</th>
                    {!isRto && <th className="px-2 py-1 text-right font-semibold text-red-500">RTO</th>}
                    {isRto && <th className="px-2 py-1 text-right font-semibold text-red-500">RTO %</th>}
                  </>}
                </tr></thead><tbody className="divide-y divide-gray-100">
                  {platArr.slice(0,10).map(p => <tr key={p.platform}>
                    <td className="px-2 py-1 font-medium text-gray-700">{p.platform}</td>
                    <td className="px-2 py-1 text-right">{p.total}</td>
                    {isCost && <>
                      <td className="px-2 py-1 text-right text-purple-600">{currency(p.inv)}</td>
                      <td className="px-2 py-1 text-right text-blue-600">{currency(p.cost)}</td>
                      <td className="px-2 py-1 text-right font-semibold" style={{color:p.costPct>10?'#dc2626':p.costPct>6?'#d97706':'#059669'}}>{p.costPct.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right text-amber-700">{currency(p.avgCost)}</td>
                    </>}
                    {!isCost && <>
                      <td className="px-2 py-1 text-right text-emerald-600">{p.delivered}</td>
                      <td className="px-2 py-1 text-right font-semibold" style={{color:p.delPct>=90?'#059669':'#dc2626'}}>{p.delPct.toFixed(1)}%</td>
                      {!isRto && <td className="px-2 py-1 text-right text-red-500">{p.rto}</td>}
                      {isRto && <td className="px-2 py-1 text-right font-semibold text-red-500">{p.rtoPct.toFixed(1)}%</td>}
                    </>}
                  </tr>)}
                </tbody></table></div>
              </div>

              {/* Courier & Zone — context-aware metric shown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-600 uppercase mb-2">Courier {isCost ? '— Cost %' : isRto ? '— RTO %' : '— Delivery %'}</p>
                  <div className="space-y-1">{courArr.slice(0,8).map(c => <div key={c.courier} className="flex items-center justify-between text-[10px] py-0.5">
                    <span className="text-gray-700 truncate flex-1 mr-2">{c.courier}</span>
                    {isCost ? <span className="font-semibold">{c.total} | <span className="text-blue-600">{currency(c.cost)}</span> | <span style={{color:c.costPct>10?'#dc2626':'#059669'}}>{c.costPct.toFixed(1)}%</span></span>
                      : isRto ? <span className="font-semibold">{c.total} | <span className="text-red-500">{c.rtoPct.toFixed(0)}%</span></span>
                      : <span className="font-semibold">{c.total} | <span className="text-emerald-600">{c.delPct.toFixed(0)}%</span></span>}
                  </div>)}</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-600 uppercase mb-2">Zone {isCost ? '— Cost %' : isRto ? '— RTO %' : '— Delivery %'}</p>
                  <div className="space-y-1">{zoneArr.slice(0,8).map(z => <div key={z.zone} className="flex items-center justify-between text-[10px] py-0.5">
                    <span className="text-gray-700">{z.zone}</span>
                    {isCost ? <span className="font-semibold">{z.total} | <span className="text-blue-600">{currency(z.cost)}</span> | <span style={{color:z.costPct>10?'#dc2626':'#059669'}}>{z.costPct.toFixed(1)}%</span></span>
                      : isRto ? <span className="font-semibold">{z.total} | <span className="text-red-500">{z.rtoPct.toFixed(0)}%</span></span>
                      : <span className="font-semibold">{z.total} | <span className="text-emerald-600">{z.delPct.toFixed(0)}%</span></span>}
                  </div>)}</div>
                </div>
              </div>

              {/* Cost outliers — only for cost KPI */}
              {isCost && costOutliers.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-red-700 uppercase mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Top 10 Cost % Outliers (highest cost relative to invoice)</p>
                  <div className="overflow-x-auto"><table className="w-full text-[10px]"><thead><tr className="border-b border-red-200">
                    <th className="px-2 py-1 text-left font-semibold text-gray-500">AWB</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-500">Platform</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-500">Courier</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-500">City</th>
                    <th className="px-2 py-1 text-right font-semibold text-purple-600">Invoice</th>
                    <th className="px-2 py-1 text-right font-semibold text-blue-600">Cost</th>
                    <th className="px-2 py-1 text-right font-semibold text-red-600">Cost %</th>
                  </tr></thead><tbody className="divide-y divide-red-100">
                    {costOutliers.map(r => <tr key={r.awbNo}>
                      <td className="px-2 py-1 font-mono text-gray-700">{r.awbNo}</td>
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

              <DataTable data={dd} columns={cols} exportFilename={`${kpiType}-${trackDrill.month||'drill'}`} pageSize={25} />
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
