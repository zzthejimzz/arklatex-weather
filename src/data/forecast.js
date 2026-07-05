// 3-day forecasts for the region's anchor cities via the NWS daily-periods
// endpoint (api.weather.gov, CORS-open, no auth). Grid forecast URLs are
// resolved once per city and cached; forecasts refresh every 30 minutes.
// Feeds the idle-cycle forecast panel (ui/forecast-panel.js).
const CITIES = [
  { name: 'Shreveport', state: 'LA',    lat: 32.525, lon: -93.750 },
  { name: 'Texarkana',  state: 'TX/AR', lat: 33.425, lon: -94.048 },
  { name: 'Longview',   state: 'TX',    lat: 32.500, lon: -94.740 },
  { name: 'Tyler',      state: 'TX',    lat: 32.351, lon: -95.301 },
  { name: 'Monroe',     state: 'LA',    lat: 32.510, lon: -92.119 },
  { name: 'Lufkin',     state: 'TX',    lat: 31.338, lon: -94.729 },
];

import { fetchWithTimeout } from '../utils/net.js';
import { track } from '../utils/health.js';

const REFRESH_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;

// shortForecast → emoji; first match wins, so storms outrank rain and rain
// outranks sky cover ("Showers then Sunny" reads as the weather that matters).
const ICONS = [
  [/tornado/i, '🌪️'],
  [/thunder/i, '⛈️'],
  [/blizzard|snow|flurr/i, '🌨️'],
  [/sleet|freezing|ice/i, '🧊'],
  [/slight chance.*(rain|shower|drizzle)/i, '🌦️'],
  [/rain|shower|drizzle/i, '🌧️'],
  [/fog|haze|smoke/i, '🌫️'],
  [/windy|breezy|blustery/i, '💨'],
  [/mostly cloudy/i, '🌥️'],
  [/partly|mostly sunny/i, '⛅'],
  [/cloudy|overcast/i, '☁️'],
  [/hot/i, '🥵'],
  [/sunny|clear|fair/i, '☀️'],
];

export function iconFor(shortForecast = '') {
  for (const [re, icon] of ICONS) if (re.test(shortForecast)) return icon;
  return '🌡️';
}

const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' });

const windMax = s => { const m = String(s ?? '').match(/(\d+)(?!.*\d)/); return m ? +m[1] : null; };
const pop = p => p?.probabilityOfPrecipitation?.value ?? 0;

// Daytime periods anchor each card; the following night supplies the low and
// its precip chance. Booting in the evening (first period = "Tonight") simply
// means the first card is tomorrow. Keeps the full week — the 3-day board
// slices the front, the per-city spotlight airs all seven.
const SUMMARY_DAYS = 7;
function summarize(periods) {
  const days = [];
  for (let i = 0; i < periods.length && days.length < SUMMARY_DAYS; i++) {
    const p = periods[i];
    if (!p.isDaytime) continue;
    const night = periods[i + 1] && !periods[i + 1].isDaytime ? periods[i + 1] : null;
    days.push({
      dow: p.number === 1 ? 'Today' : dowFmt.format(new Date(p.startTime)),
      icon: iconFor(p.shortForecast),
      short: p.shortForecast,
      hi: p.temperature,
      lo: night?.temperature ?? null,
      precip: Math.max(pop(p), pop(night)),
      wind: windMax(p.windSpeed),
    });
  }
  return days;
}

export function createCityForecasts() {
  const gridUrls = new Map();
  let latest = null;
  let timer = null;
  const beat = track('forecast', { pollMs: REFRESH_MS });

  async function fetchJson(url) {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }

  async function forecastFor(city) {
    if (!gridUrls.has(city.name)) {
      const pt = await fetchJson(`https://api.weather.gov/points/${city.lat},${city.lon}`);
      gridUrls.set(city.name, pt.properties.forecast);
    }
    const fc = await fetchJson(gridUrls.get(city.name));
    return { ...city, days: summarize(fc.properties.periods ?? []) };
  }

  async function refresh() {
    beat.attempt();
    const results = await Promise.allSettled(CITIES.map(forecastFor));
    const failed = results.filter(r => r.status === 'rejected');
    for (const f of failed) console.error('[forecast]', f.reason);
    const cities = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(c => c.days.length >= 3); // board needs 3; spotlight airs what exists
    // Keep stale-but-complete data over a partial refresh; the panel only
    // airs when most of the board resolved.
    const ok = cities.length >= 4;
    if (ok) { latest = { cities, at: Date.now() }; beat.ok(); }
    timer = setTimeout(refresh, ok ? REFRESH_MS : RETRY_MS);
  }

  return {
    start() { refresh(); },
    stop() { clearTimeout(timer); },
    get: () => latest,
  };
}
