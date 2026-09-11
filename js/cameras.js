// ALERTCalifornia fire-camera markers (data/cameras.js).

CAMERA_DATA.forEach(cam => {
  const camIcon = L.divIcon({
    className: 'camera-icon',
    html: `<svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#FBF9F1" stroke="#3D6C82" stroke-width="1.2"/>
      <rect x="6.5" y="9" width="11" height="8" rx="1.6" stroke="#3D6C82" stroke-width="1.6"/>
      <circle cx="12" cy="13" r="2.3" stroke="#3D6C82" stroke-width="1.6"/>
    </svg>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  const marker = L.marker(cam.coord, { icon: camIcon }).addTo(map);
  const content = document.createElement('div');
  const note = cam.approxLink
    ? "Public wildfire-detection camera. I couldn't confirm a direct link to this specific camera, so this opens ALERTCalifornia's full camera map — search its name there."
    : "Public wildfire-detection camera. Opens the live official viewer in a new tab — a good visibility gut-check before you head out.";
  content.innerHTML = `
    <div class="camera-popup-name">${cam.name} camera</div>
    <p class="camera-popup-note">${note}</p>
    <a class="camera-popup-link" href="${cam.url}" target="_blank" rel="noopener">${cam.approxLink ? 'Open camera map' : 'View live feed'}</a>
  `;
  marker.bindPopup(content);
});
