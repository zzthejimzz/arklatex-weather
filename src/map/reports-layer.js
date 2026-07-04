// Local Storm Report markers: emoji pins ringed in the report-type color, in
// the 'reports' pane above warning polygons. The report the director is
// visiting gets an enlarged, glowing treatment (.highlighted).
import L from 'leaflet';

const MAX_MARKERS = 40; // newest first — an outbreak backlog shouldn't wallpaper the map

export function createReportsLayer(map) {
  const group = L.layerGroup().addTo(map);
  const markers = new Map(); // id → marker
  let highlightId = null;

  function update(reports, added = []) {
    const fresh = new Set(added.map(r => r.id));
    group.clearLayers();
    markers.clear();
    for (const r of reports.slice(0, MAX_MARKERS)) {
      const cls = [
        'lsr-pin',
        r.id === highlightId ? 'highlighted' : '',
        fresh.has(r.id) ? 'fresh' : '',
      ].join(' ').trim();
      const icon = L.divIcon({
        className: 'lsr-marker',
        html: `<div class="${cls}" style="--lsr-color:${r.style.color}">${r.style.icon}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const m = L.marker([r.lat, r.lon], {
        icon,
        pane: 'reports',
        interactive: false,
        keyboard: false,
      });
      markers.set(r.id, m);
      group.addLayer(m);
    }
  }

  function highlight(id) {
    highlightId = id;
    for (const [rid, m] of markers) {
      const el = m.getElement()?.querySelector('.lsr-pin');
      if (el) el.classList.toggle('highlighted', rid === id);
    }
  }

  return { update, highlight };
}
