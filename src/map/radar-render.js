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

// ---- broadcast palette -------------------------------------------------------
// Tuned against the grey basemap (land #595959). Alpha scales with intensity:
// drizzle stays translucent so towns read through it, cores go near-solid.
// [dBZ, r, g, b, alpha]
const STOPS = [
  [15, 8, 82, 46, 0.0], // fade-in starts here — anything weaker is invisible
  [20, 22, 138, 66, 0.55],
  [30, 74, 208, 86, 0.8],
  [37, 250, 214, 40, 0.88],
  [45, 255, 140, 22, 0.92],
  [52, 236, 42, 32, 0.94],
  [60, 152, 12, 22, 0.95],
  [65, 224, 66, 240, 0.95],
  [72, 255, 168, 255, 0.95],
  [78, 255, 255, 255, 0.96],
];

// Precomputed palette at half-dBZ resolution: index = dbz*2 + 64 (-32 → 0).
const PAL_N = 256;
const PAL_R = new Uint8Array(PAL_N);
const PAL_G = new Uint8Array(PAL_N);
const PAL_B = new Uint8Array(PAL_N);
const PAL_A = new Uint8Array(PAL_N);

// Interpolated [r, g, b, alpha] at an exact dBZ value.
function evalStops(dbz) {
  let s = STOPS.length - 1;
  while (s > 0 && STOPS[s][0] > dbz) s--;
  const a0 = STOPS[s];
  const a1 = STOPS[Math.min(s + 1, STOPS.length - 1)];
  const t = a1[0] === a0[0] ? 0 : Math.max(0, Math.min(1, (dbz - a0[0]) / (a1[0] - a0[0])));
  return [
    a0[1] + (a1[1] - a0[1]) * t,
    a0[2] + (a1[2] - a0[2]) * t,
    a0[3] + (a1[3] - a0[3]) * t,
    a0[4] + (a1[4] - a0[4]) * t,
  ];
}

// Color snaps to the floor of its band (classic stepped NEXRAD bins) so every
// intensity jump reads as a crisp boundary on stream; alpha stays continuous
// so light rain still fades in and storm edges stay soft.
const BAND_DBZ = 5;
for (let i = 0; i < PAL_N; i++) {
  const dbz = (i - 64) / 2;
  if (dbz <= STOPS[0][0]) continue; // transparent below the first stop
  const [r, g, b] = evalStops(Math.floor(dbz / BAND_DBZ) * BAND_DBZ);
  PAL_R[i] = Math.round(r);
  PAL_G[i] = Math.round(g);
  PAL_B[i] = Math.round(b);
  PAL_A[i] = Math.round(evalStops(dbz)[3] * 255);
}

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
 */
export function renderRadarTile(padded, pad, out, radius) {
  const S = padded.width;
  const src = padded.getContext('2d', { willReadFrequently: true });
  const img = src.getImageData(0, 0, S, S).data;

  const field = new Float32Array(S * S); // dBZ · coverage
  const cov = new Float32Array(S * S);
  const tmp = new Float32Array(S * S);

  for (let p = 0, i = 0; p < field.length; p++, i += 4) {
    if (img[i + 3] === 0) continue;
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
      const a = PAL_A[pi];
      if (a === 0) continue;

      const oi = (oy * OUT + ox) * 4;
      o[oi] = PAL_R[pi];
      o[oi + 1] = PAL_G[pi];
      o[oi + 2] = PAL_B[pi];
      // soften storm edges: fade by coverage before full opacity kicks in
      o[oi + 3] = c >= 0.5 ? a : Math.round(a * (c - 0.04) * (1 / 0.46));
    }
  }

  dst.putImageData(outData, 0, 0);
}
