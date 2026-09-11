// Add / edit your own traced trails: one guided panel anchored below the
// "Add trail" button, walking through two phases —
//   1. tracing: DRAG along a trail on the map to trace it — the line snaps
//      to and follows the real trail network (data/trail-network.js, via
//      js/snap-trace.js) instead of straight segments between taps. A
//      plain tap (no real movement) still places a single point, snapped
//      if it's near a trail. Live distance and location update as you go.
//      Dragging only ever captures the map when it STARTS near a trail —
//      start a drag on empty map and it pans normally, so you're never
//      stuck unable to reposition the map.
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

// A drag only becomes a trace if it starts within this many pixels of the
// network — otherwise it's left alone so the map can pan. Real trails are
// split across many separate OSM way segments (a single named trail is
// often a dozen+ of them), so rather than trying to "stay on the same way"
// and jumping crudely at every boundary, each drag is densely resampled in
// pixel space (every DRAG_SAMPLE_SPACING_PX) and each sub-sample snapped
// independently — the line just hugs whatever's nearest at each fine step,
// which tracks the real trail shape regardless of how it's split up.
const DRAG_SNAP_PX = 22;
const DRAG_SAMPLE_SPACING_PX = 6;

let dragTraceActive = false;
let lastSamplePixel = null;
let mouseDownPixel = null;
let mouseDownLatLng = null;
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
  if (drawPoints.length === 0) traceHintText.textContent = 'Drag along a trail to trace it. Tap to place a point, or drag empty map to pan.';
  else traceHintText.textContent = 'Keep dragging or tapping to extend your route, then tap Done.';
}

function updateTraceStats() {
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

// Places one point, snapped to the network if it's near one. If the new
// point lands far from the last drawn point (in screen pixels), it might be
// the user dragging back over ground already traced this gesture rather
// than continuing forward — search back through this gesture's points for
// a close match and unwind to it instead of adding a doubled-back spike.
function placeTracePoint(latlng) {
  const snap = findNearestNetworkPoint(latlng, DRAG_SNAP_PX);
  const candidate = snap ? snap.latlng : toLatLonArray(latlng);
  const candidatePx = map.latLngToContainerPoint(L.latLng(candidate[0], candidate[1]));

  if (drawPoints.length > 0) {
    const lastPt = drawPoints[drawPoints.length - 1];
    const lastPx = map.latLngToContainerPoint(L.latLng(lastPt[0], lastPt[1]));
    const distToLast = Math.hypot(candidatePx.x - lastPx.x, candidatePx.y - lastPx.y);
    if (distToLast > DRAG_SNAP_PX * 1.5) {
      const gestureFloor = gestureStarts.length ? gestureStarts[gestureStarts.length - 1] : 0;
      for (let idx = drawPoints.length - 2; idx >= gestureFloor; idx--) {
        const pPt = drawPoints[idx];
        const pPx = map.latLngToContainerPoint(L.latLng(pPt[0], pPt[1]));
        if (Math.hypot(pPx.x - candidatePx.x, pPx.y - candidatePx.y) <= DRAG_SNAP_PX) {
          drawPoints.length = idx + 1;
          break;
        }
      }
    }
  }

  drawPoints.push([candidate[0], candidate[1]]);
}

function handleTraceMouseDown(e) {
  if (!drawMode) return;
  mouseDownPixel = map.latLngToContainerPoint(e.latlng);
  mouseDownLatLng = e.latlng;

  // Only capture the drag if it starts near a trail — otherwise leave it
  // alone entirely so the map's own drag-to-pan handles it. A plain tap
  // that started off-trail is handled on mouseup below.
  if (!findNearestNetworkPoint(e.latlng, DRAG_SNAP_PX)) {
    dragTraceActive = false;
    return;
  }

  dragTraceActive = true;
  map.dragging.disable();
  gestureStarts.push(drawPoints.length);
  lastSamplePixel = mouseDownPixel;
  const isFirstPoint = drawPoints.length === 0;
  placeTracePoint(e.latlng);

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
  const dist = Math.hypot(px.x - lastSamplePixel.x, px.y - lastSamplePixel.y);
  if (dist < 1) return;

  // Resample the straight pixel-space path since the last processed point
  // at a fixed spacing, snapping each sub-point independently — this is
  // what makes the line hug the real trail shape even through a fast drag
  // that only fires a few browser mousemove events.
  const steps = Math.max(1, Math.ceil(dist / DRAG_SAMPLE_SPACING_PX));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const samplePx = { x: lastSamplePixel.x + (px.x - lastSamplePixel.x) * t, y: lastSamplePixel.y + (px.y - lastSamplePixel.y) * t };
    placeTracePoint(map.containerPointToLatLng(samplePx));
  }
  lastSamplePixel = px;

  redrawDrawPreview();
  updateTraceStats();
}

function handleTraceMouseUp(e) {
  if (dragTraceActive) {
    dragTraceActive = false;
    map.dragging.enable();
    updateTraceHint();
    mouseDownLatLng = null;
    return;
  }
  // Didn't capture on mousedown (started off-trail). If the mouse never
  // moved much, treat it as a plain tap and place a freehand point;
  // otherwise it was a genuine pan and there's nothing to do.
  if (!mouseDownLatLng) return;
  const upPx = e && e.latlng ? map.latLngToContainerPoint(e.latlng) : mouseDownPixel;
  const moved = mouseDownPixel ? Math.hypot(upPx.x - mouseDownPixel.x, upPx.y - mouseDownPixel.y) : Infinity;
  if (moved < DRAG_SAMPLE_SPACING_PX) {
    gestureStarts.push(drawPoints.length);
    const isFirstPoint = drawPoints.length === 0;
    drawPoints.push(toLatLonArray(mouseDownLatLng));
    redrawDrawPreview();
    updateTraceStats();
    updateTraceHint();
    if (isFirstPoint) {
      traceLocation.textContent = 'Locating…';
      fetchRouteLocationLabel(drawPoints[0]);
    }
  }
  mouseDownLatLng = null;
}

// Safety net: if the button is released off the map (or the tab loses
// focus mid-drag), don't leave tracing — or map panning — stuck disabled.
document.addEventListener('mouseup', () => {
  if (dragTraceActive) { dragTraceActive = false; map.dragging.enable(); updateTraceHint(); }
  mouseDownLatLng = null;
});

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
  // Map dragging stays enabled by default — it's only disabled per-gesture,
  // in handleTraceMouseDown, when a drag actually starts near a trail. That
  // way a drag anywhere else still pans the map normally.
  map.on('mousedown', handleTraceMouseDown);
  map.on('mousemove', handleTraceMouseMove);
  map.on('mouseup', handleTraceMouseUp);
}

function exitDrawMode(discard) {
  drawMode = false;
  dragTraceActive = false;
  addTrailBtn.classList.remove('active');
  mapEl.classList.remove('drawing-mode');
  map.dragging.enable(); // safety net in case a gesture left it disabled
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
