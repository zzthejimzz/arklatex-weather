// NWS/NOAA river gauge flood status via the NWPS API (api.water.noaa.gov —
// the successor to AHPS). Its documented `bbox`/`state`/`wfo` filters either
// no-op or 500 — the query params that actually work are undocumented in the
// swagger description text but present in the schema: bbox.xmin/ymin/xmax/
// ymax + srid=EPSG_4326. That returns every gauge (name, coordinates, current
// stage, flood category) inside the box directly — no separate per-station
// fetch needed. ~220 stations / ~225 KB for the ArkLaTex; most read
// "no_flooding" and are dropped immediately, so the feed the director sees is
// just the handful worth a camera visit. No CORS headers — proxied like SPC/WPC.
//
// The API enforces a hard 10 requests/5 min rate limit (server-side, returns
// a plain-JSON 429 that isn't part of the documented schema) — don't hammer
// it manually while debugging. One fetch per REFRESH_MS is nowhere close.
import { fetchWithTimeout } from '../utils/net.js';
import { RIVER_META } from '../map/river-gauge-layer.js';

const IS_DEV = import.meta.env.DEV;
const NWPS_GAUGES = 'https://api.water.noaa.gov/nwps/v1/gauges';
const REFRESH_MS = 20 * 60 * 1000; // river response is slow — no need to poll like radar
const RETRY_MS = 5 * 60 * 1000;

function url(bbox) {
  const [w, s, e, n] = bbox;
  const params = new URLSearchParams({
    'bbox.xmin': w, 'bbox.ymin': s, 'bbox.xmax': e, 'bbox.ymax': n,
    srid: 'EPSG_4326',
  });
  if (IS_DEV) return `/api/nwps?${params}`;
  return `/proxy.php?url=${encodeURIComponent(`${NWPS_GAUGES}?${params}`)}`;
}

export function createRiverGaugeSource(geo) {
  let gauges = []; // notable stations only: { lid, name, lat, lon, category, stage, unit }

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const res = await fetchWithTimeout(url(geo.bbox), { timeoutMs: 45_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      gauges = (data.gauges ?? [])
        .filter(g => g.latitude && g.longitude)
        .map(g => ({
          lid: g.lid,
          name: g.name,
          lat: g.latitude,
          lon: g.longitude,
          category: g.status?.observed?.floodCategory,
          stage: g.status?.observed?.primary,
          unit: g.status?.observed?.primaryUnit,
        }))
        .filter(g => RIVER_META[g.category]);
    } catch (err) {
      console.warn('[river-gauges] fetch failed:', err);
      if (!gauges.length) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  function start() {
    poll();
  }

  // Worst station present (flooding outranks low water) as a RIVER_META entry
  // plus its station name/reading, or null when every gauge reads normal —
  // the director gates the shot on this.
  function worst() {
    if (!gauges.length) return null;
    const g = gauges.reduce((a, b) =>
      RIVER_META[b.category].order > RIVER_META[a.category].order ? b : a);
    return { ...RIVER_META[g.category], lid: g.lid, name: g.name, lat: g.lat, lon: g.lon, stage: g.stage, unit: g.unit };
  }

  return { start, get: () => gauges, worst };
}
