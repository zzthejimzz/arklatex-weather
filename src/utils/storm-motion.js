// Storm motion from the CAP eventMotionDescription parameter, used for the
// warning card's "Moving E at 46 mph" row and "towns in the path" ETAs.
//
// The parameter encodes the product's TIME...MOT...LOC line, e.g.
//   "2026-07-05T21:52:00-00:00...storm...263DEG...35KT...32.52,-93.75 32.61,-93.90"
// Direction is meteorological — degrees FROM which the storm moves — and
// multiple lat,lon points appear for line segments (QLCS warnings).
//
// All math is a local flat-earth approximation (km east/north around the
// storm point) — over a warning polygon's ~100 km scale the error is noise.
import { param } from '../director/scoring.js';
import { PLACES } from '../map/cities.js';

const KM_PER_DEG = 111.32;
const KT_TO_MPH = 1.15078;
const KT_TO_KMH = 1.852;
const MIN_SPEED_KT = 3; // slower is effectively stationary — no meaningful path

export function parseMotion(props) {
  const raw = param(props, 'eventMotionDescription');
  if (!raw) return null;
  const dir = raw.match(/(\d{1,3})DEG/);
  const spd = raw.match(/(\d{1,3})KT/);
  const points = [...raw.matchAll(/(-?\d+\.\d+),(-?\d+\.\d+)/g)]
    .map(m => ({ lat: +m[1], lon: +m[2] }));
  if (!dir || !spd || !points.length) return null;
  const speedKt = +spd[1];
  if (speedKt < MIN_SPEED_KT) return null;

  return {
    // Reference time for dead-reckoning the storm forward. `sent` runs a
    // minute or two behind the radar-scan time in the parameter, but unlike
    // the parameter it's rewritten by the replay engine — so replayed storms
    // dead-reckon correctly instead of extrapolating from a canned timestamp.
    at: new Date(props?.sent ?? NaN).getTime() || Date.now(),
    toDeg: (+dir[1] + 180) % 360, // heading the storm moves toward
    speedMph: Math.round(speedKt * KT_TO_MPH),
    speedKmh: speedKt * KT_TO_KMH,
    points,
  };
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass8(deg) {
  return COMPASS_8[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// "Towns in the path": places within a corridor along the storm's track,
// with arrival times. The corridor half-width acknowledges a warned storm
// isn't a point; the lookahead stops us naming towns the warning will never
// live to reach (a follow-on warning will own them).
const CORRIDOR_KM = 14;
const LOOKAHEAD_MIN = 75;
const BEHIND_KM = 3;   // just-passed still reads as "near ... now"
const NEAR_NOW_KM = 5;
const MAX_DEAD_RECKON_MS = 45 * 60 * 1000; // don't extrapolate stale motion forever

export function townsInPath(motion, { now = Date.now(), max = 3 } = {}) {
  if (!motion) return [];
  const th = (motion.toDeg * Math.PI) / 180;
  const ux = Math.sin(th);
  const uy = Math.cos(th);
  // Storm has kept moving since the product was issued — advance the origin.
  const movedKm =
    (motion.speedKmh * Math.min(Math.max(now - motion.at, 0), MAX_DEAD_RECKON_MS)) / 3.6e6;

  const best = new Map(); // town name → closest-approach entry across points
  for (const p of motion.points) {
    const coslat = Math.cos((p.lat * Math.PI) / 180);
    for (const [name, tlat, tlon, tier] of PLACES) {
      if (tier === 0) continue; // out-of-region anchors — never "in the path"
      const ex = (tlon - p.lon) * KM_PER_DEG * coslat - movedKm * ux;
      const ny = (tlat - p.lat) * KM_PER_DEG - movedKm * uy;
      const along = ex * ux + ny * uy;
      const lateral = Math.abs(ex * uy - ny * ux);
      if (lateral > CORRIDOR_KM || along < -BEHIND_KM) continue;
      if (along > (motion.speedKmh * LOOKAHEAD_MIN) / 60) continue;
      const etaMs = now + (Math.max(0, along) / motion.speedKmh) * 3.6e6;
      const prev = best.get(name);
      if (!prev || etaMs < prev.etaMs) {
        best.set(name, { name, lat: tlat, lon: tlon, etaMs, nearNow: along < NEAR_NOW_KM });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.etaMs - b.etaMs).slice(0, max);
}
