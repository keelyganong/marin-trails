// Trail insights sidebar content. Split into two tiers:
//
// - History: static, from data/fallback-insights.js. It doesn't change, so
//   there's no reason to spend an API call regenerating it — rendered
//   immediately, no network request.
// - Recent conditions + community sentiment: live, via /api/insights (a
//   cached server-side endpoint — see api/insights.js) so it reflects
//   current closures, season, crowding, and what hikers are saying lately.
//   Shown with a relative "Updated X ago" timestamp and category tags.
//
// Custom (isCustom) trails skip the live call entirely — there's no public
// information about a route only you have drawn — and just show
// GENERIC_FALLBACK_INSIGHTS throughout.

const INSIGHT_TAG_LABELS = {
  closure: 'Closure',
  seasonal: 'Seasonal',
  crowd: 'Crowded',
  conditions: 'Trail conditions',
  wildlife: 'Wildlife',
};

function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function renderInsightTags(tags) {
  if (!tags || tags.length === 0) return '';
  return `<div class="insight-tags">${tags.map(t =>
    `<span class="insight-tag insight-tag-${t}">${INSIGHT_TAG_LABELS[t] || t}</span>`
  ).join('')}</div>`;
}

function renderRefreshMeta(generatedAt) {
  if (!generatedAt) return '';
  return `<span class="insight-refresh-label">Updated ${formatRelativeTime(generatedAt)}</span>`;
}

function renderHistory(trail) {
  const source = (FALLBACK_INSIGHTS[trail.id] || GENERIC_FALLBACK_INSIGHTS);
  sheetBody.innerHTML = `
    <div class="sheet-section"><h3>History</h3><p>${source.history}</p></div>
    <div class="sheet-section" id="recentSection"><h3>Recent conditions</h3><div class="skeleton"></div><div class="skeleton"></div></div>
    <div class="sheet-section" id="communitySection"><h3>What people are saying</h3><div class="skeleton"></div><div class="skeleton"></div></div>
  `;
}

// Custom routes have no public write-up to show — the one thing worth
// surfacing here is what you actually wrote about it yourself.
function renderCustomTrailNotes(trail) {
  sheetBody.innerHTML = `
    <div class="sheet-section"><h3>Your notes</h3><p>${trail.blurb}</p></div>
  `;
}

function renderLiveSections(data) {
  const recentSection = document.getElementById('recentSection');
  const communitySection = document.getElementById('communitySection');
  if (!recentSection || !communitySection) return;

  const recentText = data.recentConditions.text || 'Nothing notable found right now — conditions look routine.';
  recentSection.innerHTML = `
    <div class="insight-header"><h3>Recent conditions</h3>${renderRefreshMeta(data.generatedAt)}</div>
    ${renderInsightTags(data.recentConditions.tags)}
    <p>${recentText}</p>
  `;
  communitySection.innerHTML = `
    <div class="insight-header"><h3>What people are saying</h3>${renderRefreshMeta(data.generatedAt)}</div>
    <p>${data.communitySentiment.text}</p>
  `;
}

function renderStaticFallbackSections(trail) {
  const source = (FALLBACK_INSIGHTS[trail.id] || GENERIC_FALLBACK_INSIGHTS);
  const recentSection = document.getElementById('recentSection');
  const communitySection = document.getElementById('communitySection');
  if (!recentSection || !communitySection) return;
  recentSection.innerHTML = `<h3>Recent conditions</h3><p>${source.recentNotes}</p>`;
  communitySection.innerHTML = `<h3>What people are saying</h3><p>${source.communitySentiment}</p>`;
}

async function fetchLiveInsights(trailId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`/api/insights?trailId=${encodeURIComponent(trailId)}`, { signal: controller.signal });
    if (!res.ok) throw new Error('Insights fetch failed: ' + res.status);
    const data = await res.json();
    if (!data.recentConditions || !data.communitySentiment) throw new Error('Unexpected response shape');
    return data;
  } finally {
    clearTimeout(timeout);
  }
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
      updateLocationDisplays(pendingLocationLabel);
    }
  } catch (err) {
    console.warn('Route location lookup failed, using generic fallback:', err);
    pendingLocationLabel = 'Marin County, CA';
    updateLocationDisplays(pendingLocationLabel);
  } finally {
    clearTimeout(timeout);
  }
}
