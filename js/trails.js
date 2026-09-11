// The live, mutable trail list (built-in trails from data/trails.js, plus any
// custom traced routes) and everything about drawing them on the map.

const trails = TRAIL_DATA.map(t => ({ ...t, color: colorForDifficulty(t.difficulty) }));

const trailLayers = {}; // trailId -> { lines: [...], halos: [...] }
const markerRefs = {};

function attachSegmentHandlers(halo, line, trail, baseWeight) {
  line.on('mouseover', () => { cancelClosePopup(); line.setStyle({ weight: baseWeight + 1.5 }); openPopup(trail); });
  line.on('mouseout', () => {
    line.setStyle({ weight: favorites.has(trail.id) ? baseWeight + 0.5 : baseWeight });
    scheduleClosePopup();
  });
  line.on('click', () => openSidebar(trail));
  halo.on('mouseover', () => { cancelClosePopup(); openPopup(trail); });
  halo.on('mouseout', () => scheduleClosePopup());
  halo.on('click', () => openSidebar(trail));
}

function drawIn(path, delayMs) {
  const el = path.getElement();
  if (!el || typeof el.getTotalLength !== 'function') return;
  const len = el.getTotalLength();
  el.style.strokeDasharray = len;
  el.style.strokeDashoffset = len;
  el.style.transition = 'none';
  // Force layout, then animate after the stagger delay
  requestAnimationFrame(() => {
    setTimeout(() => {
      el.style.transition = 'stroke-dashoffset 0.9s ease, stroke-width 0.2s ease, opacity 0.2s ease';
      el.style.strokeDashoffset = '0';
      // Once drawn in, remove the dash pattern entirely. Leaflet reprojects
      // this path's geometry on every zoom/pan, which changes its actual
      // pixel length — a fixed dasharray from the original length would then
      // mismatch the new length and render as broken/dashed segments.
      setTimeout(() => {
        el.style.strokeDasharray = 'none';
        el.style.strokeDashoffset = '0';
      }, 950);
    }, delayMs);
  });
}

function renderTrail(trail, index) {
  const baseWeight = 3;
  const halo = L.polyline(trail.path, {
    color: '#FBF9F1', weight: baseWeight + 3, opacity: 0.85, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
  const line = L.polyline(trail.path, {
    color: trail.color, weight: baseWeight, opacity: 0.95, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
  attachSegmentHandlers(halo, line, trail, baseWeight);
  trailLayers[trail.id] = { lines: [line], halos: [halo] };

  const delay = index * 180;
  drawIn(halo, delay);
  drawIn(line, delay);

  const icon = L.divIcon({
    className: 'trailhead-icon',
    html: iconSvg(favorites.has(trail.id), trail.color, trail.isCustom),
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const marker = L.marker(trail.trailhead, { icon }).addTo(map);
  markerRefs[trail.id] = marker;
  marker.on('mouseover', () => { cancelClosePopup(); openPopup(trail); });
  marker.on('mouseout', () => scheduleClosePopup());
  marker.on('click', () => openSidebar(trail));
}

// Difficulty filter, driven by the legend
const activeDifficulties = new Set(['Easy', 'Moderate', 'Strenuous']);

function applyDifficultyFilter() {
  trails.forEach(trail => {
    const visible = activeDifficulties.has(trail.difficulty);
    const layers = trailLayers[trail.id];
    const targets = layers ? [...layers.lines, ...layers.halos] : [];
    targets.forEach(layer => {
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    });
    const marker = markerRefs[trail.id];
    if (marker) {
      if (visible && !map.hasLayer(marker)) marker.addTo(map);
      if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

document.querySelectorAll('.legend-item').forEach(item => {
  item.addEventListener('click', () => {
    const difficulty = item.dataset.difficulty;
    if (activeDifficulties.has(difficulty)) {
      activeDifficulties.delete(difficulty);
      item.classList.remove('active');
    } else {
      activeDifficulties.add(difficulty);
      item.classList.add('active');
    }
    map.closePopup();
    applyDifficultyFilter();
  });
});
