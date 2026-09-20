import { kv } from '@vercel/kv';

const REPORT_KEY = 'sms:reports';
const MAX_REPORTS = 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: 用户端上报（取号 / 验证码）
  if (req.method === 'POST') {
    try {
      const { phone, code, content, time, oid, type } = req.body || {};
      const recType = type === 'claim' ? 'claim' : 'sms';

      // ★ 校验放宽：取号记录（claim）不带 code 也允许
      if (!phone) {
        return res.status(400).json({ error: 'phone 不能为空' });
      }
      if (recType === 'sms' && !code) {
        return res.status(400).json({ error: '验证码记录必须带 code' });
      }

      const now = Date.now();

      // ★ 去重策略：
      //   - sms：30 秒内相同 phone+code 去重
      //   - claim：同一 oid+phone 只记一次（防止买家刷新重复上报）
      const recent = await kv.lrange(REPORT_KEY, 0, 49);
      const dup = recent.some(r => {
        try {
          const o = typeof r === 'string' ? JSON.parse(r) : r;
          if (recType === 'sms') {
            return (o.type !== 'claim') &&
                   o.phone === String(phone) &&
                   o.code === String(code) &&
                   now - (o.ts || 0) < 30000;
          }
          // claim 去重
          if (o.type === 'claim' &&
              o.phone === String(phone) &&
              o.oid === (oid || '')) {
            return true;
          }
          return false;
        } catch (e) { return false; }
      });
      if (dup) return res.status(200).json({ success: true, dup: true });

      // 后端用 oid 反查订单补 targetUrl
      let targetUrl = '';
      if (oid) {
        try {
          const order = await kv.get(`order:${oid}`);
          if (order && order.targetUrl) {
            targetUrl = order.targetUrl;
          }
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
        type: recType,           // ★ 新增：保存类型
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
