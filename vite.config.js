import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'https';
import { handleShipmentApiRequest } from './api/shipmentEngine.mjs';

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
  let kpiCache = null;
  let kpiCacheTime = 0;
  let kpiInFlight = null;

  let shipmentRawCache = null;
  let shipmentRawCacheTime = 0;
  let shipmentInFlight = null;

  const CACHE_TTL = 3 * 60 * 1000;

  async function getRawRows(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && shipmentRawCache && now - shipmentRawCacheTime < CACHE_TTL) {
      const parsed = JSON.parse(shipmentRawCache);
      return Array.isArray(parsed) ? parsed : parsed?.data || [];
    }

    if (!shipmentInFlight) shipmentInFlight = fetchFollowRedirects(APPS_SCRIPT_URL);
    const body = await shipmentInFlight;
    shipmentInFlight = null;

    shipmentRawCache = body;
    shipmentRawCacheTime = Date.now();

    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : parsed?.data || [];
  }

  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use('/api/kpi', async (_req, res) => {
        try {
          const now = Date.now();
          if (kpiCache && now - kpiCacheTime < CACHE_TTL) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=60',
            });
            res.end(kpiCache);
            return;
          }

          if (!kpiInFlight) kpiInFlight = fetchFollowRedirects(KPI_APPS_SCRIPT_URL);
          const body = await kpiInFlight;
          kpiInFlight = null;

          kpiCache = body;
          kpiCacheTime = Date.now();

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60',
          });
          res.end(body);
        } catch (err) {
          kpiInFlight = null;
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api', async (req, res) => {
        try {
          const fullUrl = new URL(req.url || '', 'http://localhost');
          const forceRefresh = fullUrl.searchParams.get('refresh') === '1';
          const result = await handleShipmentApiRequest(fullUrl, () => getRawRows(forceRefresh));

          if (!result.ok) {
            res.writeHead(result.status || 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=30',
          });
          res.end(JSON.stringify(result.body));
        } catch (err) {
          shipmentInFlight = null;
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
    host: true,
    port: 5173,
    allowedHosts: true,
  },
});
