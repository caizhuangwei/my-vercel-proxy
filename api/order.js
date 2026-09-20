import { kv } from '@vercel/kv';

// ⚠️ 改成你自己的短链域名前缀（也可以用 Vercel 环境变量 SHORTLINK_BASE 覆盖）
const SHORTLINK_BASE = process.env.SHORTLINK_BASE || 'https://你的短链域名/s/';

function generateShortCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function buildShortUrl(oid) {
  return SHORTLINK_BASE + oid;
}

const DAY_MS = 24 * 60 * 60 * 1000; // 24 小时

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { action, oid, phone, password, targetUrl } = req.body;

      // === 释放订单（立即删除）===
      if (action === 'release') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });
        await kv.del(`order:${oid}`);
        return res.status(200).json({ success: true, message: '订单已释放' });
      }

      // === 【老平台专用】取到验证码后 10 分钟失效 ===
      if (action === 'complete') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });
        const existing = await kv.get(`order:${oid}`);
        if (existing) {
          await kv.set(
            `order:${oid}`,
            { ...existing, fetchedAt: Date.now() },
            { ex: 600 } // 10 分钟
          );
        }
        return res.status(200).json({ success: true, message: '已设定10分钟后失效' });
      }

      // === 【新平台】买家点击“我已阅读取号” ===
      if (action === 'claim') {
        if (!oid) return res.status(400).json({ error: '缺少 oid' });

        const data = await kv.get(`order:${oid}`);
        if (!data) {
          return res.status(404).json({ error: '订单已失效或不存在' });
        }

        const now = Date.now();
        let firstClaimAt = data.firstClaimAt || 0;
        let expireAt = data.expireAt || 0;

        // 仅首次取号时初始化 24 小时有效期
        if (!firstClaimAt) {
          firstClaimAt = now;
          expireAt = now + DAY_MS;
          const ttlSeconds = Math.ceil(DAY_MS / 1000) + 60; // 多留 60 秒缓冲
          await kv.set(
            `order:${oid}`,
            { ...data, firstClaimAt, expireAt },
            { ex: ttlSeconds }
          );
        }

        return res.status(200).json({
          phone: data.phone || '',
          password: data.password || '',
          targetUrl: data.targetUrl || '',
          shortUrl: data.shortUrl || buildShortUrl(oid),  // 新增：返回短链
          firstClaimAt,
          expireAt
        });
      }

      // === 管理后台创建订单 ===
      if (!phone || !targetUrl) {
        return res.status(400).json({ error: 'phone 与 targetUrl 不能为空' });
      }

      const newOid = generateShortCode();
      const shortUrl = buildShortUrl(newOid);  // 新增：生成短链

      await kv.set(
        `order:${newOid}`,
        {
          phone,
          password: password || '',
          targetUrl,
          shortUrl,               // 新增：保存短链
          createdAt: Date.now(),
          firstClaimAt: 0,
          expireAt: 0
        },
        { ex: 72000 } // 20 小时，等待用户点击取号
      );
      return res.status(200).json({ oid: newOid, shortUrl });  // 新增：返回短链
    } catch (err) {
      return res.status(500).json({ error: '操作失败: ' + err.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const { oid } = req.query;
      if (!oid) return res.status(400).json({ error: '缺少 oid 参数' });

      const data = await kv.get(`order:${oid}`);
      if (!data) {
        return res.status(404).json({ error: '订单已过期或不存在' });
      }

      // 确保返回数据里带 shortUrl（历史数据没有的话现补）
      return res.status(200).json({
        ...data,
        shortUrl: data.shortUrl || buildShortUrl(oid)
      });
    } catch (err) {
      return res.status(500).json({ error: '查询失败: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
