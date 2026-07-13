// Current-temperatures map mode: a chip per observation station with the
// temp (or feels-like value) in a classic broadcast color ramp + the town
// name. Shown only while the director runs its "temps" / "feels" idle stops.
// City-label panes are hidden while active — the chips carry their own
// names, and doubled labels read sloppy.
import L from 'leaflet';

// Temp → color, the familiar TV ramp: purples ice-cold, blues cold, greens
// mild, yellow warm, orange hot, red scorching.
const RAMP = [
  [20, '#a78bfa'],
  [32, '#60a5fa'],
  [45, '#38bdf8'],
  [59, '#2dd4a8'],
  [71, '#a3d34e'],
  [83, '#f5c33b'],
  [93, '#f08c1d'],
  [Infinity, '#e23c3c'],
];

export function tempColor(f) {
  for (const [max, color] of RAMP) if (f <= max) return color;
  return RAMP[RAMP.length - 1][1];
}

export function createTempsLayer(map) {
  const group = L.layerGroup();
  let visible = false;

  function setLabelPanes(display) {
    for (const pane of ['cities', 'labels']) {
      const el = map.getPane(pane);
      if (el) el.style.display = display;
    }
  }

  // `key` picks which reading the chips plot: 'tempF' (default) or 'feelsF'
  // for the feels-like mode — same ramp, the scale means the same thing.
  function show(obs, key = 'tempF') {
    group.clearLayers();
    for (const o of obs) {
      const v = o[key];
      if (v == null) continue;
      group.addLayer(
        L.marker([o.lat, o.lon], {
          pane: 'temps',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'temp-anchor',
            html: `
              <div class="temp-chip">
                <b style="color:${tempColor(v)}">${v}°</b>
                <span>${o.city}</span>
              </div>`,
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
