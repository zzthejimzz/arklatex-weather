// Satellite map mode: GOES-East imagery from IEM's tile cache — the view
// from space between radar-driven shots. Three channels: visible (daytime
// only — it's literally reflected sunlight), colorized infrared (cloud-top
// temperature), and water vapor (upper-level moisture). Each tile is the
// latest single frame, regenerated server-side about every 5 minutes; the
// reflectivity loop keeps animating on top — the classic satellite/radar
// composite — so the shot never reads as a freeze-frame.
import L from 'leaflet';
import { safeTmsLayer } from './tms-tile.js';
import { sunTimes } from '../utils/sun.js';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
// NASA GIBS GOES-East imagery. The IEM channels above are a fixed CONUS-ish
// sector, so a system out in the basin can fall off their edge; GIBS GeoColor
// is full-hemisphere and frames a storm anywhere it forms. WMTS {z}/{y}/{x}
// order, native to zoom 7, `default` time = latest frame (served no-store),
// CORS-open. GeoColor stays true-colorish by day and switches to an IR + city-
// lights blend at night, so clouds read around the clock — no day-gating.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const CHANNELS = [
  { key: 'vis', tiles: 'goes-east-vis-1km-900913', dayOnly: true, label: 'Visible Satellite', sub: 'clouds as seen from space in daylight' },
  { key: 'ir', tiles: 'goes-east-ir-4km-900913', dayOnly: false, label: 'Infrared Satellite', sub: 'cloud-top temperature — bright colors = tall storm tops' },
  { key: 'wv', tiles: 'goes-east-wv-4km-900913', dayOnly: false, label: 'Water Vapor', sub: 'upper-level moisture — orange = dry air aloft' },
  // basin:true keeps GeoColor out of the region-framed rotation — the director
  // shows it storm-framed via a dedicated shot, not the ambient satellite cycle.
  { key: 'geocolor', basin: true, url: `${GIBS}/GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, maxNativeZoom: 7, label: 'GeoColor Satellite', sub: 'true-color GOES-East imagery — the storm as seen from space' },
];

const MAX_ZOOM = 14;
const OPACITY = 0.9;
// Visible imagery near the terminator is half-dark and reads on air as a
// broken feed — require the sun comfortably up, not merely risen.
const DAY_BUFFER_MS = 45 * 60 * 1000;

export function createSatelliteLayer(map, geo) {
  // Own pane above the outlook fills, below the radar loop; state borders
  // and labels stay on top.
  map.createPane('satellite');
  const pane = map.getPane('satellite');
  pane.style.zIndex = 440;
  pane.style.pointerEvents = 'none';

  const [w, s, e, n] = geo.bbox;
  const center = { lat: (s + n) / 2, lon: (w + e) / 2 };

  function isDaylight(now = new Date()) {
    const { sunrise, sunset } = sunTimes(now, center.lat, center.lon);
    if (!sunrise || !sunset) return false;
    return now.getTime() >= sunrise.getTime() + DAY_BUFFER_MS
        && now.getTime() <= sunset.getTime() - DAY_BUFFER_MS;
  }

  // Channels airable right now — the director rotates through these, so the
  // visible channel simply drops out of the cycle after sunset.
  function channels() {
    const day = isDaylight();
    return CHANNELS.filter(c => !c.basin && (!c.dayOnly || day));
  }

  let layer = null;

  function show(key) {
    hide();
    const channel = CHANNELS.find(c => c.key === key) ?? CHANNELS[1];
    // IEM channels are a 5-min sector cache (bust with a timestamp); the GIBS
    // basin channel carries its own full WMTS template and is already no-store.
    const tpl = channel.url ?? `${BASE}/${channel.tiles}/{z}/{x}/{y}.png?_ts=${Date.now()}`;
    layer = safeTmsLayer(tpl, {
      pane: 'satellite',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      ...(channel.maxNativeZoom ? { maxNativeZoom: channel.maxNativeZoom } : {}), // GIBS is native to z7 — upsample past it rather than blank out
      updateWhenIdle: false,
      keepBuffer: 2,
      crossOrigin: 'anonymous',
    }).addTo(map);

    // These tiles are served no-store (the GIBS basin frame especially), so a
    // tile that 4xx's transiently or whose request is dropped mid-fly stays
    // blank with no cache to fall back on — the "doesn't fully render" gaps.
    // Retry a failed tile a few times with a cache-buster (GIBS 200s on an
    // extra query param) so the frame fills in instead of holding the hole.
    const retryLyr = layer;
    layer.on('tileerror', e => {
      const el = e?.tile;
      if (!el || layer !== retryLyr) return;
      const n = (el._satRetry = (el._satRetry || 0) + 1);
      if (n > 3) return;
      const base = (el.src || '').split('?')[0];
      if (!base) return;
      setTimeout(() => {
        if (layer === retryLyr && el.isConnected) el.src = `${base}?_r=${Date.now()}`;
      }, 350 * n);
    });

    // Fade in over the grey basemap — a hard cut to full-frame imagery flashes.
    const t0 = performance.now();
    const lyr = layer;
    const step = (now) => {
      if (lyr !== layer) return; // hidden/replaced mid-fade
      const t = Math.min(1, (now - t0) / 350);
      lyr.setOpacity(OPACITY * t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return channel;
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide, channels };
}
