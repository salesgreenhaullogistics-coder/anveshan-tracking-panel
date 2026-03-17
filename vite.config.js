import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'https';

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec';

const KPI_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxI66Y3lZZqeSlZCdIQKVrPGla10AvM-3vVI89t8gc49ld4ukH3wnrIIEiuCv6khAAA/exec';

function fetchFollowRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchFollowRedirects(res.headers.location, maxRedirects - 1).then(resolve, reject);
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function apiProxyPlugin() {
  let cachedBody = null;
  let cacheTime = 0;
  const CACHE_TTL = 3 * 60 * 1000; // 3 min server-side cache
  let inFlight = null;

  return {
    name: 'api-proxy',
    configureServer(server) {
      // KPI endpoint — must be registered BEFORE /api to avoid being caught by the shipment proxy
      let kpiCache = null;
      let kpiCacheTime = 0;
      let kpiInFlight = null;
      server.middlewares.use('/api/kpi', async (_req, res) => {
        try {
          const now = Date.now();
          if (kpiCache && now - kpiCacheTime < CACHE_TTL) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' });
            res.end(kpiCache);
            return;
          }
          if (!kpiInFlight) kpiInFlight = fetchFollowRedirects(KPI_APPS_SCRIPT_URL);
          const body = await kpiInFlight;
          kpiInFlight = null;
          kpiCache = body;
          kpiCacheTime = Date.now();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' });
          res.end(body);
        } catch (err) {
          kpiInFlight = null;
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api', async (_req, res) => {
        try {
          const now = Date.now();
          if (cachedBody && now - cacheTime < CACHE_TTL) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=60',
            });
            res.end(cachedBody);
            return;
          }

          // Deduplicate concurrent requests
          if (!inFlight) {
            inFlight = fetchFollowRedirects(APPS_SCRIPT_URL);
          }
          const body = await inFlight;
          inFlight = null;
          cachedBody = body;
          cacheTime = Date.now();

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60',
          });
          res.end(body);
        } catch (err) {
          inFlight = null;
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  server: {
    host: true,          // bind to 0.0.0.0 → accessible on LAN via your IP
    port: 5173,
    allowedHosts: true,  // allow all hostnames (tunnel, LAN IP, etc.)
  },
});
