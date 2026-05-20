/**
 * Shiprocket read-only engine — shared by the Vercel function and the Vite dev middleware.
 *
 * SECURITY:
 *  - Credentials come ONLY from env vars (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD)
 *    or a pre-issued token (SHIPROCKET_TOKEN). They are never sent to the browser.
 *  - This module exposes ONLY GET/read operations against Shiprocket. There is no
 *    create / update / cancel path, so the panel can never push or mutate orders.
 */

const SR_BASE = 'https://apiv2.shiprocket.in/v1/external';

/* Module-scope token cache (survives warm serverless invocations / dev server lifetime) */
let _token = null;
let _tokenAt = 0;
const TOKEN_TTL = 9 * 24 * 60 * 60 * 1000; /* Shiprocket tokens last ~10 days; refresh at 9 */

function creds() {
  return {
    email: process.env.SHIPROCKET_EMAIL || '',
    password: process.env.SHIPROCKET_PASSWORD || '',
    token: process.env.SHIPROCKET_TOKEN || '',
  };
}

export function isConfigured() {
  const c = creds();
  return Boolean(c.token || (c.email && c.password));
}

async function getToken(forceRefresh = false) {
  const c = creds();
  if (c.token) return c.token; /* explicit token wins */
  const now = Date.now();
  if (!forceRefresh && _token && now - _tokenAt < TOKEN_TTL) return _token;
  if (!c.email || !c.password) {
    throw new Error('Shiprocket credentials not configured. Set SHIPROCKET_EMAIL & SHIPROCKET_PASSWORD (or SHIPROCKET_TOKEN) in environment variables.');
  }
  const res = await fetch(`${SR_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.password }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Shiprocket login failed (HTTP ${res.status}). ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.token) throw new Error('Shiprocket login returned no token.');
  _token = json.token;
  _tokenAt = Date.now();
  return _token;
}

async function srGet(path, token, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${SR_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/* Project each raw Shiprocket order down to only the fields the analytics UI needs.
   Shiprocket returns very large objects; slimming keeps the response well under
   Vercel's 4.5 MB limit and speeds up transfer. */
function slimOrder(o) {
  const products = Array.isArray(o.products) ? o.products.map(p => ({
    name: p.name, sku: p.sku, channel_sku: p.channel_sku,
    quantity: p.quantity, selling_price: p.selling_price, price: p.price,
  })) : [];
  return {
    id: o.id,
    channel_order_id: o.channel_order_id,
    order_id: o.order_id,
    channel_name: o.channel_name || o.channel,
    customer_name: o.customer_name,
    customer_city: o.customer_city || o.city,
    customer_state: o.customer_state || o.state,
    payment_method: o.payment_method,
    total: o.total,
    status: o.status,
    courier_name: o.courier_name || o.courier,
    awb_code: o.awb_code || o.awb,
    created_at: o.created_at || o.order_date || o.channel_created_at,
    products,
  };
}

async function fetchPage(page, perPage, token) {
  const res = await srGet(`/orders?page=${page}&per_page=${perPage}`, token);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${t.slice(0, 120)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data.map(slimOrder) : [];
  return { rows, meta: json.meta || null };
}

/**
 * Fetch one BATCH of order pages (read-only), starting at `startPage`, fetching
 * up to `maxPages` pages in PARALLEL (so we stay under the 60s serverless limit).
 * The frontend calls this repeatedly with an advancing startPage to accumulate
 * a large history without ever exceeding Vercel's per-request limits.
 * Auto-refreshes the token once on 401/403 (checked on the first page of the batch).
 */
export async function fetchOrders({ perPage = 100, maxPages = 6, startPage = 1 } = {}) {
  let token = await getToken();

  /* First page of this batch — with one token-refresh retry on auth failure */
  let first;
  try {
    first = await fetchPage(startPage, perPage, token);
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      token = await getToken(true);
      first = await fetchPage(startPage, perPage, token);
    } else throw new Error(`Shiprocket orders fetch failed (${e.message})`);
  }

  const totalPages = first.meta?.pagination?.total_pages || startPage;
  const endPage = Math.min(startPage + maxPages - 1, totalPages);
  const all = [...first.rows];

  if (endPage > startPage && first.rows.length === perPage) {
    const pageNums = [];
    for (let p = startPage + 1; p <= endPage; p++) pageNums.push(p);
    const results = await Promise.allSettled(pageNums.map(p => fetchPage(p, perPage, token)));
    results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value.rows); });
  }

  const hasMore = endPage < totalPages && first.rows.length === perPage;
  return { data: all, startPage, endPage, totalPages, hasMore, count: all.length, meta: first.meta };
}

/**
 * Router used by both the Vercel handler and the Vite middleware.
 * Only the read action 'orders' is supported.
 */
export async function handleShiprocketRequest(searchParams) {
  if (!isConfigured()) {
    return { ok: false, status: 200, body: { configured: false, data: [], message: 'Shiprocket not connected. Set SHIPROCKET_EMAIL & SHIPROCKET_PASSWORD in Vercel env vars.' } };
  }
  const action = searchParams.get('action') || 'orders';
  if (action !== 'orders') {
    return { ok: false, status: 400, body: { error: `Unsupported action "${action}". This endpoint is read-only and supports only "orders".` } };
  }
  const perPage = Math.min(Math.max(parseInt(searchParams.get('per_page') || '100', 10) || 100, 10), 100);
  const maxPages = Math.min(Math.max(parseInt(searchParams.get('max_pages') || '6', 10) || 6, 1), 10);
  const startPage = Math.max(parseInt(searchParams.get('start_page') || '1', 10) || 1, 1);
  try {
    const result = await fetchOrders({ perPage, maxPages, startPage });
    return { ok: true, status: 200, body: { configured: true, ...result } };
  } catch (err) {
    return { ok: false, status: 502, body: { configured: true, error: err.message || String(err) } };
  }
}
