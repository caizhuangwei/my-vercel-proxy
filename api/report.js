import { kv } from '@vercel/kv';

const REPORT_KEY = 'sms:reports';
const MAX_REPORTS = 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: 用户端上报（取号 / 验证码 / 旧平台）
  if (req.method === 'POST') {
    try {
      const { phone, code, content, time, oid, type } = req.body || {};

      // ★ 关键：只有明确传 'claim' 或 'sms' 才用，其它（含旧平台不传）一律存 ''
      const recType = (type === 'claim' || type === 'sms') ? type : '';

      // ★ 校验：
      //   - claim：只要求 phone
      //   - sms / 旧平台（recType === ''）：要求 phone + code
      if (recType === 'claim') {
        if (!phone) return res.status(400).json({ error: 'phone 不能为空' });
      } else {
        if (!phone || !code) return res.status(400).json({ error: 'phone 和 code 不能为空' });
      }

      const now = Date.now();

      // 去重
      const recent = await kv.lrange(REPORT_KEY, 0, 49);
      const dup = recent.some(r => {
        try {
          const o = typeof r === 'string' ? JSON.parse(r) : r;

          // claim：同 phone + oid 只记一次
          if (recType === 'claim') {
            return o.type === 'claim' &&
                   o.phone === String(phone) &&
                   o.oid === (oid || '');
          }

          // 验证码（含旧平台）：30 秒内同 phone + code 去重
          return o.phone === String(phone) &&
                 o.code === String(code) &&
                 now - (o.ts || 0) < 30000;
        } catch (e) { return false; }
      });
      if (dup) return res.status(200).json({ success: true, dup: true });

      // 后端用 oid 反查订单补 targetUrl
      let targetUrl = '';
      if (oid) {
        try {
          const order = await kv.get(`order:${oid}`);
          if (order && order.targetUrl) targetUrl = order.targetUrl;
        } catch (e) {
          console.warn('补 targetUrl 失败（不影响上报）:', e);
        }
      }

      const record = {
        phone: String(phone),
        code: String(code || ''),
        content: String(content || ''),
        time: time || new Date().toLocaleString('zh-CN', { hour12: false }),
        oid: oid || '',
        targetUrl: targetUrl,
        type: recType,       // ★ 旧平台存 ''，新平台存 'sms'/'claim'
        ts: now
      };

      await kv.lpush(REPORT_KEY, JSON.stringify(record));
      await kv.ltrim(REPORT_KEY, 0, MAX_REPORTS - 1);

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: '上报失败: ' + err.message });
    }
  }

  // GET: admin 拉取记录（完全不变）
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
