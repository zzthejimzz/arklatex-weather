// Continuously animating NEXRAD loop — the map should never look frozen.
// IEM caches time-lagged composite tiles at 5-minute offsets (-m05m … -m50m);
// we cycle a 30-minute window ending on the current frame, holding the newest
// frame a beat before restarting, and re-bust the cache every 5 minutes.
//
// Rendering is a real reflectivity pipeline (map/radar-render.js): tile RGBs
// decode to exact dBZ via the baked IEM lookup table, the dBZ field is
// smoothed in data space (with neighbor-tile padding so storms never show
// seams), and repainted through our broadcast palette — translucent greens
// for light rain, near-solid cores. Frames crossfade instead of hard-cutting.
import L from 'leaflet';
import { renderRadarTile, blurRadiusForZoom } from './radar-render.js';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913';
const OFFSETS = ['-m30m', '-m25m', '-m20m', '-m15m', '-m10m', '-m05m', '']; // oldest → newest
const FRAME_MS = 650;
const HOLD_NEWEST_MS = 2200;
const XFADE_MS = 240;
const REFRESH_MS = 5 * 60 * 1000;
const OPACITY = 1; // the palette carries per-intensity transparency
const MAX_ZOOM = 14; // IEM serves n0q tiles through z14 (verified)

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const SmoothRadarLayer = L.GridLayer.extend({
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
    tile.width = 512; // 2× supersampled — Leaflet displays at 256 via style
    tile.height = 512;
    const size = this.getTileSize();
    tile.style.width = `${size.x}px`;
    tile.style.height = `${size.y}px`;

    this._render(coords, tile)
      .catch(() => {}) // empty tile beats a broken one
      .finally(() => done(null, tile));
    return tile;
  },

  async _render(coords, tile) {
    const z = coords.z;
    const n = 2 ** z;
    const radius = blurRadiusForZoom(z);
    const pad = 2 * radius + 2; // blur reach (two passes) must stay inside
    const url = (x, y) =>
      this._url.replace('{z}', z).replace('{x}', ((x % n) + n) % n).replace('{y}', y);

    // Center tile + all 8 neighbors (HTTP cache makes the overlap ~free —
    // each neighbor is also some other tile's center).
    const jobs = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const y = coords.y + dy;
        if (y < 0 || y >= n) continue;
        jobs.push(
          loadImage(url(coords.x + dx, y)).then(
            (img) => ({ img, dx, dy }),
            () => null, // missing neighbor = no data there
          ),
        );
      }
    }
    const loaded = (await Promise.all(jobs)).filter(Boolean);
    if (!loaded.some((t) => t.dx === 0 && t.dy === 0)) return; // no center, no tile

    const S = 256 + 2 * pad;
    const padded = document.createElement('canvas');
    padded.width = S;
    padded.height = S;
    const ctx = padded.getContext('2d', { willReadFrequently: true });
    for (const { img, dx, dy } of loaded) {
      ctx.drawImage(img, pad + dx * 256, pad + dy * 256);
    }

    try {
      renderRadarTile(padded, pad, tile, radius);
    } catch {
      // canvas tainted (no CORS) — fall back to the raw center tile
      const raw = loaded.find((t) => t.dx === 0 && t.dy === 0).img;
      tile.getContext('2d').drawImage(raw, 0, 0, 512, 512);
    }
  },
});

export function createRadarLoop(map) {
  const url = (i, ts) => `${BASE}${OFFSETS[i]}/{z}/{x}/{y}.png?_ts=${ts}`;

  let ts = Date.now();
  // All frames stay on the map at opacity 0 so their tiles are loaded and
  // warm — animating is just an opacity swap, no network hitch per frame.
  const frames = OFFSETS.map((_, i) =>
    new SmoothRadarLayer(url(i, ts), {
      pane: 'radar',
      opacity: 0,
      maxZoom: MAX_ZOOM,
    }).addTo(map),
  );

  let idx = frames.length - 1;
  frames[idx].setOpacity(OPACITY);

  // Crossfade between frames — a hard cut reads as flicker on stream.
  function fadeTo(nextIdx) {
    const from = frames[idx];
    const to = frames[nextIdx];
    idx = nextIdx;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / XFADE_MS);
      to.setOpacity(OPACITY * t);
      from.setOpacity(OPACITY * (1 - t));
      if (t < 1 && idx === nextIdx) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let nextAt = Date.now() + HOLD_NEWEST_MS;
  setInterval(() => {
    if (Date.now() < nextAt) return;
    fadeTo((idx + 1) % frames.length);
    nextAt = Date.now() + (idx === frames.length - 1 ? HOLD_NEWEST_MS : FRAME_MS);
  }, 100);

  setInterval(() => {
    ts = Date.now();
    frames.forEach((f, i) => f.setUrl(url(i, ts)));
  }, REFRESH_MS);
}
