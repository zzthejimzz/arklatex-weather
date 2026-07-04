// Broadcast map: grey "Pivotal-style" basemap (same recipe as the Website
// outlooks map) + label/state/data panes. All user interaction is disabled —
// a stray mouse during capture must not move the camera.
//
// CARTO dark tiles are remapped to grey by the `.grey-basemap` CSS filter in
// broadcast.css (land ~#595959, water ~#191919 — derived from actual tile
// pixel values; don't change without re-deriving). The filter hits only the
// default tile pane; labels/radar live in custom panes so they stay unfiltered.
//
// Pane stack (bottom → top):
//   tilePane 200      CARTO dark_nolabels (grey-filtered)
//   overlayPane 400   SPC outlook fills
//   radar 450         NEXRAD loop frames (normal blend over the grey base)
//   states 455        white state borders
//   mcd 458           mesoscale discussions (dashed)
//   watches 460       watch outlines
//   warnings 465      warning polygons
//   cities 640        curated city labels
//   labels 650        CARTO dark_only_labels
import L from 'leaflet';

const CARTO_ATTR = '&copy; OSM &copy; CARTO &middot; Radar: Iowa State Mesonet / NEXRAD';
const MAX_ZOOM = 12;

const PANES = {
  radar: 450,
  states: 455,
  mcd: 458,
  watches: 460,
  warnings: 465,
  cities: 640,
  labels: 650,
};

export function createBroadcastMap(el, bbox) {
  const map = L.map(el, {
    zoomControl: false,
    zoomSnap: 0,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    inertia: false,
  });
  map.getContainer().classList.add('grey-basemap');

  for (const [name, z] of Object.entries(PANES)) {
    map.createPane(name);
    const pane = map.getPane(name);
    pane.style.zIndex = z;
    pane.style.pointerEvents = 'none';
  }

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: CARTO_ATTR,
    subdomains: 'abcd',
    maxZoom: MAX_ZOOM,
  }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    pane: 'labels',
    subdomains: 'abcd',
    maxZoom: MAX_ZOOM,
  }).addTo(map);

  map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
  return map;
}

export async function addStateBorders(map) {
  try {
    const res = await fetch('/geo/us-states.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const states = await res.json();
    L.geoJSON(states, {
      pane: 'states',
      interactive: false,
      style: { color: '#ffffff', weight: 1.5, opacity: 0.75, fill: false },
    }).addTo(map);
  } catch (err) {
    console.warn('[basemap] state borders unavailable:', err);
  }
}
