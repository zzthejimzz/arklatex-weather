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
const TILE_SIZE = 256;

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

// IEM answers a malformed tile request with a solid-red "Invalid TMS Request"
// PNG — HTTP 200 and CORS-valid (ACAO:*), so the canvas-taint check in _render
// doesn't catch it, and the LUT would recolor it into a bright orange smear on
// air. It's pure opaque red edge to edge (real reflectivity never fills a whole
// tile corner-to-corner with exact max-red), so detect that signature and treat
// it as a failed load. Runs once per image (loadImage is cached per URL), off
// the per-frame render path; a fresh 16×16 probe canvas avoids a tainted tile
// permanently poisoning a shared one.
function isErrorTile(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, 16, 16);
    const d = cx.getImageData(0, 0, 16, 16).data;
    // Corners + mid-edges of the 16×16 probe. The error graphic loads as solid
    // ~(240,0,0,255) everywhere; real reflectivity is transparent at tile edges
    // and never uniformly max-red across all of these points.
    for (const i of [0, 15, 8, 240, 255, 248]) {
      const o = i * 4;
      if (!(d[o] > 200 && d[o + 1] < 40 && d[o + 2] < 40 && d[o + 3] > 240)) return false;
    }
    return true;
  } catch {
    return false; // tainted (no CORS) — the render path's taint check handles it
  }
}

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
      if (isErrorTile(img)) {
        imgCache.delete(url); // don't cache the error graphic; a retry may land real data
        reject(new Error('IEM error tile'));
        return;
      }
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
const NEIGHBOR_GRACE_MS = 350; // after the center lands, how long to hold first paint for neighbors

const SmoothRadarLayer = L.GridLayer.extend({
  initialize(url, options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._url = url;
    this._outputScale = options.outputScale ?? 2;
  },

  setUrl(url) {
    this._url = url;
    this.redraw();
  },

  createTile(coords, done) {
    const tile = document.createElement('canvas');
    // Local/browser mode keeps the 2× supersampled output. The VPS stream uses
    // 1×: at 1080p/6 Mbps the visual difference is small, while the color pass
    // and every persistent canvas backing store are 75% smaller.
    tile.width = TILE_SIZE * this._outputScale;
    tile.height = TILE_SIZE * this._outputScale;
    const size = this.getTileSize();
    tile.style.width = `${size.x}px`;
    tile.style.height = `${size.y}px`;

    let announced = false;
    const announce = () => {
      if (!announced) { announced = true; done(null, tile); }
    };

    // Non-finite coords (a transient NaN zoom/center) would build a bad TMS URL
    // — IEM answers those with a red "Invalid TMS Request" PNG. Skip the fetch
    // and leave the tile transparent; Leaflet re-requests once the map settles.
    if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y) || !Number.isFinite(coords.z)) {
      done(null, tile);
      return tile;
    }
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
    // each neighbor is also some other tile's center). Only the center is
    // required before painting: waiting on the slowest of 9 fetches held the
    // whole tile blank, which on a zoomed fly read as radar popping in
    // tile-by-tile around the warning. Neighbors get a short grace after the
    // center lands; stragglers keep loading into the shared cache and the
    // caller's retry pass re-renders to heal any edge seam in place.
    const slots = [];
    const jobs = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const y = coords.y + dy;
        if (y < 0 || y >= n) continue;
        const slot = { img: null, dx, dy };
        slots.push(slot);
        jobs.push(
          loadImage(url(coords.x + dx, y)).then(
            (img) => { slot.img = img; },
            () => {}, // missing neighbor = no data there
          ),
        );
      }
    }
    const all = Promise.all(jobs);
    // Same cached promise the jobs loop created — rejection throws to the
    // caller's center-failed retry path, exactly like before.
    await loadImage(url(coords.x, coords.y));
    await Promise.race([all, new Promise((r) => setTimeout(r, NEIGHBOR_GRACE_MS))]);
    const loaded = slots.filter((s) => s.img);

    const S = 256 + 2 * pad;
    const padded = document.createElement('canvas');
    padded.width = S;
    padded.height = S;
    const ctx = padded.getContext('2d', { willReadFrequently: true });
    for (const { img, dx, dy } of loaded) {
      ctx.drawImage(img, pad + dx * 256, pad + dy * 256);
    }

    // Canvas taint here means this response didn't carry CORS headers —
    // in practice that's IEM's backend handing back an error/placeholder
    // graphic instead of real radar data (occasionally seen as a bright
    // orange tile with error text), not a normal cached tile. Drawing that
    // raw would put the error graphic on air, so treat it like any other
    // fetch failure: let the caller retry, empty tile beats a broken one.
    renderRadarTile(padded, pad, tile, radius);
    return loaded.length === slots.length; // false = a neighbor missing (seam risk)
  },
});

export function createRadarLoop(map, { lowPower = false } = {}) {
  const url = (i, ts) => `${BASE}${OFFSETS[i]}/{z}/{x}/{y}.png?_ts=${ts}`;
  const outputScale = lowPower ? 1 : 2;

  let ts = Date.now();
  // All frames stay on the map at opacity 0 so their tiles are loaded and
  // warm — animating is just an opacity swap, no network hitch per frame.
  const frames = OFFSETS.map((_, i) =>
    new SmoothRadarLayer(url(i, ts), {
      pane: 'radar',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      outputScale,
      // Keep the already-painted grid and let Leaflet transform it for the
      // duration of a camera flight. Each frame is a costly 9-image + blur
      // pipeline; rebuilding seven grids at every crossed integer zoom was
      // the dominant software-rendering spike on the VPS. Destination source
      // images are still warmed by prewarm(), then grids rebuild once at rest.
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 2,
    }).addTo(map),
  );

  let idx = frames.length - 1;
  // Velocity mode dims the loop to a faint underlay instead of hiding it: the
  // couplets read clearly on top, and if velocity tiles ever fail the shot
  // still shows storms rather than an empty basemap. Rainfall-totals mode
  // hides it outright — live echoes animating over accumulated totals is two
  // precip palettes fighting.
  let level = 1;
  let dimmed = false;
  let hidden = false;
  frames[idx].setOpacity(OPACITY);

  function applyLevel() {
    level = hidden ? 0 : dimmed ? 0.22 : 1;
    frames.forEach((f, i) => f.setOpacity(i === idx ? OPACITY * level : 0));
  }

  function setDim(dim) {
    dimmed = dim;
    applyLevel();
  }

  function setHidden(h) {
    hidden = h;
    applyLevel();
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

  // While the camera is flying, the software renderer (no GPU on the VPS) is
  // already saturated re-rastering the basemap every frame. Advancing the loop
  // then kicks off a concurrent crossfade rAF that fights for the same cores —
  // exactly the contention that makes flyTo choppy. Freeze frame-advance for
  // the duration of the move (same movestart→moveend gate the labels use) so
  // all the CPU goes to the motion; the loop resumes the instant it settles.
  let nextAt = Date.now() + HOLD_NEWEST_MS;
  let moving = false;
  // Leaflet zooms also emit the move lifecycle; subscribing to both event
  // pairs ran this settle work twice for every flyTo().
  map.on('movestart', () => { moving = true; });
  map.on('moveend', () => {
    moving = false;
    nextAt = Date.now() + FRAME_MS; // don't fire a catch-up burst on landing
  });

  setInterval(() => {
    if (moving || Date.now() < nextAt) return;
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
  // Warning-sized shots need ~60–130 tiles per frame — the old hard cap of 64
  // made prewarm bail on exactly the flys that needed it, so the camera landed
  // cold and radar popped in tile-by-tile (or showed one stretched parent tile,
  // a solid orange smear over a heavy core). Budget instead of bail: the newest
  // frames — what's on screen most of the loop — always warm first, and older
  // frames spend whatever budget is left.
  const PREWARM_FRAME_MAX = 220; // grid bigger than this per frame: shot too wide to warm usefully
  const PREWARM_BUDGET = 700;    // total image loads per fly, across all frames

  function prewarm(bounds, maxZoom = MAX_ZOOM) {
    const z = Math.round(Math.min(map.getBoundsZoom(bounds), maxZoom, MAX_ZOOM));
    const n = 2 ** z;
    const nw = map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const se = map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    const x0 = nw.x - 1; // +1 ring: neighbor pads of the edge tiles
    const x1 = se.x + 1;
    const y0 = Math.max(0, nw.y - 1);
    const y1 = Math.min(n - 1, se.y + 1);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > PREWARM_FRAME_MAX) return;

    let budget = PREWARM_BUDGET;
    for (let i = OFFSETS.length - 1; i >= 0 && budget > 0; i--) {
      const tpl = url(i, ts);
      for (let y = y0; y <= y1 && budget > 0; y++) {
        for (let x = x0; x <= x1 && budget > 0; x++) {
          budget--;
          const u = tpl
            .replace('{z}', z)
            .replace('{x}', ((x % n) + n) % n)
            .replace('{y}', y);
          loadImage(u).catch(() => {});
        }
      }
    }
  }

  return { prewarm, setDim, setHidden };
}
