// Rainfall totals map mode: MRMS radar-estimated precipitation from IEM's
// tile cache — "who got the most rain". Three accumulation windows share one
// color ramp (see precip-lut.js). A background scan samples the tiles over
// the region, inverts RGB back to millimeters, and finds the wettest spot so
// the director can (a) skip the shot entirely when nothing fell and (b)
// caption it with a real number ("Heaviest: 2.4″ near Marshall").
//
// The reflectivity loop is hidden (not dimmed) while this mode is up — live
// echoes animating over accumulated totals is two precip palettes fighting.
import L from 'leaflet';
import { PRECIP_LUT } from './precip-lut.js';
import { pointInGeometry } from '../utils/geometry.js';
import { nearestPlace } from './cities.js';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
export const PERIODS = [
  { key: 'p24h', tiles: 'q2-p24h-900913', label: '24-Hour Rainfall', sub: 'past 24 hours' },
  { key: 'p48h', tiles: 'q2-p48h-900913', label: '48-Hour Rainfall', sub: 'past 48 hours' },
  { key: 'p72h', tiles: 'q2-p72h-900913', label: '3-Day Rainfall', sub: 'past 72 hours' },
];

const SCAN_ZOOM = 7;
const SCAN_MS = 15 * 60 * 1000; // totals move slowly — no need for radar cadence
const MIN_MAX_MM = 2.54; // under a tenth of an inch region-wide: not a story
const MAX_ZOOM = 14;
const OPACITY = 0.85;

// RGB → mm, exact palette inversion (tile.py resamples nearest-neighbor, so
// tile pixels carry the ramp colors verbatim; off-palette pixels are ignored).
const MM_BY_RGB = new Map(PRECIP_LUT.map(([mm, r, g, b]) => [(r << 16) | (g << 8) | b, mm]));

export function formatInches(mm) {
  const inches = mm / 25.4;
  if (inches < 0.1) return 'Trace';
  return `${inches.toFixed(inches >= 1 ? 1 : 2)}″`;
}

// Chip legend: the ramp is continuous, so a gradient bar with inch anchors
// beats discrete swatches. Anchors run log-ish — most totals live under 2″
// but the ramp reads to 8″+. All three accumulation windows share it.
const LEGEND_ANCHORS_IN = [0.1, 0.25, 0.5, 1, 2, 4, 8];

function rampColor(mm) {
  let best = PRECIP_LUT[0];
  for (const e of PRECIP_LUT) {
    if (e[0] > mm) break;
    best = e;
  }
  return `rgb(${best[1]},${best[2]},${best[3]})`;
}

export function legendHtml() {
  const n = LEGEND_ANCHORS_IN.length;
  // Sample between anchors so the bar tracks the real (non-linear) ramp
  // instead of smearing straight lines between anchor colors.
  const SUB = 4;
  const stops = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < SUB; j++) {
      const pct = ((i + j / SUB) / (n - 1)) * 100;
      const inches = LEGEND_ANCHORS_IN[i] + (LEGEND_ANCHORS_IN[i + 1] - LEGEND_ANCHORS_IN[i]) * (j / SUB);
      stops.push(`${rampColor(inches * 25.4)} ${pct.toFixed(1)}%`);
    }
  }
  stops.push(`${rampColor(LEGEND_ANCHORS_IN[n - 1] * 25.4)} 100%`);
  const labels = LEGEND_ANCHORS_IN.map((v, i) => {
    const pos = i === 0 ? 'left:0'
      : i === n - 1 ? 'right:0'
      : `left:${((i / (n - 1)) * 100).toFixed(1)}%;transform:translateX(-50%)`;
    const text = v < 1 ? `${String(v).slice(1)}″` : `${v}″`; // .1″ .25″ .5″ 1″ …
    return `<span style="${pos}">${text}</span>`;
  }).join('');
  return `<span class="rain-legend"><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span class="labels">${labels}</span></span>`;
}

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function loadTile(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // Settle no matter what — a hung image must not strand the scan's
    // Promise.all on a 24/7 page.
    const timeout = setTimeout(() => { img.src = ''; resolve(null); }, 30_000);
    img.onload = () => { clearTimeout(timeout); resolve(img); };
    img.onerror = () => { clearTimeout(timeout); resolve(null); };
    img.src = url;
  });
}

export function createRainfallLayer(map, geo) {
  // Own pane just above the (hidden) reflectivity loop, below state borders.
  map.createPane('rainfall');
  const pane = map.getPane('rainfall');
  pane.style.zIndex = 451;
  pane.style.pointerEvents = 'none';

  const hull = { type: 'Polygon', coordinates: [geo.hull] };
  let summaries = new Map(); // period key → { maxMm, place }
  let layer = null;

  // Sample one period's tiles over the region bbox and find the wettest
  // in-region pixel. Same canvas approach as data/precip-scout.js, but with an
  // exact RGB→mm inversion instead of a palette heuristic.
  async function scanPeriod(period) {
    const [w, s, e, n] = geo.bbox;
    const x0 = lon2tile(w, SCAN_ZOOM), x1 = lon2tile(e, SCAN_ZOOM);
    const y0 = lat2tile(n, SCAN_ZOOM), y1 = lat2tile(s, SCAN_ZOOM);
    const cols = x1 - x0 + 1, rows = y1 - y0 + 1;

    const canvas = document.createElement('canvas');
    canvas.width = cols * 256;
    canvas.height = rows * 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const jobs = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        jobs.push(
          loadTile(`${BASE}/${period.tiles}/${SCAN_ZOOM}/${x}/${y}.png?_scan=${Date.now()}`).then(img => {
            if (img) ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256);
          }),
        );
      }
    }
    await Promise.all(jobs);

    const lonLeft = tile2lon(x0, SCAN_ZOOM);
    const lonRight = tile2lon(x1 + 1, SCAN_ZOOM);
    const latTop = tile2lat(y0, SCAN_ZOOM);
    const latBottom = tile2lat(y1 + 1, SCAN_ZOOM);

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let maxMm = 0, maxLat = 0, maxLon = 0;
    const STRIDE = 2;
    for (let py = 0; py < height; py += STRIDE) {
      // Web-mercator latitude is non-linear, but over a ~4° span the error
      // is negligible for naming the nearest town.
      const lat = latTop + (latBottom - latTop) * (py / height);
      for (let px = 0; px < width; px += STRIDE) {
        const o = (py * width + px) * 4;
        if (data[o + 3] < 200) continue; // transparent = no precip
        const mm = MM_BY_RGB.get((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
        if (mm === undefined || mm <= maxMm) continue;
        const lon = lonLeft + (lonRight - lonLeft) * (px / width);
        if (!pointInGeometry([lon, lat], hull)) continue;
        maxMm = mm;
        maxLat = lat;
        maxLon = lon;
      }
    }
    if (maxMm < MIN_MAX_MM) return null;
    return { maxMm, place: nearestPlace(maxLat, maxLon) };
  }

  async function scan() {
    const next = new Map();
    for (const p of PERIODS) {
      try {
        const s = await scanPeriod(p);
        if (s) next.set(p.key, s);
      } catch (err) {
        // Canvas taint / network — this period just sits out the cycle.
        console.warn(`[rainfall] ${p.key} scan failed:`, err);
      }
    }
    summaries = next;
  }

  // Periods worth showing, each with its heaviest-total caption data.
  // Empty on dry stretches — the director simply plans no rainfall stop.
  function periods() {
    return PERIODS.filter(p => summaries.has(p.key)).map(p => ({
      ...p,
      ...summaries.get(p.key),
    }));
  }

  // onReady fires once the visible tiles have loaded (or after a grace
  // period if one hangs) — the director hides the reflectivity loop *then*,
  // so the swap reads as a crossfade instead of a patchy checkerboard while
  // tiles trickle in. Guarded so a shot that already moved on never fires it.
  function show(key, onReady) {
    hide();
    const period = PERIODS.find(p => p.key === key) ?? PERIODS[0];
    layer = L.tileLayer(`${BASE}/${period.tiles}/{z}/{x}/{y}.png?_ts=${Date.now()}`, {
      pane: 'rainfall',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      updateWhenIdle: false,
      keepBuffer: 2,
      crossOrigin: 'anonymous',
    }).addTo(map);

    // Fade in over the still-visible reflectivity — reads as a crossfade.
    const t0 = performance.now();
    const lyr = layer;

    if (onReady) {
      let called = false;
      const ready = () => {
        if (called || lyr !== layer) return;
        called = true;
        onReady();
      };
      lyr.once('load', ready);
      setTimeout(ready, 5000); // a hung tile must not leave both palettes up
    }
    const step = (now) => {
      if (lyr !== layer) return; // hidden/replaced mid-fade
      const t = Math.min(1, (now - t0) / 350);
      lyr.setOpacity(OPACITY * t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return period;
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  scan();
  setInterval(scan, SCAN_MS);
  return { show, hide, periods };
}
