// Live AI-generated trail insights (history / recent notes / community
// sentiment), via /api/anthropic — a small server-side proxy (see
// api/anthropic.js) that holds the Anthropic API key, since the browser
// can't call api.anthropic.com directly (no CORS headers for browser
// origins). Falls back to static content (data/fallback-insights.js) if
// the call fails.

function renderSkeleton() {
  sheetBody.innerHTML = `
    <div class="sheet-section"><h3>History</h3><div class="skeleton"></div><div class="skeleton"></div></div>
    <div class="sheet-section"><h3>Recent on the trail</h3><div class="skeleton"></div><div class="skeleton"></div></div>
    <div class="sheet-section"><h3>What people are saying</h3><div class="skeleton"></div><div class="skeleton"></div></div>
  `;
}

function renderInsights(data) {
  sheetBody.innerHTML = `
    <div class="sheet-section"><h3>History</h3><p>${data.history}</p></div>
    <div class="sheet-section"><h3>Recent on the trail</h3><p>${data.recentNotes}</p></div>
    <div class="sheet-section"><h3>What people are saying</h3><p>${data.communitySentiment}</p></div>
  `;
}

// Best-effort reverse-lookup for a custom route's starting point, using the
// same Anthropic API access already proven reliable for trail insights.
// Elevation is deliberately NOT estimated this way — see js/drawing.js for
// the real elevation-gain calculation from actual terrain data.
let pendingLocationLabel = null;

async function fetchRouteLocationLabel(startPoint) {
  pendingLocationLabel = null;
  const [lat, lon] = startPoint;
  const prompt = `A hiking/running app needs a short, human-readable location label for a route starting at latitude ${lat.toFixed(5)}, longitude ${lon.toFixed(5)} in Marin County, California. Respond with ONLY the label itself — under 8 words, e.g. "Near Muir Woods, Mill Valley, CA" — no explanation, no punctuation besides commas, nothing else.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/api/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });
    if (!response.ok) throw new Error('Location lookup failed: ' + response.status);
    const data = await response.json();
    const text = data.content.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
    if (text) {
      pendingLocationLabel = text.replace(/^["']|["']$/g, '').slice(0, 80);
      const formLocationEl = document.getElementById('formLocation');
      if (formLocationEl && sidebarForm.classList.contains('active')) {
        formLocationEl.textContent = pendingLocationLabel;
      }
    }
  } catch (err) {
    console.warn('Route location lookup failed, using generic fallback:', err);
    pendingLocationLabel = 'Marin County, CA';
    const formLocationEl = document.getElementById('formLocation');
    if (formLocationEl && sidebarForm.classList.contains('active')) {
      formLocationEl.textContent = pendingLocationLabel;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchInsights(trail) {
  const prompt = `Give me an in-depth, trustworthy profile of "${trail.name}" in Marin County, California, for a hiking/running app. Respond ONLY with raw JSON (no markdown fences, no preamble, no explanation before or after) with exactly these keys: "history" (2-3 sentences on real, verifiable history or origin of the trail), "recentNotes" (2-3 sentences on genuinely useful current/seasonal info a hiker would want, e.g. conditions, access, timing), "communitySentiment" (2-3 sentences synthesizing what hikers commonly and recently say about this specific trail, in your own words, no fabricated quotes). Be concise and only include what you're confident is accurate; omit anything you're unsure about rather than guess. Your entire response must be valid JSON and nothing else.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch("/api/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error('Anthropic API error: ' + response.status);
  const data = await response.json();
  if (!data.content || !Array.isArray(data.content)) throw new Error('Unexpected API response shape');

  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  // Extract the first {...} block in case the model adds any stray text
  // despite instructions, rather than assuming the whole string is clean JSON.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response');
  const parsed = JSON.parse(match[0]);

  if (!parsed.history || !parsed.recentNotes || !parsed.communitySentiment) {
    throw new Error('Response missing expected keys');
  }
  return parsed;
}
