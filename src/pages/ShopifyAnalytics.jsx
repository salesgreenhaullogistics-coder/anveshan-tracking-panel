import React, { useEffect, useMemo, useState } from 'react';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { LineChart, DoughnutChart } from '../components/Charts';
import { currency } from '../utils/index';
import {
  ShoppingBag, IndianRupee, TrendingUp, Package, CheckCircle, RotateCcw,
  RefreshCw, Activity, Truck, MapPin, Layers, X,
} from 'lucide-react';

const SHIPROCKET_API = '/api/shiprocket?action=orders&per_page=100&max_pages=6';

const srNum = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const srTxt = (v, fb = '') => { const s = String(v == null ? '' : v).trim(); return s || fb; };
const srDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };

function srStage(status) {
  const s = String(status || '').toLowerCase();
  if (/delivered/.test(s)) return 'Delivered';
  if (/rto|return/.test(s)) return 'RTO';
  if (/transit|shipped|out for delivery|ofd/.test(s)) return 'In Transit';
  if (/pickup|manifest|ready/.test(s)) return 'Ready/Pickup';
  if (/cancel/.test(s)) return 'Cancelled';
  if (/new|order placed|invoiced|pending/.test(s)) return 'New';
  return 'Other';
}

export default function ShopifyAnalytics() {
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [channelFilter, setChannelFilter] = useState('all'); /* 'all' or a specific channel name */
  const [drill, setDrill] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(SHIPROCKET_API)
      .then(async r => {
        const text = await r.text();
        try { return JSON.parse(text); }
        catch {
          /* Non-JSON (e.g. Vercel timeout/crash page) — surface a clean message */
          if (/timeout/i.test(text)) throw new Error('Shiprocket fetch timed out. Try Refresh — fewer pages will load.');
          throw new Error(`Server returned a non-JSON response (HTTP ${r.status}).`);
        }
      })
      .then(json => {
        if (cancelled) return;
        if (json.configured === false) { setConfigured(false); setRaw([]); return; }
        if (json.error) { setError(json.error); setRaw([]); return; }
        setConfigured(true);
        setRaw(Array.isArray(json.data) ? json.data : []);
        setLastSync(new Date());
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to fetch'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const orders = useMemo(() => raw.map((o, i) => {
    const created = srDate(o.created_at || o.order_date || o.channel_created_at);
    const products = Array.isArray(o.products) ? o.products : [];
    const status = srTxt(o.status, 'Unknown');
    const channel = srTxt(o.channel_name || o.channel, 'Unknown');
    const pay = srTxt(o.payment_method, 'Prepaid');
    return {
      _i: i,
      orderId: srTxt(o.channel_order_id || o.order_id || o.id),
      channel,
      isShopify: /shopify/i.test(channel),
      customer: srTxt(o.customer_name, '—'),
      city: srTxt(o.customer_city || o.city, '—'),
      state: srTxt(o.customer_state || o.state, '—'),
      payment: /cod|cash/i.test(pay) ? 'COD' : 'Prepaid',
      total: srNum(o.total),
      status,
      stage: srStage(status),
      courier: srTxt(o.courier_name || o.courier, '—'),
      awb: srTxt(o.awb_code || o.awb),
      created,
      createdStr: created ? created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—',
      products,
      sku: products[0] ? srTxt(products[0].channel_sku || products[0].sku || products[0].name) : '—',
      qty: products.reduce((s, p) => s + srNum(p.quantity), 0),
    };
  }), [raw]);

  const channels = useMemo(() => Array.from(new Set(orders.map(o => o.channel).filter(Boolean))).sort(), [orders]);
  const data = useMemo(() => channelFilter === 'all' ? orders : orders.filter(o => o.channel === channelFilter), [orders, channelFilter]);

  const stats = useMemo(() => {
    const totalRevenue = data.reduce((s, o) => s + o.total, 0);
    const aov = data.length ? totalRevenue / data.length : 0;
    const cod = data.filter(o => o.payment === 'COD');
    const prepaid = data.filter(o => o.payment === 'Prepaid');
    const delivered = data.filter(o => o.stage === 'Delivered');
    const rto = data.filter(o => o.stage === 'RTO');

    const group = (keyFn) => {
      const m = {};
      data.forEach(o => { const k = keyFn(o) || '—'; if (!m[k]) m[k] = { key: k, count: 0, revenue: 0, rows: [] }; m[k].count++; m[k].revenue += o.total; m[k].rows.push(o); });
      return Object.values(m).sort((a, b) => b.count - a.count);
    };

    const byDay = {};
    data.forEach(o => { if (!o.created) return; const k = o.created.toISOString().slice(0, 10); if (!byDay[k]) byDay[k] = { date: o.created, label: o.createdStr, count: 0, revenue: 0 }; byDay[k].count++; byDay[k].revenue += o.total; });
    const daily = Object.values(byDay).sort((a, b) => a.date - b.date);

    const stageOrder = ['New', 'Ready/Pickup', 'In Transit', 'Delivered', 'RTO', 'Cancelled', 'Other'];
    const stages = {}; stageOrder.forEach(s => stages[s] = { stage: s, count: 0, revenue: 0, rows: [] });
    data.forEach(o => { if (!stages[o.stage]) stages[o.stage] = { stage: o.stage, count: 0, revenue: 0, rows: [] }; stages[o.stage].count++; stages[o.stage].revenue += o.total; stages[o.stage].rows.push(o); });

    const skuMap = {};
    data.forEach(o => { o.products.forEach(p => { const k = srTxt(p.channel_sku || p.sku || p.name, '—'); if (!skuMap[k]) skuMap[k] = { sku: k, name: srTxt(p.name, k), qty: 0, orders: 0, revenue: 0 }; skuMap[k].qty += srNum(p.quantity); skuMap[k].orders++; skuMap[k].revenue += srNum(p.selling_price || p.price) * srNum(p.quantity); }); });
    const skus = Object.values(skuMap).sort((a, b) => b.qty - a.qty).slice(0, 20);

    return {
      totalRevenue, aov, cod, prepaid, delivered, rto,
      deliveryRate: data.length ? delivered.length / data.length * 100 : 0,
      rtoRate: data.length ? rto.length / data.length * 100 : 0,
      byCourier: group(o => o.courier),
      byCity: group(o => o.city).slice(0, 12),
      byStatus: group(o => o.status),
      daily, stages, stageOrder, skus,
    };
  }, [data]);

  const drillCols = [
    { key: 'orderId', label: 'Order ID' },
    { key: 'channel', label: 'Channel' },
    { key: 'customer', label: 'Customer' },
    { key: 'city', label: 'City' },
    { key: 'payment', label: 'Payment' },
    { key: 'total', label: 'Total', render: v => currency(srNum(v)) },
    { key: 'status', label: 'Status' },
    { key: 'courier', label: 'Courier' },
    { key: 'awb', label: 'AWB' },
    { key: 'sku', label: 'SKU' },
    { key: 'qty', label: 'Qty' },
    { key: 'createdStr', label: 'Created' },
  ];
  const openDrill = (title, rows) => setDrill({ title, rows });

  if (!configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2 mb-2"><ShoppingBag className="w-4 h-4" /> Shopify Analytics — Not Connected</h3>
        <p className="text-[12px] text-gray-700 mb-3">This dashboard reads live order data from Shiprocket (read-only). To activate it, add these <strong>Environment Variables</strong> in Vercel → Project → Settings → Environment Variables, then redeploy:</p>
        <div className="bg-white border border-amber-100 rounded-lg p-3 font-mono text-[11px] text-gray-700 space-y-1">
          <div>SHIPROCKET_EMAIL = <span className="text-gray-400">your-shiprocket-api-user@email</span></div>
          <div>SHIPROCKET_PASSWORD = <span className="text-gray-400">your-api-user-password</span></div>
          <div className="text-gray-400">— or instead —</div>
          <div>SHIPROCKET_TOKEN = <span className="text-gray-400">a pre-issued bearer token</span></div>
        </div>
        <p className="text-[10px] text-gray-500 mt-3">Tip: create a dedicated API user in Shiprocket (Settings → API → Configure) so this never uses your main login. This panel only ever <strong>reads</strong> orders — it cannot create, edit, or cancel anything.</p>
        <button onClick={() => setRefreshKey(k => k + 1)} className="mt-3 text-[11px] px-3 py-1.5 bg-amber-600 text-white rounded-lg font-semibold flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Re-check connection</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Live · Read-only</span>
          {lastSync && <span className="text-[10px] text-gray-400">Synced {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
          <span className="text-[10px] text-gray-400">{data.length} orders</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-500 font-medium">Channel:</label>
          <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)} className="text-[10px] px-2 py-1 border border-indigo-200 rounded bg-white text-indigo-700 font-semibold">
            <option value="all">All channels ({orders.length})</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setRefreshKey(k => k + 1)} className="text-[11px] px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold flex items-center gap-1"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </div>

      {loading && raw.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center"><RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" /><p className="text-[12px] text-blue-700 font-semibold">Loading Shopify orders from Shiprocket…</p></div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[11px] text-red-700"><strong>Error:</strong> {error}. <button onClick={() => setRefreshKey(k => k + 1)} className="underline ml-1">Retry</button></div>}

      {raw.length > 0 && (<>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <button onClick={() => openDrill('All Shopify orders', data)} className="text-left"><KPICard title="Orders" value={data.length} icon={ShoppingBag} color="blue" /></button>
          <KPICard title="Revenue" value={currency(stats.totalRevenue)} icon={IndianRupee} color="green" />
          <KPICard title="AOV" value={currency(stats.aov)} icon={TrendingUp} color="indigo" />
          <button onClick={() => openDrill('COD orders', stats.cod)} className="text-left"><KPICard title="COD Share" value={`${data.length ? (stats.cod.length / data.length * 100).toFixed(0) : 0}%`} icon={Package} color="orange" subtitle={`${stats.cod.length} orders`} /></button>
          <button onClick={() => openDrill('Delivered', stats.delivered)} className="text-left"><KPICard title="Delivery %" value={`${stats.deliveryRate.toFixed(1)}%`} icon={CheckCircle} color="green" /></button>
          <button onClick={() => openDrill('RTO', stats.rto)} className="text-left"><KPICard title="RTO %" value={`${stats.rtoRate.toFixed(1)}%`} icon={RotateCcw} color="red" /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="chart-container">
            <LineChart title="Daily Orders" labels={stats.daily.map(d => d.label)} datasets={[{ label: 'Orders', data: stats.daily.map(d => d.count), color: '#6366f1', fill: true }]} height={220} />
          </div>
          <div className="chart-container">
            <DoughnutChart title="Payment Mode" labels={['COD', 'Prepaid']} data={[stats.cod.length, stats.prepaid.length]} height={220} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-[12px] font-bold text-gray-700 mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-500" /> Order Status Funnel</h3>
          <div className="space-y-1.5">
            {stats.stageOrder.filter(s => stats.stages[s] && stats.stages[s].count > 0).map(s => {
              const st = stats.stages[s];
              const max = Math.max(...stats.stageOrder.map(x => stats.stages[x]?.count || 0), 1);
              const w = st.count / max * 100;
              const color = s === 'Delivered' ? '#10b981' : (s === 'RTO' || s === 'Cancelled') ? '#ef4444' : s === 'In Transit' ? '#6366f1' : '#f59e0b';
              return (
                <button key={s} onClick={() => openDrill(`Status: ${s}`, st.rows)} className="w-full flex items-center gap-2 text-[11px] hover:bg-gray-50 rounded p-1 -mx-1">
                  <span className="w-24 text-left text-gray-700 font-medium">{s}</span>
                  <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2" style={{ width: `${w}%`, background: color }}><span className="text-[9px] font-bold text-white">{st.count}</span></div></div>
                  <span className="w-24 text-right font-mono text-gray-600">{currency(st.revenue)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SrPanel title="Courier Split" icon={Truck} items={stats.byCourier.slice(0, 10)} onPick={(it) => openDrill(`Courier: ${it.key}`, it.rows)} />
          <SrPanel title="Top Cities" icon={MapPin} items={stats.byCity} onPick={(it) => openDrill(`City: ${it.key}`, it.rows)} />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-[12px] font-bold text-gray-700 flex items-center gap-2"><Layers className="w-4 h-4 text-rose-500" /> Top 20 SKUs by Quantity</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500">SKU</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Product</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500">Qty</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500">Orders</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600">Revenue</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {stats.skus.map(s => (
                <tr key={s.sku} className="hover:bg-rose-50/30">
                  <td className="px-3 py-1.5 font-mono text-[10px]">{s.sku}</td>
                  <td className="px-3 py-1.5 truncate max-w-[260px]" title={s.name}>{s.name}</td>
                  <td className="px-3 py-1.5 text-right font-bold">{s.qty}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{s.orders}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{currency(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </>)}

      {drill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div><h3 className="text-sm font-bold text-indigo-700">{drill.title}</h3><p className="text-[10px] text-gray-500">{drill.rows.length} orders · {currency(drill.rows.reduce((s, r) => s + r.total, 0))}</p></div>
              <button onClick={() => setDrill(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4"><DataTable data={drill.rows} columns={drillCols} pageSize={25} exportFilename="shopify-orders" /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function SrPanel({ title, icon: Icon, items, onPick }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2"><Icon className="w-3.5 h-3.5 text-indigo-500" /><h3 className="text-[11px] font-bold text-gray-700">{title}</h3><span className="text-[9px] text-gray-400 ml-auto">click to drill</span></div>
      <div className="divide-y divide-gray-50">
        {items.map(it => {
          const w = it.count / max * 100;
          return (
            <button key={it.key} onClick={() => onPick(it)} className="w-full text-left px-3 py-1.5 hover:bg-indigo-50/40">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="text-gray-700 font-medium truncate flex-1" title={it.key}>{it.key}</span>
                <span className="text-gray-500 w-12 text-right">{it.count}</span>
                <span className="text-emerald-600 font-bold w-24 text-right">{currency(it.revenue)}</span>
              </div>
              <div className="w-full h-1 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${w}%` }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
