export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { target } = req.query;
  if (!target) return res.status(400).send('Missing target');

  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
      }
    });
    const data = await response.text();
    return res.status(response.status).send(data);
  } catch (e) {
    return res.status(500).send('Proxy Error: ' + e.message);
  }
}
