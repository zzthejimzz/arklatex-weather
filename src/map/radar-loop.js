// Continuously animating NEXRAD loop — the map should never look frozen.
// IEM caches time-lagged composite tiles at 5-minute offsets (-m05m … -m50m);
// we cycle a 30-minute window ending on the current frame, holding the newest
// frame a beat before restarting, and re-bust the cache every 5 minutes.
//
// Rendering is a real reflectivity pipeline (map/radar-render.js): tile RGBs
// decode to exact dBZ via the baked IEM lookup table, the dBZ field is
// smoothed in data space (with neighbor-tile padding so storms never show
// seams), and repainted through our broadcast palette — translucent greens
// for light rain, near-solid cores. An MRMS precip-type grid per frame drops
// non-precip clutter and switches snow to its own palette. Frames crossfade
// instead of hard-cutting.
import L from 'leaflet';
import { renderRadarTile, blurRadiusForZoom, PTYPE_RAIN, PTYPE_SNOW } from './radar-render.js';
import { track } from '../utils/health.js';
import { fetchWithTimeout } from '../utils/net.js';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913';
const OFFSETS = ['-m30m', '-m25m', '-m20m', '-m15m', '-m10m', '-m05m', '']; // oldest → newest
const FRAME_MS = 650;
const HOLD_NEWEST_MS = 2200;
const XFADE_MS = 240;
const REFRESH_MS = 5 * 60 * 1000;
const OPACITY = 1; // the palette carries per-intensity transparency
const MAX_ZOOM = 14; // IEM serves n0q tiles through z14 (verified)
const TILE_SIZE = 256;

// MRMS precipitation type (NOAA opengeo WMS — CORS-open, 2-minute steps,
// ~2 h of history). It doubles as a QC mask: MRMS drops the clear-air/bug
// returns that bloom around every NEXRAD site at night, which raw n0q keeps.
// It also flags snow, so winter echoes get their own palette.
// Akamai in front of opengeo 403s bursts (a few parallel GetMaps trip it, and
// its 403 carries no CORS header), so never tile it: one regional image per
// loop frame — 7 requests per 5-minute refresh — decoded once into a 1-byte
// class grid that every tile samples. Failures stay failed until the next
// refresh (render unmasked) so an outage can't turn into a retry storm.
const MASK_WMS = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_pcpn_typ/ows';
const MASK_PX = 2048; // long side; ~0.8 km/px over the wide region ≈ MRMS's 1 km grid
const MASK_SNOW_RGB = (200 << 16) | (200 << 8) | 200; // legend "S"; every other color is rain or hail
const N0Q_META = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json';
const MERC = 20037508.342789244;
const FRAME_LAG_MIN = OFFSETS.map((o) => (o ? parseInt(o.slice(2), 10) : 0));

const mercX = (lon) => (lon * MERC) / 180;
const mercY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * MERC) / Math.PI;

async function loadPtypeGrid(bounds, time) {
  const minx = mercX(bounds.getWest());
  const maxx = mercX(bounds.getEast());
  const miny = mercY(bounds.getSouth());
  const maxy = mercY(bounds.getNorth());
  const mpp = Math.max(maxx - minx, maxy - miny) / MASK_PX;
  const w = Math.round((maxx - minx) / mpp);
  const h = Math.round((maxy - miny) / mpp);
  const url = `${MASK_WMS}?service=WMS&version=1.3.0&request=GetMap&layers=conus_pcpn_typ&styles=` +
    `&crs=EPSG:3857&bbox=${minx},${miny},${maxx},${maxy}&width=${w}&height=${h}` +
    `&format=image/png&transparent=true&time=${time}`;
  const img = await loadImage(url, null);
  imgCache.delete(url); // decoded below; don't pin a ~16 MB bitmap in the tile cache
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const cls = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < cls.length; p++, i += 4) {
    if (px[i + 3] === 0) continue;
    cls[p] = ((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]) === MASK_SNOW_RGB ? PTYPE_SNOW : PTYPE_RAIN;
  }
  return { cls, w, h, minx, maxy, mpp };
}

// Is MRMS showing precipitation at (or within `slop` grid px of) a point?
// null when the point is outside the grid — callers treat that as unknown.
export function ptypeWetNear(grid, lon, lat, slop = 2) {
  const gx = Math.floor((mercX(lon) - grid.minx) / grid.mpp);
  const gy = Math.floor((grid.maxy - mercY(lat)) / grid.mpp);
  if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return null;
  for (let dy = -slop; dy <= slop; dy++) {
    const y = gy + dy;
    if (y < 0 || y >= grid.h) continue;
    for (let dx = -slop; dx <= slop; dx++) {
      const x = gx + dx;
      if (x >= 0 && x < grid.w && grid.cls[y * grid.w + x] !== 0) return true;
    }
  }
  return false;
}

// Nearest-sample the class grid into a tile's padded source square. Pixels
// outside the grid read as rain (= unmasked), so edges of wide shots past the
// mask region just render the way they always have.
function sampleMask(grid, coords, pad, S) {
  const n = 2 ** coords.z;
  const span = (2 * MERC) / n / 256; // meters per source pixel
  const ox = (((coords.x % n) + n) % n) * 256 - pad;
  const oy = coords.y * 256 - pad;
  const gx0 = (-MERC + ox * span - grid.minx) / grid.mpp;
  const gy0 = (grid.maxy - (MERC - oy * span)) / grid.mpp;
  const step = span / grid.mpp;
  const gEnd = (g) => g + S * step;
  if (gEnd(gx0) < 0 || gx0 >= grid.w || gEnd(gy0) < 0 || gy0 >= grid.h) return null;
  const out = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    const gy = Math.floor(gy0 + (y + 0.5) * step);
    const inY = gy >= 0 && gy < grid.h;
    for (let x = 0; x < S; x++) {
      const gx = Math.floor(gx0 + (x + 0.5) * step);
      out[y * S + x] = inY && gx >= 0 && gx < grid.w ? grid.cls[gy * grid.w + gx] : PTYPE_RAIN;
    }
  }
  return out;
}

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

function loadImage(url, beat = tileBeat) {
  let p = imgCache.get(url);
  if (p) return p;
  beat?.attempt();
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
      beat?.ok();
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
const MASK_WAIT_MS = 6000; // longest a tile waits on the MRMS mask before painting unmasked
const NEIGHBOR_GRACE_MS = 350; // after the center lands, how long to hold first paint for neighbors

const SmoothRadarLayer = L.GridLayer.extend({
  initialize(url, options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._url = url;
    this._getMask = options.getMask ?? (() => Promise.resolve(null));
    this._outputScale = options.outputScale ?? 2;
  },

  // New data without a blank: every painted tile re-renders where it sits, so
  // the old picture stays on air until the new one replaces it in a single
  // putImageData. (redraw() empties the grid first — that blanked the whole
  // loop for seconds at every 5-minute refresh.) Tiles still on their first
  // render finish it, then re-render once with the new source.
  refreshInPlace() {
    for (const { el, coords, loaded } of Object.values(this._tiles)) {
      if (!loaded) {
        el._stale = true;
        continue;
      }
      el._gen = (el._gen || 0) + 1;
      this._rerender(coords, el, el._gen, 0);
    }
  },

  setUrl(url) {
    this._url = url;
    this.refreshInPlace();
  },

  _rerender(coords, tile, gen, tryNo) {
    const again = () => {
      if (tryNo < TILE_RETRIES) {
        setTimeout(() => {
          if (tile.isConnected && tile._gen === gen) this._rerender(coords, tile, gen, tryNo + 1);
        }, TILE_RETRY_MS * (tryNo + 1));
      }
    };
    // A failure keeps the previous picture on air — stale beats blank.
    this._render(coords, tile, gen).then((complete) => { if (!complete) again(); }, again);
  },

  // Leaflet's redraw() takes the map's raw zoom as the tile zoom, unlike its
  // own view updates which round it. With zoomSnap: 0 the map sits at zooms
  // like 8.6, so a redraw built bogus /8.6/ tile URLs and left the frame blank
  // until the next camera move re-rounded it. Refreshes now re-render in place
  // instead, but keep any redraw() safe. Mirror the rounding _setView does.
  redraw() {
    if (!this._map) return this;
    this._removeAllTiles();
    let tileZoom = Math.round(this._map.getZoom());
    const { maxZoom, minZoom } = this.options;
    if ((maxZoom !== undefined && tileZoom > maxZoom) || (minZoom !== undefined && tileZoom < minZoom)) {
      tileZoom = undefined;
    } else {
      tileZoom = this._clampZoom(tileZoom);
    }
    if (tileZoom !== this._tileZoom) {
      this._tileZoom = tileZoom;
      this._updateLevels();
    }
    this._update();
    return this;
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
          if (tile._stale) {
            // A refresh/mask landed mid-render: this paint used the old source.
            tile._stale = false;
            tile._gen = (tile._gen || 0) + 1;
            this._rerender(coords, tile, tile._gen, 0);
            return;
          }
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

  // `gen` (in-place re-renders only): skip the paint if a newer re-render of
  // this tile has started, so a slow stale render can't land on top of it.
  async _render(coords, tile, gen) {
    const z = coords.z;
    const n = 2 ** z;
    const radius = blurRadiusForZoom(z);
    const pad = 2 * radius + 2; // blur reach (two passes) must stay inside
    const url = (x, y) =>
      this._url.replace('{z}', z).replace('{x}', ((x % n) + n) % n).replace('{y}', y);
    const S = 256 + 2 * pad;
    const maskP = this._getMask(); // same promise for every tile of this frame

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
    // Don't hold first paint hostage to NOAA: past the wait, render unmasked
    // and let the loop re-render this frame in place once the mask lands.
    const grid = await Promise.race([maskP, new Promise((r) => setTimeout(r, MASK_WAIT_MS))]);
    if (grid === undefined) this._maskMissed = true;
    if (gen !== undefined && tile._gen !== gen) return true; // superseded
    renderRadarTile(padded, pad, tile, radius, grid ? sampleMask(grid, coords, pad, S) : null);
    return loaded.length === slots.length; // false = a neighbor missing (seam risk)
  },
});

export function createRadarLoop(map, { lowPower = false, maskBounds = null } = {}) {
  const url = (i, ts) => `${BASE}${OFFSETS[i]}/{z}/{x}/{y}.png?_ts=${ts}`;
  const outputScale = lowPower ? 1 : 2;

  let ts = Date.now();
  // Valid time of the newest IEM frame; MRMS mask frames are matched to it.
  // Until IEM's metadata answers, estimate (n0q runs every 5 min, ~3 min late).
  let anchor = Math.floor((Date.now() - 3 * 60e3) / 300e3) * 300e3;
  const maskTime = (i) => new Date(anchor - FRAME_LAG_MIN[i] * 60e3).toISOString();
  async function syncAnchor() {
    try {
      const res = await fetchWithTimeout(N0Q_META, { cache: 'no-store', timeoutMs: 8000 });
      const t = Date.parse((await res.json()).meta.valid);
      if (!Number.isFinite(t) || t === anchor) return false;
      anchor = t;
      return true;
    } catch {
      return false; // keep the estimate — a few minutes off only softens mask edges
    }
  }
  const anchorReady = syncAnchor();

  // One MRMS grid per frame, shared by all of its tiles. Fetched strictly one
  // at a time (newest frame first — it's on screen longest) because Akamai
  // rejects even 3–4 parallel GetMaps. A failure resolves to null (unmasked)
  // and stays that way until the next refresh.
  const ptypeBeat = track('radar-ptype', { pollMs: REFRESH_MS });
  let masks = OFFSETS.map(() => null);
  let maskQueue = anchorReady;
  function queueMasks() {
    for (let i = OFFSETS.length - 1; i >= 0; i--) {
      if (masks[i]) continue;
      const gen = masks;
      ptypeBeat.attempt();
      const p = maskQueue.then(() => loadPtypeGrid(maskBounds, maskTime(i))).then(
        (grid) => {
          ptypeBeat.ok();
          const f = frames[i];
          if (gen === masks && f._maskMissed) {
            f._maskMissed = false;
            f.refreshInPlace(); // some tiles painted unmasked while this was in flight
          }
          return grid;
        },
        (err) => {
          console.warn('[radar] precip-type mask failed, rendering unmasked:', err?.message || err);
          return null;
        },
      );
      masks[i] = p;
      maskQueue = p;
    }
  }
  function getMask(i) {
    if (!maskBounds) return Promise.resolve(null);
    if (!masks[i]) queueMasks();
    return masks[i];
  }

  // All frames stay on the map at opacity 0 so their tiles are loaded and
  // warm — animating is just an opacity swap, no network hitch per frame.
  const frames = OFFSETS.map((_, i) =>
    new SmoothRadarLayer(url(i, ts), {
      pane: 'radar',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      outputScale,
      getMask: () => getMask(i),
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
  // Overlay modes can dim or hide the loop. Velocity and rainfall wait until
  // their own tiles are ready before hiding it, preventing a blank handoff.
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
    // Never cut to a frame that's still building tiles (startup, a refresh's
    // first render, a pan onto new ground) — that's a blank on air. Skip ahead
    // to the next ready frame, or hold the current one.
    for (let k = 1; k < frames.length; k++) {
      const j = (idx + k) % frames.length;
      if (!frames[j].isLoading()) {
        fadeTo(j);
        break;
      }
    }
    nextAt = Date.now() + (idx === frames.length - 1 ? HOLD_NEWEST_MS : FRAME_MS);
  }, 100);

  // If this loop dies the map keeps animating the same aging frames — the
  // "screensaver of stale data" failure. Critical: the watchdog reloads on it.
  const refreshBeat = track('radar-refresh', { pollMs: REFRESH_MS, critical: true });
  setInterval(async () => {
    refreshBeat.ok();
    await syncAnchor();
    ts = Date.now();
    imgCache.clear(); // URLs just changed — everything cached is stale
    masks = OFFSETS.map(() => null);
    frames.forEach((f, i) => {
      f._maskMissed = false;
      f.setUrl(url(i, ts));
    });
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

  // The newest frame's MRMS grid (or null): lets the precip scout ignore the
  // same clutter the loop hides, without a second NOAA request.
  const latestMask = () => getMask(OFFSETS.length - 1);

  return { prewarm, setDim, setHidden, latestMask };
}
