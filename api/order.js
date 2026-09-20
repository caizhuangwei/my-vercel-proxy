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

  // 1. POST 请求：创建订单 / 触发取码后10分钟倒计时 / 释放订单 / 买家取号
  if (req.method === 'POST') {
    try {
      const { action, oid, phone, password, targetUrl } = req.body;

      // 释放订单：立即删除，用户端马上失效
      if (action === 'release') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });
        await kv.del(`order:${oid}`);
        return res.status(200).json({ success: true, message: '订单已释放' });
      }

      // 买家取到验证码后触发：将过期时间重置为 600 秒（10分钟）
      if (action === 'complete') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });
        const existing = await kv.get(`order:${oid}`);
        if (existing) {
          await kv.set(`order:${oid}`, { ...existing, fetchedAt: Date.now() }, { ex: 600 });
        }
        return res.status(200).json({ success: true, message: '已设定10分钟后失效' });
      }

      // 【新增】买家看完教程后取号：从 KV 读取账号密码
      if (action === 'claim') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });
        const data = await kv.get(`order:${oid}`);
        if (!data) {
          return res.status(404).json({ error: '订单已失效或不存在' });
        }
        return res.status(200).json({
          phone: data.phone || '',
          password: data.password || '',
          targetUrl: data.targetUrl || ''
        });
      }

      // 管理后台创建订单：初始 20 小时过期（72000秒）
      if (!phone || !targetUrl) {
        return res.status(400).json({ error: 'phone 与 targetUrl 不能为空' });
      }

      const newOid = generateShortCode();
      // 【改动】password 一并保存到 KV，供 claim 时返回
      await kv.set(
        `order:${newOid}`,
        { phone, password: password || '', targetUrl },
        { ex: 72000 }
      );
      return res.status(200).json({ oid: newOid });
    } catch (err) {
      return res.status(500).json({ error: '操作失败: ' + err.message });
    }
  }

  // 2. GET 请求：查询订单（保持原样，老平台继续用）
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
