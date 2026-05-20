/**
 * Vercel Serverless Function — Shiprocket read-only proxy
 * GET /api/shiprocket?action=orders&per_page=100&max_pages=12
 *
 * Read-only: only fetches order data. No create/update/cancel paths exist.
 * Credentials live in env vars (SHIPROCKET_EMAIL/PASSWORD or SHIPROCKET_TOKEN).
 */
import { handleShiprocketRequest } from './shiprocketEngine.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed — read-only endpoint' });

  try {
    const url = new URL(req.url, 'http://localhost');
    const result = await handleShiprocketRequest(url.searchParams);
    res.status(result.status || 200).json(result.body);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Shiprocket proxy error' });
  }
}
