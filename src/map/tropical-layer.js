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

  const unionBoxes = boxes => boxes.length ? [
    Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
    Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
  ] : null;

  // Areas arrive sorted by formation chance ascending (likelier on top).
  // Returns the legend, the headline area (highest 7-day chance) and the
  // union bbox of everything drawn, for the director's framing. With a
  // focusIdx (the per-disturbance shot), that area draws full-strength while
  // the others dim to context, and `focus` carries its details + own bbox.
  function show({ areas, points }, focusIdx = null) {
    hide();
    if (!areas.length) return null;
    const focused = focusIdx != null ? areas[focusIdx] ?? null : null;

    // The ✕ points carry no id linking them to their development area —
    // pair each with the nearest area center so a focused shot can dim the
    // other disturbances' markers and frame its own.
    const centers = areas.map(a => {
      const b = geometryBounds(a.geometry);
      return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
    });
    const areaOf = f => {
      const [x, y] = f.geometry.coordinates;
      let best = null, bd = Infinity;
      centers.forEach((c, i) => {
        if (!c) return;
        const d2 = (c[0] - x) ** 2 + (c[1] - y) ** 2;
        if (d2 < bd) { bd = d2; best = areas[i]; }
      });
      return best;
    };

    layer = L.layerGroup([
      L.geoJSON({ type: 'FeatureCollection', features: areas }, {
        pane: 'overlayPane',
        interactive: false,
        style: f => {
          const meta = tierFor(f);
          const dim = focused && f !== focused;
          return {
            color: meta.color,
            weight: dim ? 1.5 : focused ? 3 : 2,
            opacity: dim ? 0.45 : 0.9,
            dashArray: '8 6',
            fillColor: meta.color,
            fillOpacity: dim ? 0.12 : focused ? 0.35 : 0.3,
          };
        },
      }),
      L.geoJSON({ type: 'FeatureCollection', features: points }, {
        interactive: false,
        pointToLayer: (f, latlng) => L.marker(latlng, {
          interactive: false,
          icon: L.divIcon({
            className: 'trop-x',
            html: `<span style="color:${tierFor(f).color}${focused && areaOf(f) !== focused ? ';opacity:0.35' : ''}">✕</span>`,
            iconSize: [30, 30],
          }),
        }),
      }),
    ]).addTo(map);

    const present = [...new Set(areas.map(tierFor))].sort((a, b) => a.min - b.min);
    const topArea = areas[areas.length - 1];
    let focus = null;
    if (focused) {
      const own = [focused, ...points.filter(f => areaOf(f) === focused)]
        .map(f => geometryBounds(f.geometry)).filter(Boolean);
      focus = {
        ...tierFor(focused),
        prob7: parseInt(focused.properties.prob7day) || 0,
        prob2: parseInt(focused.properties.prob2day) || 0,
        bbox: unionBoxes(own),
      };
    }
    return {
      legend: present,
      top: { ...tierFor(topArea), prob: parseInt(topArea.properties.prob7day) || 0 },
      focus,
      bbox: unionBoxes([...areas, ...points].map(f => geometryBounds(f.geometry)).filter(Boolean)),
    };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
