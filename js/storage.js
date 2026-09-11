// Custom traced trails, synced across a visitor's own devices via a private
// "sync code" (see api/trails.js) — not a real login, just a random code
// generated on first save. The same code entered on another device pulls
// the same trails. A localStorage cache is kept alongside the server copy
// so the app still works offline or before sync is configured server-side.

const SYNC_CODE_KEY = 'marin-trails.sync-code';
const CUSTOM_TRAILS_CACHE_KEY = 'marin-trails.custom-trails-cache';
const SYNC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easier to read/type
const SYNC_CODE_LENGTH = 10;

function getSyncCode() {
  try {
    return localStorage.getItem(SYNC_CODE_KEY);
  } catch {
    return null;
  }
}

function generateSyncCode() {
  const bytes = new Uint32Array(SYNC_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < SYNC_CODE_LENGTH; i++) code += SYNC_CODE_ALPHABET[bytes[i] % SYNC_CODE_ALPHABET.length];
  return code;
}

function ensureSyncCode() {
  let code = getSyncCode();
  if (!code) {
    code = generateSyncCode();
    try { localStorage.setItem(SYNC_CODE_KEY, code); } catch { /* ignore */ }
  }
  return code;
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRAILS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalCache(custom) {
  try {
    localStorage.setItem(CUSTOM_TRAILS_CACHE_KEY, JSON.stringify(custom));
  } catch { /* ignore */ }
}

function serializeCustomTrails() {
  return trails.filter(t => t.isCustom).map(t => ({
    id: t.id, name: t.name, difficulty: t.difficulty, blurb: t.blurb,
    trailhead: t.trailhead, path: t.path, stats: t.stats,
    distance: t.distance, elevation: t.elevation, address: t.address || null
  }));
}

async function saveCustomTrailsToStorage() {
  const custom = serializeCustomTrails();
  writeLocalCache(custom); // always keep a local copy, regardless of server availability
  const code = ensureSyncCode();
  try {
    const res = await fetchWithTimeout('/api/trails', 10000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, trails: custom })
    });
    if (!res.ok) throw new Error('sync save failed: ' + res.status);
  } catch (err) {
    console.warn('Could not sync custom trails to the server (kept locally):', err);
  }
}

function renderCustomTrails(custom) {
  custom.forEach((t) => {
    t.isCustom = true;
    t.color = colorForDifficulty(t.difficulty);
    trails.push(t);
    renderTrail(t, trails.length - 1);
  });
  applyDifficultyFilter();
}

function clearCustomTrailsFromMap() {
  for (let i = trails.length - 1; i >= 0; i--) {
    if (!trails[i].isCustom) continue;
    const id = trails[i].id;
    const layers = trailLayers[id];
    if (layers) {
      layers.lines.forEach(l => map.removeLayer(l));
      layers.halos.forEach(l => map.removeLayer(l));
      delete trailLayers[id];
    }
    if (markerRefs[id]) { map.removeLayer(markerRefs[id]); delete markerRefs[id]; }
    favorites.delete(id);
    trails.splice(i, 1);
  }
}

async function loadCustomTrails() {
  const code = getSyncCode();
  let custom = null;
  if (code) {
    try {
      const res = await fetchWithTimeout(`/api/trails?code=${encodeURIComponent(code)}`, 10000);
      if (res.ok) {
        const data = await res.json();
        custom = data.trails;
        writeLocalCache(custom); // keep the local cache fresh for next time
      }
    } catch (err) {
      console.warn('Trail sync fetch failed, using local cache instead:', err);
    }
  }
  if (!custom) custom = readLocalCache();
  renderCustomTrails(custom);
}

// Switches to a different sync code (entered from another device) — drops
// whatever custom trails are currently shown and loads that code's trails.
async function switchSyncCode(newCode) {
  const code = newCode.trim().toUpperCase();
  if (!code) return { ok: false, error: 'Enter a code.' };

  try {
    const res = await fetchWithTimeout(`/api/trails?code=${encodeURIComponent(code)}`, 10000);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || `Server returned ${res.status}` };
    }
    const data = await res.json();
    try { localStorage.setItem(SYNC_CODE_KEY, code); } catch { /* ignore */ }
    writeLocalCache(data.trails);
    clearCustomTrailsFromMap();
    renderCustomTrails(data.trails);
    return { ok: true, count: data.trails.length };
  } catch (err) {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' };
  }
}
