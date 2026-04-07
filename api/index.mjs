/**
 * Vercel Serverless Function - API proxy + query engine for logistics data.
 */

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

let cachedRawBody = null;
let cachedRawTs = 0;
const RAW_CACHE_TTL = 3 * 60 * 1000;

async function fetchRawRows(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedRawBody && now - cachedRawTs < RAW_CACHE_TTL) {
    const parsed = JSON.parse(cachedRawBody);
    return Array.isArray(parsed) ? parsed : parsed?.data || [];
  }

  const body = await fetchFollowRedirects(APPS_SCRIPT_URL);
  cachedRawBody = body;
  cachedRawTs = Date.now();

  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : parsed?.data || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const fullUrl = new URL(req.url, 'http://localhost');
    const forceRefresh = fullUrl.searchParams.get('refresh') === '1';

    const result = await handleShipmentApiRequest(fullUrl, () => fetchRawRows(forceRefresh));
    if (!result.ok) {
      res.status(result.status || 400).json(result.body);
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120');
    res.status(200).json(result.body);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Request failed' });
  }
}
