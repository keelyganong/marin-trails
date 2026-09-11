// Server-side proxy for one-off Anthropic API calls — currently just the
// custom-route location label lookup (js/insights.js fetchRouteLocationLabel).
// Trail insights have their own dedicated, cached endpoint (api/insights.js)
// since they're viewed repeatedly by many visitors; this one stays a thin
// generic pass-through for the low-frequency, per-route case that doesn't
// benefit from caching (each route has a unique lat/lon).
//
// Exists because the browser can't call api.anthropic.com directly —
// Anthropic doesn't send CORS headers for browser origins, by design, since
// that would mean shipping the API key to every visitor. This function
// holds the key server-side (ANTHROPIC_API_KEY env var, set in the Vercel
// project's Settings > Environment Variables) and forwards the request.
//
// A few limits since this is a public, keyless endpoint: pinned model
// (enforced in lib/anthropic.js), capped max_tokens, and a light per-IP
// rate limit (best-effort; skipped if no Redis is configured yet).

import { Redis } from '@upstash/redis';
import { callAnthropic } from '../lib/anthropic.js';

const RATE_LIMIT_PER_HOUR = 30;

let redis = null;
try {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    redis = Redis.fromEnv();
  }
} catch {
  redis = null; // storage not configured yet — proxy still works, just unrate-limited
}

async function checkRateLimit(ip) {
  if (!redis) return true;
  try {
    const key = `ratelimit:anthropic:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    return count <= RATE_LIMIT_PER_HOUR;
  } catch {
    return true; // if Redis hiccups, fail open rather than blocking everyone
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!(await checkRateLimit(ip))) {
    res.status(429).json({ error: 'Rate limit exceeded — try again later.' });
    return;
  }

  let body;
  try {
    body = req.body || {};
  } catch {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  const { messages, tools, max_tokens } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Request body must include a non-empty "messages" array' });
    return;
  }

  const result = await callAnthropic({ messages, tools, max_tokens });
  res.status(result.status).json(result.data);
}
