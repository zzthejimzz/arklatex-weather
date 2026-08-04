// CPC 6–10 & 8–14 day temperature/precipitation outlooks (data side). The
// national product is fetched already simplified and windowed to a wide box
// around the region (cpc-api.js), so we keep every returned feature for the
// multi-state shot and gate the director's stop on the region actually leaning
// above/below normal — an Equal-Chances week for a product has no story, so it
// stays silent, the same locality gate ERO/fire-weather use.
import { fetchCpcOutlook, CPC_PRODUCTS } from '../utils/cpc-api.js';
import { geometriesIntersect } from '../utils/geometry.js';

const REFRESH_MS = 30 * 60 * 1000; // CPC reissues once daily (~3pm ET)
const RETRY_MS = 5 * 60 * 1000;

export function createCpcSource(geo) {
  const hull = { type: 'Polygon', coordinates: [geo.hull] };
  // Query envelope: a generous multi-state box around the region so the wide
  // shot's frame is filled without dragging in Alaska/Hawaii/west-coast bands.
  const [w, s, e, n] = geo.bbox;
  const env = [w - 8, s - 7, e + 8, n + 7];
  const byProduct = {}; // product → { features, local, valid }

  async function poll() {
    let delay = REFRESH_MS;
    for (const product of CPC_PRODUCTS) {
      try {
        const data = await fetchCpcOutlook(product, env);
        const features = (data.features ?? []).filter(f => f.geometry && f.properties?.cat);
        const local = features.filter(f => geometriesIntersect(f.geometry, hull));
        // Every feature in a product shares one valid window — read it off any.
        const p0 = features[0]?.properties;
        const valid = p0 ? { start: new Date(p0.start_date), end: new Date(p0.end_date) } : null;
        byProduct[product] = { features, local, valid };
      } catch (err) {
        console.warn(`[cpc] ${product} fetch failed:`, err);
        if (!byProduct[product]) delay = RETRY_MS; // nothing on hand — retry sooner
      }
    }
    setTimeout(poll, delay);
  }

  function start() {
    poll();
  }

  // Strongest local lean for a product: the highest-probability Above/Below
  // band touching the region hull, or null when the region is Equal-Chances.
  function lean(product) {
    let best = null;
    for (const f of byProduct[product]?.local ?? []) {
      const { cat, prob } = f.properties;
      if (cat === 'Normal') continue;
      if (!best || prob > best.prob) best = { cat, prob };
    }
    return best;
  }

  // Products the region actually leans on — the director's stops, kept in the
  // fixed 6–10→8–14, temperature→precipitation reading order of CPC_PRODUCTS.
  function products() {
    return CPC_PRODUCTS.filter(p => lean(p));
  }

  return {
    start, products, lean,
    get: p => byProduct[p]?.features ?? [],
    valid: p => byProduct[p]?.valid ?? null,
  };
}
