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

async function srGet(path, token) {
  const res = await fetch(`${SR_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  return res;
}

/**
 * Fetch orders (read-only), aggregating up to `maxPages`.
 * Auto-retries once with a refreshed token on 401/403.
 */
export async function fetchOrders({ perPage = 100, maxPages = 12 } = {}) {
  let token = await getToken();
  const all = [];
  let page = 1;
  let lastMeta = null;

  while (page <= maxPages) {
    let res = await srGet(`/orders?page=${page}&per_page=${perPage}`, token);
    if (res.status === 401 || res.status === 403) {
      token = await getToken(true); /* refresh once */
      res = await srGet(`/orders?page=${page}&per_page=${perPage}`, token);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Shiprocket orders fetch failed (HTTP ${res.status}). ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    all.push(...rows);
    lastMeta = json.meta || null;

    const totalPages = lastMeta?.pagination?.total_pages;
    if (rows.length < perPage) break;
    if (totalPages && page >= totalPages) break;
    page++;
  }

  return { data: all, fetchedPages: page, count: all.length, meta: lastMeta };
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
  const maxPages = Math.min(Math.max(parseInt(searchParams.get('max_pages') || '12', 10) || 12, 1), 30);
  try {
    const result = await fetchOrders({ perPage, maxPages });
    return { ok: true, status: 200, body: { configured: true, ...result } };
  } catch (err) {
    return { ok: false, status: 502, body: { configured: true, error: err.message || String(err) } };
  }
}
