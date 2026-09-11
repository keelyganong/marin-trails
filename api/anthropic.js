// Server-side proxy for Anthropic API calls (trail insights, route location
// labels). Exists because the browser can't call api.anthropic.com directly
// — Anthropic doesn't send CORS headers for browser origins, by design,
// since that would mean shipping the API key to every visitor. This
// function holds the key server-side (ANTHROPIC_API_KEY env var, set in the
// Vercel project's Settings > Environment Variables) and forwards the
// request.
//
// The frontend (js/insights.js) still builds the prompt and parses the
// response — this stays a thin pass-through, not business logic — but with
// a few limits so a public, keyless endpoint can't be used to run up an
// unbounded bill: pinned model, capped max_tokens, and a light per-IP rate
// limit (best-effort; skipped if no Redis is configured yet).

import { Redis } from '@upstash/redis';

const ALLOWED_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 1200;
const RATE_LIMIT_PER_HOUR = 30;

let redis = null;
try {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    redis = Redis.fromEnv();
  }
} catch {
  redis = null; // storage not configured yet — proxy still works, just unrated-limited
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' });
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

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ALLOWED_MODEL,
        max_tokens: Math.min(Number(max_tokens) || 800, MAX_TOKENS_CAP),
        messages,
        ...(tools ? { tools } : {}),
      }),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Upstream request to Anthropic failed', detail: String(err) });
  }
}
