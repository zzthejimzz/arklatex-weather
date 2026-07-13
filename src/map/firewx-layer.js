// SPC fire weather outlook map mode: Elevated/Critical/Extremely Critical
// fills, shown only while the director runs its "firewx" idle stop. Lives in
// overlayPane (below the radar pane) like the other risk fills. The ambient
// convective outlook is hidden while this is up — both palettes run through
// orange/red and would read as one blob.
import L from 'leaflet';

// SPC's outline colors (the geojson's own `fill` values are too pale for the
// dark broadcast basemap). `chip` is a readable-on-dark variant for chip text.
export const FIRE_META = {
  ELEV: { order: 1, label: 'Elevated',           color: '#ff7f00', chip: '#ffa64d' },
  CRIT: { order: 2, label: 'Critical',           color: '#ff0000', chip: '#ff4d4d' },
  EXTM: { order: 3, label: 'Extremely Critical', color: '#ff00ff', chip: '#ff80ff' },
};

export function createFireWxLayer(map) {
  let layer = null;

  // Draws every feature in the product (the wide shot benefits from the full
  // multi-state picture); the director gates the shot on local overlap.
  function show(features) {
    hide();
    if (!features.length) return null;
    const sorted = [...features].sort(
      (a, b) => FIRE_META[a.properties.LABEL].order - FIRE_META[b.properties.LABEL].order);
    layer = L.geoJSON({ type: 'FeatureCollection', features: sorted }, {
      pane: 'overlayPane',
      interactive: false,
      style: f => {
        const meta = FIRE_META[f.properties.LABEL];
        return {
          color: meta.color,
          weight: 1.5,
          opacity: 0.9,
          fillColor: meta.color,
          fillOpacity: 0.45,
        };
      },
    }).addTo(map);

    const present = [...new Set(sorted.map(f => f.properties.LABEL))]
      .sort((a, b) => FIRE_META[a].order - FIRE_META[b].order);
    return { legend: present.map(l => FIRE_META[l]) };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
