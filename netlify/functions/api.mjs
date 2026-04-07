/**
 * Netlify Serverless Function - API proxy + query engine for logistics data.
 */

import https from 'https';
import { handleShipmentApiRequest } from '../../api/shipmentEngine.mjs';

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

export default async (req) => {
  try {
    const fullUrl = new URL(req.url);
    const forceRefresh = fullUrl.searchParams.get('refresh') === '1';

    const result = await handleShipmentApiRequest(fullUrl, () => fetchRawRows(forceRefresh));
    if (!result.ok) {
      return new Response(JSON.stringify(result.body), {
        status: result.status || 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(JSON.stringify(result.body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30, s-maxage=120',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Request failed' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
