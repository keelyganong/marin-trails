// Add / edit your own traced trails: one guided panel anchored below the
// "Add trail" button, walking through two phases —
//   1. tracing: tap the map to place points, with live point count,
//      distance, and location feedback as you go
//   2. naming: once tracing is done, the same panel switches to name /
//      difficulty / local tips, with distance + elevation already filled in
// Editing an existing custom trail (from the view sidebar's edit button)
// jumps straight to phase 2, pre-filled.

const addTrailBtn = document.getElementById('addTrailBtn');
const addTrailPanel = document.getElementById('addTrailPanel');
const addTrailTitle = document.getElementById('addTrailTitle');
const addTrailCloseBtn = document.getElementById('addTrailCloseBtn');
const addTrailTracing = document.getElementById('addTrailTracing');
const addTrailForm = document.getElementById('addTrailForm');
const traceHintText = document.getElementById('traceHintText');
const tracePointCount = document.getElementById('tracePointCount');
const traceDistance = document.getElementById('traceDistance');
const traceLocation = document.getElementById('traceLocation');
const undoDrawBtn = document.getElementById('undoDrawBtn');
const doneDrawingBtn = document.getElementById('doneDrawingBtn');
const mapEl = document.getElementById('map');

let drawMode = false;
let drawPoints = [];
let drawLine = null, drawHalo = null;
let drawPointMarkers = [];
let editingTrail = null; // set when the panel is editing an existing custom trail

function updateLocationDisplays(text) {
  if (traceLocation) traceLocation.textContent = text;
  const formLocationEl = document.getElementById('formLocation');
  if (formLocationEl) formLocationEl.textContent = text;
}

function updateTraceHint(snapped) {
  if (snapped) {
    traceHintText.textContent = 'Snapped to a nearby trail.';
    return;
  }
  if (drawPoints.length === 0) traceHintText.textContent = 'Tap the map to place your trailhead.';
  else if (drawPoints.length === 1) traceHintText.textContent = 'Trailhead placed — tap again to add your next point.';
  else traceHintText.textContent = 'Keep tapping to trace your route, then tap Done.';
}

function updateTraceStats() {
  tracePointCount.textContent = drawPoints.length;
  traceDistance.textContent = `${pathDistanceMiles(drawPoints).toFixed(1)} mi`;
  const ready = drawPoints.length >= 2;
  doneDrawingBtn.style.opacity = ready ? '1' : '0.4';
  doneDrawingBtn.style.pointerEvents = ready ? 'auto' : 'none';
  undoDrawBtn.style.display = drawPoints.length >= 1 ? 'block' : 'none';
}

function redrawDrawPreview() {
  if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
  drawPointMarkers.forEach(m => map.removeLayer(m));
  drawPointMarkers = [];
  if (drawPoints.length === 0) return;

  if (drawPoints.length > 1) {
    drawHalo = L.polyline(drawPoints, { color: '#FBF9F1', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    drawLine = L.polyline(drawPoints, { color: '#C1542E', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round', dashArray: '1,8' }).addTo(map);
  }
  drawPoints.forEach((pt, i) => {
    const isStart = i === 0;
    const marker = L.circleMarker(pt, {
      radius: isStart ? 6 : 4,
      color: '#C1542E', weight: 2,
      fillColor: isStart ? '#C1542E' : '#FBF9F1',
      fillOpacity: 1
    }).addTo(map);
    drawPointMarkers.push(marker);
  });
}

// ----- Snap new points to nearby existing trails, so a personal route can
// deliberately follow or branch off a real one -----
function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function findSnapPoint(clickLatLng) {
  const SNAP_PX = 16;
  const clickPt = map.latLngToContainerPoint(clickLatLng);
  let best = null;
  let bestDist = Infinity;
  trails.forEach(trail => {
    if (editingTrail && trail.id === editingTrail.id) return;
    const path = trail.path;
    for (let i = 1; i < path.length; i++) {
      const a = map.latLngToContainerPoint(L.latLng(path[i - 1][0], path[i - 1][1]));
      const b = map.latLngToContainerPoint(L.latLng(path[i][0], path[i][1]));
      const c = closestPointOnSegment(clickPt, a, b);
      const dist = Math.hypot(c.x - clickPt.x, c.y - clickPt.y);
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
  });
  if (best && bestDist <= SNAP_PX) {
    return { latlng: map.containerPointToLatLng(best), snapped: true };
  }
  return { latlng: clickLatLng, snapped: false };
}

function handleDrawClick(e) {
  const { latlng, snapped } = findSnapPoint(e.latlng);
  const isFirstPoint = drawPoints.length === 0;
  drawPoints.push([latlng.lat, latlng.lng]);
  redrawDrawPreview();
  updateTraceStats();
  updateTraceHint(snapped);
  if (snapped) setTimeout(() => updateTraceHint(false), 1100);
  if (isFirstPoint) {
    traceLocation.textContent = 'Locating…';
    fetchRouteLocationLabel(drawPoints[0]);
  }
}

// ----- Panel phase switching -----
function showTracingPhase() {
  addTrailPanel.hidden = false;
  addTrailTracing.hidden = false;
  addTrailForm.hidden = true;
  addTrailTitle.textContent = 'Trace your route';
}

function showFormPhase(existingTrail) {
  addTrailPanel.hidden = false;
  addTrailTracing.hidden = true;
  addTrailForm.hidden = false;
  addTrailTitle.textContent = existingTrail ? 'Edit route' : 'Name your route';
}

function hideAddTrailPanel() {
  addTrailPanel.hidden = true;
}

function enterDrawMode() {
  drawMode = true;
  drawPoints = [];
  editingTrail = null;
  addTrailBtn.classList.add('active');
  mapEl.classList.add('drawing-mode');
  showTracingPhase();
  traceLocation.textContent = 'Place your trailhead to see the location';
  updateTraceHint(false);
  updateTraceStats();
  closeSidebar();
  map.on('click', handleDrawClick);
}

function exitDrawMode(discard) {
  drawMode = false;
  addTrailBtn.classList.remove('active');
  mapEl.classList.remove('drawing-mode');
  map.off('click', handleDrawClick);
  if (discard) {
    if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
    drawPointMarkers.forEach(m => map.removeLayer(m));
    drawPointMarkers = [];
    drawPoints = [];
  }
}

// The single × on the panel means "leave this flow" — what that discards
// depends on where you are: mid-trace or naming a brand-new route both
// throw away the unsaved points; editing an existing route just closes.
function closeAddTrailPanel() {
  if (drawMode) {
    exitDrawMode(true);
  } else if (!addTrailForm.hidden && !editingTrail) {
    if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
    drawPointMarkers.forEach(m => map.removeLayer(m));
    drawPointMarkers = [];
    drawPoints = [];
  }
  editingTrail = null;
  hideAddTrailPanel();
}

addTrailBtn.addEventListener('click', () => {
  if (!addTrailPanel.hidden) { closeAddTrailPanel(); return; }
  enterDrawMode();
});
addTrailCloseBtn.addEventListener('click', closeAddTrailPanel);

undoDrawBtn.addEventListener('click', () => {
  if (drawPoints.length === 0) return;
  drawPoints.pop();
  redrawDrawPreview();
  updateTraceStats();
  updateTraceHint(false);
});

doneDrawingBtn.addEventListener('click', () => {
  if (drawPoints.length < 2) return;
  exitDrawMode(false); // keep the drawn points/preview visible while naming
  editingTrail = null;
  openTrailForm(drawPoints);
  fetchElevationGain(drawPoints).then(gainFeet => {
    if (gainFeet == null) return;
    pendingElevationGainFeet = gainFeet;
    if (!addTrailForm.hidden && !editingTrail) {
      formElevationStat.textContent = `${gainFeet.toLocaleString()} ft`;
    }
  });
});

// ----- Name / edit form (phase 2) -----
const formName = document.getElementById('formName');
const formBlurb = document.getElementById('formBlurb');
const formDistanceStat = document.getElementById('formDistanceStat');
const formElevationStat = document.getElementById('formElevationStat');
const difficultyPicker = document.getElementById('difficultyPicker');
const formDeleteWrap = document.getElementById('formDeleteWrap');
let selectedDifficulty = null;
let pendingElevationGainFeet = null;

difficultyPicker.querySelectorAll('.diff-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    difficultyPicker.querySelectorAll('.diff-swatch').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDifficulty = btn.dataset.difficulty;
  });
});

function openTrailForm(points, existingTrail) {
  showFormPhase(existingTrail);

  const dist = pathDistanceMiles(points);
  formDistanceStat.textContent = `${dist.toFixed(1)} mi`;

  difficultyPicker.querySelectorAll('.diff-swatch').forEach(b => b.classList.remove('selected'));
  selectedDifficulty = null;
  pendingElevationGainFeet = null;

  if (existingTrail) {
    formName.value = existingTrail.name;
    formBlurb.value = existingTrail.blurb || '';
    const match = difficultyPicker.querySelector(`[data-difficulty="${existingTrail.difficulty}"]`);
    if (match) { match.classList.add('selected'); selectedDifficulty = existingTrail.difficulty; }
    formDeleteWrap.style.display = 'block';
    updateLocationDisplays(existingTrail.address || 'Marin County, CA');
    formElevationStat.textContent = existingTrail.elevation || '…';
  } else {
    formName.value = '';
    formBlurb.value = '';
    formDeleteWrap.style.display = 'none';
    updateLocationDisplays(pendingLocationLabel || 'Locating…');
    formElevationStat.textContent = 'Calculating…';
  }
  formName.focus();
}

document.getElementById('formSaveBtn').addEventListener('click', () => {
  const name = formName.value.trim();
  if (!name || !selectedDifficulty) {
    formName.style.borderColor = name ? '' : '#C1542E';
    if (!selectedDifficulty) difficultyPicker.style.outline = '1.5px solid #C1542E';
    setTimeout(() => { difficultyPicker.style.outline = 'none'; }, 900);
    return;
  }

  if (editingTrail) {
    // Update in place — metadata only, path stays as originally drawn
    editingTrail.name = name;
    editingTrail.difficulty = selectedDifficulty;
    editingTrail.blurb = formBlurb.value.trim();
    editingTrail.color = colorForDifficulty(selectedDifficulty);
    const dist = pathDistanceMiles(editingTrail.path);
    editingTrail.distance = `${dist.toFixed(1)} mi`;
    editingTrail.stats = [
      [editingTrail.distance, 'Distance'],
      [editingTrail.elevation || 'Not measured', 'Elevation'],
      [editingTrail.difficulty, 'Difficulty'],
      ['You', 'Added by']
    ];
    trailLayers[editingTrail.id].lines.forEach(l => l.setStyle({ color: editingTrail.color }));
    refreshFavoriteVisuals(editingTrail.id);
    saveCustomTrailsToStorage();
    const savedTrail = editingTrail;
    editingTrail = null;
    hideAddTrailPanel();
    openSidebar(savedTrail);
    return;
  }

  // Creating a new trail
  if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
  drawPointMarkers.forEach(m => map.removeLayer(m));
  drawPointMarkers = [];

  const dist = pathDistanceMiles(drawPoints);
  const elevationLabel = pendingElevationGainFeet != null ? `${pendingElevationGainFeet.toLocaleString()} ft gain` : 'Not measured';
  const newTrail = {
    id: 'custom-' + Date.now(),
    name,
    difficulty: selectedDifficulty,
    color: colorForDifficulty(selectedDifficulty),
    distance: `${dist.toFixed(1)} mi`,
    elevation: elevationLabel,
    blurb: formBlurb.value.trim() || 'A route you traced yourself.',
    trailhead: drawPoints[0],
    path: drawPoints.slice(),
    address: pendingLocationLabel || 'Marin County, CA',
    isCustom: true,
    stats: [
      [`${dist.toFixed(1)} mi`, 'Distance'],
      [elevationLabel, 'Elevation'],
      [selectedDifficulty, 'Difficulty'],
      ['You', 'Added by']
    ]
  };
  trails.push(newTrail);
  renderTrail(newTrail, trails.length - 1);
  applyDifficultyFilter();
  saveCustomTrailsToStorage();

  drawPoints = [];
  hideAddTrailPanel();
  openSidebar(newTrail);
});

document.getElementById('sheetEditBtn').addEventListener('click', () => {
  if (!currentTrail || !currentTrail.isCustom) return;
  closeSidebar();
  editingTrail = currentTrail;
  openTrailForm(currentTrail.path, currentTrail);
});

document.getElementById('formDeleteBtn').addEventListener('click', () => {
  if (!editingTrail) return;
  const id = editingTrail.id;
  const layers = trailLayers[id];
  if (layers) {
    layers.lines.forEach(l => map.removeLayer(l));
    layers.halos.forEach(l => map.removeLayer(l));
    delete trailLayers[id];
  }
  if (markerRefs[id]) { map.removeLayer(markerRefs[id]); delete markerRefs[id]; }
  favorites.delete(id);
  const idx = trails.findIndex(t => t.id === id);
  if (idx !== -1) trails.splice(idx, 1);
  saveCustomTrailsToStorage();
  updateFavCounter();
  editingTrail = null;
  hideAddTrailPanel();
});
