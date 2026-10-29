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

  // Zone-based alerts built from the same UGC list come out as *identical*
  // polygons (SHV routinely pairs a Red Flag Warning with a Wind Advisory over
  // the exact same zones) — the top one's outline buries the other entirely.
  // Those get a candy-stripe instead: each member draws only every n-th dash,
  // offset so the colors alternate along the shared boundary. The twin the
  // director is touring drops its stripe and draws solid on top, so the shot
  // reads as that one alert.
  function stripeLen() {
    return 22 * zoomThin(map) + zoomBoost() * 2;
  }
  function stripeDash(stripe, highlighted) {
    if (!stripe || highlighted) return null;
    const s = stripeLen();
    return { dashArray: `${s} ${s * (stripe.n - 1)}`, dashOffset: `${s * stripe.i}` };
  }
  // Cheap identity for "same shape": bounds + vertex count. Identical zone
  // unions match exactly; distinct storm polygons essentially never do.
  function geomFingerprint(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let verts = 0, w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
      verts++;
      if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    }
    return `${geometry.type}|${verts}|${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}`;
  }

  function visualStyle(alert, highlighted, stripe) {
    const watch = !!alert.style.watch;
    const dash = stripeDash(stripe, highlighted);
    return {
      color: alert.style.color,
      weight: watch ? watchWeight() : baseWeight(highlighted),
      opacity: 1,
      dashArray: dash ? dash.dashArray : watch ? '10 8' : null,
      dashOffset: dash ? dash.dashOffset : null,
      lineCap: dash ? 'butt' : 'round',
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
    for (const { layer, casing, alert, stripe } of rendered.values()) {
      const highlighted = alert.key === highlightKey;
      layer.setStyle(visualStyle(alert, highlighted, stripe));
      casing?.setStyle(casingStyle(alert, highlighted));
    }
  }

  // No per-frame stroke work during animated zooms: Leaflet only CSS-scales
  // the SVG panes mid-flight, so both alert panes sit the glide out under the
  // flight veil (map/flight-veil.js) and zoomend's restyle lands the final
  // weights before they fade back in.

  function update(alerts) {
    group.clearLayers();
    rendered.clear();
    // Ascending score so the most severe draw last (on top within their pane).
    const drawn = [...alerts].filter(a => a.geometry).sort((a, b) => a.score - b.score);
    const twins = new Map(); // fingerprint → alerts sharing that exact shape
    for (const alert of drawn) {
      const fp = `${alert.style.watch ? 'W' : 'X'}|${geomFingerprint(alert.geometry)}`;
      if (!twins.has(fp)) twins.set(fp, []);
      twins.get(fp).push(alert);
    }
    const stripes = new Map(); // alert.key → { i, n }
    for (const group of twins.values()) {
      // Same color twice (two Wind Advisory segments, say) gains nothing.
      if (new Set(group.map(a => a.style.color)).size < 2) continue;
      group.forEach((a, i) => stripes.set(a.key, { i, n: group.length }));
    }
    for (const alert of drawn) {
      const feature = { type: 'Feature', geometry: alert.geometry };
      const highlighted = alert.key === highlightKey;
      const stripe = stripes.get(alert.key) ?? null;
      let casing = null;
      // One casing per striped group — a later twin's casing would black out
      // the earlier twin's dashes underneath it.
      if (!alert.style.watch && !(stripe?.i > 0)) {
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
        style: () => visualStyle(alert, highlighted, stripe),
      });
      group.addLayer(layer);
      rendered.set(alert.key, { layer, casing, alert, stripe });
    }
    const toured = rendered.get(highlightKey);
    if (toured?.stripe) toured.layer.bringToFront(); // rebuilt mid-tour: keep it on top
    requestAnimationFrame(syncFlash); // paths need to hit the DOM first
  }

  function highlight(key) {
    highlightKey = key;
    restyle();
    const toured = rendered.get(key);
    if (toured?.stripe) toured.layer.bringToFront(); // solid twin over the striped one(s)
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

  // Product-map shots (SPC/WPC/CPC outlooks, drought, tropical) want a clean
  // frame — hide both alert panes outright. Pane-level so update() keeps
  // rebuilding underneath and the polygons are current the moment they return.
  function setHidden(h) {
    for (const name of ['warnings', 'watches']) {
      const pane = map.getPane(name);
      if (pane) pane.style.display = h ? 'none' : '';
    }
  }

  return { update, highlight, flash, setHidden };
}
