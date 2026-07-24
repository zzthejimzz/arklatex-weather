// A single labeled dot + sonar ring on the town the precip scout is tracking
// ("Tracking precipitation near Winnfield"). The POI shot zooms tighter than
// the curated city labels' band, so the map would otherwise land nameless —
// this restores a named anchor and gives the tracked town the same pulsing
// ring a visited storm report gets. Lives in the 'reports' pane, above the
// warning polygons. Fully DOM-driven, so it doesn't depend on the GL basemap
// painting a label at that spot on the software renderer.
import L from 'leaflet';

export function createPrecipFocusLayer(map) {
  const group = L.layerGroup().addTo(map);

  // place = { name, lat, lon } — the TOWN, not the echo centroid.
  function show(place) {
    group.clearLayers();
    if (!place) return;
    const icon = L.divIcon({
      className: 'precip-focus-marker',
      html: `<div class="precip-focus"><span class="pf-dot"></span><span class="pf-name">${place.name}</span></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    L.marker([place.lat, place.lon], {
      icon,
      pane: 'reports',
      interactive: false,
      keyboard: false,
    }).addTo(group);
  }

  function hide() {
    group.clearLayers();
  }

  return { show, hide };
}
