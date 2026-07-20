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
export const CHANNELS = [
  { key: 'vis', tiles: 'goes-east-vis-1km-900913', dayOnly: true, label: 'Visible Satellite', sub: 'clouds as seen from space in daylight' },
  { key: 'ir', tiles: 'goes-east-ir-4km-900913', dayOnly: false, label: 'Infrared Satellite', sub: 'cloud-top temperature — bright colors = tall storm tops' },
  { key: 'wv', tiles: 'goes-east-wv-4km-900913', dayOnly: false, label: 'Water Vapor', sub: 'upper-level moisture — orange = dry air aloft' },
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
    return CHANNELS.filter(c => !c.dayOnly || day);
  }

  let layer = null;

  function show(key) {
    hide();
    const channel = CHANNELS.find(c => c.key === key) ?? CHANNELS[1];
    layer = safeTmsLayer(`${BASE}/${channel.tiles}/{z}/{x}/{y}.png?_ts=${Date.now()}`, {
      pane: 'satellite',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      updateWhenIdle: false,
      keepBuffer: 2,
      crossOrigin: 'anonymous',
    }).addTo(map);

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
