// Moon phases, computed locally — no API, no deps. Ecliptic longitudes of
// the sun (same NOAA series as sun.js) and moon (Astronomical Almanac
// low-precision series, ~0.3° ≈ ±40 min on a phase time — a broadcast date
// card never notices), with the phase read from their elongation:
// 0° new → 90° first quarter → 180° full → 270° last quarter.
const rad = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000 = Date.UTC(2000, 0, 1, 12); // epoch: 2000-01-01 12:00 UTC
const ELONG_RATE = 12.190749; // mean elongation gain, °/day (moon outrunning the sun)

const sin = a => Math.sin(a * rad);

function sunLon(d) {
  const M = 357.5291 + 0.98560028 * d; // solar mean anomaly
  const C = 1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M);
  return M + C + 180 + 102.9372;
}

function moonLon(d) {
  const L = 218.3164477 + 13.17639648 * d; // mean longitude
  const D = 297.8501921 + 12.19074912 * d; // mean elongation from the sun
  const M = 357.5291092 + 0.98560028 * d;  // sun mean anomaly
  const Mp = 134.9633964 + 13.06499295 * d; // moon mean anomaly
  const F = 93.272095 + 13.22935024 * d;   // argument of latitude
  return L
    + 6.289 * sin(Mp) + 1.274 * sin(2 * D - Mp) + 0.658 * sin(2 * D)
    + 0.214 * sin(2 * Mp) - 0.186 * sin(M) - 0.114 * sin(2 * F)
    - 0.059 * sin(2 * D - 2 * Mp) - 0.057 * sin(2 * D - M - Mp)
    + 0.053 * sin(2 * D + Mp) + 0.046 * sin(2 * D - M) + 0.041 * sin(M - Mp)
    - 0.035 * sin(D) - 0.031 * sin(M + Mp);
}

// Sun→moon elongation in ecliptic longitude, normalized to 0–360.
function elongation(date) {
  const d = (date.getTime() - J2000) / DAY_MS;
  return (((moonLon(d) - sunLon(d)) % 360) + 360) % 360;
}

export const MOON_PHASES = [
  { name: 'New Moon', emoji: '🌑' },
  { name: 'Waxing Crescent', emoji: '🌒' },
  { name: 'First Quarter', emoji: '🌓' },
  { name: 'Waxing Gibbous', emoji: '🌔' },
  { name: 'Full Moon', emoji: '🌕' },
  { name: 'Waning Gibbous', emoji: '🌖' },
  { name: 'Last Quarter', emoji: '🌗' },
  { name: 'Waning Crescent', emoji: '🌘' },
];

// Current phase: the 8-way wheel (each principal phase owns ±22.5° of
// elongation), plus the illuminated fraction and fill direction.
export function moonInfo(date = new Date()) {
  const e = elongation(date);
  return {
    ...MOON_PHASES[Math.round(e / 45) % 8],
    fraction: (1 - Math.cos(e * rad)) / 2,
    waxing: e < 180,
  };
}

// The next `count` principal phases in chronological order. Elongation only
// ever grows (the moon always outruns the sun), so each upcoming multiple of
// 90° gets a linear first guess refined by a few Newton steps.
export function nextPhases(date = new Date(), count = 4) {
  const out = [];
  const e0 = elongation(date);
  for (let i = 1; i <= count; i++) {
    const target = (Math.floor(e0 / 90) + i) * 90;
    let t = date.getTime() + ((target - e0) / ELONG_RATE) * DAY_MS;
    for (let k = 0; k < 6; k++) {
      const diff = (((target - elongation(new Date(t))) % 360) + 540) % 360 - 180;
      t += (diff / ELONG_RATE) * DAY_MS;
      if (Math.abs(diff) < 0.001) break;
    }
    out.push({ ...MOON_PHASES[((target / 90) % 4) * 2], date: new Date(t) });
  }
  return out;
}
