// Broadcast map: grey "Pivotal-style" basemap + label/state/data panes. All
// user interaction is disabled — a stray mouse during capture must not move
// the camera.
//
// The base is OpenFreeMap vector tiles rendered by MapLibre GL (see
// map/vector-basemap.js): grey land/water plus a labels-only GL layer in the
// `labels` pane so names stay above radar. If the style fetch fails the map
// falls back to the old CARTO raster stack (grey CSS filter + label tiles) —
// a 24/7 stream can't sit on a blank map.
//
// Pane stack (bottom → top):
//   tilePane 200      vector base, grey (fallback: CARTO dark, grey-filtered)
//   overlayPane 400   SPC outlook fills
//   radar 450         NEXRAD loop frames (normal blend over the grey base)
//   states 455        white state borders
//   mcd 458           mesoscale discussions (dashed)
//   watches 460       watch outlines
//   warnings 465      warning polygons
//   reports 470       local storm report pins
//   cities 640        curated city labels
//   labels 650        vector labels (fallback: CARTO dark_only_labels)
import L from 'leaflet';
import { addVectorBasemap } from './vector-basemap.js';

const ATTR =
  '&copy; OpenStreetMap &middot; OpenFreeMap &middot; Radar: Iowa State Mesonet / NEXRAD';
const MAX_ZOOM = 14;

const PANES = {
  radar: 450,
  states: 455,
  mcd: 458,
  watches: 460,
  warnings: 465,
  reports: 470,
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
    attributionControl: true,
  });
  map.attributionControl.addAttribution(ATTR);

  for (const [name, z] of Object.entries(PANES)) {
    map.createPane(name);
    const pane = map.getPane(name);
    pane.style.zIndex = z;
    pane.style.pointerEvents = 'none';
  }

  map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);

  addVectorBasemap(map).catch((err) => {
    console.warn('[basemap] vector style unavailable, falling back to CARTO raster:', err);
    addRasterFallback(map);
  });

  return map;
}

// Legacy CARTO raster stack. Non-commercial tiles — acceptable only as an
// emergency fallback. The grey look comes from the `.grey-basemap` CSS filter
// in broadcast.css; labels swap to @2x retina tiles at z8.5 so text renders
// twice as large when the camera is deep in a warning.
function addRasterFallback(map) {
  map.getContainer().classList.add('grey-basemap');

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: MAX_ZOOM,
  }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png', {
    pane: 'labels',
    subdomains: 'abcd',
    maxZoom: 8.5,
  }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png', {
    pane: 'labels',
    subdomains: 'abcd',
    minZoom: 8.5,
    maxZoom: MAX_ZOOM,
    tileSize: 512,
    zoomOffset: -1,
  }).addTo(map);
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
