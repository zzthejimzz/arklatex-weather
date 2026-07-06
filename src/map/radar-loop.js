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
import { track } from '../utils/health.js';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913';
const OFFSETS = ['-m30m', '-m25m', '-m20m', '-m15m', '-m10m', '-m05m', '']; // oldest → newest
const FRAME_MS = 650;
const HOLD_NEWEST_MS = 2200;
const XFADE_MS = 240;
const REFRESH_MS = 5 * 60 * 1000;
const OPACITY = 1; // the palette carries per-intensity transparency
const MAX_ZOOM = 14; // IEM serves n0q tiles through z14 (verified)

// Shared image cache. Every tile render pulls its 8 neighbors — which are
// other tiles' centers — and the director prewarms fly destinations, so the
// same URL is wanted many times in quick succession. Caching the promise
// dedupes in-flight fetches and skips re-decodes when the camera pans back.
const imgCache = new Map(); // url → Promise<HTMLImageElement>
const IMG_CACHE_MAX = 900;
const IMG_SETTLE_MS = 30_000; // an Image that never fires load/error would pin a pending promise in the cache forever

// Freshness heartbeat for the status chip: every successfully loaded tile
// proves IEM is reachable. Silence for many minutes = radar outage on air.
const tileBeat = track('radar-tiles', { pollMs: REFRESH_MS });

export const radarCacheSize = () => imgCache.size; // soak-test hook

function loadImage(url) {
  let p = imgCache.get(url);
  if (p) return p;
  tileBeat.attempt();
  p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timeout = setTimeout(() => {
      imgCache.delete(url);
      img.src = ''; // stop the load
      reject(new Error('tile load timeout'));
    }, IMG_SETTLE_MS);
    img.onload = () => {
      clearTimeout(timeout);
      tileBeat.ok();
      resolve(img);
    };
    img.onerror = (e) => {
      clearTimeout(timeout);
      imgCache.delete(url); // failures aren't sticky — a retry may succeed
      reject(e);
    };
    img.src = url;
  });
  imgCache.set(url, p);
  if (imgCache.size > IMG_CACHE_MAX) {
    for (const k of imgCache.keys()) {
      imgCache.delete(k);
      if (imgCache.size <= IMG_CACHE_MAX * 0.9) break;
    }
  }
  return p;
}

// A failed fetch used to leave a permanently blank tile until the 5-minute
// refresh — on air that's a crisp rectangular hole in the radar (worst right
// after a zoom, when dozens of tiles fetch at once and a few lose the race).
// Failures aren't sticky in imgCache, so retrying re-fetches just the misses.
const TILE_RETRIES = 3;
const TILE_RETRY_MS = 1500;

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

    let announced = false;
    const announce = () => {
      if (!announced) { announced = true; done(null, tile); }
    };
    const attempt = (tryNo) => {
      this._render(coords, tile).then(
        (complete) => {
          announce();
          // A neighbor strip failed → seam at that tile edge. The canvas
          // stays live in the DOM, so a later re-render heals it in place.
          if (!complete && tryNo < TILE_RETRIES) {
            setTimeout(() => { if (tile.isConnected) attempt(tryNo + 1); }, TILE_RETRY_MS * (tryNo + 1));
          }
        },
        () => {
          // Center tile failed — nothing painted yet. Hold `done` and retry
          // so Leaflet doesn't count an empty canvas as a loaded tile.
          if (tryNo < TILE_RETRIES) {
            setTimeout(() => { if (!announced || tile.isConnected) attempt(tryNo + 1); }, TILE_RETRY_MS * (tryNo + 1));
          } else {
            announce(); // gave up — empty tile beats a broken one
          }
        },
      );
    };
    attempt(0);
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
    if (!loaded.some((t) => t.dx === 0 && t.dy === 0)) throw new Error('center tile unavailable');

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
    return loaded.length === jobs.length; // false = a neighbor failed (seam risk)
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
      // Camera is always flying somewhere — load while moving, keep a fat
      // ring of rendered tiles around the view, and don't re-render at every
      // intermediate zoom during a fly (each tile is an expensive 9-fetch +
      // blur pipeline; updateInterval throttles the churn).
      updateWhenIdle: false,
      keepBuffer: 4,
      updateInterval: 350,
    }).addTo(map),
  );

  let idx = frames.length - 1;
  // Velocity mode dims the loop to a faint underlay instead of hiding it: the
  // couplets read clearly on top, and if velocity tiles ever fail the shot
  // still shows storms rather than an empty basemap.
  let level = 1;
  frames[idx].setOpacity(OPACITY);

  function setDim(dim) {
    level = dim ? 0.22 : 1;
    frames.forEach((f, i) => f.setOpacity(i === idx ? OPACITY * level : 0));
  }

  // Crossfade between frames — a hard cut reads as flicker on stream.
  function fadeTo(nextIdx) {
    const from = frames[idx];
    const to = frames[nextIdx];
    idx = nextIdx;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / XFADE_MS);
      to.setOpacity(OPACITY * level * t);
      from.setOpacity(OPACITY * level * (1 - t));
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

  // If this loop dies the map keeps animating the same aging frames — the
  // "screensaver of stale data" failure. Critical: the watchdog reloads on it.
  const refreshBeat = track('radar-refresh', { pollMs: REFRESH_MS, critical: true });
  setInterval(() => {
    refreshBeat.ok();
    ts = Date.now();
    imgCache.clear(); // URLs just changed — everything cached is stale
    frames.forEach((f, i) => f.setUrl(url(i, ts)));
  }, REFRESH_MS);

  // Warm the tiles for a fly destination while the camera is still in the
  // air, so radar is painted (not popping in) when the shot settles. The
  // director calls this with the same bounds/maxZoom it hands flyToBounds.
  function prewarm(bounds, maxZoom = MAX_ZOOM) {
    const z = Math.round(Math.min(map.getBoundsZoom(bounds), maxZoom, MAX_ZOOM));
    const n = 2 ** z;
    const nw = map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const se = map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    const x0 = nw.x - 1; // +1 ring: neighbor pads of the edge tiles
    const x1 = se.x + 1;
    const y0 = Math.max(0, nw.y - 1);
    const y1 = Math.min(n - 1, se.y + 1);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return; // too wide to warm usefully

    // Newest frame first — it's what's on screen most of the loop.
    for (let i = OFFSETS.length - 1; i >= 0; i--) {
      const tpl = url(i, ts);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const u = tpl
            .replace('{z}', z)
            .replace('{x}', ((x % n) + n) % n)
            .replace('{y}', y);
          loadImage(u).catch(() => {});
        }
      }
    }
  }

  return { prewarm, setDim };
}
