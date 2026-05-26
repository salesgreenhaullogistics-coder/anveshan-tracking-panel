import React, { useEffect, useMemo, useState } from 'react';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { BarChart, LineChart, DoughnutChart } from '../components/Charts';
import { currency } from '../utils/index';
import {
  normalizeOrders, buildPickupMap, computeBI, pctNum, WEIGHT_SLABS,
} from '../utils/shopifyBI';
import {
  ShoppingBag, IndianRupee, TrendingUp, CheckCircle, RotateCcw, RefreshCw,
  Activity, Truck, MapPin, Layers, X, Scale, Wallet, Clock, Boxes, AlertTriangle,
  Store, Navigation, Search,
} from 'lucide-react';

const PER_PAGE = 100;
const BATCH_PAGES = 6;
/* Shiprocket refuses page-based fetching past ~9,900 orders (HTTP 422), so we
   always scope to a recent date window instead of pulling "everything". */
const SAFETY_CAP = 9000;
const DAY_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 15 days', value: 15 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 60 days', value: 60 },
  { label: 'Last 90 days', value: 90 },
];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ordersUrl = (startPage, from, to) => `/api/shiprocket?action=orders&per_page=${PER_PAGE}&max_pages=${BATCH_PAGES}&start_page=${startPage}&from=${from}&to=${to}`;

export default function ShopifyAnalytics() {
  const [raw, setRaw] = useState([]);
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [channelFilter, setChannelFilter] = useState('all');
  const [days, setDays] = useState(30);
  const [progress, setProgress] = useState(0);
  const [drill, setDrill] = useState(null);
  const [wThreshold, setWThreshold] = useState(0.5);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - days);
    return { from: ymd(from), to: ymd(to) };
  }, [days]);

  const fetchBatch = async (startPage) => {
    const r = await fetch(ordersUrl(startPage, range.from, range.to));
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); }
    catch {
      if (/timeout/i.test(text)) throw new Error('Shiprocket batch timed out — try a smaller load size.');
      throw new Error(`Server returned a non-JSON response (HTTP ${r.status}).`);
    }
    return json;
  };

  /* pickup locations (for mis-route) — fetched once per refresh, non-fatal */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/shiprocket?action=pickup');
        const j = await r.json();
        if (!cancelled && Array.isArray(j.data)) setPickups(j.data);
      } catch { /* mis-route just stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(''); setProgress(0);
      try {
        const acc = [];
        let startPage = 1;
        let configuredOk = true;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const json = await fetchBatch(startPage);
          if (cancelled) return;
          if (json.configured === false) { configuredOk = false; setConfigured(false); setRaw([]); break; }
          if (json.error) { throw new Error(json.error); }
          const rows = Array.isArray(json.data) ? json.data : [];
          acc.push(...rows);
          setProgress(acc.length);
          setRaw([...acc]);
          setConfigured(true);
          /* stop at end of range, or at the safety cap (Shiprocket's 422 wall) */
          if (!json.hasMore || acc.length >= SAFETY_CAP) break;
          startPage = (json.endPage || startPage + BATCH_PAGES - 1) + 1;
        }
        if (configuredOk && !cancelled) setLastSync(new Date());
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to fetch');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, days]);

  const pickupMap = useMemo(() => buildPickupMap(pickups), [pickups]);
  const orders = useMemo(() => normalizeOrders(raw, pickupMap), [raw, pickupMap]);
  const channels = useMemo(() => Array.from(new Set(orders.map(o => o.channel).filter(Boolean))).sort(), [orders]);
  const data = useMemo(() => channelFilter === 'all' ? orders : orders.filter(o => o.channel === channelFilter), [orders, channelFilter]);
  const pickupPins = useMemo(() => pickups.map(p => p.pincode), [pickups]);
  const bi = useMemo(() => computeBI(data, { wThreshold, pickupPins }), [data, wThreshold, pickupPins]);

  const openDrill = (title, rows, note) => setDrill({ title, rows: rows || [], note });

  if (!configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2 mb-2"><ShoppingBag className="w-4 h-4" /> Shopify Analytics — Not Connected</h3>
        <p className="text-[12px] text-gray-700 mb-3">This dashboard reads live order data from Shiprocket (read-only). Add these <strong>Environment Variables</strong> in Vercel → Settings → Environment Variables, then redeploy:</p>
        <div className="bg-white border border-amber-100 rounded-lg p-3 font-mono text-[11px] text-gray-700 space-y-1">
          <div>SHIPROCKET_EMAIL = <span className="text-gray-400">your-shiprocket-api-user@email</span></div>
          <div>SHIPROCKET_PASSWORD = <span className="text-gray-400">your-api-user-password</span></div>
        </div>
        <button onClick={() => setRefreshKey(k => k + 1)} className="mt-3 text-[11px] px-3 py-1.5 bg-amber-600 text-white rounded-lg font-semibold flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Re-check connection</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Live · Read-only</span>
          {lastSync && <span className="text-[10px] text-gray-400">Synced {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
          <span className="text-[10px] text-gray-400">{data.length.toLocaleString('en-IN')} orders · {range.from} → {range.to} · {pickups.length} pickup loc.</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-gray-500 font-medium">Period:</label>
          <select value={days} onChange={e => setDays(parseInt(e.target.value, 10))} className="text-[10px] px-2 py-1 border border-amber-200 rounded bg-white text-amber-700 font-semibold">
            {DAY_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="text-[10px] text-gray-500 font-medium">Channel:</label>
          <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)} className="text-[10px] px-2 py-1 border border-indigo-200 rounded bg-white text-indigo-700 font-semibold">
            <option value="all">All ({orders.length})</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setRefreshKey(k => k + 1)} className="text-[11px] px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold flex items-center gap-1"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </div>

      {loading && raw.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center"><RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" /><p className="text-[12px] text-blue-700 font-semibold">Loading orders from Shiprocket…</p></div>
      )}
      {loading && raw.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 flex items-center gap-2 text-[11px] text-blue-700"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading last {days} days… {progress.toLocaleString('en-IN')} orders so far</div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[11px] text-red-700"><strong>Error:</strong> {error}. <button onClick={() => setRefreshKey(k => k + 1)} className="underline ml-1">Retry</button></div>}

      {raw.length > 0 && (<>
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <button onClick={() => openDrill('All orders', bi.allData)} className="text-left"><KPICard title="Orders" value={bi.n} icon={ShoppingBag} color="blue" /></button>
          <KPICard title="Revenue" value={currency(bi.revenue)} icon={IndianRupee} color="green" />
          <KPICard title="AOV" value={currency(bi.aov)} icon={TrendingUp} color="indigo" />
          <button onClick={() => openDrill('COD orders', bi.cod)} className="text-left"><KPICard title="COD %" value={`${bi.n ? (bi.cod.length / bi.n * 100).toFixed(0) : 0}%`} icon={Wallet} color="orange" subtitle={`${bi.cod.length} orders`} /></button>
          <button onClick={() => openDrill('Delivered', bi.delivered)} className="text-left"><KPICard title="Delivery %" value={`${bi.deliveryPct.toFixed(1)}%`} icon={CheckCircle} color="green" /></button>
          <button onClick={() => openDrill('RTO', bi.rto)} className="text-left"><KPICard title="RTO %" value={`${bi.rtoPct.toFixed(1)}%`} icon={RotateCcw} color="red" /></button>
          <button onClick={() => openDrill('Mis-routed orders', bi.misrouted, 'shipped from a non-optimal pickup')} className="text-left"><KPICard title="Mis-route %" value={`${bi.misRate.toFixed(1)}%`} icon={Navigation} color="purple" subtitle={`${bi.misrouted.length} orders`} /></button>
        </div>

        {/* Trend */}
        <Section title="Daily Orders & Revenue" icon={Activity}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2">
              <LineChart labels={bi.daily.map(d => d.label)} datasets={[{ label: 'Orders', data: bi.daily.map(d => d.count), color: '#6366f1', fill: true }]} height={210} />
            </div>
            <DoughnutChart title="Payment Mode" labels={['COD', 'Prepaid']} data={[bi.cod.length, bi.prepaid.length]} height={210} />
          </div>
        </Section>

        {/* Status — graph + table */}
        <ChartTable
          title="Status-wise Orders (share of all orders)" icon={Activity}
          items={bi.byStatus} barColor="#6366f1"
          cols={[
            { label: 'Status', fn: r => r.key },
            { label: 'Orders', fn: r => r.count, align: 'right' },
            { label: '% of Orders', fn: r => `${pctNum(r.count, bi.n).toFixed(1)}%`, align: 'right', color: () => '#4f46e5' },
            { label: 'Revenue', fn: r => currency(r.revenue), align: 'right' },
            { label: '% of Rev', fn: r => `${pctNum(r.revenue, bi.revenue).toFixed(1)}%`, align: 'right' },
          ]}
          onPick={r => openDrill(`Status: ${r.key}`, r.rows)}
        />

        {/* Courier — graph + table */}
        <ChartTable
          title="Courier Performance — Orders · Delivery% · RTO% · TAT" icon={Truck}
          items={bi.byCourier} barColor="#10b981"
          cols={[
            { label: 'Courier', fn: r => r.key },
            { label: 'Orders', fn: r => r.count, align: 'right' },
            { label: 'Delivery %', fn: r => `${r.deliveryPct.toFixed(1)}%`, align: 'right', color: () => '#16a34a' },
            { label: 'RTO %', fn: r => `${r.rtoPct.toFixed(1)}%`, align: 'right', color: r => r.rtoPct > 20 ? '#dc2626' : '#f59e0b' },
            { label: 'Avg TAT', fn: r => r.tatCount ? `${r.avgTat.toFixed(1)}d` : '—', align: 'right' },
          ]}
          onPick={r => openDrill(`Courier: ${r.key}`, r.rows)}
          note={bi.byCourier.every(c => !c.tatCount) ? 'Avg TAT needs delivered + shipped dates from Shiprocket — not in this feed yet.' : null}
        />

        {/* Geography */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartTable compact title="Top Cities by Revenue" icon={MapPin} items={bi.byCity} barColor="#f59e0b" barFn={r => r.revenue}
            cols={[{ label: 'City', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }, { label: 'Revenue', fn: r => currency(r.revenue), align: 'right' }]}
            onPick={r => openDrill(`City: ${r.key}`, r.rows)} />
          <ChartTable compact title="Top States by Revenue" icon={MapPin} items={bi.byState} barColor="#8b5cf6" barFn={r => r.revenue}
            cols={[{ label: 'State', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }, { label: 'Revenue', fn: r => currency(r.revenue), align: 'right' }]}
            onPick={r => openDrill(`State: ${r.key}`, r.rows)} />
        </div>

        {/* Weight reconciliation */}
        <Section title="Weight Reconciliation — Channel-SKU weight vs charged Weight (KG)" icon={Scale}
          right={<div className="flex items-center gap-1">{[0.25, 0.5, 1, 2].map(t => <button key={t} onClick={() => setWThreshold(t)} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${wThreshold === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{t}kg</button>)}</div>}>
          {!bi.withBothW.length ? (
            <EmptyNote>Needs <strong>both</strong> a charged Weight (KG) and an SKU-inferable weight (e.g. <code>FPCL-MSTR-PETT-1LTR</code>→1kg). Currently {bi.skuWeightOnly} orders have an SKU weight and {bi.chargedWeightOnly} have a charged weight. See coverage at the bottom.</EmptyNote>
          ) : (<>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
              <button onClick={() => openDrill('Reconcilable orders', bi.withBothW)} className="text-left"><KPICard title="Reconcilable" value={bi.withBothW.length} color="blue" /></button>
              <KPICard title="Avg Δ Weight" value={`${bi.avgWeightDiff > 0 ? '+' : ''}${bi.avgWeightDiff.toFixed(2)} kg`} color={bi.avgWeightDiff > 0 ? 'red' : 'green'} />
              <button onClick={() => openDrill(`Over-charged (Δ > ${wThreshold}kg)`, bi.overCharged)} className="text-left"><KPICard title="Over-charged" value={bi.overCharged.length} color="red" subtitle={`> ${wThreshold}kg`} /></button>
              <button onClick={() => openDrill(`Under-charged (Δ < -${wThreshold}kg)`, bi.underCharged)} className="text-left"><KPICard title="Under-charged" value={bi.underCharged.length} color="yellow" /></button>
              <KPICard title="Over-charge %" value={`${pctNum(bi.overCharged.length, bi.withBothW.length).toFixed(1)}%`} color="orange" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <BarChart labels={bi.wDiffBuckets.map(b => b.key)} datasets={[{ label: 'Orders', data: bi.wDiffBuckets.map(b => b.count), color: '#ef4444' }]} height={200} />
                <ClickTable rows={bi.wDiffBuckets} cols={[{ label: 'Δ Weight (kg)', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }]} onPick={r => openDrill(`Δ Weight ${r.key} kg`, r.rows)} />
              </div>
              <div>
                <BarChart horizontal labels={bi.weightByCourier.slice(0, 10).map(c => c.key)} datasets={[{ label: 'Avg over-charge (kg)', data: bi.weightByCourier.slice(0, 10).map(c => Math.max(0, +c.avgDiff.toFixed(2))), color: '#ef4444' }]} height={200} />
                <ClickTable rows={bi.weightByCourier.slice(0, 10)} cols={[{ label: 'Courier', fn: r => r.key }, { label: 'Avg Δ', fn: r => `${r.avgDiff > 0 ? '+' : ''}${r.avgDiff.toFixed(2)}kg`, align: 'right' }, { label: '% over', fn: r => `${r.overPct.toFixed(0)}%`, align: 'right' }]} onPick={r => openDrill(`Courier weight gap: ${r.key}`, r.rows)} />
              </div>
            </div>
          </>)}
        </Section>

        {/* COD & RTO */}
        <Section title="COD Order-Total Buckets vs RTO" icon={Wallet} right={bi.worstCodBucket ? <span className="text-[10px] font-bold text-red-600">Worst: {bi.worstCodBucket.key} ({bi.worstCodBucket.rtoPct.toFixed(1)}% RTO)</span> : null}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <BarChart labels={bi.codBuckets.map(b => b.key)} datasets={[
              { label: 'Orders', data: bi.codBuckets.map(b => b.count), color: '#cbd5e1' },
              { label: 'RTO', data: bi.codBuckets.map(b => b.rto), color: '#ef4444' },
            ]} height={220} />
            <ClickTable rows={bi.codBuckets} cols={[
              { label: 'COD Bucket', fn: r => r.key },
              { label: 'Orders', fn: r => r.count, align: 'right' },
              { label: 'RTO', fn: r => r.rto, align: 'right' },
              { label: 'RTO %', fn: r => `${r.rtoPct.toFixed(1)}%`, align: 'right', color: r => r.rtoPct > 20 ? '#dc2626' : r.rtoPct > 10 ? '#f59e0b' : '#16a34a' },
              { label: 'Revenue', fn: r => currency(r.revenue), align: 'right' },
            ]} onPick={r => openDrill(`COD ${r.key}`, r.rows)} />
          </div>
        </Section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartTable compact title="Top Couriers by RTO %" icon={RotateCcw} items={bi.courierByRto} barColor="#ef4444" barFn={r => r.rtoPct}
            cols={[{ label: 'Courier', fn: r => r.key }, { label: 'RTO %', fn: r => `${r.rtoPct.toFixed(1)}%`, align: 'right', color: () => '#dc2626' }, { label: 'RTO/Tot', fn: r => `${r.rto}/${r.count}`, align: 'right' }]}
            onPick={r => openDrill(`RTO — ${r.key}`, r.rows.filter(x => x.isRTO))} />
          <ChartTable compact title="Top RTO Customers" icon={AlertTriangle} items={bi.rtoCustomers} barColor="#f97316" barFn={r => r.count}
            cols={[{ label: 'Customer', fn: r => r.key }, { label: 'RTO Orders', fn: r => r.count, align: 'right', color: () => '#dc2626' }, { label: 'Order Total', fn: r => currency(r.total), align: 'right' }]}
            onPick={r => openDrill(`RTO customer: ${r.key}`, r.rows)} />
        </div>

        <Section title="Zone × Courier — Highest RTO%" icon={Layers}>
          <MatrixList rows={bi.zoneCourierByRto.slice(0, 25)} cols={[
            { label: 'Zone', fn: r => r.zone }, { label: 'Courier', fn: r => r.courier },
            { label: 'Orders', fn: r => r.count, align: 'right' }, { label: 'RTO', fn: r => r.rto, align: 'right' },
            { label: 'RTO %', fn: r => `${r.rtoPct.toFixed(1)}%`, align: 'right', color: r => r.rtoPct > 20 ? '#dc2626' : '#f59e0b' },
          ]} onPick={r => openDrill(`${r.zone} · ${r.courier} — RTO`, r.rows.filter(x => x.isRTO))} />
        </Section>

        {/* MIS-ROUTE / pickup proximity */}
        <Section title="Mis-route — Pickup Pincode Proximity & Shipping Mis-rate" icon={Navigation}
          right={<span className="text-[10px] text-gray-400">{bi.uniqPickPins.length} pickup pincodes · {bi.misEvaluable} evaluable</span>}>
          {bi.uniqPickPins.length < 2 ? (
            <EmptyNote>Mis-route needs <strong>≥2 pickup locations</strong> with pincodes (to know if a closer warehouse existed) and a delivery pincode per order. Found {bi.uniqPickPins.length} pickup pincode(s) and {bi.withBothPin.length} orders with both pins. {pickupMap && Object.keys(pickupMap).length === 0 ? 'The pickup-locations API returned nothing — check Shiprocket API-user permissions.' : ''}</EmptyNote>
          ) : (<>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <KPICard title="Pickup locations" value={bi.uniqPickPins.length} icon={Store} color="indigo" />
              <button onClick={() => openDrill('Orders with both pins', bi.withBothPin)} className="text-left"><KPICard title="Evaluable" value={bi.misEvaluable} icon={MapPin} color="blue" /></button>
              <button onClick={() => openDrill('Mis-routed orders', bi.misrouted, 'a closer pickup existed')} className="text-left"><KPICard title="Mis-route %" value={`${bi.misRate.toFixed(1)}%`} icon={AlertTriangle} color="red" subtitle={`${bi.misrouted.length} orders`} /></button>
              <KPICard title="Optimal-routed" value={`${(100 - bi.misRate).toFixed(1)}%`} icon={CheckCircle} color="green" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <DoughnutChart title="Pickup → Delivery distance" labels={bi.proximity.map(p => p.key)} data={bi.proximity.map(p => p.count)} height={200} />
                <ClickTable rows={bi.proximity} cols={[{ label: 'Proximity', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }]} onPick={r => openDrill(`Proximity: ${r.key}`, r.rows)} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-600 mb-1">Mis-routes by actual pickup location</p>
                <ClickTable rows={bi.misByPickup} cols={[{ label: 'Pickup', fn: r => r.key }, { label: 'Mis-routed', fn: r => r.count, align: 'right', color: () => '#dc2626' }]} onPick={r => openDrill(`Mis-routed from ${r.key}`, r.rows)} />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[10px] font-bold text-gray-600 mb-1 flex items-center gap-1"><Boxes className="w-3 h-3" /> Top SKUs processed from a far / wrong pickup</p>
              <SkuMiniTable skus={bi.misSkus} showRev={false} />
            </div>
          </>)}
        </Section>

        {/* Courier deep-dive: attempt-wise, TAT, mishandling */}
        <Section title="Courier × Attempt — Delivery% · RTO% · TAT" icon={Activity}>
          {!bi.hasAttempts ? (
            <EmptyNote>NDR attempt counts aren't in the Shiprocket <code>/orders</code> feed; this activates once a <code>delivery_attempts</code> / NDR field is available.</EmptyNote>
          ) : (
            <MatrixList rows={bi.attemptStats} cols={[
              { label: 'Courier', fn: r => r.courier }, { label: 'Attempt', fn: r => r.attempt },
              { label: 'Orders', fn: r => r.count, align: 'right' },
              { label: 'Delivery %', fn: r => `${r.deliveryPct.toFixed(0)}%`, align: 'right', color: () => '#16a34a' },
              { label: 'RTO %', fn: r => `${r.rtoPct.toFixed(0)}%`, align: 'right', color: () => '#dc2626' },
              { label: 'TAT', fn: r => r.tats?.length ? `${r.avgTat.toFixed(1)}d` : '—', align: 'right' },
            ]} onPick={r => openDrill(`${r.courier} · attempt ${r.attempt}`, r.rows)} />
          )}
        </Section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Zone × Courier — Worst TAT" icon={Clock}>
            {bi.zoneCourierByTat.length ? (
              <MatrixList rows={bi.zoneCourierByTat.slice(0, 18)} cols={[
                { label: 'Zone', fn: r => r.zone }, { label: 'Courier', fn: r => r.courier },
                { label: 'Avg TAT', fn: r => `${r.avgTat.toFixed(1)}d`, align: 'right', color: () => '#4f46e5' }, { label: 'n', fn: r => r.tatCount, align: 'right' },
              ]} onPick={r => openDrill(`${r.zone} · ${r.courier} — TAT`, r.rows)} />
            ) : <EmptyNote>Needs delivery dates to compute TAT.</EmptyNote>}
          </Section>
          <Section title="Zone × Courier × City — Worst TAT" icon={MapPin}>
            {bi.zoneCourierCity.length ? (
              <MatrixList rows={bi.zoneCourierCity.slice(0, 18)} cols={[
                { label: 'Zone', fn: r => r.zone }, { label: 'Courier', fn: r => r.courier }, { label: 'City', fn: r => r.city },
                { label: 'TAT', fn: r => `${r.avgTat.toFixed(1)}d`, align: 'right', color: () => '#4f46e5' }, { label: 'n', fn: r => r.count, align: 'right' },
              ]} onPick={r => openDrill(`${r.city} · ${r.courier} — TAT`, r.rows)} />
            ) : <EmptyNote>Needs delivery dates to compute TAT.</EmptyNote>}
          </Section>
        </div>

        <Section title="Courier Mishandling % & Revenue Loss (damage / lost / discard)" icon={AlertTriangle} right={<span className="text-[10px] font-bold text-red-600">Total loss {currency(bi.totalLoss)}</span>}>
          {bi.mishandleByCourier.length ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <BarChart horizontal labels={bi.mishandleByCourier.slice(0, 10).map(c => c.key)} datasets={[{ label: 'Revenue loss', data: bi.mishandleByCourier.slice(0, 10).map(c => Math.round(c.loss)), color: '#ef4444' }]} height={200} />
              <ClickTable rows={bi.mishandleByCourier} cols={[
                { label: 'Courier', fn: r => r.key }, { label: 'Mishandled', fn: r => r.mis, align: 'right' },
                { label: 'Mishandle %', fn: r => `${r.misPct.toFixed(2)}%`, align: 'right', color: () => '#dc2626' },
                { label: 'Revenue Loss', fn: r => currency(r.loss), align: 'right' },
              ]} onPick={r => openDrill(`Mishandled — ${r.key}`, r.rows)} />
            </div>
          ) : <EmptyNote>No statuses matching damage / lost / discard / missing in current data.</EmptyNote>}
        </Section>

        {/* Ageing */}
        <Section title="Ageing — In-Transit & RTO" icon={Clock} right={<button onClick={() => openDrill('Stuck > 10 days', bi.aged10, 'in pipeline over 10 days')} className="text-[10px] font-bold text-red-600 hover:underline">Stuck &gt;10d: {bi.aged10.length}</button>}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <BarChart labels={bi.intransitAgeing.map(b => b.key)} datasets={[{ label: 'In-Transit', data: bi.intransitAgeing.map(b => b.count), color: '#6366f1' }]} height={190} />
              <ClickTable rows={bi.intransitAgeing} cols={[{ label: 'Age (days)', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }, { label: 'Revenue', fn: r => currency(r.revenue), align: 'right' }]} onPick={r => openDrill(`In-transit age ${r.key}d`, r.rows)} />
            </div>
            <div>
              <BarChart labels={bi.rtoAgeing.map(b => b.key)} datasets={[{ label: 'RTO In-Transit', data: bi.rtoAgeing.map(b => b.count), color: '#ef4444' }]} height={190} />
              <ClickTable rows={bi.rtoAgeing} cols={[{ label: 'Age (days)', fn: r => r.key }, { label: 'RTO Orders', fn: r => r.count, align: 'right' }, { label: 'Revenue', fn: r => currency(r.revenue), align: 'right' }]} onPick={r => openDrill(`RTO age ${r.key}d`, r.rows)} />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            <div>
              <p className="text-[10px] font-bold text-gray-600 mb-1">Stuck &gt;10 days — status-wise</p>
              <ClickTable rows={bi.aged10ByStatus} cols={[{ label: 'Status', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }]} onPick={r => openDrill(`Stuck >10d · ${r.key}`, r.rows)} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-600 mb-1">Stuck &gt;10 days — courier breakup</p>
              <ClickTable rows={bi.aged10ByCourier} cols={[{ label: 'Courier', fn: r => r.key }, { label: 'Orders', fn: r => r.count, align: 'right' }]} onPick={r => openDrill(`Stuck >10d · ${r.key}`, r.rows)} />
            </div>
          </div>
        </Section>

        {/* Dark store */}
        <Section title="Dark-Store Suggestions (highest-opportunity delivery clusters)" icon={Store} right={<span className="text-[9px] text-gray-400">3-digit PIN district · scored by volume × TAT</span>}>
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-3 py-2 text-left font-semibold text-gray-500">PIN District</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Region</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Top City</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500">Orders</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500">Customers</th>
              <th className="px-3 py-2 text-right font-semibold text-indigo-600">Avg TAT</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600">Revenue</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {bi.darkStore.map((d, i) => (
                <tr key={d.key} className={`hover:bg-emerald-50/40 cursor-pointer ${i < 3 ? 'bg-emerald-50/30' : ''}`} onClick={() => openDrill(`PIN ${d.key}xxx (${d.topCity})`, d.rows)}>
                  <td className="px-3 py-1.5 font-mono font-bold">{d.key}xxx{i < 3 && <span className="ml-1 text-[8px] px-1 py-0.5 bg-emerald-600 text-white rounded">SUGGEST</span>}</td>
                  <td className="px-3 py-1.5 text-gray-500">{d.region}</td>
                  <td className="px-3 py-1.5">{d.topCity}</td>
                  <td className="px-3 py-1.5 text-right font-bold">{d.count}</td>
                  <td className="px-3 py-1.5 text-right">{d.customers}</td>
                  <td className="px-3 py-1.5 text-right">{d.tatCount ? `${d.avgTat.toFixed(1)}d` : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{currency(d.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="text-[9px] text-gray-400 mt-2">High order volume + slow TAT = strongest dark-store candidate. Top 3 flagged.</p>
        </Section>

        {/* Freight */}
        <Section title="Freight — Zone × Weight-slab Total" icon={Boxes}>
          {!bi.hasFreight && <div className="mb-2"><EmptyNote>Freight charges aren't in the <code>/orders</code> feed (they live in Shiprocket billing/passbook). The grid shows order <strong>counts</strong> for now and fills with amounts once a <code>freight_charges</code> field is present.</EmptyNote></div>}
          <FreightGrid bi={bi} openDrill={openDrill} />
        </Section>

        {/* Top SKUs + coverage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Top 20 SKUs by Quantity" icon={Layers}>
            <SkuMiniTable skus={bi.topSkus} showRev={true} />
          </Section>
          <Section title="Data Coverage — what the live feed actually returns" icon={Search}>
            <p className="text-[10px] text-gray-500 mb-2">% of loaded orders carrying each field. Low coverage = that module shows an empty state until the field is present.</p>
            <div className="space-y-1.5">
              {bi.coverage.map(c => (
                <div key={c.label} className="flex items-center gap-2 text-[11px]">
                  <span className="w-40 text-gray-700">{c.label}</span>
                  <div className="flex-1 h-3.5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded" style={{ width: `${c.pct}%`, background: c.pct > 60 ? '#10b981' : c.pct > 20 ? '#f59e0b' : '#ef4444' }} /></div>
                  <span className="w-20 text-right font-mono text-gray-600">{c.pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </>)}

      {drill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-indigo-700">{drill.title}</h3>
                <p className="text-[10px] text-gray-500">{drill.rows.length} orders · {currency(drill.rows.reduce((s, r) => s + r.total, 0))}{drill.note ? ` · ${drill.note}` : ''}</p>
              </div>
              <button onClick={() => setDrill(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4"><DataTable data={drill.rows} columns={DRILL_COLS} pageSize={25} exportFilename="shopify-analytics" /></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== reusable view bits ===================== */
const DRILL_COLS = [
  { key: 'orderId', label: 'Order ID' },
  { key: 'channel', label: 'Channel' },
  { key: 'customer', label: 'Customer' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'deliveryPin', label: 'Del PIN' },
  { key: 'pickupName', label: 'Pickup' },
  { key: 'pickupPin', label: 'Pickup PIN' },
  { key: 'payment', label: 'Pay' },
  { key: 'total', label: 'Total', render: v => currency(parseFloat(v) || 0) },
  { key: 'status', label: 'Status' },
  { key: 'courier', label: 'Courier' },
  { key: 'zoneLabel', label: 'Zone' },
  { key: 'skuWeight', label: 'SKU Wt', render: v => v ? `${v} kg` : '—' },
  { key: 'chargedWeight', label: 'Chg Wt', render: v => v ? `${v} kg` : '—' },
  { key: 'weightDiff', label: 'Δ Wt', render: v => v == null ? '—' : `${v > 0 ? '+' : ''}${v} kg` },
  { key: 'tat', label: 'TAT', render: v => v == null ? '—' : `${v}d` },
  { key: 'ageDays', label: 'Age', render: v => v == null ? '—' : `${v}d` },
  { key: 'awb', label: 'AWB' },
  { key: 'createdStr', label: 'Created' },
];

function Section({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-indigo-500" />}
        <h3 className="text-[11px] font-bold text-gray-700">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

const EmptyNote = ({ children }) => (
  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[10px] text-amber-700 flex items-start gap-1.5">
    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> <span>{children}</span>
  </div>
);

/* Section that pairs a horizontal bar chart with a clickable table (graph + table). */
function ChartTable({ title, icon, items, cols, onPick, barColor = '#6366f1', barFn, note, compact }) {
  const top = items.slice(0, compact ? 10 : 12);
  const labels = top.map(r => cols[0].fn(r));
  const values = top.map(r => barFn ? barFn(r) : r.count);
  return (
    <Section title={title} icon={icon}>
      <div className={`grid grid-cols-1 ${compact ? '' : 'lg:grid-cols-2'} gap-3`}>
        <BarChart horizontal labels={labels} datasets={[{ label: cols[1] ? cols[1].label : 'Value', data: values, color: barColor }]} height={Math.max(180, top.length * 22 + 30)} />
        <ClickTable rows={items} cols={cols} onPick={onPick} />
      </div>
      {note && <div className="mt-2"><EmptyNote>{note}</EmptyNote></div>}
    </Section>
  );
}

function ClickTable({ rows, cols, onPick }) {
  if (!rows.length) return <EmptyNote>No rows.</EmptyNote>;
  return (
    <div className="overflow-x-auto max-h-[340px] overflow-y-auto"><table className="w-full text-[11px]">
      <thead className="sticky top-0"><tr className="bg-gray-50 border-b border-gray-100">
        {cols.map(c => <th key={c.label} className={`px-3 py-2 font-semibold text-gray-500 bg-gray-50 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-indigo-50/30 cursor-pointer" onClick={() => onPick && onPick(r)}>
            {cols.map(c => <td key={c.label} className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right font-mono' : 'text-left'}`} style={c.color ? { color: c.color(r), fontWeight: 700 } : undefined}>{c.fn(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function MatrixList({ rows, cols, onPick }) {
  if (!rows.length) return <EmptyNote>No rows.</EmptyNote>;
  return (
    <div className="overflow-x-auto max-h-[420px] overflow-y-auto"><table className="w-full text-[11px]">
      <thead className="sticky top-0"><tr className="bg-gray-50 border-b border-gray-100">
        {cols.map(c => <th key={c.label} className={`px-3 py-2 font-semibold text-gray-500 bg-gray-50 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-indigo-50/30 cursor-pointer" onClick={() => onPick && onPick(r)}>
            {cols.map(c => <td key={c.label} className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right' : 'text-left'}`} style={c.color ? { color: c.color(r), fontWeight: 700 } : undefined}>{c.fn(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function SkuMiniTable({ skus, showRev }) {
  if (!skus.length) return <EmptyNote>No SKUs.</EmptyNote>;
  return (
    <div className="overflow-x-auto max-h-[340px] overflow-y-auto"><table className="w-full text-[11px]">
      <thead className="sticky top-0"><tr className="bg-gray-50 border-b border-gray-100">
        <th className="px-3 py-2 text-left font-semibold text-gray-500 bg-gray-50">SKU</th>
        <th className="px-3 py-2 text-left font-semibold text-gray-500 bg-gray-50">Product</th>
        <th className="px-3 py-2 text-right font-semibold text-gray-500 bg-gray-50">Qty</th>
        <th className="px-3 py-2 text-right font-semibold text-gray-500 bg-gray-50">Orders</th>
        {showRev && <th className="px-3 py-2 text-right font-semibold text-emerald-600 bg-gray-50">Revenue</th>}
      </tr></thead>
      <tbody className="divide-y divide-gray-50">
        {skus.map(s => (
          <tr key={s.sku} className="hover:bg-rose-50/30">
            <td className="px-3 py-1.5 font-mono text-[10px]">{s.sku}</td>
            <td className="px-3 py-1.5 truncate max-w-[240px]" title={s.name}>{s.name}</td>
            <td className="px-3 py-1.5 text-right font-bold">{s.qty}</td>
            <td className="px-3 py-1.5 text-right text-gray-500">{s.orders}</td>
            {showRev && <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{currency(s.revenue)}</td>}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function FreightGrid({ bi, openDrill }) {
  const { cells, zones } = bi.freightMatrix;
  const cell = (z, slab) => cells[z + '||' + slab];
  if (!zones.length) return <EmptyNote>No weighted orders to grid.</EmptyNote>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-[11px]">
      <thead><tr className="bg-gray-50 border-b border-gray-100">
        <th className="px-3 py-2 text-left font-semibold text-gray-500">Zone \ Wt (kg)</th>
        {WEIGHT_SLABS.map(s => <th key={s} className="px-3 py-2 text-right font-semibold text-gray-500">{s}</th>)}
        <th className="px-3 py-2 text-right font-semibold text-indigo-600">Total</th>
      </tr></thead>
      <tbody className="divide-y divide-gray-50">
        {zones.map(z => {
          const rowTotal = WEIGHT_SLABS.reduce((s, slab) => s + (cell(z, slab)?.freight || 0), 0);
          return (
            <tr key={z} className="hover:bg-indigo-50/20">
              <td className="px-3 py-1.5 font-medium">{z}</td>
              {WEIGHT_SLABS.map(slab => {
                const c = cell(z, slab);
                return <td key={slab} className="px-3 py-1.5 text-right font-mono cursor-pointer hover:underline" onClick={() => c && openDrill(`${z} · ${slab}kg`, c.rows)}>{c ? (c.freight > 0 ? currency(c.freight) : c.count) : '—'}<span className="block text-[8px] text-gray-400">{c ? `${c.count} ord` : ''}</span></td>;
              })}
              <td className="px-3 py-1.5 text-right font-mono font-bold text-indigo-700">{rowTotal > 0 ? currency(rowTotal) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}
