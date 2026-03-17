import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import KPICard from '../components/KPICard';
import { BarChart, LineChart, PieChart, DoughnutChart } from '../components/Charts';
import DataTable from '../components/DataTable';
import {
  Package, Truck, CheckCircle, RotateCcw, AlertTriangle, Clock,
  IndianRupee, FileText, Eye, TrendingUp, XCircle, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import {
  isInTransit, isOFD, isDelivered, isPartialDelivered, isRTO,
  isRTODelivered, isLost, safeParseDate, daysBetween, getAgeBucket,
  percent, groupBy, currency, formatDate,
} from '../utils/index';

const VIEWS = ['Overview', 'In-Transit', 'Appointment', 'Aged PO', 'RTO Analysis'];

/* Drill-down detail columns */
const DRILL_COLS = [
  { key: 'awbNo', label: 'AWB No' },
  { key: 'invoiceNo', label: 'Invoice No' },
  { key: 'vendor', label: 'Courier' },
  { key: 'platform', label: 'Platform' },
  { key: 'destination', label: 'Destination' },
  { key: 'status', label: 'Status' },
  { key: 'bookingDate', label: 'Booking Date', render: (v) => formatDate(v) },
  { key: 'deliveryDate', label: 'Delivery Date', render: (v) => formatDate(v) },
  { key: 'failureRemarks', label: 'Failure Remarks' },
  { key: 'zone', label: 'Zone' },
];

/* Filter out unknown / empty platform rows for charts & tables */
function isKnownPlatform(p) {
  if (!p) return false;
  const lc = p.toLowerCase();
  return lc !== '' && lc !== 'unknown' && lc !== 'na' && lc !== '-';
}

const MABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Dashboard() {
  const { data } = useData();
  const [view, setView] = useState('Overview');
  const [drillDown, setDrillDown] = useState(null);
  const [expandedPlatform, setExpandedPlatform] = useState(null);

  const stats = useMemo(() => {
    const total = data.length;
    const inTransit = data.filter((r) => isInTransit(r.status)).length;
    const ofd = data.filter((r) => isOFD(r.status)).length;
    const delivered = data.filter((r) => isDelivered(r.status) || isPartialDelivered(r.status)).length;
    const rto = data.filter((r) => isRTO(r.status)).length;
    const rtoDelivered = data.filter((r) => isRTODelivered(r.status)).length;
    const lost = data.filter((r) => isLost(r.status)).length;
    const withAppointment = data.filter((r) => safeParseDate(r.appointmentDate)).length;
    const withoutAppointment = total - withAppointment;
    const deliveryPercent = percent(delivered, total);
    const rtoPercent = percent(rto, total);
    const podCount = data.filter((r) => r.pod && r.pod.toLowerCase() !== '' && r.pod !== '-').length;
    const podPercent = percent(podCount, delivered || 1);
    const totalCost = data.reduce((sum, r) => sum + (parseFloat(r.logisticsCost) || 0), 0);

    const tatVals = data
      .filter((r) => safeParseDate(r.bookingDate) && safeParseDate(r.deliveryDate))
      .map((r) => daysBetween(r.bookingDate, r.deliveryDate))
      .filter((d) => d !== null && d >= 0);
    const avgTAT = tatVals.length ? Math.round((tatVals.reduce((a, b) => a + b, 0) / tatVals.length) * 10) / 10 : 0;

    const ageBuckets = { '0-3 Days': 0, '4-7 Days': 0, '8-15 Days': 0, '15+ Days': 0 };
    data.forEach((r) => {
      const bd = safeParseDate(r.bookingDate);
      if (bd) { const age = Math.floor((new Date() - bd) / 86400000); const b = getAgeBucket(age); if (ageBuckets[b] !== undefined) ageBuckets[b]++; }
    });

    /* Platform stats — only known platforms */
    const knownData = data.filter((r) => isKnownPlatform(r.platform));
    const platformGroups = groupBy(knownData, 'platform');
    const platformStats = Object.entries(platformGroups)
      .map(([platform, rows]) => {
        const del = rows.filter((r) => isDelivered(r.status) || isPartialDelivered(r.status)).length;
        const rtoC = rows.filter((r) => isRTO(r.status)).length;
        const failedRows = rows.filter((r) => !(isDelivered(r.status) || isPartialDelivered(r.status)));
        const remarkCounts = {};
        failedRows.forEach((r) => {
          const rm = (r.failureRemarks || '').trim();
          const key = rm && rm !== 'NA' && rm !== '-' ? rm : 'No remark available';
          remarkCounts[key] = (remarkCounts[key] || 0) + 1;
        });
        return {
          platform, total: rows.length, delivered: del, rto: rtoC,
          lost: rows.filter((r) => isLost(r.status)).length,
          inTransit: rows.filter((r) => isInTransit(r.status)).length,
          cost: rows.reduce((s, r) => s + (parseFloat(r.logisticsCost) || 0), 0),
          delPercent: percent(del, rows.length),
          failureReasons: Object.entries(remarkCounts).sort((a, b) => b[1] - a[1]),
          allRows: rows,
        };
      })
      .sort((a, b) => b.total - a.total);

    /* Zone stats — skip empty zones */
    const zoneGroups = groupBy(knownData, 'zone');
    const zoneStats = Object.entries(zoneGroups)
      .filter(([z]) => z && z !== 'Unknown' && z !== '')
      .map(([zone, rows]) => ({ zone, total: rows.length, delivered: rows.filter((r) => isDelivered(r.status) || isPartialDelivered(r.status)).length }));

    /* Monthly trend — chronological sort */
    const monthGroups = groupBy(data, 'month');
    const monthStats = Object.entries(monthGroups)
      .filter(([m]) => m && m.includes("'"))
      .map(([month, rows]) => ({
        month, total: rows.length,
        delivered: rows.filter((r) => isDelivered(r.status) || isPartialDelivered(r.status)).length,
        rto: rows.filter((r) => isRTO(r.status)).length,
        sortKey: (() => { const yr = parseInt('20' + month.slice(4), 10) || 2000; return yr * 100 + MABBR.indexOf(month.slice(0, 3)); })(),
      }))
      .sort((a, b) => a.sortKey - b.sortKey);

    /* Courier stats — skip empty */
    const courierGroups = groupBy(knownData, 'vendor');
    const courierStats = Object.entries(courierGroups)
      .filter(([c]) => c && c !== '' && c.toLowerCase() !== 'unknown')
      .map(([courier, rows]) => ({ courier, total: rows.length, delivered: rows.filter((r) => isDelivered(r.status) || isPartialDelivered(r.status)).length }))
      .sort((a, b) => b.total - a.total);

    return { total, inTransit, ofd, delivered, rto, rtoDelivered, lost, withAppointment, withoutAppointment, deliveryPercent, rtoPercent, podCount, podPercent, totalCost, avgTAT, ageBuckets, platformStats, zoneStats, monthStats, courierStats };
  }, [data]);

  const openDrill = (title, rows) => setDrillDown({ title, rows });
  const closeDrill = () => setDrillDown(null);

  const failurePlatforms = useMemo(() => stats.platformStats.filter((p) => p.delPercent < 100 && p.total > 0), [stats.platformStats]);

  return (
    <div className="space-y-4">
      {/* ─── Drill-down Modal ─────────────────────────────────── */}
      {drillDown && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 bg-black/40" onClick={closeDrill}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[82vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
              <h3 className="text-[12px] font-semibold text-gray-800">{drillDown.title} <span className="text-gray-400 font-normal">({drillDown.rows.length.toLocaleString('en-IN')} records)</span></h3>
              <button onClick={closeDrill} className="p-1 hover:bg-gray-200 rounded-lg"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="overflow-auto max-h-[calc(82vh-44px)]">
              <DataTable data={drillDown.rows} columns={DRILL_COLS} pageSize={50} exportFilename={drillDown.title.replace(/\s+/g, '_')} />
            </div>
          </div>
        </div>
      )}

      {/* View Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {VIEWS.map((v) => (<button key={v} onClick={() => setView(v)} className={`tab-btn ${view === v ? 'tab-btn-active' : 'tab-btn-inactive'}`}>{v}</button>))}
      </div>

      {/* KPI Row 1 — clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <div className="cursor-pointer" onClick={() => openDrill('All Shipments', data)}><KPICard title="Total Shipments" value={stats.total} icon={Package} color="blue" /></div>
        <div className="cursor-pointer" onClick={() => openDrill('In-Transit', data.filter((r) => isInTransit(r.status)))}><KPICard title="In-Transit" value={stats.inTransit} icon={Truck} color="indigo" /></div>
        <div className="cursor-pointer" onClick={() => openDrill('Delivered', data.filter((r) => isDelivered(r.status) || isPartialDelivered(r.status)))}><KPICard title="Delivered" value={stats.delivered} icon={CheckCircle} color="green" subtitle={`${stats.deliveryPercent}%`} /></div>
        <div className="cursor-pointer" onClick={() => openDrill('RTO Shipments', data.filter((r) => isRTO(r.status)))}><KPICard title="RTO" value={stats.rto} icon={RotateCcw} color="red" subtitle={`${stats.rtoPercent}%`} /></div>
        <div className="cursor-pointer" onClick={() => openDrill('Lost Shipments', data.filter((r) => isLost(r.status)))}><KPICard title="Lost" value={stats.lost} icon={AlertTriangle} color="yellow" /></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <KPICard title="Avg TAT" value={stats.avgTAT} suffix="days" icon={Clock} color="purple" />
        <div className="cursor-pointer" onClick={() => openDrill('OFD Shipments', data.filter((r) => isOFD(r.status)))}><KPICard title="OFD" value={stats.ofd} icon={Truck} color="cyan" /></div>
        <KPICard title="Total Cost" value={currency(stats.totalCost)} icon={IndianRupee} color="orange" />
        <KPICard title="POD Visibility" value={`${stats.podPercent}%`} icon={FileText} color="green" />
        <div className="cursor-pointer" onClick={() => openDrill('With Appointment', data.filter((r) => safeParseDate(r.appointmentDate)))}><KPICard title="With Appointment" value={stats.withAppointment} icon={Eye} color="blue" /></div>
      </div>

      {view === 'Overview' && (<>
        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container">
            <BarChart title="Delivery Performance by Platform" labels={stats.platformStats.slice(0, 12).map((p) => p.platform)} datasets={[
              { label: 'Delivered', data: stats.platformStats.slice(0, 12).map((p) => p.delivered), color: '#10B981' },
              { label: 'RTO', data: stats.platformStats.slice(0, 12).map((p) => p.rto), color: '#EF4444' },
            ]} options={{ plugins: { legend: { display: true, position: 'top', labels: { font: { size: 10 }, padding: 10 } } } }} height={200} />
          </div>
          <div className="chart-container">
            <DoughnutChart title="Shipment Status Distribution" labels={['In-Transit', 'OFD', 'Delivered', 'RTO', 'Lost', 'Other']} data={[
              stats.inTransit, stats.ofd, stats.delivered, stats.rto, stats.lost,
              Math.max(0, stats.total - stats.inTransit - stats.ofd - stats.delivered - stats.rto - stats.lost),
            ]} height={200} />
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container">
            <LineChart title="Monthly Delivery & RTO Trend" labels={stats.monthStats.map((m) => m.month)} datasets={[
              { label: 'Delivered', data: stats.monthStats.map((m) => m.delivered), color: '#10B981', fill: true },
              { label: 'RTO', data: stats.monthStats.map((m) => m.rto), color: '#EF4444', fill: true },
            ]} height={200} />
          </div>
          <div className="chart-container">
            <BarChart title="Age Bucket Distribution" labels={Object.keys(stats.ageBuckets)} datasets={[
              { label: 'Shipments', data: Object.values(stats.ageBuckets), color: '#6366F1' },
            ]} height={200} />
          </div>
        </div>

        {/* Charts Row 3 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container">
            <BarChart title="Zone-wise Delivery Performance" labels={stats.zoneStats.map((z) => z.zone)} datasets={[
              { label: 'Total', data: stats.zoneStats.map((z) => z.total), color: '#3B82F6' },
              { label: 'Delivered', data: stats.zoneStats.map((z) => z.delivered), color: '#10B981' },
            ]} options={{ plugins: { legend: { display: true, position: 'top', labels: { font: { size: 10 }, padding: 10 } } } }} height={200} />
          </div>
          <div className="chart-container">
            <BarChart title="Logistics Cost by Platform" labels={stats.platformStats.slice(0, 10).map((p) => p.platform)} datasets={[
              { label: 'Cost', data: stats.platformStats.slice(0, 10).map((p) => p.cost), color: '#F59E0B' },
            ]} height={200} />
          </div>
        </div>

        {/* ── Top Platform Summary — clickable drill-down ────── */}
        <div className="bg-white rounded-xl border border-gray-100/80 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-blue-500" /> Top Platform Summary
              <span className="text-[9px] text-gray-400 ml-1">(click row to drill down)</span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Platform</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Delivered</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">RTO</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">In-Transit</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Del %</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Cost</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {stats.platformStats.slice(0, 15).map((p) => (
                  <tr key={p.platform} onClick={() => openDrill(`${p.platform} — All Shipments`, p.allRows)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                    <td className="px-3 py-2 font-medium text-blue-700 underline underline-offset-2 decoration-blue-200">{p.platform}</td>
                    <td className="px-3 py-2 text-gray-600">{p.total.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2"><span className="text-emerald-600 font-medium">{p.delivered.toLocaleString('en-IN')}</span></td>
                    <td className="px-3 py-2"><span className="text-red-500 font-medium">{p.rto.toLocaleString('en-IN')}</span></td>
                    <td className="px-3 py-2 text-gray-600">{p.inTransit.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2"><span className={`badge ${p.delPercent >= 80 ? 'badge-green' : p.delPercent >= 50 ? 'badge-yellow' : 'badge-red'}`}>{p.delPercent}%</span></td>
                    <td className="px-3 py-2 text-gray-600">{currency(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Failure Reasons — platforms below 100% ──────────── */}
        {failurePlatforms.length > 0 && (
          <div className="bg-white rounded-xl border border-red-100/80 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(239,68,68,0.06)' }}>
            <div className="px-3 py-2 border-b border-red-100 bg-red-50/40">
              <h3 className="text-[11px] font-semibold text-red-700 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5 text-red-500" /> Failure Reasons — Platforms below 100% Delivery
                <span className="text-[9px] text-red-400 ml-1">(click to expand reasons, click reason for detail)</span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-red-50">
                  <th className="px-2 py-2 w-6"></th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Platform</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Delivered</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Not Delivered</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Del %</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Top Failure Reason</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {failurePlatforms.slice(0, 20).map((p) => {
                    const isExp = expandedPlatform === p.platform;
                    const notDel = p.total - p.delivered;
                    const topReason = p.failureReasons.length > 0 ? p.failureReasons[0][0] : '-';
                    return (
                      <React.Fragment key={p.platform}>
                        <tr onClick={() => setExpandedPlatform(isExp ? null : p.platform)} className="hover:bg-red-50/30 cursor-pointer transition-colors">
                          <td className="px-2 py-2 text-gray-400">{isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</td>
                          <td className="px-3 py-2 font-medium text-gray-800">{p.platform}</td>
                          <td className="px-3 py-2 text-gray-600">{p.total.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2 text-emerald-600 font-medium">{p.delivered.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2 text-red-500 font-medium">{notDel.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2"><span className={`badge ${p.delPercent >= 80 ? 'badge-green' : p.delPercent >= 50 ? 'badge-yellow' : 'badge-red'}`}>{p.delPercent}%</span></td>
                          <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={topReason}>{topReason}</td>
                        </tr>
                        {isExp && p.failureReasons.length > 0 && (
                          <tr><td colSpan={7} className="px-6 py-2 bg-red-50/20">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                              {p.failureReasons.map(([reason, count]) => (
                                <div key={reason}
                                  className="flex items-center justify-between text-[10px] py-0.5 px-2 rounded hover:bg-red-100/40 cursor-pointer transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const rows = p.allRows.filter((r) => {
                                      const rm = (r.failureRemarks || '').trim();
                                      if (reason === 'No remark available') return !rm || rm === 'NA' || rm === '-';
                                      return rm === reason;
                                    });
                                    openDrill(`${p.platform} — ${reason}`, rows);
                                  }}>
                                  <span className="text-gray-700 truncate mr-2">{reason}</span>
                                  <span className="text-red-600 font-semibold flex-shrink-0">{count}</span>
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
        )}
      </>)}

      {view === 'In-Transit' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container"><BarChart title="In-Transit by Platform" labels={stats.platformStats.filter((p) => p.inTransit > 0).slice(0, 12).map((p) => p.platform)} datasets={[{ label: 'In-Transit', data: stats.platformStats.filter((p) => p.inTransit > 0).slice(0, 12).map((p) => p.inTransit), color: '#6366F1' }]} height={220} /></div>
          <div className="chart-container"><BarChart title="Courier-wise Shipments" labels={stats.courierStats.slice(0, 10).map((c) => c.courier)} datasets={[{ label: 'Shipments', data: stats.courierStats.slice(0, 10).map((c) => c.total), color: '#3B82F6' }]} height={220} /></div>
        </div>
      )}

      {view === 'Appointment' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container"><PieChart title="Appointment Status" labels={['With Appointment', 'Without Appointment']} data={[stats.withAppointment, stats.withoutAppointment]} height={200} /></div>
          <div className="kpi-card">
            <h3 className="text-[11px] font-semibold text-gray-700 mb-3">Appointment Summary</h3>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center"><span className="text-[11px] text-gray-600">Appointment Booked</span><span className="text-sm font-semibold">{stats.withAppointment.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between items-center"><span className="text-[11px] text-gray-600">Non-Appointment</span><span className="text-sm font-semibold">{stats.withoutAppointment.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-100"><span className="text-[11px] text-gray-600">Appointment %</span><span className="text-sm font-bold text-blue-600">{percent(stats.withAppointment, stats.total)}%</span></div>
            </div>
          </div>
        </div>
      )}

      {view === 'Aged PO' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container"><BarChart title="Age Bucket Analysis" labels={Object.keys(stats.ageBuckets)} datasets={[{ label: 'Count', data: Object.values(stats.ageBuckets), color: '#8B5CF6' }]} height={200} /></div>
          <div className="kpi-card">
            <h3 className="text-[11px] font-semibold text-gray-700 mb-3">Aging Summary</h3>
            <div className="space-y-2.5">
              {Object.entries(stats.ageBuckets).map(([bucket, count]) => (
                <div key={bucket} className="flex justify-between items-center">
                  <span className="text-[11px] text-gray-600">{bucket}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${percent(count, stats.total)}%` }} /></div>
                    <span className="text-[11px] font-semibold w-10 text-right">{count.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'RTO Analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container"><DoughnutChart title="RTO Distribution" labels={['RTO Delivered', 'RTO In-Transit']} data={[stats.rtoDelivered, Math.max(0, stats.rto - stats.rtoDelivered)]} height={200} /></div>
          <div className="chart-container"><BarChart title="RTO by Platform" labels={stats.platformStats.filter((p) => p.rto > 0).slice(0, 12).map((p) => p.platform)} datasets={[{ label: 'RTO', data: stats.platformStats.filter((p) => p.rto > 0).slice(0, 12).map((p) => p.rto), color: '#EF4444' }]} height={200} /></div>
        </div>
      )}
    </div>
  );
}
