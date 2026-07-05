// Sunrise/sunset via the standard NOAA "sunrise equation" (Wikipedia
// formulation, ±2 min — plenty for a ticker almanac line). No API, no deps.
const rad = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000 = Date.UTC(2000, 0, 1, 12); // epoch: 2000-01-01 12:00 UTC

export function sunTimes(date, lat, lon) {
  const n = Math.round((date.getTime() - J2000) / DAY_MS);
  const jStar = n - lon / 360; // mean solar noon, days since epoch
  const M = (357.5291 + 0.98560028 * jStar) % 360; // solar mean anomaly
  const C =
    1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360; // ecliptic longitude
  const jTransit = jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const sinDec = Math.sin(L * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  // -0.833°: refraction + solar disc radius
  const cosH =
    (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosH < -1 || cosH > 1) return { sunrise: null, sunset: null }; // polar day/night
  const h = Math.acos(cosH) / rad / 360; // half day length, in days
  return {
    sunrise: new Date(J2000 + (jTransit - h) * DAY_MS),
    sunset: new Date(J2000 + (jTransit + h) * DAY_MS),
  };
}
