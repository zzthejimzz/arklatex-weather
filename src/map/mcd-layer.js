// SPC Mesoscale Convective Discussion outlines via the Iowa Environmental
// Mesonet API (endpoint verified against IEM's OpenAPI spec):
//   /api/1/nws/spc_mcd.geojson — MCDs valid at the request time.
import L from 'leaflet';
import { geometriesIntersect } from '../utils/geometry.js';

const MCD_URL = 'https://mesonet.agron.iastate.edu/api/1/nws/spc_mcd.geojson';
const REFRESH_MS = 5 * 60 * 1000;

export function createMcdLayer(map, geo) {
  let layer = null;
  let warned = false;

  async function refresh() {
    try {
      const res = await fetch(MCD_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const hull = { type: 'Polygon', coordinates: [geo.hull] };
      const features = (data.features ?? []).filter(
        f => f.geometry && geometriesIntersect(f.geometry, hull),
      );

      const next = L.geoJSON(
        { type: 'FeatureCollection', features },
        {
          pane: 'mcd',
          interactive: false,
          style: {
            color: '#22d3ee',
            weight: 2,
            opacity: 0.9,
            dashArray: '6 6',
            fillColor: '#22d3ee',
            fillOpacity: 0.03,
          },
        },
      );
      if (layer) layer.remove();
      layer = next.addTo(map);
    } catch (err) {
      if (!warned) {
        console.warn('[mcd] fetch failed (will keep retrying):', err);
        warned = true;
      }
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
}
