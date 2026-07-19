// UV Index outlook for the region's climate cities, from EPA Envirofacts'
// UV forecast service (data.epa.gov: CORS-open, no key). Daily product —
// one value + alert flag per city, issued for the current forecast cycle
// (which in the afternoon may already read as tomorrow's date; the DATE
// field returned is authoritative, not assumed to be "today").
import { fetchWithTimeout } from '../utils/net.js';

// [ZIP, on-air name, state] — same six cities as the almanac/frost cards.
const CITIES = [
  ['71101', 'Shreveport', 'LA'],
  ['75701', 'Tyler',      'TX'],
  ['71854', 'Texarkana',  'AR'],
  ['75601', 'Longview',   'TX'],
  ['71201', 'Monroe',     'LA'],
  ['75901', 'Lufkin',     'TX'],
];

const ENDPOINT = 'https://data.epa.gov/dmapservice/getEnvirofactsUVDAILY/ZIP';
const REFRESH_MS = 2 * 60 * 60 * 1000; // coarse daily product; a couple checks a day is plenty
const RETRY_MS = 30 * 60 * 1000;

// EPA's own UV Index categories + their public sun-safety guidance.
export const UV_SCALE = [
  { max: 2,        label: 'Low',        color: '#4ade80', advice: 'Minimal risk. Sunglasses on a bright day are the only real need.' },
  { max: 5,        label: 'Moderate',   color: '#facc15', advice: 'Seek shade during midday hours; wear sunglasses and SPF 30+.' },
  { max: 7,        label: 'High',       color: '#fb923c', advice: 'Reduce midday sun; a hat, sunglasses, and SPF 30+ are protection, not optional.' },
  { max: 10,       label: 'Very High',  color: '#f87171', advice: 'Unprotected skin burns quickly — minimize midday exposure and reapply sunscreen.' },
  { max: Infinity, label: 'Extreme',    color: '#c084fc', advice: 'Unprotected skin can burn in under 10 minutes — avoid the sun 10am–4pm.' },
];

function uvInfo(index) {
  return UV_SCALE.find(b => index <= b.max) ?? UV_SCALE[UV_SCALE.length - 1];
}

async function fetchCity([zip, name, state]) {
  const res = await fetchWithTimeout(`${ENDPOINT}/${zip}/JSON`, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const [row] = await res.json();
  const index = parseInt(row?.UV_INDEX, 10);
  if (!row || !Number.isFinite(index)) throw new Error('no UV row');
  const { label, color, advice } = uvInfo(index);
  return { name, state, index, alert: row.UV_ALERT === '1', date: row.DATE, label, color, advice };
}

export function createUvSource() {
  let cities = []; // CITIES order, failed cities dropped

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const results = await Promise.allSettled(CITIES.map(fetchCity));
      const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (!ok.length) throw new Error('no cities resolved');
      cities = ok;
    } catch (err) {
      console.warn('[uv] fetch failed:', err);
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
