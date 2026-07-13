// SPC fire weather outlook (Days 1–2, wind + low-RH areas). The national
// product is small, so we keep every feature for the wide shot but gate the
// director's stop on an Elevated+ area actually touching the region hull —
// in a drought summer that's often, the rest of the year it stays silent.
import { fetchFireOutlook } from '../utils/spc-api.js';
import { geometriesIntersect } from '../utils/geometry.js';
import { FIRE_META } from '../map/firewx-layer.js';

const DAYS = ['day1', 'day2'];
const REFRESH_MS = 30 * 60 * 1000; // reissued a few times a day
const RETRY_MS = 5 * 60 * 1000;

export function createFireWxSource(geo) {
  const hull = { type: 'Polygon', coordinates: [geo.hull] };
  const byDay = {}; // day → { features, local } — local = features touching the hull

  async function poll() {
    let delay = REFRESH_MS;
    for (const day of DAYS) {
      try {
        const data = await fetchFireOutlook(day);
        // A quiet product still carries one "No Areas" feature with an empty
        // GeometryCollection — the FIRE_META check drops it.
        const features = (data.features ?? [])
          .filter(f => f.geometry && FIRE_META[f.properties?.LABEL]);
        const local = features.filter(f => geometriesIntersect(f.geometry, hull));
        byDay[day] = { features, local };
      } catch (err) {
        console.warn(`[firewx] ${day} fetch failed:`, err);
        if (!byDay[day]) delay = RETRY_MS; // nothing on hand — retry sooner
      }
    }
    setTimeout(poll, delay);
  }

  function start() {
    poll();
  }

  // Days with an Elevated+ area over the region — the director's stops.
  function days() {
    return DAYS.filter(d => byDay[d]?.local.length);
  }

  // Worst local category for a day (FIRE_META entry), or null.
  function worst(day) {
    let best = null;
    for (const f of byDay[day]?.local ?? []) {
      const meta = FIRE_META[f.properties.LABEL];
      if (!best || meta.order > best.order) best = meta;
    }
    return best;
  }

  return { start, days, worst, get: day => byDay[day]?.features ?? [] };
}
