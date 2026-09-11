// Drag-to-trace snapping: finds the nearest point on the real trail network
// (data/trail-network.js) to a map position, and walks along a way's actual
// vertices between two positions on it — so dragging your cursor near a
// trail produces a smooth line that follows its real shape, not straight
// segments between sparse taps. See js/drawing.js for the drag interaction
// that drives this.

let networkBBoxes = null;

function ensureNetworkIndex() {
  if (networkBBoxes) return;
  networkBBoxes = TRAIL_NETWORK.map(way => {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lat, lon] of way) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    return { minLat, maxLat, minLon, maxLon };
  });
}

function pointAtT(way, segIdx, t) {
  const a = way[segIdx], b = way[segIdx + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Bounding-box prefilter (cheap) narrows 5,000+ ways down to the handful
// actually near the cursor before doing per-segment pixel-distance checks
// (the part that needs Leaflet's projection, so it's worth skipping when we
// can). Margin is generous relative to the pixel snap radius callers use.
const NETWORK_PREFILTER_DEG = 0.006;

function findNearestNetworkPoint(latlng, maxPixelDist) {
  ensureNetworkIndex();
  const queryPt = map.latLngToContainerPoint(latlng);
  let best = null;
  let bestPixelDist = Infinity;

  for (let w = 0; w < TRAIL_NETWORK.length; w++) {
    const bb = networkBBoxes[w];
    if (
      latlng.lat < bb.minLat - NETWORK_PREFILTER_DEG || latlng.lat > bb.maxLat + NETWORK_PREFILTER_DEG ||
      latlng.lng < bb.minLon - NETWORK_PREFILTER_DEG || latlng.lng > bb.maxLon + NETWORK_PREFILTER_DEG
    ) continue;

    const way = TRAIL_NETWORK[w];
    for (let i = 0; i < way.length - 1; i++) {
      const a = map.latLngToContainerPoint(L.latLng(way[i][0], way[i][1]));
      const b = map.latLngToContainerPoint(L.latLng(way[i + 1][0], way[i + 1][1]));
      const c = closestPointOnSegment(queryPt, a, b);
      const dist = Math.hypot(c.x - queryPt.x, c.y - queryPt.y);
      if (dist < bestPixelDist) {
        bestPixelDist = dist;
        const segLenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        let t = segLenSq === 0 ? 0 : (((queryPt.x - a.x) * (b.x - a.x) + (queryPt.y - a.y) * (b.y - a.y)) / segLenSq);
        t = Math.max(0, Math.min(1, t));
        best = { wayIdx: w, segIdx: i, t, latlng: pointAtT(way, i, t) };
      }
    }
  }

  return (best && bestPixelDist <= maxPixelDist) ? best : null;
}

// -1 if (segA,tA) is before (segB,tB) along the way, 0 if equal, 1 if after.
function comparePos(segA, tA, segB, tB) {
  if (segA !== segB) return segA < segB ? -1 : 1;
  if (tA === tB) return 0;
  return tA < tB ? -1 : 1;
}

// Real vertices strictly after (fromSeg,fromT) up to and including
// (toSeg,toT) — caller guarantees "to" is after "from" on the same way.
// Each returned entry carries its own {wayIdx,segIdx,t}, not just the final
// one, so a later backward drag can unwind precisely to any point in this
// batch rather than only to its end.
function walkForward(way, wayIdx, fromSeg, fromT, toSeg, toT) {
  if (fromSeg === toSeg) {
    return [{ pt: pointAtT(way, toSeg, toT), meta: { wayIdx, segIdx: toSeg, t: toT } }];
  }
  const out = [];
  for (let i = fromSeg + 1; i <= toSeg; i++) {
    out.push({ pt: way[i].slice(), meta: { wayIdx, segIdx: i, t: 0 } });
  }
  out.push({ pt: pointAtT(way, toSeg, toT), meta: { wayIdx, segIdx: toSeg, t: toT } });
  return out;
}
