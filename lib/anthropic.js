// Shared helper for calling the Anthropic API server-side. Lives outside
// api/ (Vercel treats every file directly under api/ as its own endpoint,
// so a shared helper has to sit elsewhere to avoid becoming one).

const ALLOWED_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 1200;

export async function callAnthropic({ messages, tools, max_tokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, data: { error: 'Server is missing ANTHROPIC_API_KEY' } };
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
