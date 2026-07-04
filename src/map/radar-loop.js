// Continuously animating NEXRAD loop — the map should never look frozen.
// IEM caches time-lagged composite tiles at 5-minute offsets (-m05m … -m50m);
// we cycle a 30-minute window ending on the current frame, holding the newest
// frame a beat before restarting, and re-bust the cache every 5 minutes.
import L from 'leaflet';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913';
const OFFSETS = ['-m30m', '-m25m', '-m20m', '-m15m', '-m10m', '-m05m', '']; // oldest → newest
const FRAME_MS = 650;
const HOLD_NEWEST_MS = 2200;
const REFRESH_MS = 5 * 60 * 1000;
const OPACITY = 0.8;
const MAX_ZOOM = 12;

export function createRadarLoop(map) {
  const url = (i, ts) => `${BASE}${OFFSETS[i]}/{z}/{x}/{y}.png?_ts=${ts}`;

  let ts = Date.now();
  // All frames stay on the map at opacity 0 so their tiles are loaded and
  // warm — animating is just an opacity swap, no network hitch per frame.
  const frames = OFFSETS.map((_, i) =>
    L.tileLayer(url(i, ts), {
      pane: 'radar',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      crossOrigin: true,
    }).addTo(map),
  );

  let idx = frames.length - 1;
  frames[idx].setOpacity(OPACITY);

  let nextAt = Date.now() + HOLD_NEWEST_MS;
  setInterval(() => {
    if (Date.now() < nextAt) return;
    frames[idx].setOpacity(0);
    idx = (idx + 1) % frames.length;
    frames[idx].setOpacity(OPACITY);
    nextAt = Date.now() + (idx === frames.length - 1 ? HOLD_NEWEST_MS : FRAME_MS);
  }, 100);

  setInterval(() => {
    ts = Date.now();
    frames.forEach((f, i) => f.setUrl(url(i, ts)));
  }, REFRESH_MS);
}
