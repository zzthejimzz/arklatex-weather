// WPC excessive rainfall outlook (Days 1–2 — the actionable flash-flood
// window; WPC issues through Day 5 but the later days rarely rise above
// Marginal). National product, small file: keep every feature for the wide
// shot, gate the director's stop on a risk area actually touching the region
// hull — in a wet pattern that's days on end, otherwise it stays silent.
import { fetchExcessiveRain } from '../utils/spc-api.js';
import { geometriesIntersect } from '../utils/geometry.js';
import { ERO_META } from '../map/ero-layer.js';

const DAYS = ['day1', 'day2'];
const REFRESH_MS = 30 * 60 * 1000; // reissued a few times a day
const RETRY_MS = 5 * 60 * 1000;

export function createEroSource(geo) {
  const hull = { type: 'Polygon', coordinates: [geo.hull] };
  const byDay = {}; // day → { features, local } — local = features touching the hull

  async function poll() {
    let delay = REFRESH_MS;
    for (const day of DAYS) {
      try {
        const data = await fetchExcessiveRain(day);
        const features = (data.features ?? [])
          .filter(f => f.geometry && ERO_META[f.properties?.dn]);
        const local = features.filter(f => geometriesIntersect(f.geometry, hull));
        byDay[day] = { features, local };
      } catch (err) {
        console.warn(`[ero] ${day} fetch failed:`, err);
        if (!byDay[day]) delay = RETRY_MS; // nothing on hand — retry sooner
      }
    }
    setTimeout(poll, delay);
  }

  function start() {
    poll();
  }

  // Days with a risk area over the region — the director's stops.
  function days() {
    return DAYS.filter(d => byDay[d]?.local.length);
  }

  // Worst local category for a day (ERO_META entry), or null.
  function worst(day) {
    let best = null;
    for (const f of byDay[day]?.local ?? []) {
      const meta = ERO_META[f.properties.dn];
      if (!best || meta.order > best.order) best = meta;
    }
    return best;
  }

  return { start, days, worst, get: day => byDay[day]?.features ?? [] };
}
