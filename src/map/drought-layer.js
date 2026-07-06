// U.S. Drought Monitor map mode: D0–D4 fills in the official USDM colors,
// shown only while the director runs its "drought" idle stop. Lives in
// overlayPane (below the radar pane) like the SPC outlooks, so any live
// echoes read on top — rain falling on the drought area is the story. The
// ambient outlook layer is hidden while this is up (both palettes run
// yellow→orange→red and would read as one confusing blob).
import L from 'leaflet';

// Official USDM classification colors. `chip` is a readable-on-dark variant
// for chip text — D4's #730000 disappears on the broadcast chip background.
export const DM_META = [
  { dm: 0, label: 'Abnormally Dry (D0)', color: '#ffff00', chip: '#ffff54' },
  { dm: 1, label: 'Moderate Drought (D1)', color: '#fcd37f', chip: '#fcd37f' },
  { dm: 2, label: 'Severe Drought (D2)', color: '#ffaa00', chip: '#ffaa00' },
  { dm: 3, label: 'Extreme Drought (D3)', color: '#e60000', chip: '#ff4d4d' },
  { dm: 4, label: 'Exceptional Drought (D4)', color: '#730000', chip: '#ff8080' },
];

export function createDroughtLayer(map) {
  let layer = null;

  // Features arrive DM-ascending, so worse categories paint on top (USDM
  // polygons are cumulative — the D0 shape includes everything D1+).
  function show(features) {
    hide();
    if (!features.length) return null;
    layer = L.geoJSON({ type: 'FeatureCollection', features }, {
      pane: 'overlayPane',
      interactive: false,
      style: f => {
        const meta = DM_META[f.properties.DM] ?? DM_META[0];
        return {
          color: meta.color,
          weight: 1,
          opacity: 0.8,
          fillColor: meta.color,
          fillOpacity: 0.5,
        };
      },
    }).addTo(map);

    const present = [...new Set(features.map(f => f.properties.DM))].sort();
    return {
      worst: DM_META[present[present.length - 1]],
      legend: present.map(dm => DM_META[dm]),
    };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
