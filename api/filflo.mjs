/**
 * Vercel Serverless Function — Filflo read-only proxy
 * GET /api/filflo?action=grn
 * Credentials live in env vars (FILFLO_EMAIL/PASSWORD or FILFLO_TOKEN).
 */
import { handleFilfloRequest } from './filfloEngine.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed — read-only endpoint' });
  try {
    const url = new URL(req.url, 'http://localhost');
    const result = await handleFilfloRequest(url.searchParams);
    res.status(result.status || 200).json(result.body);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Filflo proxy error' });
  }
}
