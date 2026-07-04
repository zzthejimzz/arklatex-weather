// Curated ArkLaTex place list. Two jobs:
//   1. Own ALL place labels in the overview zoom band (< Leaflet 8.45) —
//      tier 0 out-of-region anchors, tier 1 in-region majors, tiers 2/3
//      progressively smaller towns. The vector basemap's GL labels take over
//      from 8.45 (LABEL_MINZOOM in vector-basemap.js); GL can't collision-
//      avoid DOM markers, so the two must never share a zoom band. State
//      capitals (Little Rock, Jackson, …) are GL-labeled at every zoom —
//      never add them here.
//   2. Name things ("Tracking showers near Marshall") via nearestPlace().
import L from 'leaflet';

export const PLACES = [
  // [name, lat, lon, tier]
  // tier 0 — out-of-region context anchors (overview framing only).
  // Excluded from nearestPlace so tours never say "near Dallas".
  ['Dallas',          32.777, -96.797, 0],
  ['Fort Worth',      32.755, -97.331, 0],
  ['Waco',            31.549, -97.147, 0],
  ['Sherman',         33.635, -96.609, 0],
  ['Ardmore',         34.174, -97.144, 0],
  ['Hot Springs',     34.504, -93.055, 0],
  ['Pine Bluff',      34.228, -92.003, 0],
  ['Greenville',      33.410, -91.062, 0],
  ['Alexandria',      31.311, -92.445, 0],

  // Within a tier, order = priority when labels collide at wide zooms.
  ['Shreveport',      32.525, -93.750, 1],
  ['Texarkana',       33.425, -94.048, 1],
  ['Tyler',           32.351, -95.301, 1],
  ['Monroe',          32.510, -92.119, 1],
  ['Lufkin',          31.338, -94.729, 1],
  ['Longview',        32.500, -94.740, 1],

  ['Marshall',        32.545, -94.367, 2],
  ['Nacogdoches',     31.603, -94.655, 2],
  ['Ruston',          32.523, -92.638, 2],
  ['Natchitoches',    31.760, -93.086, 2],
  ['El Dorado',       33.208, -92.666, 2],
  ['Magnolia',        33.267, -93.239, 2],
  ['Camden',          33.585, -92.834, 2],
  ['Hope',            33.667, -93.591, 2],
  ['Paris',           33.661, -95.556, 2],
  ['Mount Pleasant',  33.157, -94.968, 2],
  ['Sulphur Springs', 33.138, -95.601, 2],
  ['Idabel',          33.896, -94.826, 2],
  ['De Queen',        34.038, -94.341, 2],
  ['Mena',            34.586, -94.240, 2],
  ['Kilgore',         32.386, -94.876, 2],
  ['Henderson',       32.153, -94.799, 2],
  ['Palestine',       31.762, -95.631, 2],
  ['Minden',          32.615, -93.287, 2],

  ['Broken Bow',      34.029, -94.739, 3],
  ['Ashdown',         33.674, -94.131, 3],
  ['Nashville',       33.946, -93.847, 3],
  ['Gilmer',          32.729, -94.942, 3],
  ['Atlanta',         33.114, -94.164, 3],
  ['Jefferson',       32.757, -94.345, 3],
  ['Carthage',        32.157, -94.337, 3],
  ['Center',          31.795, -94.179, 3],
  ['Jacksonville',    31.964, -95.270, 3],
  ['Coushatta',       32.015, -93.342, 3],
  ['Many',            31.569, -93.484, 3],
  ['Winnfield',       31.926, -92.641, 3],
  ['Jonesboro',       32.241, -92.716, 3],
  ['Arcadia',         32.549, -92.920, 3],
  ['Homer',           32.792, -93.056, 3],
  ['Springhill',      33.006, -93.467, 3],
  ['Farmerville',     32.773, -92.406, 3],
  ['Bastrop',         32.778, -91.911, 3],
  ['Vivian',          32.871, -93.987, 3],
];

// Curated labels only fill the overview zoom band. From Leaflet 8.45 the
// vector basemap's city/town/village labels take over (LABEL_MINZOOM in
// map/vector-basemap.js is pinned to GL 7.45 = Leaflet 8.45 — keep in sync),
// so curated labels cut off there to avoid doubling.
const TIER_ZOOM = { 0: [0, 8.45], 1: [0, 8.45], 2: [6.5, 8.45], 3: [7.6, 8.45] };

// Estimated on-screen label box (px): dot + gap + text at the tier's font
// size. Used only for collision math — a few px off is fine.
const TIER_CHAR_W = { 0: 6.6, 1: 8.2, 2: 7.2, 3: 6.1 };
const LABEL_H = 22;
const GAP = 4; // required breathing room between boxes

export function addCityLabels(map) {
  const entries = PLACES.filter(([, , , tier]) => TIER_ZOOM[tier]).map(
    ([name, lat, lon, tier], idx) => ({
      name,
      lat,
      lon,
      tier,
      idx,
      w: name.length * TIER_CHAR_W[tier] + 18,
      marker: L.marker([lat, lon], {
        pane: 'cities',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'city-anchor',
          html: `<div class="city-label tier-${tier}">${name}</div>`,
          iconSize: [0, 0],
        }),
      }),
    }),
  );

  // Higher tiers win collisions; within a tier, PLACES order wins. In-region
  // majors (1) beat out-of-region anchors (0) — the region is the story.
  const PRIORITY = { 1: 0, 2: 1, 3: 2, 0: 3 };
  const byPriority = entries
    .slice()
    .sort((a, b) => PRIORITY[a.tier] - PRIORITY[b.tier] || a.idx - b.idx);

  const sync = () => {
    const z = map.getZoom();
    // Greedy collision cull: place labels in priority order, hide any whose
    // box overlaps an already-placed one. Overlap geometry only depends on
    // zoom (relative pixel distances are pan-invariant), so zoomend suffices.
    const placed = [];
    for (const e of byPriority) {
      const [lo, hi] = TIER_ZOOM[e.tier];
      let show = z >= lo && z < hi;
      if (show) {
        const p = map.latLngToContainerPoint([e.lat, e.lon]);
        const box = { x1: p.x, y1: p.y - LABEL_H, x2: p.x + e.w, y2: p.y };
        show = !placed.some(
          (r) =>
            r.x1 < box.x2 + GAP && box.x1 < r.x2 + GAP &&
            r.y1 < box.y2 + GAP && box.y1 < r.y2 + GAP,
        );
        if (show) placed.push(box);
      }
      if (show && !map.hasLayer(e.marker)) e.marker.addTo(map);
      else if (!show && map.hasLayer(e.marker)) e.marker.remove();
    }
  };
  map.on('zoomend', sync);
  sync();
}

export function nearestPlace(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const [name, plat, plon, tier] of PLACES) {
    if (tier === 0) continue; // anchors are outside the region
    const d = (plat - lat) ** 2 + (plon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}
