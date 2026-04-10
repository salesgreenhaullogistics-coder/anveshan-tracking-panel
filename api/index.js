export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { action } = req.query;

    if (!action) {
      return res.status(400).json({ error: 'Missing action parameter' });
    }

    // Simple test response
    if (action === 'test') {
      return res.status(200).json({ ok: true, message: 'API is working!' });
    }

    // Placeholder for search, suggest, shipments
    return res.status(200).json({
      ok: true,
      action,
      data: [],
      total: 0,
      message: 'Action placeholder - API route is working'
    });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
