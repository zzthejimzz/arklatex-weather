// Finds radar echo clusters inside the region so the director has something to
// show on warning-free days. Samples the IEM n0q composite tiles at z7 onto a
// canvas, weights pixels by intensity (yellow/orange cores count much more
// than light stratiform), bins them into ~0.2° cells, and clusters the hottest
// cells into up to 3 points of interest.
import { pointInGeometry } from '../utils/geometry.js';
import { nearestPlace } from '../map/cities.js';

const BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913';
const ZOOM = 7;
const CELL_DEG = 0.2;
const MIN_CLUSTER_WEIGHT = 60; // ignore drizzle/speckle-only areas
const SCAN_MS = 5 * 60 * 1000;
const MAX_POIS = 3;

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

// Rough intensity weight from the n0q palette: reds/purples (severe cores)
// dominate, greens count a little, the grey-blue <20 dBZ clutter barely at all.
function pixelWeight(r, g, b) {
  if (r > 150 && b > 150) return 10;            // purple/pink — extreme
  if (r > 160 && g < 140) return 8;             // red/orange
  if (r > 150 && g > 150 && b < 120) return 4;  // yellow
  if (g > 120 && r < 120) return 1;             // green
  return 0.15;                                  // weak returns / clutter
}

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

export function createPrecipScout(geo) {
  let pois = [];
  const hull = { type: 'Polygon', coordinates: [geo.hull] };

  async function scan() {
    try {
      const [w, s, e, n] = geo.bbox;
      const x0 = lon2tile(w, ZOOM), x1 = lon2tile(e, ZOOM);
      const y0 = lat2tile(n, ZOOM), y1 = lat2tile(s, ZOOM);
      const cols = x1 - x0 + 1, rows = y1 - y0 + 1;

      const canvas = document.createElement('canvas');
      canvas.width = cols * 256;
      canvas.height = rows * 256;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const jobs = [];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          jobs.push(
            loadTile(`${BASE}/${ZOOM}/${x}/${y}.png?_scout=${Date.now()}`).then(img => {
              if (img) ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256);
            }),
          );
        }
      }
      await Promise.all(jobs);

      const lonLeft = tile2lon(x0, ZOOM);
      const lonRight = tile2lon(x1 + 1, ZOOM);
      const latTop = tile2lat(y0, ZOOM);
      const latBottom = tile2lat(y1 + 1, ZOOM);

      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const cells = new Map(); // "i,j" → { weight, lonSum, latSum }
      const STRIDE = 2; // every other pixel is plenty at this scale
      for (let py = 0; py < height; py += STRIDE) {
        // Web-mercator latitude is non-linear, but over a ~4° span the error
        // is well under a cell — linear interpolation is fine here.
        const lat = latTop + (latBottom - latTop) * (py / height);
        for (let px = 0; px < width; px += STRIDE) {
          const o = (py * width + px) * 4;
          if (data[o + 3] < 60) continue;
          const wgt = pixelWeight(data[o], data[o + 1], data[o + 2]);
          if (wgt < 0.5) continue;
          const lon = lonLeft + (lonRight - lonLeft) * (px / width);
          const key = `${Math.floor(lon / CELL_DEG)},${Math.floor(lat / CELL_DEG)}`;
          const cell = cells.get(key) ?? { weight: 0, lonSum: 0, latSum: 0 };
          cell.weight += wgt;
          cell.lonSum += lon * wgt;
          cell.latSum += lat * wgt;
          cells.set(key, cell);
        }
      }

      // Greedy clustering: hottest cell absorbs its 8 neighbors.
      const entries = [...cells.entries()].sort((a, b) => b[1].weight - a[1].weight);
      const used = new Set();
      const clusters = [];
      for (const [key, cell] of entries) {
        if (used.has(key)) continue;
        const [ci, cj] = key.split(',').map(Number);
        let weight = 0, lonSum = 0, latSum = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const nk = `${ci + di},${cj + dj}`;
            const nc = cells.get(nk);
            if (!nc || used.has(nk)) continue;
            used.add(nk);
            weight += nc.weight;
            lonSum += nc.lonSum;
            latSum += nc.latSum;
          }
        }
        if (weight < MIN_CLUSTER_WEIGHT) continue;
        const lon = lonSum / weight;
        const lat = latSum / weight;
        if (!pointInGeometry([lon, lat], hull)) continue;
        // { name, lat, lon } is the nearest TOWN (for a labeled ring marker);
        // label includes the relation word ("near X" / "12 mi NW of X").
        const place = nearestPlace(lat, lon);
        clusters.push({
          center: [lon, lat],
          bounds: [lon - 0.55, lat - 0.45, lon + 0.55, lat + 0.45],
          weight,
          place,
          placeLabel: place.label,
        });
      }

      pois = clusters.sort((a, b) => b.weight - a.weight).slice(0, MAX_POIS);
    } catch (err) {
      // Canvas taint / network — just means no precip tours this cycle.
      console.warn('[precip-scout] scan failed:', err);
      pois = [];
    }
  }

  scan();
  setInterval(scan, SCAN_MS);
  return { get: () => pois };
}
