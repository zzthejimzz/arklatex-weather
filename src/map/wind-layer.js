// Wind & gusts map mode: a chip per observation station with the sustained
// wind (in a Beaufort-style color ramp), a flow-direction arrow, and the gust
// when it's meaningfully above the sustained speed. Shown only while the
// director runs its "wind" idle stop. Shares the temps pane + chip styling —
// the two modes never air at once, so the pane is free to reuse.
import L from 'leaflet';

// Wind speed → color, calm→extreme. Thresholds track the familiar TV/Beaufort
// bands and the NWS advisory levels: yellow around a Wind Advisory (~30 mph
// gusts), red at High Wind Warning strength (~58 mph).
const RAMP = [
  [7, '#7a8aa0'],   // calm — muted slate
  [14, '#38bdf8'],  // light
  [21, '#2dd4a8'],  // gentle
  [29, '#a3d34e'],  // breezy
  [38, '#f5c33b'],  // windy (advisory-ish)
  [46, '#f08c1d'],  // strong
  [57, '#e23c3c'],  // damaging (warning-ish)
  [Infinity, '#c026d3'], // extreme
];

export function windColor(mph) {
  for (const [max, color] of RAMP) if (mph <= max) return color;
  return RAMP[RAMP.length - 1][1];
}

// A gust only earns its own line when it runs a few mph clear of the sustained
// wind — otherwise the two numbers just restate each other.
const GUST_MARGIN = 3;

// Navigation-style arrow pointing "up" (north); rotated to the direction the
// wind is blowing *toward*, so the barb flies with the wind — the read most
// intuitive for a general audience.
const ARROW = '<svg class="wind-arrow" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 3 18 18 12 14 6 18Z" fill="currentColor"/></svg>';

export function createWindLayer(map) {
  const group = L.layerGroup();
  let visible = false;

  function setLabelPanes(display) {
    for (const pane of ['cities', 'labels']) {
      const el = map.getPane(pane);
      if (el) el.style.display = display;
    }
  }

  function show(obs) {
    group.clearLayers();
    for (const o of obs) {
      if (o.windMph == null) continue;
      const gusting = o.gustMph != null && o.gustMph >= o.windMph + GUST_MARGIN;
      const color = windColor(gusting ? o.gustMph : o.windMph);
      const calm = o.windMph === 0;
      // Arrow flies toward where the wind is going (from-direction + 180);
      // dropped when calm or when the ob carries no direction.
      const arrow = calm || o.windDir == null
        ? ''
        : `<span class="wind-dir" style="transform:rotate(${(o.windDir + 180) % 360}deg)">${ARROW}</span>`;
      const value = calm
        ? '<b>calm</b>'
        : `<b style="color:${color}">${arrow}${o.windMph}<small>mph</small></b>`;
      const sub = gusting
        ? `<span><b class="wg">G ${o.gustMph}</b> · ${o.city}</span>`
        : `<span>${o.city}</span>`;
      group.addLayer(
        L.marker([o.lat, o.lon], {
          pane: 'temps',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'temp-anchor',
            html: `<div class="temp-chip wind-chip">${value}${sub}</div>`,
            iconSize: [0, 0],
          }),
        }),
      );
    }
    group.addTo(map);
    setLabelPanes('none');
    visible = true;
  }

  function hide() {
    if (!visible) return;
    visible = false;
    group.remove();
    group.clearLayers(); // divIcon DOM shouldn't outlive the mode
    setLabelPanes('');
  }

  return { show, hide };
}
