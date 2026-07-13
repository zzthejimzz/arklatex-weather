// NHC tropical outlook map mode: 7-day potential-development areas in NHC's
// formation-chance colors plus a ✕ at each disturbance's current location,
// shown only while the director runs its "tropical" idle stop. Fills live in
// overlayPane like the other risk fills; the ambient convective outlook is
// hidden while this is up — both palettes run yellow→orange→red.
import L from 'leaflet';
import { geometryBounds } from '../utils/geometry.js';

// The camera always keeps the Gulf in frame for this shot — the "is it coming
// our way" context — and stretches further only if an area sits outside it.
export const GULF_BBOX = [-98, 17.5, -79.5, 31];

// NHC's graphical-outlook tiers: Low <40%, Medium 40–60%, High ≥70%.
// `chip` is the readable-on-dark variant for chip text.
export const TROP_META = [
  { min: 0,  label: 'Low',    color: '#ffff00', chip: '#ffff54' },
  { min: 40, label: 'Medium', color: '#ff9e00', chip: '#ffb84d' },
  { min: 70, label: 'High',   color: '#ff0000', chip: '#ff4d4d' },
];

function tierFor(f) {
  const prob = parseInt(f.properties?.prob7day) || 0;
  let meta = TROP_META[0];
  for (const t of TROP_META) if (prob >= t.min) meta = t;
  return meta;
}

export function createTropicalLayer(map) {
  let layer = null;

  // Areas arrive sorted by formation chance ascending (likelier on top).
  // Returns the legend, the headline area (highest 7-day chance) and the
  // union bbox of everything drawn, for the director's framing.
  function show({ areas, points }) {
    hide();
    if (!areas.length) return null;
    layer = L.layerGroup([
      L.geoJSON({ type: 'FeatureCollection', features: areas }, {
        pane: 'overlayPane',
        interactive: false,
        style: f => {
          const meta = tierFor(f);
          return {
            color: meta.color,
            weight: 2,
            opacity: 0.9,
            dashArray: '8 6',
            fillColor: meta.color,
            fillOpacity: 0.3,
          };
        },
      }),
      L.geoJSON({ type: 'FeatureCollection', features: points }, {
        interactive: false,
        pointToLayer: (f, latlng) => L.marker(latlng, {
          interactive: false,
          icon: L.divIcon({
            className: 'trop-x',
            html: `<span style="color:${tierFor(f).color}">✕</span>`,
            iconSize: [30, 30],
          }),
        }),
      }),
    ]).addTo(map);

    const present = [...new Set(areas.map(tierFor))].sort((a, b) => a.min - b.min);
    const topArea = areas[areas.length - 1];
    const boxes = [...areas, ...points].map(f => geometryBounds(f.geometry)).filter(Boolean);
    return {
      legend: present,
      top: { ...tierFor(topArea), prob: parseInt(topArea.properties.prob7day) || 0 },
      bbox: boxes.length ? [
        Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
        Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
      ] : null,
    };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
