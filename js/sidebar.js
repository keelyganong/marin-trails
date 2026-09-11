// Left sidebar: trail detail view (stats, weather, AI insights, favoriting).
// The create/edit route form lives in its own panel — see js/drawing.js.

const sidebar = document.getElementById('sidebar');
const sidebarView = document.getElementById('sidebarView');
const sheetName = document.getElementById('sheetName');
const sheetStats = document.getElementById('sheetStats');
const sheetBody = document.getElementById('sheetBody');
const sheetFavBtn = document.getElementById('sheetFavBtn');
const favBtnLabel = document.getElementById('favBtnLabel');
let currentTrail = null;

document.getElementById('sheetClose').addEventListener('click', closeSidebar);
map.on('click', () => closeSidebar());

function closeSidebar() {
  sidebar.classList.remove('open');
}

function renderStats(trail) {
  sheetStats.innerHTML = trail.stats.map(([num, lbl]) => `
    <div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>
  `).join('');
}

function renderFavButton(trail) {
  const isFav = favorites.has(trail.id);
  sheetFavBtn.classList.toggle('active', isFav);
  favBtnLabel.textContent = isFav ? 'Saved' : 'Save route';
  sheetFavBtn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
}

sheetFavBtn.addEventListener('click', () => {
  if (!currentTrail) return;
  toggleFavorite(currentTrail.id);
  renderFavButton(currentTrail);
});

async function openSidebar(trail) {
  currentTrail = trail;
  sheetName.textContent = trail.name;
  renderStats(trail);
  renderFavButton(trail);
  renderHistory(trail); // static — renders immediately, no network call
  document.getElementById('weatherCard').innerHTML = '<div class="skeleton"></div>';

  document.getElementById('sheetEditBtn').style.display = trail.isCustom ? 'flex' : 'none';

  const [lat, lon] = trail.trailhead;
  const chip = document.getElementById('directionsChip');
  if (trail.address) {
    chip.style.display = 'flex';
    chip.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    document.getElementById('directionsAddress').textContent = trail.address;
  } else {
    chip.style.display = 'none';
  }

  sidebar.classList.add('open');

  fetchWeather(trail.trailhead)
    .then(period => { if (currentTrail && currentTrail.id === trail.id) renderWeather(period); })
    .catch(err => {
      console.error('Weather fetch failed:', err);
      if (currentTrail && currentTrail.id === trail.id) renderWeatherError();
    });

  if (trail.isCustom) {
    // No public information exists for a route only you've drawn — skip
    // the live call entirely rather than send it somewhere with nothing to find.
    renderStaticFallbackSections(trail);
    return;
  }

  try {
    const insights = await fetchLiveInsights(trail.id);
    if (currentTrail && currentTrail.id === trail.id) renderLiveSections(insights);
  } catch (err) {
    console.error('Falling back to static recent/community sections:', err);
    if (currentTrail && currentTrail.id === trail.id) renderStaticFallbackSections(trail);
  }
}
