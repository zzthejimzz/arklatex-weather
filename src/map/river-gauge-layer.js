// NWS/NOAA river gauge flood status: colored pins at stream gauges running
// action stage or above, or unusually low. Lives in overlayPane like the
// other quiet-day water stories (drought, ERO) — these are point readings,
// not fills, so they sit fine over the ambient outlook without hiding it.
import L from 'leaflet';
import { icon } from '../ui/icons.js';

// AHPS' own flood-category colors (their national map legend): yellow →
// orange → red → purple as stage rises. Low water reuses the drought-monitor
// tan since it's the same "dry" story, not a flood one. `chip` is a
// readable-on-dark variant for chip text.
// Icons escalate by shape too (STYLE_GUIDE.md §11): cracked drop → empty
// drop → one band → two bands → solid + alert mark, so stage stays legible
// even where the ring hue doesn't register (downscaling, color-blindness,
// stream compression banding).
export const RIVER_META = {
  low_threshold: { order: 0, label: 'Low Water',       icon: icon('river-low'),      color: '#c9a227', chip: '#e0c168' },
  action:        { order: 1, label: 'Action Stage',    icon: icon('river-action'),   color: '#ffe066', chip: '#fff0a3' },
  minor:         { order: 2, label: 'Minor Flooding',  icon: icon('river-minor'),    color: '#ffa500', chip: '#ffc266' },
  moderate:      { order: 3, label: 'Moderate Flooding', icon: icon('river-moderate'), color: '#ff3b3b', chip: '#ff8080' },
  major:         { order: 4, label: 'Major Flooding',  icon: icon('river-major'),    color: '#c724ff', chip: '#e29bff' },
};

export function createRiverGaugeLayer(map) {
  const group = L.layerGroup().addTo(map);

  // `highlightLid` marks the station driving the shot (the one named in the
  // chip text) with a pulsing-ring pin, same treatment as a visited LSR pin.
  function show(gauges, highlightLid = null) {
    hide();
    if (!gauges.length) return null;
    for (const g of gauges) {
      const meta = RIVER_META[g.category];
      if (!meta) continue;
      const cls = g.lid === highlightLid ? 'river-pin highlighted' : 'river-pin';
      const icon = L.divIcon({
        className: 'river-marker',
        html: `<div class="${cls}" style="--river-color:${meta.color}">${meta.icon}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      group.addLayer(L.marker([g.lat, g.lon], {
        icon,
        pane: 'reports',
        interactive: false,
        keyboard: false,
      }));
    }
    const present = [...new Set(gauges.map(g => g.category))]
      .sort((a, b) => RIVER_META[a].order - RIVER_META[b].order);
    return { legend: present.map(c => RIVER_META[c]) };
  }

  function hide() {
    group.clearLayers();
  }

  return { show, hide };
}
