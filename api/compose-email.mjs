/**
 * Vercel Serverless Function — AI Email Composer using Claude API
 * POST /api/compose-email
 * Body: { prompt, language, context }
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, language = 'English', context = '' } = req.body || {};

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured. Set it in Vercel Environment Variables.' });
    }

    const systemPrompt = `You are a professional logistics email composer for Anveshan (an Indian D2C food brand).

Your job: Take a user prompt (in any language — Hindi, English, Hinglish) and compose a professional business email.

Rules:
1. Output language: ${language}
2. Format as JSON: {"subject": "...", "body": "..."}
3. Subject should be concise, professional, include "| Anveshan"
4. Body should be professional, well-structured with proper greeting and sign-off
5. If logistics data is provided in context, embed relevant numbers in the email
6. Use bullet points and numbered lists for action items
7. Include emojis for section headers (📊 📦 🚛 📄 etc.)
8. Sign off as "Anveshan Logistics Team"
9. If tone is urgent, add 🔴 URGENT prefix to subject
10. If Hindi, use formal Hindi (आप, कृपया, etc.)
11. Always add a clear call-to-action at the end
12. Keep it concise but complete`;

    const userMessage = context
      ? `Prompt: ${prompt}\n\nLogistics Data Context:\n${context}`
      : `Prompt: ${prompt}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    });

    const text = response.content[0]?.text || '';

    /* Parse JSON from response */
    let result;
    try {
      const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { subject: 'Email | Anveshan', body: text };
    } catch {
      result = { subject: 'Email | Anveshan', body: text };
    }

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    console.error('Claude API error:', err);
    return res.status(500).json({ error: err.message || 'AI generation failed' });
  }
}
