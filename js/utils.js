// Small stateless helpers shared across the app.

function colorForDifficulty(difficulty) {
  if (difficulty === 'Easy') return '#7C8F6E';       // sage — lighter, easier
  if (difficulty === 'Moderate') return '#3D6C82';   // bay — mid
  return '#24382C';                                   // forest — strenuous, heaviest
}

function haversineMiles(a, b) {
  const R = 3958.8; // miles
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathDistanceMiles(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMiles(path[i - 1], path[i]);
  return total;
}

// Closest point to p on the segment a-b, all in the same (pixel or lat/lon)
// coordinate space. Shared by js/snap-trace.js (network snapping).
function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

async function fetchWithTimeout(url, ms, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
