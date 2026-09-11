// National Weather Service — free, no API key. Two-step lookup:
// resolve lat/lon to a forecast office grid, then pull the current period.

async function fetchWeather(coord) {
  const [lat, lon] = coord;
  const pointsRes = await fetchWithTimeout(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 10000);
  if (!pointsRes.ok) throw new Error('NWS points lookup failed');
  const pointsData = await pointsRes.json();
  const forecastUrl = pointsData.properties.forecast;
  const forecastRes = await fetchWithTimeout(forecastUrl, 10000);
  if (!forecastRes.ok) throw new Error('NWS forecast fetch failed');
  const forecastData = await forecastRes.json();
  return forecastData.properties.periods[0]; // current/next period
}

function weatherGlyph(shortForecast) {
  const f = (shortForecast || '').toLowerCase();
  if (f.includes('fog') || f.includes('haze')) {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 10h16M3 14h18M5 18h14" stroke="#3D6C82" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="7" r="3" stroke="#3D6C82" stroke-width="1.4"/></svg>`;
  }
  if (f.includes('rain') || f.includes('shower') || f.includes('drizzle')) {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 10a4 4 0 01.4-8 5 5 0 019.2 1.4A4.5 4.5 0 0117 10H7z" stroke="#3D6C82" stroke-width="1.5"/><path d="M8 14l-1.5 3M12 14l-1.5 3M16 14l-1.5 3" stroke="#3D6C82" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (f.includes('cloud') || f.includes('overcast')) {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 17a4 4 0 01.4-8 5 5 0 019.2 1.4A4.5 4.5 0 0117 17H7z" stroke="#3D6C82" stroke-width="1.6"/></svg>`;
  }
  // clear / sunny default
  return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="#C1542E" stroke-width="1.6"/><path d="M12 3v2.5M12 18.5V21M4.2 12H6.7M17.3 12h2.5M6.3 6.3l1.8 1.8M15.9 15.9l1.8 1.8M17.7 6.3l-1.8 1.8M8.1 15.9l-1.8 1.8" stroke="#C1542E" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

function renderWeather(period) {
  const card = document.getElementById('weatherCard');
  card.innerHTML = `
    <div class="weather-glyph">${weatherGlyph(period.shortForecast)}</div>
    <div class="temp">${period.temperature}°</div>
    <div class="details">
      <div class="cond">${period.shortForecast}</div>
      <div class="sub">${period.name} · Wind ${period.windSpeed} ${period.windDirection}</div>
    </div>
  `;
}

function renderWeatherError() {
  const card = document.getElementById('weatherCard');
  card.innerHTML = `<div class="sub">Weather data unavailable right now — check back before you head out.</div>`;
}
