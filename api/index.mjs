/**
 * Vercel Serverless Function — API proxy for Google Apps Script
 * Handles CORS and follows redirects so the browser doesn't have to.
 * Cached for 3 minutes to avoid hammering the Apps Script endpoint.
 */

import https from 'https';

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

// In-memory cache (per serverless instance)
let cachedBody = null;
let cacheTime = 0;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const now = Date.now();
    if (cachedBody && now - cacheTime < CACHE_TTL) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=180');
      res.status(200).send(cachedBody);
      return;
    }

    const body = await fetchFollowRedirects(APPS_SCRIPT_URL);
    cachedBody = body;
    cacheTime = Date.now();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=180');
    res.status(200).send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
