// Curated ArkLaTex place list. Two jobs:
//   1. Render town labels with zoom tiers (tier 2 mid zoom, tier 3 warning
//      zoom) so places near a warning are readable on air. Tier 1 majors are
//      NOT rendered — CARTO's label tiles already show them at every zoom we
//      use, and doubling looks broken.
//   2. Name things ("Tracking showers near Marshall") via nearestPlace().
import L from 'leaflet';

export const PLACES = [
  // [name, lat, lon, tier]
  ['Shreveport',      32.525, -93.750, 1],
  ['Texarkana',       33.425, -94.048, 1],
  ['Longview',        32.500, -94.740, 1],
  ['Tyler',           32.351, -95.301, 1],
  ['Monroe',          32.510, -92.119, 1],
  ['Lufkin',          31.338, -94.729, 1],

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

// Curated labels only fill the zoom band where CARTO's label tiles are sparse
// (overview). From fractional zoom ~8.5 CARTO renders z9 tiles which label
// most towns — curated labels there just double them, so they cut off at 8.45.
const TIER_ZOOM = { 2: [6.5, 8.45], 3: [7.6, 8.45] }; // tier 1 never rendered

export function addCityLabels(map) {
  const markers = PLACES.filter(([, , , tier]) => TIER_ZOOM[tier]).map(
    ([name, lat, lon, tier]) => ({
      tier,
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

  const sync = () => {
    const z = map.getZoom();
    for (const { tier, marker } of markers) {
      const [lo, hi] = TIER_ZOOM[tier];
      const show = z >= lo && z < hi;
      if (show && !map.hasLayer(marker)) marker.addTo(map);
      else if (!show && map.hasLayer(marker)) marker.remove();
    }
  };
  map.on('zoomend', sync);
  sync();
}

export function nearestPlace(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const [name, plat, plon] of PLACES) {
    const d = (plat - lat) ** 2 + (plon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}
