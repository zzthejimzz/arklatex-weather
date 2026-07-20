// Renders active alert geometries. Warnings: a black casing path under a
// solid colored outline (the dark edge keeps the line readable over radar
// cores that share its hue) + faint fill, in the 'warnings' pane; watches:
// dashed in the 'watches' pane below. The alert the director is touring gets
// a heavier, brighter treatment, and outlines thicken as the camera zooms in.
import L from 'leaflet';
import { zoomThin } from '../utils/zoom-weight.js';

export function createAlertsLayer(map) {
  const group = L.layerGroup().addTo(map);
  const rendered = new Map(); // key → { layer, casing, alert }
  const flashUntil = new Map(); // key → timestamp; survives layer rebuilds
  let highlightKey = null;

  // A 6px line that reads fine at overview looks spindly at street level
  // over bright radar — grow warning outlines as the camera gets closer.
  function zoomBoost() {
    const z = map.getZoom() ?? 0;
    return z <= 9 ? 0 : Math.min(3.5, (z - 9) * 1.1);
  }

  // ...and the same 6-8px line (a Heat Advisory county outline, say) looks
  // disproportionately heavy pulled back past its normal viewing zoom — thin
  // it below zoom 8 the same way, so the ramp shrinks below 8, holds flat
  // 8-9, then grows again above 9 via zoomBoost.
  function baseWeight(highlighted) {
    return (highlighted ? 8 : 6) * zoomThin(map) + zoomBoost();
  }

  // Watch boxes (tornado/severe t-storm/flood watch parallelograms) are big
  // enough to still read at a pulled-back convective-outlook zoom, but a flat
  // 2.5px outline looks disproportionately heavy against the shrunken
  // geometry — thin it out below zoom 8, same floor/ramp as above.
  function watchWeight() {
    return 2.5 * zoomThin(map);
  }

  function visualStyle(alert, highlighted) {
    const watch = !!alert.style.watch;
    return {
      color: alert.style.color,
      weight: watch ? watchWeight() : baseWeight(highlighted),
      opacity: 1,
      dashArray: watch ? '10 8' : null,
      fillColor: alert.style.color,
      fillOpacity: watch ? 0.06 : highlighted ? 0.18 : 0.10,
    };
  }

  function casingStyle(alert, highlighted) {
    return {
      color: '#000000',
      weight: baseWeight(highlighted) + 3.5,
      opacity: 0.85,
      fill: false,
    };
  }

  function restyle() {
    for (const { layer, casing, alert } of rendered.values()) {
      const highlighted = alert.key === highlightKey;
      layer.setStyle(visualStyle(alert, highlighted));
      casing?.setStyle(casingStyle(alert, highlighted));
    }
  }

  // During an animated zoom Leaflet scales the whole SVG pane with a CSS
  // transform and only re-projects paths at zoomend — so a 9px outline reads
  // as 40+px mid-fly. Counter-scale the stroke widths every zoom frame so the
  // apparent thickness stays steady while the camera moves; zoomend's restyle
  // then lands on the exact final weights (scale is 1 again by then).
  let paneZoom = map.getZoom(); // zoom the vector pane was last projected at
  function setStrokeWidth(group, w) {
    group.eachLayer(l => l.getElement()?.setAttribute('stroke-width', w));
  }
  function counterScale() {
    const scale = map.getZoomScale(map.getZoom(), paneZoom);
    for (const { layer, casing, alert } of rendered.values()) {
      const highlighted = alert.key === highlightKey;
      const line = alert.style.watch ? watchWeight() : baseWeight(highlighted);
      setStrokeWidth(layer, line / scale);
      if (casing) setStrokeWidth(casing, (baseWeight(highlighted) + 3.5) / scale);
    }
  }
  map.on('zoom', counterScale);
  map.on('zoomend moveend', () => { paneZoom = map.getZoom(); });

  function update(alerts) {
    group.clearLayers();
    rendered.clear();
    // Ascending score so the most severe draw last (on top within their pane).
    for (const alert of [...alerts].sort((a, b) => a.score - b.score)) {
      if (!alert.geometry) continue;
      const feature = { type: 'Feature', geometry: alert.geometry };
      const highlighted = alert.key === highlightKey;
      let casing = null;
      if (!alert.style.watch) {
        casing = L.geoJSON(feature, {
          pane: 'warnings',
          interactive: false,
          style: () => casingStyle(alert, highlighted),
        });
        group.addLayer(casing); // under the colored line
      }
      const layer = L.geoJSON(feature, {
        pane: alert.style.watch ? 'watches' : 'warnings',
        interactive: false,
        style: () => visualStyle(alert, highlighted),
      });
      group.addLayer(layer);
      rendered.set(alert.key, { layer, casing, alert });
    }
    requestAnimationFrame(() => {
      syncFlash(); // paths need to hit the DOM first
      counterScale(); // rebuilt mid-fly, the pane may be transform-scaled
    });
  }

  function highlight(key) {
    highlightKey = key;
    restyle();
    syncFlash();
  }

  map.on('zoomend', restyle);

  // Watches flash subtly while featured; a newly issued warning strobes its
  // outline white ↔ the warning color for ~10 s so the eye lands on it as the
  // camera arrives. The CSS animation reads the base color from --warn-color.
  function syncFlash() {
    const now = Date.now();
    for (const { layer, alert } of rendered.values()) {
      const watchFlash = !!alert.style.watch && alert.key === highlightKey;
      const warnFlash = (flashUntil.get(alert.key) ?? 0) > now;
      layer.eachLayer(l => {
        const el = l.getElement();
        if (!el) return;
        el.classList.toggle('watch-flash', watchFlash);
        el.classList.toggle('warn-flash', warnFlash);
        if (warnFlash) el.style.setProperty('--warn-color', alert.style.color);
      });
    }
  }

  function flash(key, ms = 10_000) {
    flashUntil.set(key, Date.now() + ms);
    syncFlash();
    setTimeout(syncFlash, ms + 100); // clear the class when the window closes
  }

  return { update, highlight, flash };
}
