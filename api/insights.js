// Live "recent conditions" + "community sentiment" for a trail — the parts
// that actually benefit from a fresh web search (closures, season, crowding,
// what hikers are saying lately). History is intentionally NOT generated
// here: it doesn't change, so it stays static content in
// data/fallback-insights.js and costs nothing to show.
//
// Cached per trail in Redis for CACHE_TTL_SECONDS: with only 8 built-in
// trails, that bounds real Anthropic calls to at most 8 per refresh window
// total, no matter how many people are viewing the map — the cost doesn't
// scale with traffic. Requires Redis to be configured (see README.md); if
// it isn't, this returns 503 and the frontend falls back to the static
// content rather than making an uncached (unbounded-cost) call per view.

import { Redis } from '@upstash/redis';
import { callAnthropic } from '../lib/anthropic.js';

// Keep in sync with the trail ids in data/trails-metadata.json. Hardcoded
// (rather than imported) so this endpoint only ever generates content for
// a known trail — an arbitrary client-supplied name would both bypass the
// cache and let a caller put words in the prompt for free.
const TRAIL_NAMES = {
  'dipsea': 'Dipsea Trail',
  'tennessee-valley': 'Tennessee Valley Trail',
  'cataract-falls': 'Cataract Falls Trail',
  'steep-ravine': 'Steep Ravine Trail',
  'matt-davis': 'Matt Davis Trail',
  'phoenix-lake': 'Phoenix Lake Loop',
  'old-railroad-grade': 'Old Railroad Grade',
  'muir-woods-main': 'Muir Woods Main Trail',
};

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 1 day
const VALID_TAGS = new Set(['closure', 'seasonal', 'crowd', 'conditions', 'wildlife']);

function getRedis() {
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) return null;
  return Redis.fromEnv();
}

function buildPrompt(trailName) {
  return `Give me a live update on "${trailName}" in Marin County, California, for a hiking/running app. I already have static historical background for this trail, so skip history entirely — focus only on what's current. Respond ONLY with raw JSON (no markdown fences, no preamble, no explanation before or after) with exactly these keys:

"recentConditions": an object with "text" (1-3 sentences on genuinely current, useful info — closures, hazards, seasonal highlights like wildflowers or waterfall flow, parking/crowding patterns, trail surface conditions like mud or downed trees. Omit anything you don't have real current signal for rather than padding — an empty or short string is fine if there's nothing notable) and "tags" (an array of 0-4 short strings drawn ONLY from this exact set: "closure", "seasonal", "crowd", "conditions", "wildlife" — include only tags that genuinely apply to what you found; an empty array is fine),

"communitySentiment": an object with "text" (1-3 sentences synthesizing what hikers commonly and recently say about this specific trail, in your own words, no fabricated quotes).

Be concise and only include what you're confident is accurate. Your entire response must be valid JSON and nothing else.`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const trailId = String(req.query.trailId || '');
  const trailName = TRAIL_NAMES[trailId];
  if (!trailName) {
    res.status(400).json({ error: 'Unknown trailId' });
    return;
  }

  const redis = getRedis();
  if (!redis) {
    res.status(503).json({ error: 'Insights cache is not configured yet (no Redis env vars) — see README.md.' });
    return;
  }

  const cacheKey = `insights:${trailId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      res.status(200).json(cached);
      return;
    }
  } catch (err) {
    console.warn('Redis read failed, generating fresh:', err);
  }

  let payload;
  try {
    const result = await callAnthropic({
      messages: [{ role: 'user', content: buildPrompt(trailName) }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      max_tokens: 700,
    });
    if (!result.ok) throw new Error('Anthropic error: ' + result.status);
    const text = (result.data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in model response');
    const parsed = JSON.parse(match[0]);
    if (!parsed.recentConditions || !parsed.communitySentiment) throw new Error('Response missing expected keys');

    const tags = Array.isArray(parsed.recentConditions.tags)
      ? parsed.recentConditions.tags.filter(t => VALID_TAGS.has(t))
      : [];
    payload = {
      recentConditions: { text: String(parsed.recentConditions.text || '').trim(), tags },
      communitySentiment: { text: String(parsed.communitySentiment.text || '').trim() },
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    res.status(502).json({ error: 'Could not generate insights', detail: String(err) });
    return;
  }

  try {
    await redis.set(cacheKey, payload, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    console.warn('Redis write failed (serving generated data anyway):', err);
  }

  res.status(200).json(payload);
}
