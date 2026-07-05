// Adapted from the Website repo's spc-api.js. Two changes for 24/7 broadcast use:
// cache entries expire after 15 minutes (outlooks are reissued several times a
// day), and the prod path still assumes a proxy.php-style host — Phase 1 runs
// under `npm run dev` where vite.config.js proxies /api/spc*.
import { fetchWithTimeout } from './net.js';

const IS_DEV = import.meta.env.DEV;

const SPC_OUTLOOK  = 'https://www.spc.noaa.gov/products/outlook';
const SPC_EXTENDED = 'https://www.spc.noaa.gov/products/exper/day4-8';

const FILES = {
  day1: { base: SPC_OUTLOOK,  cat: 'day1otlk_cat.lyr.geojson' },
  day2: { base: SPC_OUTLOOK,  cat: 'day2otlk_cat.lyr.geojson' },
  day3: { base: SPC_OUTLOOK,  cat: 'day3otlk_cat.lyr.geojson' },
  day4: { base: SPC_EXTENDED, prob: 'day4prob.lyr.geojson' },
  day5: { base: SPC_EXTENDED, prob: 'day5prob.lyr.geojson' },
  day6: { base: SPC_EXTENDED, prob: 'day6prob.lyr.geojson' },
  day7: { base: SPC_EXTENDED, prob: 'day7prob.lyr.geojson' },
  day8: { base: SPC_EXTENDED, prob: 'day8prob.lyr.geojson' },
};

const TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // key → { at, data }

function buildUrl(base, file) {
  const target = `${base}/${file}`;
  if (IS_DEV) {
    const devBase = base === SPC_EXTENDED ? '/api/spc-ext' : '/api/spc';
    return `${devBase}/${file}`;
  }
  return `/proxy.php?url=${encodeURIComponent(target)}`;
}

export function isExtendedDay(day) {
  return ['day4', 'day5', 'day6', 'day7', 'day8'].includes(day);
}

export async function fetchOutlook(day, hazard = 'cat') {
  const entry = FILES[day];
  if (!entry) throw new Error(`Unknown day: ${day}`);

  const file = isExtendedDay(day) ? entry.prob : entry[hazard];
  if (!file) throw new Error(`No file for ${day}/${hazard}`);

  const key = `${day}:${file}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const res = await fetchWithTimeout(buildUrl(entry.base, file));
  if (!res.ok) throw new Error(`SPC ${day}: HTTP ${res.status}`);

  const data = await res.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}
