// Add / edit your own traced trails: draw mode, snap-to-existing-trail, and
// the create/edit form (which shares the sidebar element with sidebar.js).

const addTrailBtn = document.getElementById('addTrailBtn');
const drawBanner = document.getElementById('drawBanner');
const drawBannerText = document.getElementById('drawBannerText');
const doneDrawingBtn = document.getElementById('doneDrawingBtn');
const undoDrawBtn = document.getElementById('undoDrawBtn');
const mapEl = document.getElementById('map');

let drawMode = false;
let drawPoints = [];
let drawLine = null, drawHalo = null;
let drawPointMarkers = [];
let editingTrail = null; // set when the form is editing an existing custom trail

function updateDrawBannerText(snapped) {
  if (snapped) {
    drawBannerText.textContent = 'Snapped to a nearby trail.';
    return;
  }
  if (drawPoints.length === 0) drawBannerText.textContent = 'Tap the map to place your trailhead.';
  else if (drawPoints.length === 1) drawBannerText.textContent = 'Trailhead placed — tap again to add your next point.';
  else drawBannerText.textContent = 'Keep tapping to trace your route, or tap Done when finished.';
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
  drawPoints.push([latlng.lat, latlng.lng]);
  redrawDrawPreview();
  if (drawPoints.length >= 2) doneDrawingBtn.classList.add('visible');
  if (drawPoints.length >= 1) undoDrawBtn.style.display = 'inline-block';
  updateDrawBannerText(snapped);
  if (snapped) setTimeout(() => updateDrawBannerText(false), 1100);
}

function enterDrawMode() {
  drawMode = true;
  drawPoints = [];
  addTrailBtn.classList.add('active');
  mapEl.classList.add('drawing-mode');
  drawBanner.classList.add('visible');
  doneDrawingBtn.classList.remove('visible');
  undoDrawBtn.style.display = 'none';
  updateDrawBannerText(false);
  closeSidebarForce();
  map.on('click', handleDrawClick);
}

function exitDrawMode(discard) {
  drawMode = false;
  addTrailBtn.classList.remove('active');
  mapEl.classList.remove('drawing-mode');
  drawBanner.classList.remove('visible');
  doneDrawingBtn.classList.remove('visible');
  map.off('click', handleDrawClick);
  if (discard) {
    if (drawLine) { map.removeLayer(drawLine); map.removeLayer(drawHalo); drawLine = null; drawHalo = null; }
    drawPointMarkers.forEach(m => map.removeLayer(m));
    drawPointMarkers = [];
    drawPoints = [];
  }
}

addTrailBtn.addEventListener('click', () => {
  if (drawMode) { exitDrawMode(true); return; }
  enterDrawMode();
});
document.getElementById('cancelDrawBtn').addEventListener('click', () => exitDrawMode(true));
undoDrawBtn.addEventListener('click', () => {
  if (drawPoints.length === 0) return;
  drawPoints.pop();
  redrawDrawPreview();
  if (drawPoints.length < 2) doneDrawingBtn.classList.remove('visible');
  if (drawPoints.length === 0) undoDrawBtn.style.display = 'none';
  updateDrawBannerText(false);
});

doneDrawingBtn.addEventListener('click', () => {
  exitDrawMode(false); // keep the drawn points/preview visible while naming
  editingTrail = null;
  fetchRouteLocationLabel(drawPoints[0]);
  openTrailForm(drawPoints);
  fetchElevationGain(drawPoints).then(gainFeet => {
    if (gainFeet == null) return;
    pendingElevationGainFeet = gainFeet;
    if (sidebarForm.classList.contains('active') && !editingTrail) {
      document.getElementById('formElevation').textContent = `${gainFeet.toLocaleString()} ft gain`;
    }
  });
});


// ----- Create/edit form -----
const formName = document.getElementById('formName');
const formBlurb = document.getElementById('formBlurb');
const formDistance = document.getElementById('formDistance');
const formTitle = document.getElementById('formTitle');
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
  sidebarView.classList.add('hidden');
  sidebarForm.classList.add('active');
  sidebar.classList.add('open');

  const dist = pathDistanceMiles(points);
  formDistance.textContent = `${dist.toFixed(1)} mi traced`;

  difficultyPicker.querySelectorAll('.diff-swatch').forEach(b => b.classList.remove('selected'));
  selectedDifficulty = null;
  pendingElevationGainFeet = null;

  if (existingTrail) {
    formTitle.textContent = 'Edit route';
    formName.value = existingTrail.name;
    formBlurb.value = existingTrail.blurb || '';
    const match = difficultyPicker.querySelector(`[data-difficulty="${existingTrail.difficulty}"]`);
    if (match) { match.classList.add('selected'); selectedDifficulty = existingTrail.difficulty; }
    formDeleteWrap.style.display = 'block';
    document.getElementById('formLocation').textContent = existingTrail.address || 'Marin County, CA';
    document.getElementById('formElevation').textContent = existingTrail.elevation || 'Calculating elevation…';
  } else {
    formTitle.textContent = 'Name your route';
    formName.value = '';
    formBlurb.value = '';
    formDeleteWrap.style.display = 'none';
    document.getElementById('formLocation').textContent = 'Locating…';
    document.getElementById('formElevation').textContent = 'Calculating elevation…';
  }
  formName.focus();
}

document.getElementById('formCloseBtn').addEventListener('click', () => {
  sidebarForm.classList.remove('active');
  sidebarView.classList.remove('hidden');
  sidebar.classList.remove('open');
  if (!editingTrail) exitDrawMode(true); // discard an unsaved new route
  editingTrail = null;
});

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
    closeSidebarForce();
    sidebarView.classList.remove('hidden');
    openSidebar(editingTrail);
    editingTrail = null;
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

  sidebarForm.classList.remove('active');
  sidebarView.classList.remove('hidden');
  drawPoints = [];
  openSidebar(newTrail);
});

document.getElementById('sheetEditBtn').addEventListener('click', () => {
  if (!currentTrail || !currentTrail.isCustom) return;
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
  closeSidebarForce();
  sidebarView.classList.remove('hidden');
});
