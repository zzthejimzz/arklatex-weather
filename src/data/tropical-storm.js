// NHC active-storm tracking: forecast points, forecast track, and the cone of
// uncertainty for any Atlantic system the National Hurricane Center is
// currently advising on — the follow-up to the 7-day potential-development
// outlook in tropical.js once a disturbance actually gets a number. Same
// CORS-enabled tropical MapServer, no proxy needed.
import { fetchWithTimeout } from '../utils/net.js';

const SERVICE =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

// The service reserves five concurrent storm "slots" per basin (AT1–AT5,
// EP1–EP5, CP1–CP5), each a fixed block of sub-layers. Only the Atlantic
// slots can put a storm over the Gulf. Within a slot, Forecast Points /
// Forecast Track / Forecast Cone / Watch-Warning sit at base / base+1 /
// base+2 / base+3 (verified against the service's layer list 2026-07-20).
const AT_SLOT_BASE = [6, 32, 58, 84, 110];

const POINT_FIELDS =
  'stormname,stormtype,tcdvlp,maxwind,gust,mslp,ssnum,tau,datelbl,fldatelbl,tcdir,tcspd,advdate,advisnum';

const REFRESH_MS = 10 * 60 * 1000; // an active storm moves fast enough to want a tighter poll than the outlook's 30 min
const RETRY_MS = 3 * 60 * 1000;

function url(layer, outFields, generalize) {
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields,
    outSR: '4326',
    ...(generalize ? { maxAllowableOffset: '0.02' } : {}), // per-storm zoom is closer than the basin-wide outlook — finer than its 0.05
  });
  return `${SERVICE}/${layer}/query?${params}`;
}

async function fetchFeatures(layer, outFields, generalize) {
  const res = await fetchWithTimeout(url(layer, outFields, generalize), { timeoutMs: 45_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).features ?? [];
}

// One slot's fetch is independent of the others — a single flaky slot
// shouldn't blank out a storm the other four requests found fine.
async function fetchSlot(base) {
  try {
    const points = await fetchFeatures(base, POINT_FIELDS, false);
    if (!points.length) return { ok: true, storm: null }; // slot unoccupied
    points.sort((a, b) => (a.properties.tau ?? 0) - (b.properties.tau ?? 0));
    const [track, cone, warnings] = await Promise.all([
      fetchFeatures(base + 1, 'stormname', true),
      fetchFeatures(base + 2, 'stormname', true),
      // Watch-Warning coastal segments — polylines tagged by `tcww` (base+3).
      // Absent until watches/warnings are posted, so an empty array is normal.
      fetchFeatures(base + 3, 'tcww', true),
    ]);
    return { ok: true, storm: { points, track: track[0] ?? null, cone: cone[0] ?? null, warnings } };
  } catch (err) {
    console.warn('[tropical-storm] slot fetch failed:', err);
    return { ok: false, storm: null };
  }
}

export function createTropicalStormSource() {
  let storms = [];

  async function poll() {
    let delay = REFRESH_MS;
    const results = await Promise.all(AT_SLOT_BASE.map(fetchSlot));
    if (results.every(r => !r.ok)) {
      // Total outage this cycle — keep whatever's on hand; only an empty
      // hand (never succeeded) retries sooner.
      if (!storms.length) delay = RETRY_MS;
    } else {
      storms = results.filter(r => r.storm).map(r => r.storm);
    }
    setTimeout(poll, delay);
  }

  function start() {
    poll();
  }

  return {
    start,
    active: () => storms.length > 0,
    count: () => storms.length,
    get: () => storms,
  };
}
