// Cross-device sync for custom traced trails, keyed by a private "sync
// code" — not a real account system (no password, no email). The frontend
// generates a random code on first save, shows it once, and the same code
// entered on another device pulls the same trails. Anyone who has the code
// can read/overwrite that data, same trust model as a house key: don't
// share it.
//
// Storage: Upstash Redis (via the Vercel Marketplace "Upstash for Redis"
// integration — see README.md for setup). One JSON blob per sync code.

import { Redis } from '@upstash/redis';

const CODE_RE = /^[A-Z0-9]{8,12}$/;
const MAX_TRAILS_PER_CODE = 200;
const MAX_BODY_BYTES = 2_000_000; // 2MB of trail JSON is a lot of hand-traced routes

function getRedis() {
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    return null;
  }
  return Redis.fromEnv();
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    res.status(503).json({ error: 'Trail sync storage is not configured yet (no Redis env vars) — see README.md.' });
    return;
  }

  if (req.method === 'GET') {
    const code = String(req.query.code || '').toUpperCase();
    if (!CODE_RE.test(code)) {
      res.status(400).json({ error: 'Invalid sync code' });
      return;
    }
    try {
      const trails = await redis.get(`trails:${code}`);
      res.status(200).json({ trails: trails || [] });
    } catch (err) {
      res.status(502).json({ error: 'Storage read failed', detail: String(err) });
    }
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = req.body || {};
    } catch {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    const code = String(body.code || '').toUpperCase();
    const trails = body.trails;
    if (!CODE_RE.test(code)) {
      res.status(400).json({ error: 'Invalid sync code' });
      return;
    }
    if (!Array.isArray(trails)) {
      res.status(400).json({ error: '"trails" must be an array' });
      return;
    }
    if (trails.length > MAX_TRAILS_PER_CODE) {
      res.status(413).json({ error: `Too many trails (max ${MAX_TRAILS_PER_CODE})` });
      return;
    }
    const serialized = JSON.stringify(trails);
    if (serialized.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Trail data too large' });
      return;
    }
    try {
      await redis.set(`trails:${code}`, trails);
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: 'Storage write failed', detail: String(err) });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
