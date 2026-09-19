import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { oid } = req.query;
    if (!oid) return res.status(400).json({ error: '缺少 oid 参数' });

    const data = await kv.get(`order:${oid}`);
    if (!data) {
      return res.status(404).json({ error: '订单不存在或已释放' });
    }

    return res.status(200).json({
      oid: oid,
      phone: data.phone || '',
      targetUrl: data.targetUrl || '',
      fetchedAt: data.fetchedAt || null
    });
  } catch (err) {
    return res.status(500).json({ error: '查询失败: ' + err.message });
  }
}
