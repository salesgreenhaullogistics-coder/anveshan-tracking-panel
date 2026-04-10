import https from 'https';
import { handleShipmentApiRequest } from './shipmentEngine.mjs';

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec';

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

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const forceRefresh = url.searchParams.get('refresh') === '1';

    const result = await handleShipmentApiRequest(url, () => getRawRows(forceRefresh));

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=30');

    if (!result.ok) {
      res.status(result.status || 400).json(result.body);
      return;
    }

    res.status(200).json(result.body);
  } catch (err) {
    console.error('API error:', err);
    res.status(502).json({ error: err.message || 'Internal Server Error' });
  }
}
