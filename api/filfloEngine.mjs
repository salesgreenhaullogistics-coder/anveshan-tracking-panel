/**
 * Filflo (anveshan.filflo.in) read-only proxy engine — shared by the Vercel
 * function and the Vite dev middleware. Logs in with credentials kept ONLY in
 * env vars, fetches live B2B orders, and aggregates an advanced GRN dashboard
 * server-side (platform fill-rate, SKU-level GRN%, short reasons, TAT, etc.).
 * Credentials are never sent to the browser.
 *
 * SECURITY — set in Vercel: FILFLO_EMAIL, FILFLO_PASSWORD (dedicated API user).
 * API: base https://backenddo.anveshan.filflo.in/api/v1 · POST /signin ·
 *      header x-access-token · GET /getB2BOrderStatusCounts /grnKPI /getAllB2BOrders
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.FILFLO_BASE || 'https://backenddo.anveshan.filflo.in/api/v1').replace(/\/+$/, '');
const PAGE = parseInt(process.env.FILFLO_PAGE || '200', 10) || 200; /* smaller pages → less likely to be 'terminated' mid-stream */
const MAX_ORDERS = Math.min(parseInt(process.env.FILFLO_MAX_ORDERS || '3000', 10) || 3000, 8000);
const CACHE_TTL = 5 * 60 * 1000;
const STALE_MAX_AGE = 24 * 60 * 60 * 1000; /* serve disk cache up to 24h old when upstream is fully down */

let _session = null;
const SESSION_TTL = 30 * 60 * 1000;
const _cache = {}; // { [dayFilter]: { at, body } } — in-memory (warm container only)

/* ─── Persistent /tmp cache — survives warm invocations even if module state resets ────
   /tmp on Vercel is writable, ~512MB, container-lifetime persistent (not across cold starts). */
const TMP_DIR = process.env.FILFLO_CACHE_DIR || '/tmp/filflo-cache';
async function diskCacheRead(key) {
  try {
    const file = path.join(TMP_DIR, `${key}.json`);
    const raw = await fs.readFile(file, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.at === 'number' && obj.body) return obj;
  } catch { /* missing/corrupt — fall through */ }
  return null;
}
async function diskCacheWrite(key, payload) {
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.writeFile(path.join(TMP_DIR, `${key}.json`), JSON.stringify(payload));
  } catch { /* read-only FS / disk full — degrade silently */ }
}

function creds() {
  return { email: process.env.FILFLO_EMAIL || '', password: process.env.FILFLO_PASSWORD || '', token: process.env.FILFLO_TOKEN || '' };
}
export function isConfigured() { const c = creds(); return Boolean(c.token || (c.email && c.password)); }

async function login(force = false) {
  const c = creds();
  if (c.token) return c.token;
  if (_session && !force && Date.now() - _session.at < SESSION_TTL) return _session.token;
  const res = await fetch(`${BASE}/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.password }), redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Filflo login failed (HTTP ${res.status}). ${text.slice(0, 160)}`);
  let json = {}; try { json = JSON.parse(text); } catch { /* */ }
  const token = json.token || json.access_token || json?.data?.token || '';
  if (!token) throw new Error('Filflo login returned no token.');
  _session = { token, at: Date.now() };
  return token;
}

async function authedGet(path, { retries = 4, timeoutMs = 15000 } = {}) {
  let token = await login();
  const doReq = async (t) => {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'x-access-token': t }, redirect: 'follow', signal: ctrl.signal });
      const txt = await r.text(); /* read body inside the timeout window — 'terminated' fires here, not at fetch() */
      return { res: r, text: txt };
    } finally { clearTimeout(tm); }
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let { res, text } = await doReq(token);
      if (res.status === 401 || res.status === 403) {
        token = await login(true);
        ({ res, text } = await doReq(token));
      }
      if (!res.ok) throw new Error(`Filflo ${path} failed (HTTP ${res.status}). ${text.slice(0, 140)}`);
      try { return JSON.parse(text); }
      catch { throw new Error(`Filflo ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 140)}`); }
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const transient = /terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|AbortError|socket hang up|network/i.test(msg);
      if (attempt >= retries || !transient) break;
      /* Exponential-ish backoff with jitter: ~500ms, 1.2s, 2.5s, 4s */
      const base = [500, 1200, 2500, 4000][Math.min(attempt, 3)];
      await new Promise(r => setTimeout(r, base + Math.random() * 300));
    }
  }
  throw lastErr || new Error(`Filflo ${path} failed after retries`);
}

/* ── helpers ─────────────────────────────────────────────────────────── */
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
function pdate(v) {
  if (!v) return null;
  const s = String(v).trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000; if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } return new Date(y, mo - 1, d); }
  const dd = new Date(s); return isNaN(dd) ? null : new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
}
const dayGap = (a, b) => { if (!a || !b) return null; const g = Math.round((a - b) / 86400000); return (g >= 0 && g <= 120) ? g : null; };
const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
function zoneFromCity(city) {
  const c = String(city || '').toLowerCase();
  if (/delhi|gurgaon|gurugram|noida|lucknow|ghaziabad|faridabad|sonipat|kundli|jaipur|chandigarh|panipat|rohtak/.test(c)) return 'North';
  if (/bangalore|bengaluru|chennai|hyderabad|coimbatore|kochi|mysore|vijayawada|vizag|visakhapatnam/.test(c)) return 'South';
  if (/mumbai|pune|ahmedabad|surat|nashik|nagpur|thane|vasai|bhiwandi|indore|bhopal/.test(c)) return 'West';
  if (/kolkata|guwahati|patna|bhubaneswar|ranchi|siliguri/.test(c)) return 'East';
  return 'Other';
}

async function fetchOrders(dayFilter) {
  /* Probe page 1 to learn total page count (and prime the auth/session) */
  const df = dayFilter ? `&dayFilter=${encodeURIComponent(dayFilter)}` : '';
  const first = await authedGet(`/getAllB2BOrders?page=1&limit=${PAGE}${df}`);
  const firstRows = Array.isArray(first?.data) ? first.data : [];
  const all = [...firstRows];
  if (firstRows.length < PAGE) return all;

  /* Estimate remaining pages — bounded by MAX_ORDERS, fetched in parallel batches of 4
     to cut wall time from N×T to ceil(N/4)×T while staying friendly to upstream. */
  const maxPages = Math.ceil(MAX_ORDERS / PAGE);
  const remainingPages = [];
  for (let p = 2; p <= maxPages; p++) remainingPages.push(p);

  /* Concurrency 2 — Filflo drops connections under heavier parallelism ("terminated").
     If a page errors after all retries, swallow it instead of failing the whole request;
     we'd rather serve N-500 orders than zero. */
  const BATCH = 2;
  let stop = false;
  for (let i = 0; i < remainingPages.length && !stop; i += BATCH) {
    const batch = remainingPages.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(p =>
      authedGet(`/getAllB2BOrders?page=${p}&limit=${PAGE}${df}`)
        .then(j => Array.isArray(j?.data) ? j.data : [])
        .catch(() => null) /* one bad page shouldn't poison the whole response */
    ));
    for (const rows of results) {
      if (rows === null) { stop = true; continue; } /* upstream gave up — return what we have */
      all.push(...rows);
      if (rows.length < PAGE) stop = true; /* short page = last page reached */
    }
    if (all.length >= MAX_ORDERS) break;
  }
  return all.slice(0, MAX_ORDERS);
}

function aggregate(orders) {
  const platform = {}, skuMap = {}, reasonMap = {}, destMap = {}, zoneTat = {}, platTat = {};
  const monthMap = {}, skuMonthMap = {};
  const slimOrders = [];

  const pf = (k) => (platform[k] = platform[k] || { platform: k, orders: 0, ordered: 0, fulfilled: 0, grn: 0, short: 0, shortFulfil: 0, shortGrn: 0, b2a: [], b2d: [], d2d: [] });
  const zt = (k) => (zoneTat[k] = zoneTat[k] || { zone: k, orders: 0, b2a: [], b2d: [], grn: 0, ordered: 0 });

  orders.forEach(o => {
    const plat = o.orderType || '—';
    const cust = o.customerID || {};
    const addr = cust.billingAddress || cust.shippingAddress || {};
    const city = addr.city || '—', state = addr.state || '—', zone = zoneFromCity(city);
    const courier = o.shippingPartner || '—';
    const booking = pdate(o.orderReceivedDate), appt = pdate(o.appointmentDate), deliv = pdate(o.deliveryDate), dispatch = pdate(o.actualDispatchDate);
    const monthKey = booking ? `${booking.getFullYear()}-${String(booking.getMonth() + 1).padStart(2, '0')}` : null;
    const b2a = dayGap(appt, booking), b2d = dayGap(deliv, booking), d2d = dayGap(deliv, dispatch);

    const P = pf(plat); P.orders++;
    if (b2a != null) P.b2a.push(b2a);
    if (b2d != null) P.b2d.push(b2d);
    if (d2d != null) P.d2d.push(d2d);
    const Z = zt(zone); Z.orders++;
    if (b2a != null) Z.b2a.push(b2a);
    if (b2d != null) Z.b2d.push(b2d);

    let oOrdered = 0, oFulfilled = 0, oGrn = 0, oShort = 0, oShortFulfil = 0, oShortGrn = 0;
    (o.listOfProducts || []).forEach(p => {
      const sku = p.skuCode || (p._id && p._id.product_name) || '—';
      const name = (p._id && p._id.product_name) || sku;
      const ordered = num(p.quantity), fulfilled = num(p.fulfilledQuantity), cn = num(p.creditNoteRaisedUnits);
      const grn = Math.max(0, fulfilled - cn);
      const shortFulfil = Math.max(0, ordered - fulfilled);
      const shortGrn = cn;
      const short = shortFulfil + shortGrn;
      const reason = shortFulfil > 0 ? (p.fulfilledQuantityChangeReason && p.fulfilledQuantityChangeReason !== 'No change' ? p.fulfilledQuantityChangeReason : 'Fulfilment short') : (shortGrn > 0 ? 'GRN credit note' : '');

      P.ordered += ordered; P.fulfilled += fulfilled; P.grn += grn; P.short += short; P.shortFulfil += shortFulfil; P.shortGrn += shortGrn;
      Z.ordered += ordered; Z.grn += grn;
      oOrdered += ordered; oFulfilled += fulfilled; oGrn += grn; oShort += short; oShortFulfil += shortFulfil; oShortGrn += shortGrn;

      const sk = plat + '||' + sku;
      const S = skuMap[sk] = skuMap[sk] || { platform: plat, sku, name, ordered: 0, fulfilled: 0, grn: 0, short: 0, shortFulfil: 0, shortGrn: 0, lines: 0, reasons: {}, dests: {} };
      S.ordered += ordered; S.fulfilled += fulfilled; S.grn += grn; S.short += short; S.shortFulfil += shortFulfil; S.shortGrn += shortGrn; S.lines++;
      if (monthKey) { const SM = skuMonthMap[sku] = skuMonthMap[sku] || { sku, name, total: 0, months: {} }; SM.months[monthKey] = (SM.months[monthKey] || 0) + ordered; SM.total += ordered; }
      if (reason) S.reasons[reason] = (S.reasons[reason] || 0) + short;
      if (short > 0) S.dests[city] = (S.dests[city] || 0) + short;

      if (reason && short > 0) reasonMap[reason] = reasonMap[reason] || { reason, qty: 0, lines: 0 };
      if (reason && short > 0) { reasonMap[reason].qty += short; reasonMap[reason].lines++; }
    });
    const D = destMap[city] = destMap[city] || { city, state, zone, ordered: 0, fulfilled: 0, grn: 0, short: 0, shortFulfil: 0, shortGrn: 0 };
    D.ordered += oOrdered; D.fulfilled += oFulfilled; D.grn += oGrn; D.short += oShort; D.shortFulfil += oShortFulfil; D.shortGrn += oShortGrn;
    if (monthKey) { const M = monthMap[monthKey] = monthMap[monthKey] || { month: monthKey, orders: 0, ordered: 0, fulfilled: 0, grn: 0, shortGrn: 0, shortFulfil: 0 }; M.orders++; M.ordered += oOrdered; M.fulfilled += oFulfilled; M.grn += oGrn; M.shortGrn += oShortGrn; M.shortFulfil += oShortFulfil; }

    if (slimOrders.length < MAX_ORDERS) slimOrders.push({
      orderId: o.orderId || o._id, platform: plat, customer: cust.businessName || cust.name || '—',
      status: o.status || '—', city, state, zone, courier, awb: o.awbNumber || '',
      ordered: oOrdered, fulfilled: oFulfilled, grn: oGrn, short: oShort, shortFulfil: oShortFulfil, shortGrn: oShortGrn,
      bookingDate: booking ? booking.toISOString().slice(0, 10) : '', appointmentDate: appt ? appt.toISOString().slice(0, 10) : '',
      deliveryDate: deliv ? deliv.toISOString().slice(0, 10) : '', dispatchDate: dispatch ? dispatch.toISOString().slice(0, 10) : '',
      bookingToAppt: b2a, bookingToDelivery: b2d,
    });
  });

  const rate = (n, d) => d ? +(n / d * 100).toFixed(1) : 0;
  const platformFillRate = Object.values(platform).map(p => ({
    platform: p.platform, orders: p.orders, ordered: p.ordered, fulfilled: p.fulfilled, grn: p.grn,
    short: p.short, shortFulfil: p.shortFulfil, shortGrn: p.shortGrn,
    grnPct: rate(p.grn, p.fulfilled), fillPct: rate(p.grn, p.ordered),
    bookingToAppt: +avg(p.b2a).toFixed(1), bookingToDelivery: +avg(p.b2d).toFixed(1), dispatchToDelivery: +avg(p.d2d).toFixed(1),
  })).sort((a, b) => b.short - a.short);

  const skuRows = Object.values(skuMap).map(s => {
    const topReason = Object.entries(s.reasons).sort((a, b) => b[1] - a[1])[0];
    const topDest = Object.entries(s.dests).sort((a, b) => b[1] - a[1])[0];
    return {
      platform: s.platform, sku: s.sku, name: s.name, ordered: s.ordered, fulfilled: s.fulfilled, grn: s.grn,
      short: s.short, shortFulfil: s.shortFulfil, shortGrn: s.shortGrn,
      grnPct: rate(s.grn, s.fulfilled), fillPct: rate(s.grn, s.ordered),
      topReason: topReason ? topReason[0] : '—', topDestination: topDest ? topDest[0] : '—',
    };
  }).sort((a, b) => b.short - a.short);

  const shortReasons = Object.values(reasonMap).sort((a, b) => b.qty - a.qty);
  const allDest = Object.values(destMap).map(d => ({ ...d, grnPct: rate(d.grn, d.fulfilled), fillPct: rate(d.grn, d.ordered) }));
  const destinationGrn = allDest.slice().sort((a, b) => b.short - a.short).slice(0, 50);
  const tatByZone = Object.values(zoneTat).map(z => ({ zone: z.zone, orders: z.orders, bookingToAppt: +avg(z.b2a).toFixed(1), bookingToDelivery: +avg(z.b2d).toFixed(1), grnPct: rate(z.grn, z.ordered) }))
    .sort((a, b) => b.orders - a.orders);

  /* Poor performers (lowest GRN quality among meaningful volume) */
  const poorPlatforms = platformFillRate.filter(p => p.fulfilled >= 200).slice().sort((a, b) => a.grnPct - b.grnPct).slice(0, 12);
  const poorDestinations = allDest.filter(d => d.fulfilled >= 50).sort((a, b) => a.grnPct - b.grnPct).slice(0, 15);

  /* Summary insights */
  const totFulfilled = platformFillRate.reduce((s, p) => s + p.fulfilled, 0);
  const totGrn = platformFillRate.reduce((s, p) => s + p.grn, 0);
  const totGrnShort = platformFillRate.reduce((s, p) => s + p.shortGrn, 0);
  const totFulfilShort = platformFillRate.reduce((s, p) => s + p.shortFulfil, 0);
  const summary = {
    overallGrnPct: rate(totGrn, totFulfilled), totGrnShort, totFulfilShort,
    worstPlatform: poorPlatforms[0] ? { platform: poorPlatforms[0].platform, grnPct: poorPlatforms[0].grnPct } : null,
    worstDestination: poorDestinations[0] ? { city: poorDestinations[0].city, grnPct: poorDestinations[0].grnPct } : null,
  };

  /* Month-on-month — drop future months (bad order dates) and tiny-volume noise months */
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const allMonths = Object.values(monthMap);
  const maxMo = Math.max(1, ...allMonths.map(m => m.orders));
  const moThresh = Math.max(20, maxMo * 0.03);
  const monthly = allMonths
    .filter(m => m.month <= curMonth && m.orders >= moThresh)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ ...m, grnPct: rate(m.grn, m.fulfilled), fillPct: rate(m.grn, m.ordered) }));
  const months = monthly.map(m => m.month);
  const skuMonthly = Object.values(skuMonthMap).sort((a, b) => b.total - a.total).slice(0, 200);

  return { platformFillRate, skuRows, shortReasons, destinationGrn, tatByZone, poorPlatforms, poorDestinations, summary, monthly, months, skuMonthly, orders: slimOrders };
}

export async function handleFilfloRequest(searchParams) {
  if (!isConfigured()) {
    return { ok: false, status: 200, body: { configured: false, message: 'Filflo not connected. Set FILFLO_EMAIL & FILFLO_PASSWORD in Vercel env vars.' } };
  }
  const action = searchParams.get('action') || 'grn';
  if (action !== 'grn' && action !== 'orders') return { ok: false, status: 400, body: { error: `Unsupported action "${action}".` } };
  const dayFilter = searchParams.get('dayFilter') || '';
  const cacheKey = dayFilter || 'all';
  const forceRefresh = searchParams.get('refresh') === '1';

  /* Layer 1: in-memory cache (fastest, only on warm container) */
  let cached = _cache[cacheKey];
  /* Layer 2: disk cache (/tmp) — populate in-memory from disk if missing */
  if (!cached) {
    const fromDisk = await diskCacheRead(cacheKey);
    if (fromDisk) { _cache[cacheKey] = fromDisk; cached = fromDisk; }
  }
  if (cached && Date.now() - cached.at < CACHE_TTL && !forceRefresh) {
    return { ok: true, status: 200, body: { ...cached.body, cached: true } };
  }
  try {
    const qs = dayFilter ? `?dayFilter=${encodeURIComponent(dayFilter)}` : '';
    /* Fetch counts + orders independently — counts is cheap & critical, orders is heavy & flaky */
    const counts = await authedGet(`/getB2BOrderStatusCounts${qs}`).catch(() => null);
    let orders = [];
    let ordersError = null;
    try { orders = await fetchOrders(dayFilter); } catch (e) { ordersError = e; }
    const c = counts?.data || {};
    const kpis = {
      total: c.total || 0, pending: c.pending || 0, approved: c.approved || 0, picked: c.picked || 0,
      pendingInvoice: c.pendingInvoice || 0, invoiced: c.invoiced || 0, dispatched: c.dispatched || 0,
      delivered: c.delivered || 0, grnEntered: c.grn || 0, rto: c.rto || 0,
    };
    /* If orders entirely failed AND we have no counts AND no prior cache → bubble the error.
       Otherwise build whatever payload we can. */
    if (orders.length === 0 && !counts && ordersError) throw ordersError;
    const agg = aggregate(orders);
    const body = {
      configured: true,
      dayFilter: dayFilter || 'all',
      sampled: orders.length,
      kpis,
      ...agg,
      ...(ordersError && orders.length === 0 ? { partial: true, partialReason: `Orders fetch failed: ${ordersError.message}. Showing KPI counts only.` } : {}),
    };
    const entry = { at: Date.now(), body };
    _cache[cacheKey] = entry;
    /* Fire-and-forget disk write so we survive cold starts */
    diskCacheWrite(cacheKey, entry).catch(() => {});
    return { ok: true, status: 200, body };
  } catch (err) {
    /* Upstream blip — never let the dashboard crash. Serve last known good payload
       (marked stale) if we have one; otherwise surface a clean JSON error. */
    let staleCache = cached;
    if (!staleCache) {
      /* Try disk again in case it wasn't loaded yet */
      staleCache = await diskCacheRead(cacheKey);
    }
    if (staleCache && Date.now() - staleCache.at < STALE_MAX_AGE) {
      const ageMin = Math.round((Date.now() - staleCache.at) / 60000);
      return { ok: true, status: 200, body: { ...staleCache.body, stale: true, staleAgeMinutes: ageMin, staleReason: err.message || String(err) } };
    }
    return { ok: false, status: 502, body: { configured: true, error: err.message || String(err) } };
  }
}
