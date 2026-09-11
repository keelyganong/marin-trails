// Add / edit your own traced trails: one guided panel anchored below the
// "Add trail" button, walking through two phases —
//   1. tracing: DRAG along a trail on the map to trace it — the line snaps
//      to and follows the real trail network (data/trail-network.js, via
//      js/snap-trace.js) instead of straight segments between taps. A
//      plain tap (no real movement) still places a single point, snapped
//      if it's near a trail. Live point count, distance, and location
//      update as you go.
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

// Dragging traces a route, so the map's own drag-to-pan has to give way
// while a trace is in progress — re-enabled the moment draw mode ends.
const DRAG_SNAP_PX = 22;   // generous "magnetic" radius while actively tracing
const DRAG_SAMPLE_PX = 5;  // minimum cursor movement between processed samples

let dragTraceActive = false;
let dragNetworkState = null; // {wayIdx, segIdx, t} once snapped onto a way, else null
let dragPointMeta = [];      // parallel to drawPoints entries added in the CURRENT gesture
let lastSamplePixel = null;
let gestureStarts = []; // drawPoints length before each tap/drag gesture, for Undo

function toLatLonArray(latlng) {
  return Array.isArray(latlng) ? latlng : [latlng.lat, latlng.lng];
}

function updateLocationDisplays(text) {
  if (traceLocation) traceLocation.textContent = text;
  const formLocationEl = document.getElementById('formLocation');
  if (formLocationEl) formLocationEl.textContent = text;
}

function updateTraceHint() {
  if (drawPoints.length === 0) traceHintText.textContent = 'Drag along a trail to trace it, or tap to place your trailhead.';
  else traceHintText.textContent = 'Keep dragging or tapping to extend your route, then tap Done.';
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
  // Line layers only make sense with 2+ points — remove them (Undo can
  // drop the count from many back to 0 or 1) rather than leaving a stale
  // line from before on the map.
  if (drawPoints.length <= 1) {
    if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
  } else if (!drawLine) {
    drawHalo = L.polyline(drawPoints, { color: '#FBF9F1', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    drawLine = L.polyline(drawPoints, { color: '#C1542E', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  } else {
    // Update in place rather than remove+recreate — this runs on every
    // drag sample, and recreating layers that often visibly stutters.
    drawHalo.setLatLngs(drawPoints);
    drawLine.setLatLngs(drawPoints);
  }

  // Only the trailhead and current end get a marker — a route traced by
  // dragging can have hundreds of points, and a marker per point would be
  // both visual noise and slow to redraw continuously.
  drawPointMarkers.forEach(m => map.removeLayer(m));
  drawPointMarkers = [];
  if (drawPoints.length === 0) return;
  drawPointMarkers.push(L.circleMarker(drawPoints[0], {
    radius: 6, color: '#C1542E', weight: 2, fillColor: '#C1542E', fillOpacity: 1
  }).addTo(map));
  if (drawPoints.length > 1) {
    drawPointMarkers.push(L.circleMarker(drawPoints[drawPoints.length - 1], {
      radius: 5, color: '#C1542E', weight: 2, fillColor: '#FBF9F1', fillOpacity: 1
    }).addTo(map));
  }
}

// ----- Drag-to-trace: snaps to the real trail network while dragging -----
function pushTracePoint(pt, meta) {
  drawPoints.push(toLatLonArray(pt));
  dragPointMeta.push(meta);
}

function handleTraceMouseDown(e) {
  if (!drawMode) return;
  dragTraceActive = true;
  dragPointMeta = [];
  gestureStarts.push(drawPoints.length);
  lastSamplePixel = map.latLngToContainerPoint(e.latlng);

  const isFirstPoint = drawPoints.length === 0;
  const snap = findNearestNetworkPoint(e.latlng, DRAG_SNAP_PX);
  if (snap) {
    pushTracePoint(snap.latlng, { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t });
    dragNetworkState = { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t };
  } else {
    pushTracePoint(e.latlng, null);
    dragNetworkState = null;
  }

  redrawDrawPreview();
  updateTraceStats();
  updateTraceHint();
  if (isFirstPoint) {
    traceLocation.textContent = 'Locating…';
    fetchRouteLocationLabel(drawPoints[0]);
  }
}

function handleTraceMouseMove(e) {
  if (!dragTraceActive) return;
  const px = map.latLngToContainerPoint(e.latlng);
  if (lastSamplePixel && Math.hypot(px.x - lastSamplePixel.x, px.y - lastSamplePixel.y) < DRAG_SAMPLE_PX) return;
  lastSamplePixel = px;

  const snap = findNearestNetworkPoint(e.latlng, DRAG_SNAP_PX);

  if (snap && dragNetworkState && snap.wayIdx === dragNetworkState.wayIdx) {
    const way = TRAIL_NETWORK[snap.wayIdx];
    const cmp = comparePos(dragNetworkState.segIdx, dragNetworkState.t, snap.segIdx, snap.t);
    if (cmp < 0) {
      // Dragged forward along the same trail — fill in its real vertices.
      const steps = walkForward(way, snap.wayIdx, dragNetworkState.segIdx, dragNetworkState.t, snap.segIdx, snap.t);
      steps.forEach(({ pt, meta }) => pushTracePoint(pt, meta));
      dragNetworkState = { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t };
    } else if (cmp > 0) {
      // Dragged back over ground already traced this gesture — unwind to
      // the new position instead of adding a doubled-back spike.
      while (dragPointMeta.length > 0) {
        const last = dragPointMeta[dragPointMeta.length - 1];
        if (!last || last.wayIdx !== snap.wayIdx || comparePos(last.segIdx, last.t, snap.segIdx, snap.t) <= 0) break;
        dragPointMeta.pop();
        drawPoints.pop();
      }
      pushTracePoint(snap.latlng, { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t });
      dragNetworkState = { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t };
    }
    // cmp === 0: hasn't moved along the way yet — nothing to add.
  } else if (snap) {
    // Landed on a different trail than before (a junction, or the first
    // snap after being off-network) — a short straight connector is fine.
    pushTracePoint(snap.latlng, { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t });
    dragNetworkState = { wayIdx: snap.wayIdx, segIdx: snap.segIdx, t: snap.t };
  } else {
    // Off any trail — freehand.
    pushTracePoint(e.latlng, null);
    dragNetworkState = null;
  }

  redrawDrawPreview();
  updateTraceStats();
}

function handleTraceMouseUp() {
  if (!dragTraceActive) return;
  dragTraceActive = false;
  dragNetworkState = null;
  dragPointMeta = [];
  updateTraceHint();
}

// Safety net: if the button is released off the map (or the tab loses
// focus mid-drag), don't leave tracing stuck "active".
document.addEventListener('mouseup', () => { if (dragTraceActive) handleTraceMouseUp(); });

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
  gestureStarts = [];
  editingTrail = null;
  addTrailBtn.classList.add('active');
  mapEl.classList.add('drawing-mode');
  showTracingPhase();
  traceLocation.textContent = 'Place your trailhead to see the location';
  updateTraceHint();
  updateTraceStats();
  closeSidebar();
  map.dragging.disable(); // dragging now traces a route instead of panning
  map.on('mousedown', handleTraceMouseDown);
  map.on('mousemove', handleTraceMouseMove);
  map.on('mouseup', handleTraceMouseUp);
}

function exitDrawMode(discard) {
  drawMode = false;
  dragTraceActive = false;
  addTrailBtn.classList.remove('active');
  mapEl.classList.remove('drawing-mode');
  map.dragging.enable();
  map.off('mousedown', handleTraceMouseDown);
  map.off('mousemove', handleTraceMouseMove);
  map.off('mouseup', handleTraceMouseUp);
  if (discard) {
    if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
    drawPointMarkers.forEach(m => map.removeLayer(m));
    drawPointMarkers = [];
    drawPoints = [];
    gestureStarts = [];
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
    gestureStarts = [];
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
  // Undoes the whole last gesture (one drag stroke, or one tap) rather
  // than a single point — a drag can add many points at once, and popping
  // just one at a time wouldn't feel like "undo" for that.
  if (gestureStarts.length === 0) return;
  drawPoints.length = gestureStarts.pop();
  redrawDrawPreview();
  updateTraceStats();
  updateTraceHint();
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
