// Entry point: render the built-in trails, then layer in anything the
// visitor has saved locally.
trails.forEach((trail, index) => renderTrail(trail, index));
loadCustomTrails();
