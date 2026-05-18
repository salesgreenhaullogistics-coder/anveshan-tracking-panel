import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart, PieChart, DoughnutChart } from '../components/Charts';
import {
  Clock, AlertTriangle, Timer, Truck, Building2, MapPin,
  Brain, ShieldAlert, Lightbulb, Calendar, Eye, CalendarCheck,
  CalendarX, CalendarClock, ChevronRight, ChevronDown, X,
} from 'lucide-react';
import {
  safeParseDate, formatDate, getAgeBucket, isAged, groupBy, percent,
  isInTransit, isOFD, daysBetween, COLORS,
} from '../utils/index';
import { isToday } from 'date-fns';

const MAIN_TABS = [
  { key: 'aged', label: 'Aged In-Transit POs', icon: Clock },
  { key: 'appt', label: 'Appointment Manager', icon: Calendar },
];

const AGE_FILTERS = ['All', '0-7 Days', '8-15 Days', '16-30 Days', '30+ Days'];

function getAgeBkt(age) { if (age <= 7) return '0-7 Days'; if (age <= 15) return '8-15 Days'; if (age <= 30) return '16-30 Days'; return '30+ Days'; }
function ageSev(age) {
  if (age > 30) return { text: 'text-red-700', badge: 'badge-red' };
  if (age > 15) return { text: 'text-orange-700', badge: 'badge-yellow' };
  if (age > 7) return { text: 'text-amber-700', badge: 'badge-yellow' };
  return { text: 'text-emerald-700', badge: 'badge-green' };
}
const fmt = v => (v != null && isFinite(v) ? v.toFixed(0) : '—');

const APPT_CATS = [
  { key: 'today', label: "Today's Appointment", icon: CalendarCheck, color: 'emerald' },
  { key: 'pending', label: 'Appointment Pending', icon: CalendarX, color: 'red' },
  { key: 'prepull', label: 'Prepull Required', icon: CalendarClock, color: 'amber' },
  { key: 'future', label: 'Future Appointment', icon: Calendar, color: 'blue' },
];

export default function AgingMonitor() {
  const { data } = useData();
  const [mainTab, setMainTab] = useState('aged');
  const [ageFilter, setAgeFilter] = useState('All');
  const [expPlatform, setExpPlatform] = useState(null);
  const [drillDown, setDrillDown] = useState(null);
  const [apptCat, setApptCat] = useState('pending');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  /* ═══ ALL In-Transit with enrichment ═══ */
  const intransitData = useMemo(() => {
    return data
      .filter(r => isInTransit(r.status) || isOFD(r.status))
      .map(r => {
        const bd = safeParseDate(r.bookingDate);
        const age = bd ? Math.floor((now - bd) / 86400000) : 0;
        const apptDate = safeParseDate(r.appointmentDate);
        const eddDate = safeParseDate(r.edd);
        const apptRaw = (r.appointmentDate || '').trim();
        const hasValidAppt = !!apptDate;
        const isNoAppt = !hasValidAppt && (!apptRaw || apptRaw === 'NA' || apptRaw === '-' || apptRaw.toLowerCase().includes('no slot'));
        const isTodayAppt = hasValidAppt && isToday(apptDate);
        const isFutureAppt = hasValidAppt && apptDate > todayStart && !isTodayAppt;
        const isPrepull = hasValidAppt && eddDate && daysBetween(r.edd, r.appointmentDate) > 5;
        const pendingDays = isNoAppt ? age : 0;
        const eddBreached = eddDate && eddDate < now;

        let apptCategory = 'future';
        if (isTodayAppt) apptCategory = 'today';
        else if (isNoAppt) apptCategory = 'pending';
        else if (isPrepull) apptCategory = 'prepull';

        return { ...r, age, ageBucket: getAgeBkt(age), hasValidAppt, isNoAppt, isTodayAppt, isFutureAppt, isPrepull, pendingDays, eddBreached, apptCategory, apptDate, eddDate };
      });
  }, [data]);

  /* ═══ AGED TAB data ═══ */
  const agedFiltered = useMemo(() => {
    if (ageFilter === 'All') return intransitData;
    return intransitData.filter(r => r.ageBucket === ageFilter);
  }, [intransitData, ageFilter]);

  const bucketCounts = useMemo(() => {
    const c = { '0-7 Days': 0, '8-15 Days': 0, '16-30 Days': 0, '30+ Days': 0 };
    intransitData.forEach(r => { if (c[r.ageBucket] !== undefined) c[r.ageBucket]++; });
    return c;
  }, [intransitData]);

  const avgAge = useMemo(() => intransitData.length ? Math.round(intransitData.reduce((s, r) => s + r.age, 0) / intransitData.length) : 0, [intransitData]);

  const platformAged = useMemo(() => {
    const g = groupBy(intransitData, 'platform');
    return Object.entries(g).filter(([k]) => k && k !== '').map(([p, rows]) => {
      const bc = { '0-7 Days': 0, '8-15 Days': 0, '16-30 Days': 0, '30+ Days': 0 };
      let noAppt = 0, eddBr = 0;
      rows.forEach(r => { if (bc[r.ageBucket] !== undefined) bc[r.ageBucket]++; if (r.isNoAppt) noAppt++; if (r.eddBreached) eddBr++; });
      const rmC = {};
      rows.forEach(r => { const rm = (r.failureRemarks || '').trim(); if (rm && rm !== 'NA' && rm !== '-') rmC[rm] = (rmC[rm] || 0) + 1; });
      const topReason = Object.entries(rmC).sort((a, b) => b[1] - a[1])[0] || null;
      return { platform: p, count: rows.length, avgAge: Math.round(rows.reduce((s, r) => s + r.age, 0) / rows.length), buckets: bc, noAppt, eddBr, topReason, rows };
    }).sort((a, b) => b.count - a.count);
  }, [intransitData]);

  const zoneAged = useMemo(() => {
    const g = groupBy(intransitData, 'zone');
    return Object.entries(g).filter(([k]) => k).map(([z, r]) => ({ zone: z, count: r.length, avgAge: Math.round(r.reduce((s, x) => s + x.age, 0) / r.length), rows: r })).sort((a, b) => b.avgAge - a.avgAge);
  }, [intransitData]);

  const courierAged = useMemo(() => {
    const g = groupBy(intransitData, 'vendor');
    return Object.entries(g).filter(([k]) => k).map(([c, r]) => ({ courier: c, count: r.length, avgAge: Math.round(r.reduce((s, x) => s + x.age, 0) / r.length), rows: r })).sort((a, b) => b.avgAge - a.avgAge);
  }, [intransitData]);

  const failReasons = useMemo(() => {
    const rc = {};
    intransitData.forEach(r => { const rm = (r.failureRemarks || '').trim(); const k = rm && rm !== 'NA' && rm !== '-' ? rm : 'No remark'; rc[k] = (rc[k] || 0) + 1; });
    return Object.entries(rc).sort((a, b) => b[1] - a[1]);
  }, [intransitData]);

  /* AI Insights */
  const insights = useMemo(() => {
    const items = [];
    const noApptCount = intransitData.filter(r => r.isNoAppt).length;
    const eddBrCount = intransitData.filter(r => r.eddBreached).length;
    if (bucketCounts['30+ Days'] > 0) items.push({ icon: ShieldAlert, title: `${bucketCounts['30+ Days']} shipments stuck 30+ days`, desc: `${percent(bucketCounts['30+ Days'], intransitData.length)}% critical. Immediate escalation needed.`, severity: 'critical' });
    if (noApptCount > 0) items.push({ icon: CalendarX, title: `${noApptCount} without appointment (${percent(noApptCount, intransitData.length)}%)`, desc: `No delivery slot booked. These need urgent appointment booking.`, severity: 'warning' });
    if (eddBrCount > 0) items.push({ icon: Timer, title: `${eddBrCount} breached EDD`, desc: `${percent(eddBrCount, intransitData.length)}% past expected delivery. Follow up with couriers.`, severity: 'critical' });
    if (failReasons.length > 0 && failReasons[0][0] !== 'No remark') items.push({ icon: Lightbulb, title: `Top reason: ${failReasons[0][0]} (${failReasons[0][1]})`, desc: `Address this to reduce aging.`, severity: 'info' });
    return items;
  }, [intransitData, bucketCounts, failReasons]);

  /* ═══ APPOINTMENT MANAGER data ═══ */
  const apptData = useMemo(() => ({
    today: intransitData.filter(r => r.apptCategory === 'today'),
    pending: intransitData.filter(r => r.apptCategory === 'pending'),
    prepull: intransitData.filter(r => r.apptCategory === 'prepull'),
    future: intransitData.filter(r => r.apptCategory === 'future'),
  }), [intransitData]);

  const activeApptData = apptData[apptCat] || [];

  const apptPlatforms = useMemo(() => {
    const g = groupBy(activeApptData, 'platform');
    return Object.entries(g).filter(([k]) => k && k !== '').map(([p, rows]) => {
      const avgA = Math.round(rows.reduce((s, r) => s + r.age, 0) / rows.length);
      return { platform: p, count: rows.length, avgAge: avgA, rows };
    }).sort((a, b) => b.count - a.count);
  }, [activeApptData]);

  const apptCouriers = useMemo(() => {
    const g = groupBy(activeApptData, 'vendor');
    return Object.entries(g).filter(([k]) => k && k !== '').map(([c, rows]) => {
      return { courier: c, count: rows.length, avgAge: Math.round(rows.reduce((s, r) => s + r.age, 0) / rows.length), rows };
    }).sort((a, b) => b.count - a.count);
  }, [activeApptData]);

  const apptAgeBuckets = useMemo(() => {
    const c = { '0-7 Days': 0, '8-15 Days': 0, '16-30 Days': 0, '30+ Days': 0 };
    activeApptData.forEach(r => { if (c[r.ageBucket] !== undefined) c[r.ageBucket]++; });
    return c;
  }, [activeApptData]);

  /* ═══ COLUMNS ═══ */
  const AGED_COLS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
    { key: 'age', label: 'Age', render: v => <span className={`badge ${ageSev(v).badge}`}>{v}d</span> },
    { key: 'eddBreached', label: 'EDD', render: v => v ? <span className="badge badge-red">Breached</span> : <span className="badge badge-green">OK</span> },
    { key: 'hasValidAppt', label: 'Appt', render: v => v ? <span className="badge badge-green">Yes</span> : <span className="badge badge-red">No</span> },
    { key: 'appointmentDate', label: 'Appt Date', render: v => formatDate(v) },
    { key: 'failureRemarks', label: 'Remarks' },
    { key: 'zone', label: 'Zone' },
    { key: 'poNumber', label: 'PO No' },
  ];

  const APPT_COLS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
    { key: 'age', label: 'Pending Days', render: v => <span className={`badge ${ageSev(v).badge}`}>{v}d</span> },
    { key: 'edd', label: 'EDD', render: v => formatDate(v) },
    { key: 'appointmentDate', label: 'Appt Date', render: v => formatDate(v) },
    ...(apptCat === 'prepull' ? [{ key: '_delay', label: 'Delay vs EDD', render: (_, r) => { const d = r.eddDate && r.apptDate ? Math.floor((r.apptDate - r.eddDate) / 86400000) : 0; return <span className={`badge ${d > 15 ? 'badge-red' : 'badge-yellow'}`}>+{d}d</span>; } }] : []),
    { key: 'failureRemarks', label: 'Remarks' },
    { key: 'zone', label: 'Zone' },
    { key: 'poNumber', label: 'PO No' },
  ];

  return (
    <div className="space-y-4">
      {/* Main Tabs */}
      <div className="flex gap-2">
        {MAIN_TABS.map(t => {
          const Icon = t.icon; const active = mainTab === t.key;
          return (
            <button key={t.key} onClick={() => { setMainTab(t.key); setExpPlatform(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all ${active ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg shadow-violet-200' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
        <span className="text-[10px] text-gray-400 ml-auto mt-2">{intransitData.length} in-transit POs</span>
      </div>

      {/* ═══ AGED IN-TRANSIT POs ═══ */}
      {mainTab === 'aged' && (<div className="space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <KPICard title="Total In-Transit" value={intransitData.length} icon={Truck} color="indigo" />
          <KPICard title="Avg Age" value={`${avgAge}d`} icon={Clock} color="purple" />
          <KPICard title="No Appointment" value={apptData.pending.length} icon={CalendarX} color="red" subtitle={`${percent(apptData.pending.length, intransitData.length)}%`} />
          <KPICard title="EDD Breached" value={intransitData.filter(r => r.eddBreached).length} icon={AlertTriangle} color="red" />
          <KPICard title="8-15 Days" value={bucketCounts['8-15 Days']} icon={Clock} color="yellow" />
          <KPICard title="30+ Days" value={bucketCounts['30+ Days']} icon={ShieldAlert} color="red" subtitle="Critical" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="chart-container"><BarChart title="Age Bucket" labels={Object.keys(bucketCounts)} datasets={[{ label: 'Shipments', data: Object.values(bucketCounts), backgroundColor: ['#10B981','#F59E0B','#F97316','#EF4444'] }]} height={200} /></div>
          <div className="chart-container"><BarChart title="Platform Aging (Top 10)" labels={platformAged.slice(0,10).map(p=>p.platform)} datasets={[{ label: 'Count', data: platformAged.slice(0,10).map(p=>p.count), backgroundColor: platformAged.slice(0,10).map(p=>p.avgAge>20?'#EF4444':p.avgAge>10?'#F59E0B':'#6366F1') }]} height={200} /></div>
          <div className="chart-container"><DoughnutChart title="By Zone" labels={zoneAged.slice(0,8).map(z=>z.zone)} data={zoneAged.slice(0,8).map(z=>z.count)} height={200} /></div>
        </div>

        {insights.length > 0 && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-violet-800 flex items-center gap-2 mb-2"><Brain className="w-4 h-4" /> AI Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {insights.map((ins, i) => { const Ic = ins.icon; const cm = { critical:'border-red-200 bg-red-50 text-red-800', warning:'border-amber-200 bg-amber-50 text-amber-800', info:'border-blue-200 bg-blue-50 text-blue-800' }; return (
                <div key={i} className={`p-3 rounded-xl border ${cm[ins.severity]}`}><div className="flex items-start gap-2"><Ic className="w-4 h-4 mt-0.5 flex-shrink-0" /><div><p className="text-[11px] font-bold">{ins.title}</p><p className="text-[10px] text-gray-600 mt-0.5">{ins.desc}</p></div></div></div>
              ); })}
            </div>
          </div>
        )}

        {/* Platform Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Platform Aging Analysis</h3><p className="text-[10px] text-gray-400">Click platform for courier/zone/reason drill-down</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Platform</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Total</th>
                <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">0-7d</th>
                <th className="px-3 py-2 text-right font-semibold text-amber-600 uppercase">8-15d</th>
                <th className="px-3 py-2 text-right font-semibold text-orange-600 uppercase">16-30d</th>
                <th className="px-3 py-2 text-right font-semibold text-red-600 uppercase">30+d</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Avg</th>
                <th className="px-3 py-2 text-right font-semibold text-red-500 uppercase">No Appt</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Top Reason</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Dist</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {platformAged.map(p => { const isExp = expPlatform === p.platform; const t = p.count || 1; return (
                  <React.Fragment key={p.platform}>
                    <tr className={`hover:bg-gray-50 cursor-pointer ${isExp?'bg-violet-50/50':''}`} onClick={() => setExpPlatform(isExp?null:p.platform)}>
                      <td className="px-3 py-2 font-medium text-violet-700 flex items-center gap-1">{isExp?<ChevronDown className="w-3 h-3"/>:<ChevronRight className="w-3 h-3"/>}{p.platform}</td>
                      <td className="px-3 py-2 text-right font-semibold cursor-pointer underline" onClick={e=>{e.stopPropagation();setDrillDown({title:`${p.platform}`,data:p.rows});}}>{p.count}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 cursor-pointer underline" onClick={e=>{e.stopPropagation();setDrillDown({title:`${p.platform} 0-7d`,data:p.rows.filter(r=>r.ageBucket==='0-7 Days')});}}>{p.buckets['0-7 Days']}</td>
                      <td className="px-3 py-2 text-right text-amber-600 cursor-pointer underline" onClick={e=>{e.stopPropagation();setDrillDown({title:`${p.platform} 8-15d`,data:p.rows.filter(r=>r.ageBucket==='8-15 Days')});}}>{p.buckets['8-15 Days']}</td>
                      <td className="px-3 py-2 text-right text-orange-600 cursor-pointer underline" onClick={e=>{e.stopPropagation();setDrillDown({title:`${p.platform} 16-30d`,data:p.rows.filter(r=>r.ageBucket==='16-30 Days')});}}>{p.buckets['16-30 Days']}</td>
                      <td className="px-3 py-2 text-right text-red-600 font-semibold cursor-pointer underline" onClick={e=>{e.stopPropagation();setDrillDown({title:`${p.platform} 30+d`,data:p.rows.filter(r=>r.ageBucket==='30+ Days')});}}>{p.buckets['30+ Days']}</td>
                      <td className="px-3 py-2 text-right"><span className={`font-semibold ${ageSev(p.avgAge).text}`}>{p.avgAge}d</span></td>
                      <td className="px-3 py-2 text-right text-red-500 cursor-pointer underline" onClick={e=>{e.stopPropagation();setDrillDown({title:`${p.platform} No Appt`,data:p.rows.filter(r=>r.isNoAppt)});}}>{p.noAppt}</td>
                      <td className="px-3 py-2 text-left text-[10px] text-gray-500 truncate max-w-[100px]">{p.topReason?`${p.topReason[0]} (${p.topReason[1]})`:'—'}</td>
                      <td className="px-3 py-2 min-w-[80px]"><div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">{p.buckets['0-7 Days']>0&&<div className="bg-emerald-500" style={{width:`${p.buckets['0-7 Days']/t*100}%`}}/>}{p.buckets['8-15 Days']>0&&<div className="bg-amber-400" style={{width:`${p.buckets['8-15 Days']/t*100}%`}}/>}{p.buckets['16-30 Days']>0&&<div className="bg-orange-500" style={{width:`${p.buckets['16-30 Days']/t*100}%`}}/>}{p.buckets['30+ Days']>0&&<div className="bg-red-500" style={{width:`${p.buckets['30+ Days']/t*100}%`}}/>}</div></td>
                    </tr>
                    {isExp && (() => {
                      const cG = groupBy(p.rows,'vendor'); const couriers = Object.entries(cG).filter(([k])=>k).map(([c,r])=>({c,n:r.length,avg:Math.round(r.reduce((s,x)=>s+x.age,0)/r.length),rows:r})).sort((a,b)=>b.avg-a.avg);
                      const zG = groupBy(p.rows,'zone'); const zones = Object.entries(zG).filter(([k])=>k).map(([z,r])=>({z,n:r.length,avg:Math.round(r.reduce((s,x)=>s+x.age,0)/r.length),rows:r})).sort((a,b)=>b.avg-a.avg);
                      const rmC={}; p.rows.forEach(r=>{const rm=(r.failureRemarks||'').trim();if(rm&&rm!=='NA'&&rm!=='-')rmC[rm]=(rmC[rm]||0)+1;}); const reasons=Object.entries(rmC).sort((a,b)=>b[1]-a[1]).slice(0,8);
                      return (<tr><td colSpan={10} className="p-0"><div className="bg-violet-50/30 border-t border-violet-100 px-4 py-3"><div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <div><p className="text-[10px] font-bold text-violet-700 mb-1.5">Courier</p><div className="space-y-1">{couriers.map(c=>(<div key={c.c} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-violet-100 cursor-pointer hover:shadow-sm" onClick={()=>setDrillDown({title:`${p.platform}→${c.c}`,data:c.rows})}><span className="text-gray-700 truncate mr-2">{c.c}</span><span className={`font-semibold ${ageSev(c.avg).text}`}>{c.n} | {c.avg}d</span></div>))}</div></div>
                        <div><p className="text-[10px] font-bold text-violet-700 mb-1.5">Zone</p><div className="space-y-1">{zones.slice(0,8).map(z=>(<div key={z.z} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-violet-100 cursor-pointer hover:shadow-sm" onClick={()=>setDrillDown({title:`${p.platform}→${z.z}`,data:z.rows})}><span className="text-gray-700">{z.z}</span><span className={`font-semibold ${ageSev(z.avg).text}`}>{z.n} | {z.avg}d</span></div>))}</div></div>
                        <div><p className="text-[10px] font-bold text-red-700 mb-1.5">Stuck Reasons</p>{reasons.length>0?<div className="space-y-1">{reasons.map(([r,c])=>(<div key={r} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-red-100 cursor-pointer hover:shadow-sm" onClick={()=>setDrillDown({title:`${p.platform}—${r}`,data:p.rows.filter(x=>(x.failureRemarks||'').trim()===r)})}><span className="text-gray-700 truncate mr-2 flex-1">{r}</span><span className="text-red-600 font-semibold">{c}</span></div>))}</div>:<p className="text-[10px] text-gray-400">No remarks</p>}
                        </div></div></div></td></tr>);
                    })()}
                  </React.Fragment>
                ); })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">{AGE_FILTERS.map(f=>{const cnt=f==='All'?intransitData.length:(bucketCounts[f]||0);return(<button key={f} onClick={()=>setAgeFilter(f)} className={`tab-btn ${ageFilter===f?'tab-btn-active':'tab-btn-inactive'}`}>{f} ({cnt})</button>);})}</div>
        <DataTable data={agedFiltered} columns={AGED_COLS} exportFilename="intransit-aging" pageSize={25} />
      </div>)}

      {/* ═══ APPOINTMENT MANAGER ═══ */}
      {mainTab === 'appt' && (<div className="space-y-4">

        {/* ── In-Transit Stage Funnel ── */}
        <div className="bg-gradient-to-r from-indigo-50 via-white to-violet-50 rounded-xl border border-indigo-200 p-4">
          <h3 className="text-sm font-bold text-indigo-800 flex items-center gap-2 mb-3"><Truck className="w-4 h-4" /> In-Transit LR Stage Breakdown</h3>
          <div className="flex items-center gap-1 mb-3 overflow-x-auto">
            <div className="flex-1 text-center"><p className="text-2xl font-bold text-indigo-700">{intransitData.length}</p><p className="text-[9px] text-indigo-500 font-semibold uppercase">Total In-Transit</p></div>
            <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />
            {[
              { key: 'today', label: "Today's Appt", d: apptData.today, color: 'emerald', icon: CalendarCheck },
              { key: 'future', label: 'Appt Booked', d: apptData.future, color: 'blue', icon: Calendar },
              { key: 'prepull', label: 'Prepull Needed', d: apptData.prepull, color: 'amber', icon: CalendarClock },
              { key: 'pending', label: 'Appt Pending', d: apptData.pending, color: 'red', icon: CalendarX },
            ].map((stage, i) => {
              const Icon = stage.icon;
              const pct = intransitData.length > 0 ? percent(stage.d.length, intransitData.length) : 0;
              const ct = { emerald: 'text-emerald-700', blue: 'text-blue-700', amber: 'text-amber-700', red: 'text-red-700' };
              const cb = { emerald: 'bg-emerald-100 border-emerald-200', blue: 'bg-blue-100 border-blue-200', amber: 'bg-amber-100 border-amber-200', red: 'bg-red-100 border-red-200' };
              const isActive = apptCat === stage.key;
              return (
                <React.Fragment key={stage.key}>
                  {i > 0 && <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                  <button onClick={() => { setApptCat(stage.key); setExpPlatform(null); }}
                    className={`flex-1 min-w-[100px] p-2.5 rounded-xl border ${isActive ? 'ring-2 ring-indigo-400 shadow-lg' : ''} ${cb[stage.color]} hover:shadow-md transition-all text-center`}>
                    <Icon className={`w-4 h-4 mx-auto mb-1 ${ct[stage.color]}`} />
                    <p className={`text-lg font-bold ${ct[stage.color]}`}>{stage.d.length}</p>
                    <p className="text-[8px] text-gray-500 font-semibold uppercase">{stage.label}</p>
                    <p className={`text-[9px] font-semibold ${ct[stage.color]}`}>{pct}%</p>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex items-center gap-3 pt-2 border-t border-indigo-100 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px]"><AlertTriangle className="w-3 h-3 text-red-500" /><span className="text-gray-600">EDD Breached:</span><span className="font-bold text-red-600 cursor-pointer underline" onClick={() => setDrillDown({ title: 'EDD Breached', data: intransitData.filter(r => r.eddBreached) })}>{intransitData.filter(r => r.eddBreached).length}</span></div>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5 text-[10px]"><Clock className="w-3 h-3 text-purple-500" /><span className="text-gray-600">Avg Age:</span><span className="font-bold text-purple-700">{avgAge}d</span></div>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5 text-[10px]"><ShieldAlert className="w-3 h-3 text-red-500" /><span className="text-gray-600">Critical (30+d):</span><span className="font-bold text-red-600 cursor-pointer underline" onClick={() => setDrillDown({ title: '30+ Days Critical', data: intransitData.filter(r => r.ageBucket === '30+ Days') })}>{bucketCounts['30+ Days']}</span></div>
          </div>
        </div>

        {/* Category KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {APPT_CATS.map(cat => {
            const Icon = cat.icon; const count = apptData[cat.key].length; const active = apptCat === cat.key;
            const colorMap = { emerald:'from-emerald-500 to-green-600', red:'from-red-500 to-rose-600', amber:'from-amber-500 to-orange-600', blue:'from-blue-500 to-indigo-600' };
            const lightMap = { emerald:'border-emerald-200 bg-emerald-50', red:'border-red-200 bg-red-50', amber:'border-amber-200 bg-amber-50', blue:'border-blue-200 bg-blue-50' };
            const textMap = { emerald:'text-emerald-700', red:'text-red-700', amber:'text-amber-700', blue:'text-blue-700' };
            return (
              <button key={cat.key} onClick={() => { setApptCat(cat.key); setExpPlatform(null); }}
                className={`p-4 rounded-xl border text-left transition-all ${active ? `bg-gradient-to-br ${colorMap[cat.color]} text-white shadow-lg` : `${lightMap[cat.color]} hover:shadow-md`}`}>
                <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${active ? 'text-white' : textMap[cat.color]}`} /><span className={`text-[10px] font-bold uppercase ${active ? 'text-white/80' : textMap[cat.color]}`}>{cat.label}</span></div>
                <p className={`text-2xl font-bold ${active ? 'text-white' : textMap[cat.color]}`}>{count.toLocaleString('en-IN')}</p>
                <p className={`text-[9px] mt-0.5 ${active ? 'text-white/60' : 'text-gray-400'}`}>{percent(count, intransitData.length)}% of in-transit</p>
              </button>
            );
          })}
        </div>

        {/* Description banner */}
        {apptCat === 'pending' && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] text-red-800"><strong>Appointment Pending</strong> — In-transit shipments with no appointment booked (NA / blank / No slot). Pending days = booking date to today.</div>}
        {apptCat === 'prepull' && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800"><strong>Prepull Required</strong> — Appointment date is 5+ days after EDD. These need earlier appointment slots (prepull).</div>}
        {apptCat === 'today' && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[11px] text-emerald-800"><strong>Today's Appointments</strong> — Shipments with appointment scheduled for today. Ensure delivery execution.</div>}
        {apptCat === 'future' && <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-800"><strong>Future Appointments</strong> — Shipments with valid future appointment dates. Monitor for on-time delivery.</div>}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="chart-container"><BarChart title={`${APPT_CATS.find(c=>c.key===apptCat)?.label} by Platform`} labels={apptPlatforms.slice(0,10).map(p=>p.platform)} datasets={[{label:'Count',data:apptPlatforms.slice(0,10).map(p=>p.count),color:apptCat==='pending'?'#EF4444':apptCat==='prepull'?'#F59E0B':apptCat==='today'?'#10B981':'#3B82F6'}]} height={200} /></div>
          <div className="chart-container"><BarChart title="Aging Bucket" labels={Object.keys(apptAgeBuckets)} datasets={[{label:'Count',data:Object.values(apptAgeBuckets),backgroundColor:['#10B981','#F59E0B','#F97316','#EF4444']}]} height={200} /></div>
          <div className="chart-container"><PieChart title="By Courier" labels={apptCouriers.slice(0,6).map(c=>c.courier)} data={apptCouriers.slice(0,6).map(c=>c.count)} height={200} /></div>
        </div>

        {/* Platform + Courier Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Platform Breakdown</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Platform</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Count</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Avg Age</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">% Share</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {apptPlatforms.map(p => (
                  <tr key={p.platform} className="hover:bg-gray-50 cursor-pointer" onClick={()=>setDrillDown({title:`${p.platform} — ${APPT_CATS.find(c=>c.key===apptCat)?.label}`,data:p.rows})}>
                    <td className="px-3 py-2 font-medium text-gray-800">{p.platform}</td>
                    <td className="px-3 py-2 text-right text-gray-600 underline">{p.count}</td>
                    <td className="px-3 py-2 text-right"><span className={`font-semibold ${ageSev(p.avgAge).text}`}>{p.avgAge}d</span></td>
                    <td className="px-3 py-2 text-right text-gray-500">{percent(p.count, activeApptData.length)}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Courier Breakdown</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Courier</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Count</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Avg Age</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">% Share</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {apptCouriers.map(c => (
                  <tr key={c.courier} className="hover:bg-gray-50 cursor-pointer" onClick={()=>setDrillDown({title:`${c.courier} — ${APPT_CATS.find(ct=>ct.key===apptCat)?.label}`,data:c.rows})}>
                    <td className="px-3 py-2 font-medium text-gray-800">{c.courier}</td>
                    <td className="px-3 py-2 text-right text-gray-600 underline">{c.count}</td>
                    <td className="px-3 py-2 text-right"><span className={`font-semibold ${ageSev(c.avgAge).text}`}>{c.avgAge}d</span></td>
                    <td className="px-3 py-2 text-right text-gray-500">{percent(c.count, activeApptData.length)}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>

        <DataTable data={activeApptData} columns={APPT_COLS} exportFilename={`appt-${apptCat}`} pageSize={25} />
      </div>)}

      {/* Drill-down Modal */}
      {drillDown && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">{drillDown.title} <span className="text-gray-400 font-normal">({drillDown.data.length})</span></h3>
              <button onClick={() => setDrillDown(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4"><DataTable data={drillDown.data} columns={AGED_COLS} exportFilename="aging-drilldown" pageSize={25} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
