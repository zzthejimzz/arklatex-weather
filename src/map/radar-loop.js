// Continuously animating NEXRAD loop — the map should never look frozen.
// IEM caches time-lagged composite tiles at 5-minute offsets (-m05m … -m50m);
// we cycle a 30-minute window ending on the current frame, holding the newest
// frame a beat before restarting, and re-bust the cache every 5 minutes.
//
// Broadcast polish, two parts:
//   1. Declutter — each tile is drawn through a canvas that drops the
//      near-grey low-dBZ speckle (ground clutter / clear-air returns) and
//      fades marginal drizzle, so only real precipitation shows.
//   2. Smoothing — a zoom-scaled blur on the radar pane melts the 1 km data
//      blocks into smooth gradients the deeper the camera goes.
import L from 'leaflet';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913';
const OFFSETS = ['-m30m', '-m25m', '-m20m', '-m15m', '-m10m', '-m05m', '']; // oldest → newest
const FRAME_MS = 650;
const HOLD_NEWEST_MS = 2200;
const REFRESH_MS = 5 * 60 * 1000;
const OPACITY = 0.8;
const MAX_ZOOM = 14; // IEM serves n0q tiles through z14 (verified)

const DeclutteredRadarLayer = L.GridLayer.extend({
  initialize(url, options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._url = url;
  },

  setUrl(url) {
    this._url = url;
    this.redraw();
  },

  createTile(coords, done) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = tile.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        const imageData = ctx.getImageData(0, 0, tile.width, tile.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const max = Math.max(r, g, b);
          const sat = max - Math.min(r, g, b);
          // Near-grey = clutter (drop) — but never drop bright pixels: the
          // very top of the n0q ramp (extreme cores) runs white-ish.
          if (sat < 40 && max < 200) d[i + 3] = 0;
          else if (sat < 70 && max < 200) d[i + 3] = Math.round(d[i + 3] * 0.55);
        }
        ctx.putImageData(imageData, 0, 0);
      } catch { /* canvas tainted (no CORS) — show the raw tile */ }
      done(null, tile);
    };
    img.onerror = () => done(null, tile); // empty tile beats a broken one
    img.src = this._url
      .replace('{z}', coords.z)
      .replace('{x}', coords.x)
      .replace('{y}', coords.y);
    return tile;
  },
});

export function createRadarLoop(map) {
  const url = (i, ts) => `${BASE}${OFFSETS[i]}/{z}/{x}/{y}.png?_ts=${ts}`;

  let ts = Date.now();
  // All frames stay on the map at opacity 0 so their tiles are loaded and
  // warm — animating is just an opacity swap, no network hitch per frame.
  const frames = OFFSETS.map((_, i) =>
    new DeclutteredRadarLayer(url(i, ts), {
      pane: 'radar',
      opacity: 0,
      maxZoom: MAX_ZOOM,
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

  // Zoom-scaled smoothing: barely-there at overview, strong enough at street
  // level to melt the 1 km blocks into gradients.
  const pane = map.getPane('radar');
  const syncBlur = () => {
    const blur = Math.min(3, Math.max(0.4, (map.getZoom() - 6) * 0.55));
    pane.style.filter = `saturate(1.15) contrast(1.03) blur(${blur}px)`;
  };
  map.on('zoomend', syncBlur);
  syncBlur();
}
