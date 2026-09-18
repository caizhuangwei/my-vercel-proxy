// api/order.js
import { kv } from '@vercel/kv';

// 生成 6 位不重复易识别的随机短码
function generateShortCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async function handler(req, res) {
  // 允许跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. 管理员后台：创建订单短码 (POST)
  if (req.method === 'POST') {
    try {
      const { phone, targetUrl } = req.body;
      if (!phone || !targetUrl) {
        return res.status(400).json({ error: 'phone 与 targetUrl 不能为空' });
      }

      const oid = generateShortCode();
      // 存入 KV，设置 72000 秒（2 小时）自动过期清理
      await kv.set(`order:${oid}`, { phone, targetUrl }, { ex: 72000 });

      return res.status(200).json({ oid });
    } catch (err) {
      return res.status(500).json({ error: '存储失败: ' + err.message });
    }
  }

  // 2. 客户前端：根据短码查询订单 (GET)
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
