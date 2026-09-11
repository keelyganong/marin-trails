// Real elevation gain for a custom traced route, from actual terrain data —
// Open-Elevation (a free, keyless public DEM lookup service), not a guess.
//
// Sparse hand-tapped points would undercount gain on any climb/descent that
// happens *between* two taps, so the traced path is first resampled to a
// point roughly every 25m before querying elevation, up to a request-size
// cap. Gain is the sum of positive elevation deltas between consecutive
// samples — the standard "cumulative elevation gain" definition.

const ELEVATION_SAMPLE_SPACING_MILES = 25 / 1609.34; // ~25 meters
const ELEVATION_MAX_SAMPLES = 300; // keep a single lookup request reasonably sized

function resamplePath(path, spacingMiles, maxSamples) {
  if (path.length < 2) return path.slice();
  const samples = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const segMiles = haversineMiles(a, b);
    const steps = Math.max(1, Math.round(segMiles / spacingMiles));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (samples.length <= maxSamples) return samples;
  // Too dense for the request cap — take an even subset rather than the
  // finest resolution, so long routes still get a request that succeeds.
  const stride = samples.length / maxSamples;
  const thinned = [];
  for (let i = 0; i < maxSamples; i++) thinned.push(samples[Math.floor(i * stride)]);
  thinned.push(samples[samples.length - 1]);
  return thinned;
}

// Returns elevation gain in feet, or null if the lookup failed — callers
// should fall back to an honest "Not measured" rather than guessing.
async function fetchElevationGain(path) {
  if (!path || path.length < 2) return null;
  const samples = resamplePath(path, ELEVATION_SAMPLE_SPACING_MILES, ELEVATION_MAX_SAMPLES);

  try {
    const res = await fetchWithTimeout('https://api.open-elevation.com/api/v1/lookup', 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: samples.map(([latitude, longitude]) => ({ latitude, longitude })) })
    });
    if (!res || !res.ok) throw new Error('Open-Elevation request failed: ' + (res && res.status));
    const data = await res.json();
    const elevationsMeters = data.results.map(r => r.elevation);

    let gainMeters = 0;
    for (let i = 1; i < elevationsMeters.length; i++) {
      const delta = elevationsMeters[i] - elevationsMeters[i - 1];
      if (delta > 0) gainMeters += delta;
    }
    return Math.round(gainMeters * 3.28084); // meters -> feet
  } catch (err) {
    console.warn('Elevation lookup failed, leaving gain unmeasured:', err);
    return null;
  }
}
