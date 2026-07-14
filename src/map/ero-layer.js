// WPC excessive rainfall outlook map mode: Marginal→High flash-flood risk
// fills, shown only while the director runs its "ero" idle stop. Lives in
// overlayPane (below the radar pane) like the other risk fills — live echoes
// falling inside the risk area are the story. The ambient convective outlook
// is hidden while this is up: both palettes run green→yellow→red.
import L from 'leaflet';

// WPC's official category colors (their own legend table). Keyed by the
// geojson's `dn` field. `chip` is a readable-on-dark variant for chip text.
export const ERO_META = {
  1: { order: 1, label: 'Marginal', prob: 'at least 5%',  color: '#00ff00', chip: '#4dff4d' },
  2: { order: 2, label: 'Slight',   prob: 'at least 15%', color: '#ffd700', chip: '#ffd700' },
  3: { order: 3, label: 'Moderate', prob: 'at least 40%', color: '#ee2c2c', chip: '#ff4d4d' },
  4: { order: 4, label: 'High',     prob: 'at least 70%', color: '#ff00ff', chip: '#ff80ff' },
};

export function createEroLayer(map) {
  let layer = null;

  // Draws every feature in the product (the wide shot benefits from the full
  // multi-state picture); the director gates the shot on local overlap.
  function show(features) {
    hide();
    if (!features.length) return null;
    // dn ascending, so worse categories paint on top (areas are nested —
    // the Marginal shape surrounds everything Slight+).
    const sorted = [...features].sort(
      (a, b) => ERO_META[a.properties.dn].order - ERO_META[b.properties.dn].order);
    layer = L.geoJSON({ type: 'FeatureCollection', features: sorted }, {
      pane: 'overlayPane',
      interactive: false,
      style: f => {
        const meta = ERO_META[f.properties.dn];
        return {
          color: meta.color,
          weight: 1.5,
          opacity: 0.9,
          fillColor: meta.color,
          fillOpacity: 0.45,
        };
      },
    }).addTo(map);

    const present = [...new Set(sorted.map(f => f.properties.dn))]
      .sort((a, b) => ERO_META[a].order - ERO_META[b].order);
    return { legend: present.map(dn => ERO_META[dn]) };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
