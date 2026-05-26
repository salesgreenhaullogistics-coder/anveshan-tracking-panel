/**
 * Vercel Serverless Function — Command Center bot trigger (proxy).
 * POST /api/run-bot  { url, method?, payload?, headers?, timeoutMs? }
 *
 * Forwards the trigger to a registered bot endpoint (server-side, to avoid CORS)
 * and returns a normalised {success, message/error, response, durationMs}.
 */
import { handleRunBot } from './botRunner.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed — use POST.' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const result = await handleRunBot(body);
    res.status(result.status || 200).json(result.body);
  } catch (err) {
    res.status(502).json({ success: false, error: err.message || 'Bot proxy error' });
  }
}
