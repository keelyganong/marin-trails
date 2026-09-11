// Hover popup, favoriting, and the little SVG icons used by both the popup
// and trailhead markers.

const favorites = new Set();

// Built-in trailheads are circles; routes you've traced yourself are
// diamonds — a shape difference reads clearly on the map at marker size,
// where a subtler cue (just a color or line-weight change) would not.
function iconSvg(favorited, color, isCustom) {
  const stroke = favorited ? '#C1542E' : color;
  const fill = favorited ? '#C1542E' : (isCustom ? 'none' : '#FBF9F1');
  const strokeWidth = (isCustom && !favorited) ? 2.2 : 2;
  const shape = isCustom
    ? `<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" transform="rotate(45 8 8)" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
    : `<circle cx="8" cy="8" r="6" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  return `<svg viewBox="0 0 16 16" fill="none">${shape}</svg>`;
}

function heartIcon(active) {
  return `<svg viewBox="0 0 24 24" fill="${active ? 'currentColor' : 'none'}"><path d="M12 21s-7.5-4.6-10-9.2C.4 8.5 2 4.8 5.6 4.1c2-.4 4 .5 5.1 2.2C11.8 4.6 13.8 3.7 15.8 4.1c3.6.7 5.2 4.4 3.6 7.7C16.9 16.4 12 21 12 21z" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

function updateFavCounter() {
  document.getElementById('favCount').textContent = favorites.size;
}

let closePopupTimer = null;
function cancelClosePopup() {
  if (closePopupTimer) { clearTimeout(closePopupTimer); closePopupTimer = null; }
}
function scheduleClosePopup() {
  cancelClosePopup();
  closePopupTimer = setTimeout(() => { map.closePopup(); }, 150);
}

function refreshFavoriteVisuals(trailId) {
  const isFav = favorites.has(trailId);
  const trail = trails.find(t => t.id === trailId);
  const layers = trailLayers[trailId];
  if (layers) {
    layers.lines.forEach(line => {
      const base = 3;
      line.setStyle({ opacity: 1, weight: isFav ? base + 1 : base });
      const el = line.getElement();
      if (el) {
        if (isFav) el.style.setProperty('filter', 'drop-shadow(0 0 5px rgba(193,84,46,0.65))');
        else el.style.removeProperty('filter');
      }
    });
  }
  markerRefs[trailId].setIcon(L.divIcon({
    className: 'trailhead-icon' + (isFav ? ' favorited' : ''),
    html: iconSvg(isFav, trail.color, trail.isCustom),
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  }));
  updateFavCounter();
}

function toggleFavorite(trailId) {
  if (favorites.has(trailId)) favorites.delete(trailId);
  else favorites.add(trailId);
  refreshFavoriteVisuals(trailId);
}

function openPopup(trail) {
  const isFav = favorites.has(trail.id);
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="pop-name">${trail.name}</div>
    <div class="pop-tokens">
      <span class="token difficulty-${trail.difficulty}">${trail.difficulty}</span>
      <span class="token">${trail.distance}</span>
      <span class="token">${trail.elevation}</span>
    </div>
    <p class="pop-blurb">${trail.blurb}</p>
    <div class="pop-actions">
      <button class="btn-viewmore">View more</button>
      <button class="fav-btn" title="Save route">${heartIcon(isFav)}</button>
    </div>
  `;
  content.querySelector('.fav-btn').style.color = isFav ? '#C1542E' : '#7C8F6E';
  content.querySelector('.btn-viewmore').addEventListener('click', () => {
    map.closePopup();
    openSidebar(trail);
  });
  content.querySelector('.fav-btn').addEventListener('click', (e) => {
    toggleFavorite(trail.id);
    e.currentTarget.innerHTML = heartIcon(favorites.has(trail.id));
    e.currentTarget.style.color = favorites.has(trail.id) ? '#C1542E' : '#7C8F6E';
  });

  const existing = map._popup;
  if (existing && existing.trailId === trail.id && map.hasLayer(existing)) return;

  const popup = L.popup({ closeButton: true, className: 'trail-popup', autoPan: false })
    .setLatLng(trail.trailhead)
    .setContent(content)
    .openOn(map);
  popup.trailId = trail.id;

  const popupEl = popup.getElement();
  if (popupEl) {
    popupEl.addEventListener('mouseenter', cancelClosePopup);
    popupEl.addEventListener('mouseleave', scheduleClosePopup);
  }
}
