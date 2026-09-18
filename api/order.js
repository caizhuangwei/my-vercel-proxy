import { kv } from '@vercel/kv';

function generateShortCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. POST 请求：创建订单 或 用户取码后标记
  if (req.method === 'POST') {
    try {
      const { action, oid, phone, targetUrl, latestCode } = req.body;

      // 买家取到验证码：标记为已完成并设置 10 分钟（600秒）倒计时失效
      if (action === 'complete') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });
        const existing = await kv.get(`order:${oid}`);
        if (existing) {
          const updated = {
            ...existing,
            status: 'completed',
            latestCode: latestCode || existing.latestCode || '',
            fetchedAt: Date.now()
          };
          await kv.set(`order:${oid}`, updated, { ex: 600 });
        }
        return res.status(200).json({ success: true, message: '已标记为已取码' });
      }

      // 管理后台批量创建订单：默认 20 小时（72000秒）
      if (!phone || !targetUrl) {
        return res.status(400).json({ error: 'phone 与 targetUrl 不能为空' });
      }

      const newOid = generateShortCode();
      const orderData = {
        phone,
        targetUrl,
        status: 'pending', // 初始等待接码
        createdAt: Date.now()
      };
      await kv.set(`order:${newOid}`, orderData, { ex: 72000 });
      return res.status(200).json({ oid: newOid });
    } catch (err) {
      return res.status(500).json({ error: '操作失败: ' + err.message });
    }
  }

  // 2. GET 请求：查询订单状态
  if (req.method === 'GET') {
    try {
      const { oid } = req.query;
      if (!oid) return res.status(400).json({ error: '缺少 oid 参数' });

      const data = await kv.get(`order:${oid}`);
      if (!data) {
        return res.status(404).json({ error: '订单已过期或不存在' });
      }

      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: '查询失败: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
