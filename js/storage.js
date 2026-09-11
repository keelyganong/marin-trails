// Personal storage: custom traced trails persist across visits, via
// localStorage (this ran on a sandbox-provided window.storage API in the
// original prototype, which only exists inside that chat environment — a
// real deployed page needs an actual browser storage API instead).

const CUSTOM_TRAILS_STORAGE_KEY = 'marin-trails.custom-trails';

function saveCustomTrailsToStorage() {
  const custom = trails.filter(t => t.isCustom).map(t => ({
    id: t.id, name: t.name, difficulty: t.difficulty, blurb: t.blurb,
    trailhead: t.trailhead, path: t.path, stats: t.stats,
    distance: t.distance, elevation: t.elevation, address: t.address || null
  }));
  try {
    localStorage.setItem(CUSTOM_TRAILS_STORAGE_KEY, JSON.stringify(custom));
  } catch (err) {
    console.warn('Could not save custom trails to storage:', err);
  }
}

function loadCustomTrails() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRAILS_STORAGE_KEY);
    if (!raw) return;
    const custom = JSON.parse(raw);
    custom.forEach((t) => {
      t.isCustom = true;
      t.color = colorForDifficulty(t.difficulty);
      trails.push(t);
      renderTrail(t, trails.length - 1);
    });
    applyDifficultyFilter();
  } catch (err) {
    console.warn('No saved custom trails yet, or failed to load:', err);
  }
}
