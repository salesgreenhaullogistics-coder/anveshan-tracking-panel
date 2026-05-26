/**
 * Shopify / Shiprocket BI engine — pure (no React) so it stays testable and the
 * page file stays focused on rendering. Normalises raw Shiprocket orders and
 * computes every analytics module used by the Shopify Analytics page.
 */
import { orderSkuWeightKg, cleanPincode, pinDistrict, pinRegion, deriveZone, pinProximity } from './skuWeight';

export const LOAD_TARGETS = [
  { label: 'Last ~600', value: 600 },
  { label: 'Last ~2,000', value: 2000 },
  { label: 'Last ~5,000', value: 5000 },
  { label: 'Last ~10,000', value: 10000 },
  { label: 'Max available', value: Infinity },
];

export const srNum = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export const srTxt = (v, fb = '') => { const s = String(v == null ? '' : v).trim(); return s || fb; };
const srDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };

export function srStage(status) {
  const s = String(status || '').toLowerCase();
  if (/cancel/.test(s)) return 'Cancelled';
  if (/rto|return/.test(s)) return 'RTO';
  /* Failed-attempt / NDR states are STILL in the pipeline — they must not be
     read as "delivered" just because the word contains "delivered". */
  if (/undelivered|undeliverd|not delivered|delivery failed|failed delivery|delivery exception|ndr/.test(s)) return 'In Transit';
  if (/\bdelivered\b/.test(s)) return 'Delivered';
  if (/transit|shipped|dispatch|out for delivery|ofd|en[-\s]?route|reached|in[-\s]?scan|received at/.test(s)) return 'In Transit';
  if (/pickup|manifest|ready|picked/.test(s)) return 'Ready/Pickup';
  if (/new|order placed|invoiced|pending|processing|confirmed/.test(s)) return 'New';
  return 'Other';
}

const IN_PIPELINE = ['New', 'Ready/Pickup', 'In Transit'];
const MISHANDLE_RE = /damage|lost|missing|discard|destroy|untrace/i;

export const AGE_BUCKETS = ['0-3', '4-7', '8-10', '11-15', '16-30', '30+'];
const ageBucketOf = (d) => d <= 3 ? '0-3' : d <= 7 ? '4-7' : d <= 10 ? '8-10' : d <= 15 ? '11-15' : d <= 30 ? '16-30' : '30+';

export const COD_BUCKETS = ['< ₹500', '₹500–999', '₹1k–1.9k', '₹2k–2.9k', '₹3k–4.9k', '₹5k+'];
const codBucketOf = (t) => t < 500 ? '< ₹500' : t < 1000 ? '₹500–999' : t < 2000 ? '₹1k–1.9k' : t < 3000 ? '₹2k–2.9k' : t < 5000 ? '₹3k–4.9k' : '₹5k+';

export const WEIGHT_SLABS = ['0–0.5', '0.5–1', '1–2', '2–5', '5–10', '10+'];
const weightSlabOf = (w) => w <= 0.5 ? '0–0.5' : w <= 1 ? '0.5–1' : w <= 2 ? '1–2' : w <= 5 ? '2–5' : w <= 10 ? '5–10' : '10+';

const PROX_RANK = { same: 0, district: 1, region: 2, far: 3, unknown: 9 };

export const pctNum = (part, total) => total ? (part / total * 100) : 0;
export const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

/* Build a name->pincode lookup from the pickup-locations API list. */
export function buildPickupMap(pickups) {
  const m = {};
  (Array.isArray(pickups) ? pickups : []).forEach(p => {
    const key = String(p.name || '').trim().toLowerCase();
    const pin = cleanPincode(p.pincode);
    if (key && pin) m[key] = { pin, city: p.city, state: p.state };
  });
  return m;
}

export function normalizeOrders(raw, pickupMap = {}) {
  return raw.map((o, i) => {
    const created = srDate(o.created_at || o.order_date || o.channel_created_at);
    const products = Array.isArray(o.products) ? o.products : [];
    const status = srTxt(o.status, 'Unknown');
    const stage = srStage(status);
    const channel = srTxt(o.channel_name || o.channel, 'Unknown');
    const pay = srTxt(o.payment_method, 'Prepaid');
    const deliveryPin = cleanPincode(o.customer_pincode);
    const pickupName = srTxt(o.pickup_location, '');
    const mapped = pickupMap[pickupName.toLowerCase()];
    const pickupPin = cleanPincode(o.pickup_pincode) || (mapped ? mapped.pin : '');
    const chargedWeight = srNum(o.weight);
    const skuW = orderSkuWeightKg(products);
    const delivered = srDate(o.delivered_date);
    const shipped = srDate(o.shipped_date);
    /* TAT = days from ship/pickup (or order date as fallback) to delivery.
       Sanity-clamp to 0..90 days so garbage dates can't blow up the average. */
    let tat = null;
    const tatBase = shipped || created;
    if (delivered && tatBase) {
      const d = Math.round((delivered.getTime() - tatBase.getTime()) / 86400000);
      if (d >= 0 && d <= 90) tat = d;
    }
    const attempts = srNum(o.delivery_attempts);
    const zoneRaw = srTxt(o.zone);
    const dZone = deriveZone(pickupPin, deliveryPin);
    const ageDays = created ? Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000)) : null;
    return {
      _i: i,
      orderId: srTxt(o.channel_order_id || o.order_id || o.id),
      channel,
      customer: srTxt(o.customer_name, '—'),
      city: srTxt(o.customer_city || o.city, '—'),
      state: srTxt(o.customer_state || o.state, '—'),
      payment: /cod|cash/i.test(pay) ? 'COD' : 'Prepaid',
      total: srNum(o.total),
      status, stage,
      isRTO: stage === 'RTO',
      isDelivered: stage === 'Delivered',
      inPipeline: IN_PIPELINE.includes(stage),
      isMishandled: MISHANDLE_RE.test(status),
      courier: srTxt(o.courier_name || o.courier, '—'),
      awb: srTxt(o.awb_code || o.awb),
      created, ageDays,
      createdStr: created ? created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—',
      products,
      sku: products[0] ? srTxt(products[0].channel_sku || products[0].sku || products[0].name) : '—',
      qty: products.reduce((s, p) => s + srNum(p.quantity), 0),
      deliveryPin,
      pickupName: pickupName || '—',
      pickupPin,
      chargedWeight,
      skuWeight: skuW.kg,
      weightDiff: (chargedWeight > 0 && skuW.kg > 0) ? Math.round((chargedWeight - skuW.kg) * 1000) / 1000 : null,
      tat, attempts,
      zoneRaw,
      zone: zoneRaw || dZone,
      zoneLabel: zoneRaw || (dZone ? `${dZone} (derived)` : '—'),
      freight: srNum(o.freight_charges),
    };
  });
}

function groupRich(data, keyFn) {
  const m = {};
  data.forEach(o => {
    const k = keyFn(o) || '—';
    if (!m[k]) m[k] = { key: k, count: 0, revenue: 0, delivered: 0, rto: 0, tats: [], rows: [] };
    const g = m[k];
    g.count++; g.revenue += o.total;
    if (o.isDelivered) g.delivered++;
    if (o.isRTO) g.rto++;
    if (o.tat != null) g.tats.push(o.tat);
    g.rows.push(o);
  });
  return Object.values(m).map(g => ({
    ...g,
    deliveryPct: pctNum(g.delivered, g.count),
    rtoPct: pctNum(g.rto, g.count),
    avgTat: avg(g.tats),
    tatCount: g.tats.length,
  }));
}

export function computeBI(data, { wThreshold = 0.5, pickupPins = [] } = {}) {
  const n = data.length;
  const revenue = data.reduce((s, o) => s + o.total, 0);
  const cod = data.filter(o => o.payment === 'COD');
  const prepaid = data.filter(o => o.payment === 'Prepaid');
  const delivered = data.filter(o => o.isDelivered);
  const rto = data.filter(o => o.isRTO);

  const byStatus = groupRich(data, o => o.status).sort((a, b) => b.count - a.count);
  const byCourier = groupRich(data, o => o.courier).sort((a, b) => b.count - a.count);
  const byCity = groupRich(data, o => o.city).sort((a, b) => b.revenue - a.revenue);
  const byState = groupRich(data, o => o.state).sort((a, b) => b.revenue - a.revenue);

  /* daily trend */
  const daily = (() => {
    const m = {};
    data.forEach(o => { if (!o.created) return; const k = o.created.toISOString().slice(0, 10); if (!m[k]) m[k] = { date: o.created, label: o.createdStr, count: 0, revenue: 0 }; m[k].count++; m[k].revenue += o.total; });
    return Object.values(m).sort((a, b) => a.date - b.date);
  })();

  /* ---- Weight reconciliation ---- */
  const withBothW = data.filter(o => o.weightDiff != null);
  const skuWeightOnly = data.filter(o => o.skuWeight > 0).length;
  const chargedWeightOnly = data.filter(o => o.chargedWeight > 0).length;
  const overCharged = withBothW.filter(o => o.weightDiff > wThreshold);
  const underCharged = withBothW.filter(o => o.weightDiff < -wThreshold);
  const wDiffBuckets = (() => {
    const labels = ['≤ -1', '-1–-0.5', '-0.5–0.5', '0.5–1', '1–2', '2+'];
    const map = {}; labels.forEach(l => map[l] = { key: l, count: 0, rows: [] });
    withBothW.forEach(o => {
      const d = o.weightDiff;
      const l = d <= -1 ? '≤ -1' : d < -0.5 ? '-1–-0.5' : d <= 0.5 ? '-0.5–0.5' : d <= 1 ? '0.5–1' : d <= 2 ? '1–2' : '2+';
      map[l].count++; map[l].rows.push(o);
    });
    return labels.map(l => map[l]);
  })();
  const weightByCourier = (() => {
    const m = {};
    withBothW.forEach(o => {
      if (!m[o.courier]) m[o.courier] = { key: o.courier, count: 0, diffs: [], over: 0, rows: [] };
      m[o.courier].count++; m[o.courier].diffs.push(o.weightDiff);
      if (o.weightDiff > wThreshold) m[o.courier].over++;
      m[o.courier].rows.push(o);
    });
    return Object.values(m).map(g => ({ ...g, avgDiff: avg(g.diffs), overPct: pctNum(g.over, g.count) }))
      .sort((a, b) => b.avgDiff - a.avgDiff);
  })();

  /* ---- COD buckets vs RTO ---- */
  const codBuckets = (() => {
    const map = {}; COD_BUCKETS.forEach(b => map[b] = { key: b, count: 0, rto: 0, revenue: 0, rows: [] });
    cod.forEach(o => { const b = codBucketOf(o.total); map[b].count++; map[b].revenue += o.total; if (o.isRTO) map[b].rto++; map[b].rows.push(o); });
    return COD_BUCKETS.map(b => ({ ...map[b], rtoPct: pctNum(map[b].rto, map[b].count) }));
  })();
  const worstCodBucket = codBuckets.filter(b => b.count >= 5).slice().sort((a, b) => b.rtoPct - a.rtoPct)[0] || null;

  const courierByRto = byCourier.filter(c => c.count >= 5).slice().sort((a, b) => b.rtoPct - a.rtoPct);
  const courierByRtoCount = byCourier.slice().sort((a, b) => b.rto - a.rto);

  /* zone x courier */
  const zoneCourier = (() => {
    const m = {};
    data.forEach(o => {
      const key = (o.zoneLabel || '—') + '||' + (o.courier || '—');
      if (!m[key]) m[key] = { zone: o.zoneLabel || '—', courier: o.courier || '—', count: 0, rto: 0, delivered: 0, tats: [], rows: [] };
      const g = m[key]; g.count++; if (o.isRTO) g.rto++; if (o.isDelivered) g.delivered++; if (o.tat != null) g.tats.push(o.tat); g.rows.push(o);
    });
    return Object.values(m).map(g => ({ ...g, rtoPct: pctNum(g.rto, g.count), avgTat: avg(g.tats), tatCount: g.tats.length }));
  })();
  const zoneCourierByRto = zoneCourier.filter(g => g.count >= 5).sort((a, b) => b.rtoPct - a.rtoPct);
  const zoneCourierByTat = zoneCourier.filter(g => g.tatCount >= 3).sort((a, b) => b.avgTat - a.avgTat);

  const zoneCourierCity = (() => {
    const m = {};
    data.forEach(o => {
      if (o.tat == null) return;
      const key = (o.zoneLabel || '—') + '||' + (o.courier || '—') + '||' + (o.city || '—');
      if (!m[key]) m[key] = { zone: o.zoneLabel || '—', courier: o.courier || '—', city: o.city || '—', tats: [], rows: [] };
      m[key].tats.push(o.tat); m[key].rows.push(o);
    });
    return Object.values(m).map(g => ({ ...g, avgTat: avg(g.tats), count: g.tats.length }))
      .filter(g => g.count >= 3).sort((a, b) => b.avgTat - a.avgTat);
  })();

  const rtoCustomers = (() => {
    const m = {};
    rto.forEach(o => { const k = o.customer || '—'; if (!m[k]) m[k] = { key: k, count: 0, total: 0, rows: [] }; m[k].count++; m[k].total += o.total; m[k].rows.push(o); });
    return Object.values(m).sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 30);
  })();

  /* ---- attempts ---- */
  const hasAttempts = data.some(o => o.attempts > 0);
  const attemptStats = (() => {
    const m = {};
    data.forEach(o => {
      if (!(o.attempts > 0)) return;
      const a = o.attempts >= 4 ? '4+' : String(o.attempts);
      const key = o.courier + '||' + a;
      if (!m[key]) m[key] = { courier: o.courier, attempt: a, count: 0, delivered: 0, rto: 0, tats: [], rows: [] };
      const g = m[key]; g.count++; if (o.isDelivered) g.delivered++; if (o.isRTO) g.rto++; if (o.tat != null) g.tats.push(o.tat); g.rows.push(o);
    });
    return Object.values(m).map(g => ({ ...g, deliveryPct: pctNum(g.delivered, g.count), rtoPct: pctNum(g.rto, g.count), avgTat: avg(g.tats) }))
      .sort((a, b) => a.courier.localeCompare(b.courier) || a.attempt.localeCompare(b.attempt));
  })();

  /* ---- mishandling ---- */
  const mishandleByCourier = (() => {
    const m = {};
    data.forEach(o => {
      if (!m[o.courier]) m[o.courier] = { key: o.courier, count: 0, mis: 0, loss: 0, rows: [] };
      m[o.courier].count++;
      if (o.isMishandled) { m[o.courier].mis++; m[o.courier].loss += o.total; m[o.courier].rows.push(o); }
    });
    return Object.values(m).map(g => ({ ...g, misPct: pctNum(g.mis, g.count) })).filter(g => g.mis > 0).sort((a, b) => b.loss - a.loss);
  })();
  const totalLoss = data.filter(o => o.isMishandled).reduce((s, o) => s + o.total, 0);

  /* ---- MISROUTE / pickup proximity ---- */
  const uniqPickPins = Array.from(new Set((pickupPins || []).map(cleanPincode).filter(Boolean)));
  const proxRank = (a, b) => PROX_RANK[pinProximity(a, b)] ?? 9;
  const withBothPin = data.filter(o => o.pickupPin && o.deliveryPin);
  const proximity = (() => {
    const labels = ['same', 'district', 'region', 'far'];
    const map = {}; labels.forEach(l => map[l] = { key: l, count: 0, rows: [] });
    withBothPin.forEach(o => { const p = pinProximity(o.pickupPin, o.deliveryPin); if (map[p]) { map[p].count++; map[p].rows.push(o); } });
    return labels.map(l => map[l]);
  })();
  /* Mis-route = a strictly closer pickup location existed than the one actually used. */
  const misrouteEval = (uniqPickPins.length > 1) ? withBothPin.map(o => {
    const actual = proxRank(o.pickupPin, o.deliveryPin);
    let best = 9;
    for (const pp of uniqPickPins) { const r = proxRank(pp, o.deliveryPin); if (r < best) best = r; }
    return { o, actual, best, misrouted: actual > best };
  }) : [];
  const misrouted = misrouteEval.filter(e => e.misrouted).map(e => e.o);
  const misEvaluable = misrouteEval.length;
  const misRate = misEvaluable ? pctNum(misrouted.length, misEvaluable) : 0;
  const misSkus = (() => {
    const m = {};
    misrouted.forEach(o => o.products.forEach(p => {
      const k = srTxt(p.channel_sku || p.sku || p.name, '—');
      if (!m[k]) m[k] = { sku: k, name: srTxt(p.name, k), qty: 0, orders: 0 };
      m[k].qty += srNum(p.quantity); m[k].orders++;
    }));
    return Object.values(m).sort((a, b) => b.qty - a.qty).slice(0, 20);
  })();
  /* mis-route by actual pickup location (which warehouse over-ships far parcels) */
  const misByPickup = (() => {
    const m = {};
    misrouted.forEach(o => { const k = o.pickupName || '—'; if (!m[k]) m[k] = { key: k, count: 0, rows: [] }; m[k].count++; m[k].rows.push(o); });
    return Object.values(m).sort((a, b) => b.count - a.count);
  })();

  /* top SKUs overall */
  const topSkus = (() => {
    const m = {};
    data.forEach(o => o.products.forEach(p => {
      const k = srTxt(p.channel_sku || p.sku || p.name, '—');
      if (!m[k]) m[k] = { sku: k, name: srTxt(p.name, k), qty: 0, orders: 0, revenue: 0 };
      m[k].qty += srNum(p.quantity); m[k].orders++; m[k].revenue += srNum(p.selling_price || p.price) * srNum(p.quantity);
    }));
    return Object.values(m).sort((a, b) => b.qty - a.qty).slice(0, 20);
  })();

  /* ---- dark store ---- */
  const darkStore = (() => {
    const m = {};
    data.forEach(o => {
      const d = pinDistrict(o.deliveryPin);
      if (!d) return;
      if (!m[d]) m[d] = { key: d, region: pinRegion(o.deliveryPin), count: 0, revenue: 0, customers: new Set(), tats: [], rto: 0, cities: {}, rows: [] };
      const g = m[d]; g.count++; g.revenue += o.total; g.customers.add(o.customer); if (o.tat != null) g.tats.push(o.tat); if (o.isRTO) g.rto++;
      g.cities[o.city] = (g.cities[o.city] || 0) + 1; g.rows.push(o);
    });
    return Object.values(m).map(g => {
      const topCity = Object.entries(g.cities).sort((a, b) => b[1] - a[1])[0];
      const avgTat = avg(g.tats);
      const score = g.count * (avgTat > 0 ? avgTat : 3);
      return { ...g, customers: g.customers.size, avgTat, tatCount: g.tats.length, topCity: topCity ? topCity[0] : '—', score };
    }).sort((a, b) => b.score - a.score).slice(0, 15);
  })();

  /* ---- ageing ---- */
  const pipeline = data.filter(o => o.inPipeline && o.ageDays != null);
  const intransitAgeing = (() => {
    const map = {}; AGE_BUCKETS.forEach(b => map[b] = { key: b, count: 0, revenue: 0, rows: [] });
    pipeline.forEach(o => { const b = ageBucketOf(o.ageDays); map[b].count++; map[b].revenue += o.total; map[b].rows.push(o); });
    return AGE_BUCKETS.map(b => map[b]);
  })();
  const aged10 = pipeline.filter(o => o.ageDays > 10);
  const aged10ByStatus = (() => {
    const m = {};
    aged10.forEach(o => { const k = o.status; if (!m[k]) m[k] = { key: k, count: 0, rows: [] }; m[k].count++; m[k].rows.push(o); });
    return Object.values(m).sort((a, b) => b.count - a.count);
  })();
  const aged10ByCourier = (() => {
    const m = {};
    aged10.forEach(o => { const k = o.courier; if (!m[k]) m[k] = { key: k, count: 0, rows: [] }; m[k].count++; m[k].rows.push(o); });
    return Object.values(m).sort((a, b) => b.count - a.count);
  })();
  const rtoPipeline = rto.filter(o => !o.isDelivered && o.ageDays != null);
  const rtoAgeing = (() => {
    const map = {}; AGE_BUCKETS.forEach(b => map[b] = { key: b, count: 0, revenue: 0, rows: [] });
    rtoPipeline.forEach(o => { const b = ageBucketOf(o.ageDays); map[b].count++; map[b].revenue += o.total; map[b].rows.push(o); });
    return AGE_BUCKETS.map(b => map[b]);
  })();

  /* ---- freight ---- */
  const hasFreight = data.some(o => o.freight > 0);
  const freightMatrix = (() => {
    const zones = Array.from(new Set(data.map(o => o.zoneLabel || '—')));
    const m = {};
    data.forEach(o => {
      const w = o.chargedWeight > 0 ? o.chargedWeight : o.skuWeight;
      if (!(w > 0)) return;
      const slab = weightSlabOf(w);
      const z = o.zoneLabel || '—';
      const key = z + '||' + slab;
      if (!m[key]) m[key] = { zone: z, slab, count: 0, freight: 0, rows: [] };
      m[key].count++; m[key].freight += o.freight; m[key].rows.push(o);
    });
    return { cells: m, zones: zones.sort() };
  })();

  /* ---- field coverage ---- */
  const coverage = (() => {
    const fields = [
      ['Delivery pincode', o => !!o.deliveryPin],
      ['Pickup pincode', o => !!o.pickupPin],
      ['Charged weight (KG)', o => o.chargedWeight > 0],
      ['SKU-inferred weight', o => o.skuWeight > 0],
      ['Delivered date (TAT)', o => o.tat != null],
      ['Shiprocket zone', o => !!o.zoneRaw],
      ['Freight charges', o => o.freight > 0],
      ['NDR attempts', o => o.attempts > 0],
    ];
    return fields.map(([label, fn]) => { const c = data.filter(fn).length; return { label, count: c, pct: pctNum(c, n) }; });
  })();

  return {
    n, revenue, aov: n ? revenue / n : 0, cod, prepaid, delivered, rto,
    deliveryPct: pctNum(delivered.length, n), rtoPct: pctNum(rto.length, n),
    daily, byStatus, byCourier, byCity, byState,
    withBothW, skuWeightOnly, chargedWeightOnly, overCharged, underCharged, wDiffBuckets, weightByCourier, avgWeightDiff: avg(withBothW.map(o => o.weightDiff)),
    codBuckets, worstCodBucket, courierByRto, courierByRtoCount,
    zoneCourierByRto, zoneCourierByTat, zoneCourierCity, rtoCustomers,
    hasAttempts, attemptStats, mishandleByCourier, totalLoss,
    uniqPickPins, withBothPin, proximity, misrouted, misEvaluable, misRate, misSkus, misByPickup,
    topSkus, darkStore,
    pipeline, intransitAgeing, aged10, aged10ByStatus, aged10ByCourier, rtoPipeline, rtoAgeing,
    hasFreight, freightMatrix, coverage, allData: data,
  };
}
