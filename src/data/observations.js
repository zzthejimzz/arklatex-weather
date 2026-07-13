// Current surface observations for stations across the ArkLaTex, via the NWS
// latest-observation endpoint (CORS-open, no auth). One shared source feeds
// both the ticker's temp strip and the current-temps map mode — the six
// ticker cities are a subset of these stations.
import { fetchWithTimeout } from '../utils/net.js';
import { track } from '../utils/health.js';
import { feelsLikeF } from '../utils/feels-like.js';

// ASOS/AWOS stations chosen for even coverage of the CWA. `city` is the
// on-air name (ticker + map label), not the airport's.
export const STATIONS = [
  // Texas
  ['KTYR', 'Tyler',        32.354, -95.402],
  ['KGGG', 'Longview',     32.384, -94.712],
  ['KLFK', 'Lufkin',       31.234, -94.750],
  ['KOCH', 'Nacogdoches',  31.578, -94.710],
  ['KPRX', 'Paris',        33.637, -95.451],
  ['KASL', 'Marshall',     32.520, -94.308],
  ['KTXK', 'Texarkana',    33.454, -93.991],
  // Arkansas
  ['KELD', 'El Dorado',    33.221, -92.813],
  ['KDEQ', 'De Queen',     34.047, -94.399],
  ['KMEZ', 'Mena',         34.545, -94.203],
  // Louisiana
  ['KSHV', 'Shreveport',   32.447, -93.824],
  ['KMLU', 'Monroe',       32.511, -92.038],
  ['KRSN', 'Ruston',       32.514, -92.588],
  ['KIER', 'Natchitoches', 31.735, -93.099],
  // Oklahoma
  ['KHHW', 'Hugo',         34.035, -95.542],
];

const POLL_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 90 * 60 * 1000; // AWOS sites go quiet; don't air a 3 h temp

const cToF = c => Math.round((c * 9) / 5 + 32);

async function fetchStation([id, city, lat, lon]) {
  const res = await fetchWithTimeout(
    `https://api.weather.gov/stations/${id}/observations/latest`,
    { headers: { Accept: 'application/geo+json' } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${id}`);
  const p = (await res.json()).properties;
  if (Date.now() - new Date(p.timestamp) > MAX_AGE_MS) throw new Error(`stale obs ${id}`);
  const t = p.temperature?.value;
  const ws = p.windSpeed?.value;
  const kmh = (p.windSpeed?.unitCode ?? '').includes('km_h');
  const rh = p.relativeHumidity?.value;
  const tempF = t == null ? null : cToF(t);
  const windMph = ws == null ? null : Math.round(ws * (kmh ? 0.621 : 2.237));
  return {
    id, city, lat, lon, tempF, windMph,
    feelsF: feelsLikeF(tempF, rh, windMph),
    desc: p.textDescription ?? '',
    at: p.timestamp,
  };
}

export function createObservationsSource() {
  let latest = []; // stations with a live temp, in STATIONS order
  let timer = null;
  const beat = track('observations', { pollMs: POLL_MS });

  async function refresh(onUpdate) {
    beat.attempt();
    const results = await Promise.allSettled(STATIONS.map(fetchStation));
    const obs = results
      .filter(r => r.status === 'fulfilled' && r.value.tempF != null)
      .map(r => r.value);
    // A partial board is fine (a dark AWOS shouldn't blank the mode), but an
    // empty/near-empty one means the API is down — keep the previous data.
    if (obs.length >= 5) {
      latest = obs;
      beat.ok();
      onUpdate?.(obs);
    }
    timer = setTimeout(() => refresh(onUpdate), POLL_MS);
  }

  return {
    start(onUpdate) { refresh(onUpdate); },
    stop() { clearTimeout(timer); },
    get: () => latest,
  };
}
