// Renders active alert geometries. Warnings: solid outline + faint fill in the
// 'warnings' pane; watches: dashed in the 'watches' pane below. The alert the
// director is touring gets a heavier, brighter treatment.
import L from 'leaflet';

export function createAlertsLayer(map) {
  const group = L.layerGroup().addTo(map);
  const rendered = new Map(); // key → { layer, alert }
  const flashUntil = new Map(); // key → timestamp; survives layer rebuilds
  let highlightKey = null;

  function visualStyle(alert, highlighted) {
    const watch = !!alert.style.watch;
    return {
      color: alert.style.color,
      weight: highlighted ? 5 : watch ? 2.5 : 3.5,
      opacity: 1,
      dashArray: watch ? '10 8' : null,
      fillColor: alert.style.color,
      fillOpacity: watch ? 0.06 : highlighted ? 0.18 : 0.10,
    };
  }

  function update(alerts) {
    group.clearLayers();
    rendered.clear();
    // Ascending score so the most severe draw last (on top within their pane).
    for (const alert of [...alerts].sort((a, b) => a.score - b.score)) {
      if (!alert.geometry) continue;
      const layer = L.geoJSON(
        { type: 'Feature', geometry: alert.geometry },
        {
          pane: alert.style.watch ? 'watches' : 'warnings',
          interactive: false,
          style: () => visualStyle(alert, alert.key === highlightKey),
        },
      );
      rendered.set(alert.key, { layer, alert });
      group.addLayer(layer);
    }
    requestAnimationFrame(syncFlash); // paths need to hit the DOM first
  }

  function highlight(key) {
    highlightKey = key;
    for (const { layer, alert } of rendered.values()) {
      layer.setStyle(visualStyle(alert, alert.key === highlightKey));
    }
    syncFlash();
  }

  // Watches flash subtly while featured; a newly issued warning flashes hard
  // for a few seconds as the camera arrives so the eye lands on it.
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
      });
    }
  }

  function flash(key, ms = 4500) {
    flashUntil.set(key, Date.now() + ms);
    syncFlash();
    setTimeout(syncFlash, ms + 100); // clear the class when the window closes
  }

  return { update, highlight, flash };
}
