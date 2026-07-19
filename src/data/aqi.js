// Air quality outlook for the region's climate cities, from Open-Meteo's
// air-quality API (air-quality-api.open-meteo.com: CORS-open, no key). Not
// a .gov source itself, but the only keyless option that returns live US
// AQI in the browser — AirNow, the official EPA feed, requires a registered
// API key. One batched request covers all six cities.
import { fetchWithTimeout } from '../utils/net.js';

// [lat, lon, on-air name, state] — same six cities as the almanac/frost cards.
const CITIES = [
  [32.525, -93.750, 'Shreveport', 'LA'],
  [32.351, -95.301, 'Tyler',      'TX'],
  [33.425, -94.048, 'Texarkana',  'AR'],
  [32.500, -94.740, 'Longview',   'TX'],
  [32.510, -92.119, 'Monroe',     'LA'],
  [31.338, -94.729, 'Lufkin',     'TX'],
];

const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REFRESH_MS = 20 * 60 * 1000; // AQI observations update hourly
const RETRY_MS = 5 * 60 * 1000;

// EPA's own US AQI categories + their public health guidance.
export const AQI_SCALE = [
  { max: 50,       label: 'Good',                          color: '#4ade80', advice: 'Air quality is satisfactory — little to no health risk.' },
  { max: 100,      label: 'Moderate',                       color: '#facc15', advice: 'Unusually sensitive people should consider reducing prolonged outdoor exertion.' },
  { max: 150,      label: 'Unhealthy for Sensitive Groups',  color: '#fb923c', advice: 'People with lung or heart conditions, older adults, and children should reduce prolonged outdoor exertion.' },
  { max: 200,      label: 'Unhealthy',                       color: '#f87171', advice: 'Everyone may begin to feel effects; sensitive groups should avoid prolonged outdoor exertion.' },
  { max: 300,      label: 'Very Unhealthy',                  color: '#c084fc', advice: 'Health alert — everyone may experience more serious health effects outdoors.' },
  { max: Infinity, label: 'Hazardous',                       color: '#7f1d1d', advice: 'Health emergency — everyone should avoid all outdoor exertion.' },
];

function aqiInfo(aqi) {
  return AQI_SCALE.find(b => aqi <= b.max) ?? AQI_SCALE[AQI_SCALE.length - 1];
}

function url() {
  const params = new URLSearchParams({
    latitude: CITIES.map(c => c[0]).join(','),
    longitude: CITIES.map(c => c[1]).join(','),
    current: 'us_aqi,pm2_5,pm10,ozone',
  });
  return `${ENDPOINT}?${params}`;
}

export function createAqiSource() {
  let cities = []; // CITIES order, failed cities dropped

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const res = await fetchWithTimeout(url(), { timeoutMs: 20_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length !== CITIES.length) throw new Error('city count mismatch');
      cities = rows
        .map((row, i) => {
          const [, , name, state] = CITIES[i];
          const aqi = Math.round(row?.current?.us_aqi ?? NaN);
          if (!Number.isFinite(aqi)) return null;
          const { label, color, advice } = aqiInfo(aqi);
          return {
            name, state, aqi,
            pm25: row.current.pm2_5, pm10: row.current.pm10, ozone: row.current.ozone,
            label, color, advice,
          };
        })
        .filter(Boolean);
      if (!cities.length) throw new Error('no cities resolved');
    } catch (err) {
      console.warn('[aqi] fetch failed:', err);
      if (!cities.length) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  return {
    start() { poll(); },
    ready: () => cities.length > 0,
    get: () => cities,
  };
}
