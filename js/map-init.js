// Map instance + base tile layer. Everything else attaches to `map`.
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([37.94, -122.62], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
