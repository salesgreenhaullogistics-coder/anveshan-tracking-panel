export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { action = 'shipments' } = req.query;

    // Simple test response
    if (action === 'test') {
      return res.status(200).json({ ok: true, message: 'API is working!' });
    }

    // Placeholder for all actions
    return res.status(200).json({
      ok: true,
      action,
      data: [],
      total: 0,
      message: 'API route working - placeholder response'
    });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
