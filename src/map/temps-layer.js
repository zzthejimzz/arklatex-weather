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

// Dew-point → color for the "muggy meter" mode. Not the temperature ramp: dew
// point reads on its own comfort scale, dry (cool blue/green) climbing to the
// oppressive Gulf air (red → magenta), so the chips shout the mugginess.
const DEW_RAMP = [
  [49, '#38bdf8'],       // dry — sky blue
  [54, '#2dd4a8'],       // pleasant — teal
  [59, '#a3d34e'],       // comfortable — green
  [64, '#f5c33b'],       // getting sticky — yellow
  [69, '#f08c1d'],       // uncomfortable — orange
  [74, '#e23c3c'],       // oppressive — red
  [Infinity, '#c026d3'], // miserable — magenta
];

export function dewColor(f) {
  for (const [max, color] of DEW_RAMP) if (f <= max) return color;
  return DEW_RAMP[DEW_RAMP.length - 1][1];
}

// CSS gradient of the ramp across [lo, hi] with hard stops — the ramp is
// banded, not interpolated, so the scale strip shows the same discrete
// colors the chips do (the almanac's record-span meter uses this).
export function rampGradient(lo, hi) {
  const pct = t => Math.max(0, Math.min(100, ((t - lo) / (hi - lo || 1)) * 100));
  const stops = [];
  let from = 0;
  for (const [max, color] of RAMP) {
    const to = max === Infinity ? 100 : pct(max);
    if (to > from) {
      stops.push(`${color} ${from.toFixed(1)}% ${to.toFixed(1)}%`);
      from = to;
    }
    if (from >= 100) break;
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
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

  // `key` picks which reading the chips plot: 'tempF' (default), 'feelsF' for
  // the feels-like mode (same temperature ramp — the scale means the same
  // thing), or 'dewF' with `colorFn=dewColor` for the muggy-meter mode.
  function show(obs, key = 'tempF', colorFn = tempColor) {
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
                <b style="color:${colorFn(v)}">${v}°</b>
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
