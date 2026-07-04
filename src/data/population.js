// Population-impacted estimates: census tract centroids ([lon, lat, pop])
// pre-baked by scripts/build-geo.js, summed by point-in-polygon at runtime.
import { pointInGeometry, geometryBounds } from '../utils/geometry.js';

let grid = null;

export async function loadPopulationGrid() {
  try {
    const res = await fetch('/geo/population-grid.json');
    if (res.ok) grid = await res.json();
    else console.warn('[population] grid missing — run `npm run build-geo`');
  } catch (err) {
    console.warn('[population] grid unavailable:', err);
  }
  return !!grid;
}

export function populationIn(geometry) {
  if (!grid || !geometry) return null;
  const bbox = geometryBounds(geometry);
  if (!bbox) return null;
  let sum = 0;
  for (const [lon, lat, pop] of grid) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (pointInGeometry([lon, lat], geometry)) sum += pop;
  }
  return sum;
}

export function formatPopulation(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
