// Pollen-index map mode: a chip per climate city with its 0–12 IQVIA index
// in the category color + the city name — the regional intensity picture
// that rides beside the panel's single-city pollen card. Modeled on the
// temps chips: city-label panes hide while active (the chips carry their
// own names), and the shared 'temps' pane keeps them above the fills.
import L from 'leaflet';

export function createPollenLayer(map) {
  const group = L.layerGroup();
  let visible = false;

  function setLabelPanes(display) {
    for (const pane of ['cities', 'labels']) {
      const el = map.getPane(pane);
      if (el) el.style.display = display;
    }
  }

  function show(cities) {
    group.clearLayers();
    for (const c of cities) {
      group.addLayer(
        L.marker([c.lat, c.lon], {
          pane: 'temps',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'temp-anchor',
            html: `
              <div class="temp-chip pollen-chip" style="--pollen-color:${c.color}">
                <b style="color:${c.color}">${c.index.toFixed(1)}</b>
                <span>${c.name}</span>
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
