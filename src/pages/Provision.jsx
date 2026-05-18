import React, { useState, useMemo, useCallback } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart, LineChart, PieChart, DoughnutChart } from '../components/Charts';
import {
  IndianRupee, Calendar, Building2, Truck, FileText, ChevronRight, ChevronDown,
  TrendingUp, TrendingDown, X, Eye, Brain, AlertTriangle, Download, Mail, Share2,
  Upload, Lock, Unlock, CheckCircle,
} from 'lucide-react';
import { groupBy, currency, percent, safeParseDate, formatDate, COLORS, isDelivered, isPartialDelivered, isRTO } from '../utils/index';

const TABS = [
  { key: 'provision', label: 'Provision Summary', icon: IndianRupee },
  { key: 'making', label: 'Provision Making', icon: Upload },
  { key: 'billing', label: 'Billing & Invoices', icon: FileText },
  { key: 'share', label: 'Share & Communicate', icon: Share2 },
];

const MABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function sortMonths(arr) { return [...arr].sort((a, b) => { const aI = MABBR.indexOf(a.slice(0,3)), bI = MABBR.indexOf(b.slice(0,3)); const aY = parseInt('20'+a.slice(4))||0, bY = parseInt('20'+b.slice(4))||0; return (aY*100+aI)-(bY*100+bI); }); }

const PROV_KEY = 'anveshan-provision-entries';
const BILL_KEY = 'anveshan-billing';

export default function Provision() {
  const { data } = useData();
  const [activeTab, setActiveTab] = useState('provision');
  const [expPlatform, setExpPlatform] = useState(null);
  const [drillDown, setDrillDown] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState('');

  /* Provision Making state */
  const [entries, setEntries] = useState(() => { try { return JSON.parse(localStorage.getItem(PROV_KEY) || '[]'); } catch { return []; } });
  const [newEntry, setNewEntry] = useState({ channel: '', type: 'Forward', courier: '', month: '', amount: '', shipments: '', remarks: '' });
  const [uploadData, setUploadData] = useState(null);

  /* Share state */
  const [shareMonth, setShareMonth] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [mailLang, setMailLang] = useState('English');
  const [attachData, setAttachData] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  /* Billing state */
  const [invoices, setInvoices] = useState(() => { try { return JSON.parse(localStorage.getItem(BILL_KEY) || '[]'); } catch { return []; } });
  const [newInv, setNewInv] = useState({ client: '', platform: '', month: '', amount: '', invoiceNo: '', status: 'Pending', notes: '' });

  /* ═══ Compute provision from shipment data ═══ */
  const provisionData = useMemo(() => {
    const cutoff = new Date(new Date().getFullYear(), new Date().getMonth() - 12, 1);
    return data.filter(r => {
      const bd = safeParseDate(r.bookingDate);
      return (!bd || bd >= cutoff) && (parseFloat(r.logisticsCost) > 0);
    }).map(r => ({
      ...r,
      costNum: parseFloat(r.logisticsCost) || 0,
      invoiceNum: parseFloat(r.invoiceValue) || 0,
      isRTO: isRTO(r.status),
      isDel: isDelivered(r.status) || isPartialDelivered(r.status),
    }));
  }, [data]);

  /* Monthly breakdown */
  const monthlyData = useMemo(() => {
    const byMonth = groupBy(provisionData, 'month');
    const months = sortMonths(Object.keys(byMonth).filter(m => m && m.includes("'")));
    return months.map((m, idx) => {
      const rows = byMonth[m];
      const totalCost = rows.reduce((s, r) => s + r.costNum, 0);
      const totalInv = rows.reduce((s, r) => s + r.invoiceNum, 0);
      const fwdCost = rows.filter(r => !r.isRTO).reduce((s, r) => s + r.costNum, 0);
      const rtoCost = rows.filter(r => r.isRTO).reduce((s, r) => s + r.costNum, 0);
      const costPct = totalInv > 0 ? (totalCost / totalInv * 100) : 0;
      const prev = idx > 0 ? byMonth[months[idx - 1]] : null;
      const prevCost = prev ? prev.reduce((s, r) => s + r.costNum, 0) : null;
      const mom = prevCost ? ((totalCost - prevCost) / prevCost * 100) : null;
      return { month: m, totalCost, totalInv, fwdCost, rtoCost, costPct, count: rows.length, mom, rows };
    });
  }, [provisionData]);

  /* Platform breakdown */
  const platformData = useMemo(() => {
    const byPlatform = groupBy(provisionData, 'platform');
    return Object.entries(byPlatform).filter(([k]) => k && k !== '').map(([platform, rows]) => {
      const totalCost = rows.reduce((s, r) => s + r.costNum, 0);
      const totalInv = rows.reduce((s, r) => s + r.invoiceNum, 0);
      const fwdCost = rows.filter(r => !r.isRTO).reduce((s, r) => s + r.costNum, 0);
      const rtoCost = rows.filter(r => r.isRTO).reduce((s, r) => s + r.costNum, 0);
      const costPct = totalInv > 0 ? (totalCost / totalInv * 100) : 0;
      /* Courier breakdown */
      const courierG = groupBy(rows, 'vendor');
      const couriers = Object.entries(courierG).filter(([k]) => k).map(([c, cr]) => ({
        courier: c, cost: cr.reduce((s, r) => s + r.costNum, 0), count: cr.length
      })).sort((a, b) => b.cost - a.cost);
      /* Monthly trend */
      const monthG = groupBy(rows, 'month');
      const trend = sortMonths(Object.keys(monthG).filter(m => m && m.includes("'"))).map(m => ({
        month: m, cost: monthG[m].reduce((s, r) => s + r.costNum, 0), count: monthG[m].length
      }));
      return { platform, totalCost, totalInv, fwdCost, rtoCost, costPct, count: rows.length, couriers, trend, rows };
    }).sort((a, b) => b.totalCost - a.totalCost);
  }, [provisionData]);

  /* Courier breakdown */
  const courierData = useMemo(() => {
    const byCourier = groupBy(provisionData, 'vendor');
    return Object.entries(byCourier).filter(([k]) => k && k !== '').map(([courier, rows]) => {
      const totalCost = rows.reduce((s, r) => s + r.costNum, 0);
      return { courier, totalCost, count: rows.length, rows };
    }).sort((a, b) => b.totalCost - a.totalCost);
  }, [provisionData]);

  /* Totals */
  const totals = useMemo(() => {
    const totalCost = provisionData.reduce((s, r) => s + r.costNum, 0);
    const totalInv = provisionData.reduce((s, r) => s + r.invoiceNum, 0);
    const fwdCost = provisionData.filter(r => !r.isRTO).reduce((s, r) => s + r.costNum, 0);
    const rtoCost = provisionData.filter(r => r.isRTO).reduce((s, r) => s + r.costNum, 0);
    return { totalCost, totalInv, costPct: totalInv > 0 ? (totalCost / totalInv * 100) : 0, fwdCost, rtoCost, count: provisionData.length };
  }, [provisionData]);

  /* Filtered by selected month */
  const monthFiltered = useMemo(() => {
    if (!selectedMonth) return provisionData;
    return provisionData.filter(r => r.month === selectedMonth);
  }, [provisionData, selectedMonth]);

  const addInvoice = useCallback((inv) => {
    setInvoices(prev => { const next = [...prev, { ...inv, id: Date.now(), createdAt: new Date().toISOString() }]; localStorage.setItem(BILL_KEY, JSON.stringify(next)); return next; });
  }, []);

  const DRILL_COLS = [
    { key: 'awbNo', label: 'AWB No' }, { key: 'invoiceNo', label: 'Invoice No' }, { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' }, { key: 'destination', label: 'City' }, { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) },
    { key: 'logisticsCost', label: 'Cost', render: v => currency(parseFloat(v) || 0) },
    { key: 'invoiceValue', label: 'Invoice Value', render: v => currency(parseFloat(v) || 0) },
    { key: 'zone', label: 'Zone' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map(t => { const Icon = t.icon; return (
          <button key={t.key} onClick={() => setActiveTab(t.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === t.key ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}><Icon className="w-3.5 h-3.5" />{t.label}</button>
        ); })}
        <span className="text-[10px] text-gray-400 ml-auto mt-2">{provisionData.length} records with cost data</span>
      </div>

      {/* ═══ PROVISION SUMMARY ═══ */}
      {activeTab === 'provision' && (<div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <KPICard title="Total Logistics Cost" value={currency(totals.totalCost)} icon={IndianRupee} color="blue" />
          <KPICard title="Forward Cost" value={currency(totals.fwdCost)} icon={Truck} color="green" subtitle={`${percent(totals.fwdCost, totals.totalCost)}%`} />
          <KPICard title="RTO Cost" value={currency(totals.rtoCost)} icon={TrendingDown} color="red" subtitle={`${percent(totals.rtoCost, totals.totalCost)}%`} />
          <KPICard title="Avg Cost %" value={`${totals.costPct.toFixed(1)}%`} icon={IndianRupee} color="purple" />
          <KPICard title="Platforms" value={platformData.length} icon={Building2} color="indigo" />
          <KPICard title="Couriers" value={courierData.length} icon={Truck} color="cyan" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="chart-container"><LineChart title="Monthly Cost Trend" labels={monthlyData.map(m => m.month)} datasets={[{ label: 'Total Cost', data: monthlyData.map(m => Math.round(m.totalCost)), color: '#3B82F6', fill: true }, { label: 'RTO Cost', data: monthlyData.map(m => Math.round(m.rtoCost)), color: '#EF4444' }]} height={200} /></div>
          <div className="chart-container"><BarChart title="Platform-wise Cost (Top 10)" labels={platformData.slice(0,10).map(p => p.platform)} datasets={[{ label: 'Cost', data: platformData.slice(0,10).map(p => Math.round(p.totalCost)), color: '#6366F1' }]} height={200} /></div>
          <div className="chart-container"><DoughnutChart title="Forward vs RTO Cost" labels={['Forward', 'RTO']} data={[Math.round(totals.fwdCost), Math.round(totals.rtoCost)]} height={200} /></div>
        </div>

        {/* Monthly Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Month-on-Month Provision</h3><p className="text-[10px] text-gray-400">Click any month for detailed breakdown</p></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Month</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Shipments</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">Total Cost</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">Forward</th>
              <th className="px-3 py-2 text-right font-semibold text-red-500 uppercase">RTO</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Cost %</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-400 uppercase">MoM</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Trend</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {monthlyData.map(m => (
                <tr key={m.month} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDrillDown({ title: `${m.month} — Cost Details`, data: m.rows })}>
                  <td className="px-3 py-2 font-medium text-gray-800">{m.month}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{m.count.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2 text-right text-blue-700 font-semibold">{currency(m.totalCost)}</td>
                  <td className="px-3 py-2 text-right text-emerald-600">{currency(m.fwdCost)}</td>
                  <td className="px-3 py-2 text-right text-red-500">{currency(m.rtoCost)}</td>
                  <td className="px-3 py-2 text-right"><span className={`font-semibold ${m.costPct > 12 ? 'text-red-600' : m.costPct > 8 ? 'text-amber-600' : 'text-emerald-600'}`}>{m.costPct.toFixed(1)}%</span></td>
                  <td className="px-3 py-2 text-center">{m.mom != null ? <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${m.mom > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{m.mom > 0 ? '+' : ''}{m.mom.toFixed(1)}%</span> : '—'}</td>
                  <td className="px-3 py-2"><div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${m.costPct > 12 ? 'bg-red-500' : m.costPct > 8 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, m.costPct * 5)}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>

        {/* Platform Cost Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Platform-wise Cost Provision</h3><p className="text-[10px] text-gray-400">Click platform for courier & monthly drill-down</p></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Platform</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Shipments</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">Total Cost</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">Forward</th>
              <th className="px-3 py-2 text-right font-semibold text-red-500 uppercase">RTO</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Cost %</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">% Share</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {platformData.map(p => {
                const isExp = expPlatform === p.platform;
                return (
                  <React.Fragment key={p.platform}>
                    <tr className={`hover:bg-gray-50 cursor-pointer ${isExp ? 'bg-indigo-50/50' : ''}`} onClick={() => setExpPlatform(isExp ? null : p.platform)}>
                      <td className="px-3 py-2 font-medium text-indigo-700 flex items-center gap-1">{isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{p.platform}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{p.count.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-right text-blue-700 font-semibold cursor-pointer underline" onClick={e => { e.stopPropagation(); setDrillDown({ title: `${p.platform} — All Cost`, data: p.rows }); }}>{currency(p.totalCost)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{currency(p.fwdCost)}</td>
                      <td className="px-3 py-2 text-right text-red-500">{currency(p.rtoCost)}</td>
                      <td className="px-3 py-2 text-right"><span className={`font-semibold ${p.costPct > 12 ? 'text-red-600' : 'text-emerald-600'}`}>{p.costPct.toFixed(1)}%</span></td>
                      <td className="px-3 py-2 text-right text-gray-500">{percent(p.totalCost, totals.totalCost)}%</td>
                    </tr>
                    {isExp && (
                      <tr><td colSpan={7} className="p-0"><div className="bg-indigo-50/20 border-t border-indigo-100 px-4 py-3">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-bold text-indigo-700 mb-1.5">Courier Cost Breakdown</p>
                            <div className="space-y-1">{p.couriers.slice(0, 8).map(c => (
                              <div key={c.courier} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-indigo-100">
                                <span className="text-gray-700">{c.courier}</span>
                                <span className="text-indigo-700 font-semibold">{currency(c.cost)} ({c.count})</span>
                              </div>
                            ))}</div>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-indigo-700 mb-1.5">Monthly Trend</p>
                            <div className="space-y-1">{p.trend.map(t => (
                              <div key={t.month} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-indigo-100">
                                <span className="text-gray-700">{t.month}</span>
                                <span className="text-blue-700 font-semibold">{currency(t.cost)}</span>
                              </div>
                            ))}</div>
                          </div>
                        </div>
                      </div></td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table></div>
        </div>
      </div>)}

      {/* ═══ BILLING & INVOICES ═══ */}
      {activeTab === 'billing' && (<div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-800">
          <strong>Billing Manager</strong> — Track client invoices, attach documents, and manage payment status.
        </div>

        {/* Add Invoice Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Create Invoice Entry</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="block text-[10px] text-gray-500 mb-1">Client / Platform</label><input type="text" value={newInv.client} onChange={e => setNewInv(p => ({ ...p, client: e.target.value }))} className="filter-input w-full text-xs" placeholder="e.g. Blinkit" /></div>
            <div><label className="block text-[10px] text-gray-500 mb-1">Month</label><input type="text" value={newInv.month} onChange={e => setNewInv(p => ({ ...p, month: e.target.value }))} className="filter-input w-full text-xs" placeholder="e.g. Apr'26" /></div>
            <div><label className="block text-[10px] text-gray-500 mb-1">Amount (₹)</label><input type="number" value={newInv.amount} onChange={e => setNewInv(p => ({ ...p, amount: e.target.value }))} className="filter-input w-full text-xs" placeholder="0" /></div>
            <div><label className="block text-[10px] text-gray-500 mb-1">Invoice No</label><input type="text" value={newInv.invoiceNo} onChange={e => setNewInv(p => ({ ...p, invoiceNo: e.target.value }))} className="filter-input w-full text-xs" placeholder="INV-001" /></div>
            <div><label className="block text-[10px] text-gray-500 mb-1">Status</label><select value={newInv.status} onChange={e => setNewInv(p => ({ ...p, status: e.target.value }))} className="filter-select text-xs"><option>Pending</option><option>Sent</option><option>Paid</option><option>Overdue</option></select></div>
            <div className="col-span-2"><label className="block text-[10px] text-gray-500 mb-1">Notes</label><input type="text" value={newInv.notes} onChange={e => setNewInv(p => ({ ...p, notes: e.target.value }))} className="filter-input w-full text-xs" placeholder="Optional notes..." /></div>
            <div className="flex items-end"><button onClick={() => { if (newInv.client && newInv.amount) { addInvoice(newInv); setNewInv({ client: '', platform: '', month: '', amount: '', invoiceNo: '', status: 'Pending', notes: '' }); } }} className="btn-primary text-xs w-full">Add Invoice</button></div>
          </div>
        </div>

        {/* Invoice List */}
        {invoices.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Invoice Tracker ({invoices.length})</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Invoice No</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Client</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Month</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Amount</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Notes</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Created</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[...invoices].reverse().map(inv => {
                  const statusColor = { Pending: 'badge-yellow', Sent: 'badge-blue', Paid: 'badge-green', Overdue: 'badge-red' };
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{inv.invoiceNo || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{inv.client}</td>
                      <td className="px-3 py-2 text-gray-600">{inv.month || '—'}</td>
                      <td className="px-3 py-2 text-right text-blue-700 font-semibold">{currency(parseFloat(inv.amount) || 0)}</td>
                      <td className="px-3 py-2 text-center"><span className={`badge ${statusColor[inv.status] || 'badge-gray'}`}>{inv.status}</span></td>
                      <td className="px-3 py-2 text-gray-500 text-[10px] truncate max-w-[150px]">{inv.notes || '—'}</td>
                      <td className="px-3 py-2 text-gray-400 text-[10px]">{formatDate(inv.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        )}

        {/* Auto-computed provision by platform */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Auto-Computed Provision (from Shipment Data)</h3><p className="text-[10px] text-gray-400">Use this as reference when creating invoices</p></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Platform</th>
              {monthlyData.slice(-4).map(m => <th key={m.month} className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">{m.month}</th>)}
              <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">Total</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {platformData.slice(0, 15).map(p => (
                <tr key={p.platform} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800">{p.platform}</td>
                  {monthlyData.slice(-4).map(m => {
                    const mCost = p.trend.find(t => t.month === m.month)?.cost || 0;
                    return <td key={m.month} className="px-3 py-2 text-right text-gray-600">{mCost > 0 ? currency(mCost) : '—'}</td>;
                  })}
                  <td className="px-3 py-2 text-right text-blue-700 font-semibold">{currency(p.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>)}

      {/* ═══ PROVISION MAKING ═══ */}
      {activeTab === 'making' && (() => {
        const saveEntry = () => {
          if (!newEntry.channel || !newEntry.amount) return;
          const next = [...entries, { ...newEntry, id: Date.now(), createdAt: new Date().toISOString() }];
          setEntries(next);
          localStorage.setItem(PROV_KEY, JSON.stringify(next));
          setNewEntry({ channel: '', type: 'Forward', courier: '', month: '', amount: '', shipments: '', remarks: '' });
        };

        const deleteEntry = (id) => {
          const next = entries.filter(e => e.id !== id);
          setEntries(next);
          localStorage.setItem(PROV_KEY, JSON.stringify(next));
        };

        const entryMonths = [...new Set(entries.map(e => e.month).filter(Boolean))].sort();
        const entryTotal = entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

        /* Handle file upload */
        const handleFileUpload = (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const XLSX = window.XLSX;
              if (XLSX) {
                const wb = XLSX.read(evt.target.result, { type: 'binary' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(ws);
                setUploadData(json);
              }
            } catch (err) { console.error('File parse error:', err); }
          };
          reader.readAsBinaryString(file);
        };

        return (
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-[11px] text-indigo-800">
              <strong>Provision Making</strong> — Create monthly provision entries by channel, courier, and type (Forward/RTO/RTV). Data is saved locally and can be exported.
            </div>

            {/* Entry Form */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Provision Entry</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><label className="block text-[10px] text-gray-500 mb-1">Channel / Platform</label><input type="text" value={newEntry.channel} onChange={e => setNewEntry(p => ({ ...p, channel: e.target.value }))} className="filter-input w-full text-xs" placeholder="e.g. Blinkit" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Type</label><select value={newEntry.type} onChange={e => setNewEntry(p => ({ ...p, type: e.target.value }))} className="filter-select text-xs"><option>Forward</option><option>RTO</option><option>RTV</option><option>B2B</option><option>D2C</option></select></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Courier</label><input type="text" value={newEntry.courier} onChange={e => setNewEntry(p => ({ ...p, courier: e.target.value }))} className="filter-input w-full text-xs" placeholder="e.g. Delhivery" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Month</label><input type="text" value={newEntry.month} onChange={e => setNewEntry(p => ({ ...p, month: e.target.value }))} className="filter-input w-full text-xs" placeholder="e.g. Apr'26" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Amount (₹)</label><input type="number" value={newEntry.amount} onChange={e => setNewEntry(p => ({ ...p, amount: e.target.value }))} className="filter-input w-full text-xs" placeholder="0" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Shipments</label><input type="number" value={newEntry.shipments} onChange={e => setNewEntry(p => ({ ...p, shipments: e.target.value }))} className="filter-input w-full text-xs" placeholder="0" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Remarks</label><input type="text" value={newEntry.remarks} onChange={e => setNewEntry(p => ({ ...p, remarks: e.target.value }))} className="filter-input w-full text-xs" placeholder="Optional" /></div>
                <div className="flex items-end"><button onClick={saveEntry} className="btn-primary text-xs w-full">Add Entry</button></div>
              </div>
            </div>

            {/* Upload Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Upload Provision Sheet</h3>
              <p className="text-[10px] text-gray-400 mb-3">Upload .xlsx/.csv with columns: Channel, Type, Courier, Month, Amount, Shipments</p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="text-xs text-gray-600" />
              {uploadData && <p className="text-[10px] text-emerald-600 mt-2">{uploadData.length} rows loaded from file</p>}
            </div>

            {/* Entries Table */}
            {entries.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div><h3 className="text-sm font-semibold text-gray-700">Provision Entries ({entries.length})</h3><p className="text-[10px] text-gray-400">Total: {currency(entryTotal)}</p></div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-[11px]">
                  <thead><tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Channel</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Courier</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Month</th>
                    <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">Amount</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Shipments</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Remarks</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase">Action</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...entries].reverse().map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-800">{e.channel}</td>
                        <td className="px-3 py-2"><span className={`badge ${e.type === 'Forward' ? 'badge-green' : e.type === 'RTO' ? 'badge-red' : 'badge-blue'}`}>{e.type}</span></td>
                        <td className="px-3 py-2 text-gray-600">{e.courier || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{e.month || '—'}</td>
                        <td className="px-3 py-2 text-right text-blue-700 font-semibold">{currency(parseFloat(e.amount) || 0)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{e.shipments || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-[10px]">{e.remarks || '—'}</td>
                        <td className="px-3 py-2 text-center"><button onClick={() => deleteEntry(e.id)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ SHARE & COMMUNICATE ═══ */}
{activeTab === 'share' && (() => {
        const effMonth = shareMonth || (monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].month : '');
        const sData = monthlyData.find(m => m.month === effMonth);

        /* ---- AI Email Generator ---- */
        const doGenerate = () => {
          if (!aiPrompt.trim()) return;
          const raw = aiPrompt.trim();
          const p = raw.toLowerCase();
          const isHi = mailLang === 'Hindi';
          setAiLoading(true);

          setTimeout(() => {
            const greet = isHi ? 'प्रिय टीम,' : 'Dear Team,';
            const sign = isHi ? 'धन्यवाद,\nAnveshan Logistics Team' : 'Regards,\nAnveshan Logistics Team';

            /* Detect topics */
            const has = {
              pod: /pod|proof.of.delivery|pod submit|pod received|pod pending|pod nhi|pod upload/.test(p),
              rto: /rto|return|reverse|rto rate|rto zyada|rto high/.test(p),
              cost: /provision|cost|billing|logistics cost|paisa|kharcha|amount|invoice value/.test(p),
              delivery: /deliver|shipment|transit|dispatch|bhej|pahunch/.test(p),
              appt: /appointment|appt|slot|booking/.test(p),
              payment: /payment|pay|paise|received nhi|payment nhi/.test(p),
              grn: /grn|goods received|grn pending/.test(p),
              delay: /delay|late|der|overdue|bahut din/.test(p),
            };
            const isUrgent = /urgent|asap|immediate|critical|turant|jaldi|tatkaal/.test(p);
            const hasWarn = /agar.*nhi|otherwise|nahi to|warna|impact|asar|rok|penalty/.test(p);
            const hasDeadline = /today|aaj|kal|tomorrow|eod|end.of.day/.test(p);

            /* Build subject */
            const topics = [];
            if (has.pod) topics.push('POD');
            if (has.rto) topics.push('RTO');
            if (has.cost) topics.push('Provision');
            if (has.delivery) topics.push('Delivery');
            if (has.appt) topics.push('Appointment');
            if (has.payment) topics.push('Payment');
            if (has.grn) topics.push('GRN');
            if (has.delay) topics.push('Delay');
            const topicStr = topics.join(' & ') || 'Update';
            const subj = `${isUrgent ? '🔴 URGENT: ' : ''}${topicStr} — ${isHi ? 'कार्रवाई आवश्यक' : 'Action Required'} | Anveshan`;

            /* Build body */
            let b = greet + '\n\n';

            /* Professional rewrite of prompt */
            if (isHi) {
              b += `यह ईमेल ${topicStr} के संबंध में है।\n\n`;
              b += `📌 विवरण:\n${raw}\n\n`;
            } else {
              b += `This email is regarding ${topicStr} that requires your attention.\n\n`;
              b += `📌 Context:\n${raw}\n\n`;
            }

            /* Topic sections */
            if (has.pod) {
              b += isHi
                ? '📄 POD:\nPOD समय पर प्राप्त नहीं हो रहा। GRN और पेमेंट प्रभावित होता है।\n'
                : '📄 POD Status:\nPOD submissions are overdue. This impacts GRN processing and payment reconciliation.\n';
              if (hasWarn) b += isHi ? '⚠️ समय पर POD न मिलने पर पेमेंट प्रभावित होगा।\n' : '⚠️ Delayed POD will impact payment processing.\n';
              b += '\n';
            }
            if (has.rto) {
              b += isHi
                ? '🔄 RTO:\nRTO दर चिंताजनक स्तर पर है।\nआवश्यक:\n1. RTO कारणों की पहचान\n2. एड्रेस वेरिफिकेशन\n3. COD नीति समीक्षा\n'
                : '🔄 RTO:\nRTO rate is at concerning levels (2x shipping cost per return).\n\nActions:\n1. Identify root causes\n2. Strengthen address verification\n3. Review COD policy\n';
              b += '\n';
            }
            if (has.cost && sData) {
              b += `📊 ${isHi ? 'प्रोविजन डेटा' : 'Provision Data'} (${effMonth}):\n`;
              b += `  • ${isHi ? 'कुल लागत' : 'Total Cost'}: ${currency(sData.totalCost)}\n`;
              b += `  • Forward: ${currency(sData.fwdCost)} | RTO: ${currency(sData.rtoCost)}\n`;
              b += `  • ${isHi ? 'शिपमेंट' : 'Shipments'}: ${sData.count.toLocaleString('en-IN')} | Cost: ${sData.costPct.toFixed(1)}%\n\n`;
            }
            if (has.appt) {
              b += isHi
                ? '📅 अपॉइंटमेंट:\n1. सभी पेंडिंग अपॉइंटमेंट तुरंत बुक करें\n2. EDD पार शिपमेंट एस्केलेट करें\n\n'
                : '📅 Appointment:\n1. Book all pending appointments immediately\n2. Escalate EDD-breached shipments\n\n';
            }
            if (has.delivery && !has.pod && !has.rto) {
              b += isHi
                ? '🚛 डिलीवरी:\nपेंडिंग शिपमेंट पर तुरंत कार्रवाई करें।\n\n'
                : '🚛 Delivery:\nPending shipments require immediate attention. Coordinate with courier partners.\n\n';
            }
            if (has.payment) {
              b += isHi ? '💰 भुगतान:\nसंबंधित भुगतान की स्थिति की जांच करें।\n\n' : '💰 Payment:\nPlease verify payment status and share update.\n\n';
            }
            if (has.grn) {
              b += isHi ? '📋 GRN:\nGRN प्रोसेसिंग पेंडिंग है।\n\n' : '📋 GRN:\nGRN processing is pending. Coordinate with warehouse team.\n\n';
            }

            if (hasDeadline) b += isHi ? '⏰ आज EOD तक अपडेट शेयर करें।\n\n' : '⏰ Please share update by EOD today.\n\n';
            if (isUrgent) b += isHi ? '🔴 तुरंत कार्रवाई आवश्यक।\n\n' : '🔴 This is high-priority — immediate action required.\n\n';
            b += sign;

            setMailSubject(subj);
            setMailBody(b);
            /* Auto-select attachments */
            const att = [];
            if (has.cost) att.push('provision', 'platform', 'monthly');
            if (has.pod) att.push('podStatus');
            if (has.rto) att.push('rtoAnalysis');
            if (has.delivery || has.delay) att.push('delivery', 'intransit');
            if (has.appt) att.push('apptStatus');
            setAttachData([...new Set(att)]);
            setAiLoading(false);
          }, 600);
        };

        /* ---- Build CSV/Text from selected attachments ---- */
        const buildDataText = () => {
          let t = '\n\n' + '='.repeat(40) + '\n📎 ATTACHED DATA\n' + '='.repeat(40) + '\n';
          if (attachData.includes('provision') && sData) t += `\n📊 Provision (${effMonth}):\n  Total: ${currency(sData.totalCost)} | Fwd: ${currency(sData.fwdCost)} | RTO: ${currency(sData.rtoCost)}\n  Shipments: ${sData.count} | Cost%: ${sData.costPct.toFixed(1)}%\n`;
          if (attachData.includes('platform')) t += '\n📦 Platform Cost:\n' + platformData.slice(0,10).map((pp,i) => `  ${i+1}. ${pp.platform}: ${currency(pp.totalCost)} (${pp.count} ship, ${pp.costPct.toFixed(1)}%)`).join('\n') + '\n';
          if (attachData.includes('monthly')) t += '\n📅 Monthly Trend:\n' + monthlyData.map(m => `  ${m.month}: ${currency(m.totalCost)} (${m.count} ship, ${m.costPct.toFixed(1)}%)`).join('\n') + '\n';
          if (attachData.includes('courier')) t += '\n🚛 Courier Cost:\n' + courierData.slice(0,8).map((c,i) => `  ${i+1}. ${c.courier}: ${currency(c.totalCost)} (${c.count} ship)`).join('\n') + '\n';
          if (attachData.includes('dashboard')) t += `\n📊 Dashboard:\n  Total: ${data.length} records | Cost: ${currency(totals.totalCost)}\n  Fwd: ${currency(totals.fwdCost)} | RTO: ${currency(totals.rtoCost)} | Avg: ${totals.costPct.toFixed(1)}%\n`;
          return t;
        };

        const buildCSV = () => {
          let csv = 'ANVESHAN LOGISTICS DATA EXPORT\nGenerated: ' + new Date().toLocaleString() + '\n\n';
          if (attachData.includes('provision') && sData) csv += `Provision Summary (${effMonth})\nMetric,Value\nTotal Cost,${Math.round(sData.totalCost)}\nForward,${Math.round(sData.fwdCost)}\nRTO,${Math.round(sData.rtoCost)}\nShipments,${sData.count}\nCost %,${sData.costPct.toFixed(1)}%\n\n`;
          if (attachData.includes('platform') || attachData.includes('platformPerf')) csv += 'Platform Cost\nPlatform,Total Cost,Forward,RTO,Shipments,Cost %\n' + platformData.map(pp => `${pp.platform},${Math.round(pp.totalCost)},${Math.round(pp.fwdCost)},${Math.round(pp.rtoCost)},${pp.count},${pp.costPct.toFixed(1)}%`).join('\n') + '\n\n';
          if (attachData.includes('monthly')) csv += 'Monthly Trend\nMonth,Total Cost,Forward,RTO,Shipments,Cost %\n' + monthlyData.map(m => `${m.month},${Math.round(m.totalCost)},${Math.round(m.fwdCost)},${Math.round(m.rtoCost)},${m.count},${m.costPct.toFixed(1)}%`).join('\n') + '\n\n';
          if (attachData.includes('courier') || attachData.includes('courierPerf')) csv += 'Courier Cost\nCourier,Total Cost,Shipments\n' + courierData.map(c => `${c.courier},${Math.round(c.totalCost)},${c.count}`).join('\n') + '\n\n';
          return csv;
        };

        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emailTo)}&su=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

        return (
          <div className="space-y-4">
            {/* AI Composer */}
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-violet-800 flex items-center gap-2 mb-1"><Brain className="w-4 h-4" /> AI Email Composer</h3>
              <p className="text-[10px] text-violet-500 mb-3">Write prompt in any language — AI composes professional email with panel data</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div className="md:col-span-3"><textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} className="filter-input w-full text-xs min-h-[80px]" placeholder="Examples:&#10;POD kai dino se received nhi ho rha hai payment impact hoga&#10;Blinkit ka RTO bahut zyada hai urgent alert bhejo&#10;Monthly provision report with platform data bhejo" /></div>
                <div className="space-y-2">
                  <select value={mailLang} onChange={e => setMailLang(e.target.value)} className="filter-select text-xs w-full"><option>English</option><option>Hindi</option></select>
                  <button onClick={doGenerate} disabled={aiLoading || !aiPrompt.trim()} className="btn-primary w-full text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {aiLoading ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Composing...</> : <><Brain className="w-3.5 h-3.5" />Generate Email</>}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { l: '📊 Provision Report', p: 'monthly provision report with platform cost data' },
                  { l: '📄 POD Follow-up', p: 'POD pending hai submit nhi ho rha follow up karo payment impact hoga' },
                  { l: '🔴 RTO Alert', p: 'RTO rate bahut high hai urgent alert with action items' },
                  { l: '🚛 Delivery Follow-up', p: 'pending delivery shipments ka follow up today EOD tak update chahiye' },
                ].map((t,i) => <button key={i} onClick={() => { setAiPrompt(t.p); }} className="text-[9px] px-2 py-1 rounded-lg border border-violet-200 bg-white text-violet-700 hover:bg-violet-100 font-medium">{t.l}</button>)}
              </div>
            </div>

            {/* Attach Data */}
            <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
              <h3 className="text-sm font-semibold text-indigo-800 flex items-center gap-2 mb-1"><Download className="w-4 h-4" /> Attach Panel Data</h3>
              <p className="text-[10px] text-gray-400 mb-3">Select data to embed in email or download as CSV file for Gmail attachment</p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
                {[
                  { key: 'provision', label: 'Provision Summary' },
                  { key: 'platform', label: 'Platform Costs' },
                  { key: 'courier', label: 'Courier Costs' },
                  { key: 'monthly', label: 'Monthly Trend' },
                  { key: 'dashboard', label: 'Dashboard KPIs' },
                ].map(item => {
                  const sel = attachData.includes(item.key);
                  return <label key={item.key} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-[10px] font-semibold transition-all ${sel ? 'border-indigo-400 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300' : 'border-gray-200 bg-gray-50 text-gray-500'}`}><input type="checkbox" checked={sel} onChange={() => setAttachData(prev => sel ? prev.filter(x=>x!==item.key) : [...prev, item.key])} className="rounded border-gray-300 text-indigo-600 w-3 h-3" />{item.label}</label>;
                })}
              </div>
              {attachData.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setMailBody(prev => prev + buildDataText())} className="btn-primary text-[10px] flex items-center gap-1"><CheckCircle className="w-3 h-3" />Embed in Email</button>
                  <button onClick={() => { const blob = new Blob([buildCSV()], { type: 'text/csv;charset=utf-8;' }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `anveshan-${effMonth}.csv`; a.click(); URL.revokeObjectURL(u); }} className="btn-secondary text-[10px] flex items-center gap-1"><Download className="w-3 h-3" />Download CSV</button>
                  <span className="text-[9px] text-gray-400">{attachData.length} selected</span>
                  <button onClick={() => setAttachData([])} className="text-[9px] text-red-500 underline ml-1">Clear</button>
                </div>
              )}
            </div>

            {/* Composed Email */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-500" /> Composed Email</h3>
              <div className="space-y-3">
                <div><label className="block text-[10px] text-gray-500 mb-1">To</label><input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} className="filter-input w-full text-xs" placeholder="recipient@example.com" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Subject</label><input type="text" value={mailSubject} onChange={e => setMailSubject(e.target.value)} className="filter-input w-full text-xs" /></div>
                <div><label className="block text-[10px] text-gray-500 mb-1">Body</label><textarea value={mailBody} onChange={e => setMailBody(e.target.value)} className="filter-input w-full text-xs min-h-[200px] leading-relaxed" /></div>
              </div>
            </div>

            {/* Send */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-xl hover:shadow-lg transition-all"><div className="p-2 bg-red-100 rounded-lg"><Mail className="w-5 h-5 text-red-600" /></div><div><p className="text-sm font-bold text-red-800">Gmail</p><p className="text-[9px] text-red-500">Open in Gmail</p></div></a>
              <a href={`mailto:${emailTo}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`} className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl hover:shadow-lg transition-all"><div className="p-2 bg-blue-100 rounded-lg"><Mail className="w-5 h-5 text-blue-600" /></div><div><p className="text-sm font-bold text-blue-800">Email</p><p className="text-[9px] text-blue-500">System client</p></div></a>
              <a href={`https://wa.me/?text=${encodeURIComponent('*' + mailSubject + '*\n\n' + mailBody)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl hover:shadow-lg transition-all"><div className="p-2 bg-emerald-100 rounded-lg"><Share2 className="w-5 h-5 text-emerald-600" /></div><div><p className="text-sm font-bold text-emerald-800">WhatsApp</p><p className="text-[9px] text-emerald-500">Share message</p></div></a>
              <button onClick={() => { navigator.clipboard?.writeText('Subject: ' + mailSubject + '\n\n' + mailBody); alert('Copied!'); }} className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-xl hover:shadow-lg transition-all text-left"><div className="p-2 bg-purple-100 rounded-lg"><FileText className="w-5 h-5 text-purple-600" /></div><div><p className="text-sm font-bold text-purple-800">Copy</p><p className="text-[9px] text-purple-500">Slack / Teams</p></div></button>
            </div>
          </div>
        );
      })()}

      {/* Drill-down */}
      {drillDown && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">{drillDown.title} <span className="text-gray-400 font-normal">({drillDown.data.length})</span></h3>
              <button onClick={() => setDrillDown(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4"><DataTable data={drillDown.data} columns={DRILL_COLS} exportFilename="provision-drilldown" pageSize={25} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
