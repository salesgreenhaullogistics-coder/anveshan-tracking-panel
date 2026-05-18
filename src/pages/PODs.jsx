import React, { useMemo, useState, useCallback } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart, PieChart, DoughnutChart } from '../components/Charts';
import {
  FileText, Search, Download, Eye, X, FileImage, File, ExternalLink, Loader2,
  Building2, Truck, Clock, AlertTriangle, CheckCircle, ChevronRight, ChevronDown, MapPin, Brain, ShieldAlert, Lightbulb,
} from 'lucide-react';
import { formatDate, groupBy, percent, safeParseDate, isDelivered, isPartialDelivered } from '../utils/index';

const SUB_TABS = [
  { key: 'overview', label: 'POD Overview', icon: Eye },
  { key: 'pending', label: 'Pending PODs', icon: AlertTriangle },
  { key: 'search', label: 'Search POD', icon: Search },
];

function hasPod(podVal) { return podVal && podVal.trim() !== '' && podVal.trim() !== '-' && podVal.trim().toLowerCase() !== 'na'; }
function getPodUrl(row) { if (row.podUrl && row.podUrl.trim()) return row.podUrl.trim(); const pod = (row.pod || '').trim(); return pod; }
function isUrl(val) { return val && (val.startsWith('http://') || val.startsWith('https://')); }
function podFileExt(val) { if (!val) return ''; const c = val.split('?')[0].split('#')[0]; const d = c.lastIndexOf('.'); return d >= 0 ? c.slice(d + 1).toLowerCase() : ''; }

function getPodAgeBucket(days) { if (days <= 3) return '0-3 Days'; if (days <= 7) return '4-7 Days'; if (days <= 15) return '8-15 Days'; return '15+ Days'; }

/* POD Preview Modal */
function PodPreviewModal({ url, filename, awb, onClose }) {
  if (!url) return null;
  const ext = podFileExt(url) || podFileExt(filename);
  const isImage = ['jpeg','jpg','png','gif','webp','bmp','svg'].includes(ext);
  const isPdf = ext === 'pdf';
  const hasValidUrl = isUrl(url);
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(isImage && hasValidUrl);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 bg-blue-50 rounded-lg">{isImage ? <FileImage className="w-4 h-4 text-blue-600" /> : <File className="w-4 h-4 text-blue-600" />}</div>
            <div className="min-w-0"><h3 className="text-[13px] font-semibold text-gray-800 truncate">POD — {awb || ''}</h3><p className="text-[10px] text-gray-400 truncate">{filename || url}</p></div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {hasValidUrl && <><a href={url} download target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-medium hover:bg-blue-700 shadow-sm"><Download className="w-3.5 h-3.5" />Download</a><a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 bg-white text-gray-600 rounded-lg text-[11px] font-medium hover:bg-gray-50"><ExternalLink className="w-3 h-3" />Open</a></>}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg"><X className="w-4 h-4 text-gray-500" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4 min-h-[320px]">
          {!hasValidUrl ? <div className="text-center py-10"><p className="text-sm text-gray-500">POD URL not available</p></div>
            : isImage && !imgError ? <div className="relative w-full flex items-center justify-center">{imgLoading && <Loader2 className="w-8 h-8 text-blue-500 animate-spin absolute" />}<img src={url} alt={`POD ${awb}`} className={`max-w-full max-h-[65vh] rounded-lg shadow-md object-contain bg-white ${imgLoading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => setImgLoading(false)} onError={() => { setImgLoading(false); setImgError(true); }} /></div>
            : isPdf ? <iframe src={url} title="POD PDF" className="w-full h-[65vh] rounded-lg border border-gray-200 bg-white" />
            : <div className="text-center py-10"><p className="text-sm text-gray-600">{ext.toUpperCase()} File — use Download button</p></div>}
        </div>
      </div>
    </div>
  );
}

export default function PODs() {
  const { data } = useData();
  const [subTab, setSubTab] = useState('overview');
  const [searchType, setSearchType] = useState('awbNo');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [podPreview, setPodPreview] = useState(null);
  const [expPlatform, setExpPlatform] = useState(null);
  const [drillDown, setDrillDown] = useState(null);
  const [pendingFilter, setPendingFilter] = useState('All');

  const now = new Date();

  /* Core data */
  /* Last 4 months only */
  const cutoff4m = useMemo(() => new Date(now.getFullYear(), now.getMonth() - 4, 1), []);
  const deliveredData = useMemo(() => data.filter(r => {
    if (!(isDelivered(r.status) || isPartialDelivered(r.status))) return false;
    const bd = safeParseDate(r.bookingDate) || safeParseDate(r.deliveryDate);
    return !bd || bd >= cutoff4m;
  }), [data, cutoff4m]);
  const withPod = useMemo(() => deliveredData.filter(r => hasPod(r.pod)), [deliveredData]);
  const pendingPods = useMemo(() => deliveredData.filter(r => !hasPod(r.pod)).map(r => {
    const dd = safeParseDate(r.deliveryDate);
    const podAge = dd ? Math.floor((now - dd) / 86400000) : 0;
    return { ...r, podAge, podAgeBucket: getPodAgeBucket(podAge) };
  }), [deliveredData]);

  const podVisibility = deliveredData.length > 0 ? percent(withPod.length, deliveredData.length) : 0;

  /* POD aging buckets */
  const podAgeBuckets = useMemo(() => {
    const c = { '0-3 Days': 0, '4-7 Days': 0, '8-15 Days': 0, '15+ Days': 0 };
    pendingPods.forEach(r => { if (c[r.podAgeBucket] !== undefined) c[r.podAgeBucket]++; });
    return c;
  }, [pendingPods]);

  const avgPodAge = useMemo(() => pendingPods.length ? Math.round(pendingPods.reduce((s, r) => s + r.podAge, 0) / pendingPods.length) : 0, [pendingPods]);

  /* Platform breakdown */
  const platformPodStats = useMemo(() => {
    const groups = groupBy(deliveredData, 'platform');
    return Object.entries(groups).filter(([p]) => p && p !== '').map(([platform, rows]) => {
      const wp = rows.filter(r => hasPod(r.pod)).length;
      const pp = rows.filter(r => !hasPod(r.pod));
      const avgAge = pp.length ? Math.round(pp.reduce((s, r) => { const dd = safeParseDate(r.deliveryDate); return s + (dd ? Math.floor((now - dd) / 86400000) : 0); }, 0) / pp.length) : 0;
      return { platform, total: rows.length, withPod: wp, pending: pp.length, podPct: percent(wp, rows.length), avgPendingAge: avgAge, pendingRows: pp, allRows: rows };
    }).sort((a, b) => b.pending - a.pending);
  }, [deliveredData]);

  /* Courier breakdown */
  const courierPodStats = useMemo(() => {
    const groups = groupBy(deliveredData, 'vendor');
    return Object.entries(groups).filter(([c]) => c && c !== '').map(([courier, rows]) => {
      const wp = rows.filter(r => hasPod(r.pod)).length;
      const pp = rows.filter(r => !hasPod(r.pod));
      const avgAge = pp.length ? Math.round(pp.reduce((s, r) => { const dd = safeParseDate(r.deliveryDate); return s + (dd ? Math.floor((now - dd) / 86400000) : 0); }, 0) / pp.length) : 0;
      return { courier, total: rows.length, withPod: wp, pending: pp.length, podPct: percent(wp, rows.length), avgPendingAge: avgAge, pendingRows: pp };
    }).sort((a, b) => b.pending - a.pending);
  }, [deliveredData]);

  /* AI Insights */
  const insights = useMemo(() => {
    const items = [];
    if (podVisibility < 80) items.push({ icon: ShieldAlert, title: `POD visibility at ${podVisibility}% — below 80% target`, desc: `${pendingPods.length} delivered shipments without POD. Target: 90%+ visibility.`, severity: 'critical' });
    else if (podVisibility >= 90) items.push({ icon: CheckCircle, title: `POD visibility at ${podVisibility}% — healthy`, desc: `${withPod.length} out of ${deliveredData.length} delivered shipments have POD uploaded.`, severity: 'success' });
    if (podAgeBuckets['15+ Days'] > 0) items.push({ icon: AlertTriangle, title: `${podAgeBuckets['15+ Days']} PODs pending 15+ days since delivery`, desc: `Critical aging. These need urgent follow-up with couriers.`, severity: 'critical' });
    const worstPlatform = platformPodStats[0];
    if (worstPlatform && worstPlatform.pending > 10) items.push({ icon: Building2, title: `${worstPlatform.platform}: ${worstPlatform.pending} PODs pending (worst)`, desc: `POD visibility: ${worstPlatform.podPct}%. Avg pending age: ${worstPlatform.avgPendingAge}d.`, severity: 'warning' });
    const worstCourier = courierPodStats[0];
    if (worstCourier && worstCourier.pending > 10) items.push({ icon: Truck, title: `${worstCourier.courier}: ${worstCourier.pending} PODs pending`, desc: `POD visibility: ${worstCourier.podPct}%. Follow up with this courier.`, severity: 'warning' });
    return items;
  }, [podVisibility, pendingPods, withPod, deliveredData, podAgeBuckets, platformPodStats, courierPodStats]);

  /* Filtered pending */
  const filteredPending = useMemo(() => {
    if (pendingFilter === 'All') return pendingPods;
    return pendingPods.filter(r => r.podAgeBucket === pendingFilter);
  }, [pendingPods, pendingFilter]);

  const openPodPreview = useCallback((row) => setPodPreview({ url: getPodUrl(row), filename: (row.pod || '').trim(), awb: row.awbNo }), []);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const vals = searchQuery.split(/[,;\n|]+/).map(v => v.trim().toLowerCase()).filter(Boolean);
    setSearchResults(data.filter(r => { const fv = (r[searchType] || '').toLowerCase(); return fv && vals.some(q => fv.includes(q)); }));
  }, [searchQuery, searchType, data]);

  const SEARCH_COLS = useMemo(() => [
    { key: 'awbNo', label: 'AWB No' }, { key: 'invoiceNo', label: 'Invoice No' }, { key: 'vendor', label: 'Courier' }, { key: 'platform', label: 'Platform' }, { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking', render: v => formatDate(v) }, { key: 'deliveryDate', label: 'Delivery', render: v => formatDate(v) },
    { key: 'pod', label: 'POD', sortable: false, render: (val, row) => hasPod(val) ? <button onClick={e => { e.stopPropagation(); openPodPreview(row); }} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-medium hover:bg-blue-700"><Eye className="w-3 h-3" />View</button> : <span className="badge badge-red">Pending</span> },
    { key: 'zone', label: 'Zone' },
  ], [openPodPreview]);

  const PENDING_COLS = [
    { key: 'awbNo', label: 'AWB No' }, { key: 'invoiceNo', label: 'Invoice No' }, { key: 'vendor', label: 'Courier' }, { key: 'platform', label: 'Platform' }, { key: 'destination', label: 'City' },
    { key: 'deliveryDate', label: 'Delivery Date', render: v => formatDate(v) },
    { key: 'podAge', label: 'POD Age', render: v => <span className={`badge ${v > 15 ? 'badge-red' : v > 7 ? 'badge-yellow' : 'badge-green'}`}>{v}d</span> },
    { key: 'podAgeBucket', label: 'Bucket' }, { key: 'zone', label: 'Zone' }, { key: 'poNumber', label: 'PO No' },
  ];

  return (
    <div className="space-y-4">
      {podPreview && <PodPreviewModal url={podPreview.url} filename={podPreview.filename} awb={podPreview.awb} onClose={() => setPodPreview(null)} />}

      {/* Sub-tabs */}
      <div className="flex gap-2">{SUB_TABS.map(t => { const Icon = t.icon; return (
        <button key={t.key} onClick={() => setSubTab(t.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${subTab === t.key ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}><Icon className="w-3.5 h-3.5" />{t.label}</button>
      ); })}</div>

      {/* ═══ OVERVIEW ═══ */}
      {subTab === 'overview' && (<div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <KPICard title="Delivered" value={deliveredData.length} icon={CheckCircle} color="blue" />
          <KPICard title="With POD" value={withPod.length} icon={FileText} color="green" />
          <KPICard title="POD Pending" value={pendingPods.length} icon={AlertTriangle} color="red" />
          <KPICard title="POD Visibility" value={`${podVisibility}%`} icon={Eye} color={podVisibility >= 80 ? 'green' : 'red'} />
          <KPICard title="Avg Pending Age" value={`${avgPodAge}d`} icon={Clock} color="purple" subtitle="Since delivery" />
          <KPICard title="15+ Days Pending" value={podAgeBuckets['15+ Days']} icon={ShieldAlert} color="red" subtitle="Critical" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="chart-container"><BarChart title="POD Aging (Days Since Delivery)" labels={Object.keys(podAgeBuckets)} datasets={[{ label: 'Pending', data: Object.values(podAgeBuckets), backgroundColor: ['#10B981','#F59E0B','#F97316','#EF4444'] }]} height={200} /></div>
          <div className="chart-container"><BarChart title="Platform POD Pendency (Top 10)" labels={platformPodStats.slice(0,10).map(p=>p.platform)} datasets={[{ label: 'Pending', data: platformPodStats.slice(0,10).map(p=>p.pending), color: '#EF4444' }]} height={200} /></div>
          <div className="chart-container"><DoughnutChart title="POD Status" labels={['With POD','Pending']} data={[withPod.length, pendingPods.length]} height={200} /></div>
        </div>

        {/* AI Insights */}
        {insights.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2 mb-2"><Brain className="w-4 h-4" /> POD Intelligence</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {insights.map((ins, i) => { const Ic = ins.icon; const cm = { critical:'border-red-200 bg-red-50 text-red-800', warning:'border-amber-200 bg-amber-50 text-amber-800', success:'border-emerald-200 bg-emerald-50 text-emerald-800', info:'border-blue-200 bg-blue-50 text-blue-800' }; return (
                <div key={i} className={`p-3 rounded-xl border ${cm[ins.severity]}`}><div className="flex items-start gap-2"><Ic className="w-4 h-4 mt-0.5 flex-shrink-0" /><div><p className="text-[11px] font-bold">{ins.title}</p><p className="text-[10px] text-gray-600 mt-0.5">{ins.desc}</p></div></div></div>
              ); })}
            </div>
          </div>
        )}

        {/* Platform POD Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Platform-wise POD Analysis</h3><p className="text-[10px] text-gray-400">Click platform for courier & zone breakdown</p></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Platform</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Delivered</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">With POD</th>
              <th className="px-3 py-2 text-right font-semibold text-red-500 uppercase">Pending</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">POD %</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Avg Age</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Visibility</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {platformPodStats.map(p => {
                const isExp = expPlatform === p.platform;
                return (
                  <React.Fragment key={p.platform}>
                    <tr className={`hover:bg-gray-50 cursor-pointer ${isExp ? 'bg-blue-50/50' : ''}`} onClick={() => setExpPlatform(isExp ? null : p.platform)}>
                      <td className="px-3 py-2 font-medium text-blue-700 flex items-center gap-1">{isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{p.platform}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{p.total}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 cursor-pointer underline" onClick={e => { e.stopPropagation(); setDrillDown({ title: `${p.platform} — With POD`, data: p.allRows.filter(r => hasPod(r.pod)) }); }}>{p.withPod}</td>
                      <td className="px-3 py-2 text-right text-red-500 font-semibold cursor-pointer underline" onClick={e => { e.stopPropagation(); setDrillDown({ title: `${p.platform} — POD Pending`, data: p.pendingRows }); }}>{p.pending}</td>
                      <td className="px-3 py-2 text-right"><span className={`font-bold ${p.podPct >= 80 ? 'text-emerald-600' : p.podPct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{p.podPct}%</span></td>
                      <td className="px-3 py-2 text-right"><span className={`font-semibold ${p.avgPendingAge > 15 ? 'text-red-600' : p.avgPendingAge > 7 ? 'text-amber-600' : 'text-gray-600'}`}>{p.pending > 0 ? `${p.avgPendingAge}d` : '—'}</span></td>
                      <td className="px-3 py-2 min-w-[100px]"><div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100"><div className="bg-emerald-500" style={{ width: `${p.podPct}%` }} /><div className="bg-red-300" style={{ width: `${100 - p.podPct}%` }} /></div></td>
                    </tr>
                    {isExp && (() => {
                      const cG = groupBy(p.pendingRows, 'vendor');
                      const couriers = Object.entries(cG).filter(([k]) => k).map(([c, r]) => ({ c, n: r.length, avg: Math.round(r.reduce((s, x) => { const dd = safeParseDate(x.deliveryDate); return s + (dd ? Math.floor((now - dd) / 86400000) : 0); }, 0) / r.length), rows: r })).sort((a, b) => b.n - a.n);
                      const zG = groupBy(p.pendingRows, 'zone');
                      const zones = Object.entries(zG).filter(([k]) => k).map(([z, r]) => ({ z, n: r.length, rows: r })).sort((a, b) => b.n - a.n);
                      return (<tr><td colSpan={7} className="p-0"><div className="bg-blue-50/30 border-t border-blue-100 px-4 py-3"><div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div><p className="text-[10px] font-bold text-blue-700 mb-1.5">Courier POD Pendency</p><div className="space-y-1">{couriers.map(c => (
                          <div key={c.c} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-blue-100 cursor-pointer hover:shadow-sm" onClick={() => setDrillDown({ title: `${p.platform}→${c.c} Pending`, data: c.rows })}>
                            <span className="text-gray-700 truncate mr-2">{c.c}</span><span className="text-red-600 font-semibold">{c.n} | {c.avg}d avg</span></div>))}</div></div>
                        <div><p className="text-[10px] font-bold text-blue-700 mb-1.5">Zone POD Pendency</p><div className="space-y-1">{zones.slice(0, 8).map(z => (
                          <div key={z.z} className="flex items-center justify-between text-[10px] py-1 px-2 bg-white rounded-lg border border-blue-100 cursor-pointer hover:shadow-sm" onClick={() => setDrillDown({ title: `${p.platform}→${z.z} Pending`, data: z.rows })}>
                            <span className="text-gray-700">{z.z}</span><span className="text-red-600 font-semibold">{z.n}</span></div>))}</div></div>
                      </div></div></td></tr>);
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table></div>
        </div>

        {/* Courier POD Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">Courier-wise POD Analysis</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Courier</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Delivered</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 uppercase">With POD</th>
              <th className="px-3 py-2 text-right font-semibold text-red-500 uppercase">Pending</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-600 uppercase">POD %</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase">Avg Age</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase">Visibility</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {courierPodStats.map(c => (
                <tr key={c.courier} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDrillDown({ title: `${c.courier} — POD Pending`, data: c.pendingRows })}>
                  <td className="px-3 py-2 font-medium text-gray-800">{c.courier}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{c.total}</td>
                  <td className="px-3 py-2 text-right text-emerald-600">{c.withPod}</td>
                  <td className="px-3 py-2 text-right text-red-500 font-semibold">{c.pending}</td>
                  <td className="px-3 py-2 text-right"><span className={`font-bold ${c.podPct >= 80 ? 'text-emerald-600' : 'text-red-600'}`}>{c.podPct}%</span></td>
                  <td className="px-3 py-2 text-right"><span className={`font-semibold ${c.avgPendingAge > 15 ? 'text-red-600' : 'text-gray-600'}`}>{c.pending > 0 ? `${c.avgPendingAge}d` : '—'}</span></td>
                  <td className="px-3 py-2 min-w-[80px]"><div className="flex h-2 rounded-full overflow-hidden bg-gray-100"><div className="bg-emerald-500" style={{ width: `${c.podPct}%` }} /><div className="bg-red-300" style={{ width: `${100 - c.podPct}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>)}

      {/* ═══ PENDING PODs ═══ */}
      {subTab === 'pending' && (<div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Total Pending" value={pendingPods.length} icon={AlertTriangle} color="red" />
          <KPICard title="Avg POD Age" value={`${avgPodAge}d`} icon={Clock} color="purple" subtitle="Since delivery" />
          <KPICard title="8-15 Days" value={podAgeBuckets['8-15 Days']} icon={Clock} color="yellow" />
          <KPICard title="15+ Days" value={podAgeBuckets['15+ Days']} icon={ShieldAlert} color="red" subtitle="Critical" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['All', ...Object.keys(podAgeBuckets)].map(f => {
            const cnt = f === 'All' ? pendingPods.length : (podAgeBuckets[f] || 0);
            return <button key={f} onClick={() => setPendingFilter(f)} className={`tab-btn ${pendingFilter === f ? 'tab-btn-active' : 'tab-btn-inactive'}`}>{f} ({cnt})</button>;
          })}
        </div>
        <DataTable data={filteredPending} columns={PENDING_COLS} exportFilename="pending-pods" pageSize={25} />
      </div>)}

      {/* ═══ SEARCH POD ═══ */}
      {subTab === 'search' && (<div className="space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Search POD</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div><label className="block text-xs text-gray-500 mb-1">Search By</label>
              <select value={searchType} onChange={e => { setSearchType(e.target.value); setSearchResults(null); }} className="filter-select">
                <option value="awbNo">AWB / LR Number</option><option value="invoiceNo">Invoice No</option><option value="poNumber">PO Number</option><option value="refNo">Reference No</option>
              </select></div>
            <div className="flex-1 min-w-[250px]"><label className="block text-xs text-gray-500 mb-1">Search Query <span className="text-[10px] text-gray-400">(comma-separated)</span></label>
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Enter values..." className="filter-input w-full" /></div>
            <button onClick={handleSearch} className="btn-primary flex items-center gap-1.5"><Search className="w-4 h-4" />Search</button>
          </div>
        </div>
        {searchResults !== null && <DataTable data={searchResults} columns={SEARCH_COLS} exportFilename="pod-search" emptyMessage="No records found" />}
      </div>)}

      {/* Drill-down Modal */}
      {drillDown && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">{drillDown.title} <span className="text-gray-400 font-normal">({drillDown.data.length})</span></h3>
              <button onClick={() => setDrillDown(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4"><DataTable data={drillDown.data} columns={PENDING_COLS} exportFilename="pod-drilldown" pageSize={25} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
