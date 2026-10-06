// Radar tile renderer: decode IEM n0q RGBA pixels back to dBZ (exact LUT —
// the tiles are lossless PNGs), smooth the reflectivity FIELD, then repaint
// through a broadcast palette. Smoothing in data space is what keeps color
// boundaries crisp while the blocks melt (RadarScope-style); blurring the
// rendered pixels (the old CSS-filter approach) fuzzes edges and bleeds hue.
//
// Smoothing uses normalized convolution: blur(field·cov) / blur(cov), where
// cov=1 marks pixels with a real return. Echo-free gaps therefore never drag
// values down — storm edges fade by coverage, not by fake low dBZ.
import { N0Q_LUT } from './n0q-lut.js';

// ---- RGB → dBZ (inversion of the IEM lookup table) --------------------------
const RGB_TO_DBZ = new Map();
for (const [dbz, r, g, b] of N0Q_LUT) {
  const k = (r << 16) | (g << 8) | b;
  // Collisions only exist below 10 dBZ (verified); keep the higher value.
  if (!RGB_TO_DBZ.has(k) || dbz > RGB_TO_DBZ.get(k)) RGB_TO_DBZ.set(k, dbz);
}

// ---- broadcast palettes ------------------------------------------------------
// Tuned against the grey basemap (land #595959). Alpha scales with intensity:
// drizzle stays translucent so towns read through it, cores go near-solid.
// Color blends continuously (consumer-app look) rather than in 5-dBZ bins.
// [dBZ, r, g, b, alpha]
//
// Rain: TV-style mint → deep green → yellow → red up to 50 dBZ, so everyday
// rain stays calm on a 24/7 stream; above that, RadarScope-style hue steps
// (dark red → magenta → purple → white) so hail cores show structure on
// warning zooms instead of fading into one pink.
const RAIN_STOPS = [
  [15, 90, 200, 110, 0.0], // fade-in starts here — anything weaker is invisible
  [18, 110, 215, 120, 0.45],
  [25, 60, 180, 70, 0.7],
  [32, 20, 130, 40, 0.82],
  [38, 245, 225, 30, 0.9],
  [44, 250, 150, 20, 0.92],
  [50, 240, 30, 25, 0.94],
  [55, 190, 5, 10, 0.95],
  [60, 255, 0, 220, 0.95],
  [65, 150, 40, 255, 0.96],
  [70, 255, 255, 255, 0.96],
];

// Snow: icy blue → deep blue → violet. Snow returns run ~10–20 dBZ weaker
// than rain at the same intensity, so the ramp starts and saturates lower.
const SNOW_STOPS = [
  [8, 190, 225, 255, 0.0],
  [12, 175, 215, 255, 0.5],
  [20, 110, 170, 250, 0.72],
  [28, 50, 110, 235, 0.85],
  [35, 30, 60, 195, 0.92],
  [42, 125, 70, 210, 0.94],
  [50, 235, 205, 255, 0.95],
];

// Precomputed palettes at half-dBZ resolution: index = dbz*2 + 64 (-32 → 0).
const PAL_N = 256;
const newPal = () => ({
  r: new Uint8Array(PAL_N), g: new Uint8Array(PAL_N), b: new Uint8Array(PAL_N), a: new Uint8Array(PAL_N),
});
const RAIN = newPal();
const SNOW = newPal();

// Interpolated [r, g, b, alpha] at an exact dBZ value.
function evalStops(stops, dbz) {
  let s = stops.length - 1;
  while (s > 0 && stops[s][0] > dbz) s--;
  const a0 = stops[s];
  const a1 = stops[Math.min(s + 1, stops.length - 1)];
  const t = a1[0] === a0[0] ? 0 : Math.max(0, Math.min(1, (dbz - a0[0]) / (a1[0] - a0[0])));
  return [
    a0[1] + (a1[1] - a0[1]) * t,
    a0[2] + (a1[2] - a0[2]) * t,
    a0[3] + (a1[3] - a0[3]) * t,
    a0[4] + (a1[4] - a0[4]) * t,
  ];
}

// Alpha is continuous so light rain fades in and storm edges stay soft.
function fillPalette(pal, stops) {
  for (let i = 0; i < PAL_N; i++) {
    const dbz = (i - 64) / 2;
    if (dbz <= stops[0][0]) continue; // transparent below the first stop
    const [r, g, b, a] = evalStops(stops, dbz);
    pal.r[i] = Math.round(r);
    pal.g[i] = Math.round(g);
    pal.b[i] = Math.round(b);
    pal.a[i] = Math.round(a * 255);
  }
}
fillPalette(RAIN, RAIN_STOPS);
fillPalette(SNOW, SNOW_STOPS);

// Dev hook (test-radar.html ?ptype=snow): paint every masked echo as snow so
// the winter palette can be judged on a rain day.
let forceSnow = false;
export function setForceSnow(on) {
  forceSnow = on;
}

// Precip-type classes in the mask grid radar-loop.js builds from MRMS.
export const PTYPE_DRY = 0;
export const PTYPE_RAIN = 1;
export const PTYPE_SNOW = 2;

// n0q source raster is ~0.0108°/px; melt blocks once they span multiple tile
// pixels. Radius is in source-tile pixels.
export function blurRadiusForZoom(z) {
  const blockPx = ((256 * 2 ** z) / 360) * 0.0108;
  return Math.max(1, Math.min(48, Math.round(blockPx * 0.55)));
}

// Separable box blur (two passes ≈ triangular kernel), in place via ping-pong.
function boxBlur(src, tmp, w, h, r) {
  const norm = 1 / (2 * r + 1);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * norm;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = sum * norm;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

const MIN_DECODE_DBZ = 5; // ignore clear-air/clutter returns entirely

/**
 * Render one smoothed output tile from a padded source canvas.
 * @param {HTMLCanvasElement} padded  256+2·pad square: center tile + neighbor
 *                                    strips already drawn in (raw IEM pixels)
 * @param {number} pad     padding in source pixels (must be ≥ 2·radius)
 * @param {HTMLCanvasElement} out     Destination tile canvas (256 or 512 px)
 * @param {number} radius  box-blur radius in source pixels
 * @param {Uint8Array|null} mask  S×S PTYPE_* classes in the same padded pixel
 *        space, or null to render unmasked (all rain)
 */
export function renderRadarTile(padded, pad, out, radius, mask = null) {
  const S = padded.width;
  const src = padded.getContext('2d', { willReadFrequently: true });
  const img = src.getImageData(0, 0, S, S).data;

  const field = new Float32Array(S * S); // dBZ · coverage
  const cov = new Float32Array(S * S);
  const tmp = new Float32Array(S * S);

  // Mask → precip presence + snow flag, both blurred. Presence is dilated (any
  // precip nearby keeps an echo) to absorb the coarse 1 km grid and the few
  // minutes between MRMS and n0q timestamps; the snow/presence ratio blends
  // rain→snow smoothly across the transition line instead of a hard seam.
  let wet = null;
  let snow = null;
  if (mask) {
    wet = new Float32Array(S * S);
    snow = new Float32Array(S * S);
    for (let p = 0; p < wet.length; p++) {
      if (mask[p] === PTYPE_DRY) continue;
      wet[p] = 1;
      if (forceSnow || mask[p] === PTYPE_SNOW) snow[p] = 1;
    }
    const dil = Math.max(3, radius);
    boxBlur(wet, tmp, S, S, dil);
    boxBlur(snow, tmp, S, S, dil);
  }

  for (let p = 0, i = 0; p < field.length; p++, i += 4) {
    if (img[i + 3] === 0) continue;
    if (wet && wet[p] < 0.01) continue; // MRMS sees no precip here: clutter/bugs
    const dbz = RGB_TO_DBZ.get((img[i] << 16) | (img[i + 1] << 8) | img[i + 2]);
    if (dbz === undefined || dbz < MIN_DECODE_DBZ) continue;
    field[p] = dbz;
    cov[p] = 1;
  }

  // two box passes ≈ smooth bell kernel
  const r1 = Math.max(1, Math.round(radius * 0.6));
  boxBlur(field, tmp, S, S, radius);
  boxBlur(field, tmp, S, S, r1);
  boxBlur(cov, tmp, S, S, radius);
  boxBlur(cov, tmp, S, S, r1);

  const OUT = out.width; // 256 on the VPS; 512 for 2× local supersampling
  const dst = out.getContext('2d');
  const outData = dst.createImageData(OUT, OUT);
  const o = outData.data;
  const scale = 256 / OUT;

  for (let oy = 0; oy < OUT; oy++) {
    const sy = pad + (oy + 0.5) * scale - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let ox = 0; ox < OUT; ox++) {
      const sx = pad + (ox + 0.5) * scale - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const i00 = y0 * S + x0;

      // bilinear sample of both blurred fields
      const c =
        cov[i00] * (1 - fx) * (1 - fy) +
        cov[i00 + 1] * fx * (1 - fy) +
        cov[i00 + S] * (1 - fx) * fy +
        cov[i00 + S + 1] * fx * fy;
      if (c < 0.04) continue;
      const f =
        field[i00] * (1 - fx) * (1 - fy) +
        field[i00 + 1] * fx * (1 - fy) +
        field[i00 + S] * (1 - fx) * fy +
        field[i00 + S + 1] * fx * fy;

      const dbz = f / c; // normalized convolution — true local mean dBZ
      const pi = Math.max(0, Math.min(PAL_N - 1, Math.round(dbz * 2) + 64));
      let r = RAIN.r[pi];
      let g = RAIN.g[pi];
      let b = RAIN.b[pi];
      let a = RAIN.a[pi];
      const sf = snow && wet[i00] > 0 ? Math.min(1, snow[i00] / wet[i00]) : 0;
      if (sf > 0) {
        const rf = 1 - sf;
        r = r * rf + SNOW.r[pi] * sf;
        g = g * rf + SNOW.g[pi] * sf;
        b = b * rf + SNOW.b[pi] * sf;
        a = a * rf + SNOW.a[pi] * sf;
      }
      if (a < 1) continue;

      const oi = (oy * OUT + ox) * 4;
      o[oi] = r;
      o[oi + 1] = g;
      o[oi + 2] = b;
      // soften storm edges: fade by coverage before full opacity kicks in
      o[oi + 3] = c >= 0.5 ? a : Math.round(a * (c - 0.04) * (1 / 0.46));
    }
  }

  dst.putImageData(outData, 0, 0);
}
