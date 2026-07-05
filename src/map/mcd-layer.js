// SPC Mesoscale Discussion outlines. An MCD is a heads-up that SPC is watching
// an area (often the precursor to a watch) — on air it reads as a plain dashed
// outline, no fill and no heavy stroke, so it never competes with warning or
// watch polygons. The one the director is touring brightens/thickens slightly.
//
// Polling + text enrichment live in data/mcd.js; this module only draws.
import L from 'leaflet';

// Cool cyan reads as "informational" against the red/yellow warning palette.
// Shared with the detail card (ui/warning-popup.js).
export const MCD_COLOR = '#22d3ee';

const BASE = {
  pane: 'mcd',
  interactive: false,
  color: MCD_COLOR,
  weight: 2,
  opacity: 0.8,
  dashArray: '7 6',
  fill: false,
};
const HIGHLIGHT = { ...BASE, weight: 3, opacity: 1, dashArray: '9 5' };

export function createMcdLayer(map) {
  const group = L.layerGroup().addTo(map);
  const sublayers = new Map(); // key → L.geoJSON
  let highlightKey = null;

  function styleFor(key) {
    return key === highlightKey ? HIGHLIGHT : BASE;
  }

  function update(mcds) {
    group.clearLayers();
    sublayers.clear();
    for (const m of mcds) {
      if (!m.geometry) continue;
      const gl = L.geoJSON(
        { type: 'Feature', geometry: m.geometry, properties: {} },
        styleFor(m.key),
      );
      sublayers.set(m.key, gl);
      group.addLayer(gl);
    }
  }

  function highlight(key) {
    highlightKey = key;
    for (const [k, gl] of sublayers) gl.setStyle(styleFor(k));
  }

  return { update, highlight };
}
