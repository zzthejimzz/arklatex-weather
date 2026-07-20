// Vector basemap: OpenFreeMap (OpenMapTiles schema) rendered by MapLibre GL,
// hosted inside Leaflet via @maplibre/maplibre-gl-leaflet so every existing
// Leaflet layer (radar loop, outlooks, alert polygons, panes) survives as-is.
//
// Why vector: CARTO raster tiles can't label county roads at broadcast zooms,
// and their free tier is non-commercial. OpenFreeMap is free for commercial
// use, and vector text stays crisp at any fractional zoom.
//
// Architecture — TWO GL layers sharing the same tiles:
//   1. base   (tilePane, z200): every non-symbol layer, recolored to the grey
//      "Pivotal" palette (land #595959 / water #191919 — same targets the old
//      CSS filter hit, so radar saturation/blur tuning still reads the same).
//   2. labels (labels pane, z650): symbol layers only, transparent background,
//      white text + dark halos, sizes scaled up for 1080p broadcast. Living in
//      the labels pane keeps names ABOVE radar, exactly like the old CARTO
//      label tiles.
//
// GL zoom = Leaflet zoom - 1 (the plugin offsets automatically). Every
// min/max zoom below is a GL zoom; comments give the Leaflet equivalent.
import L from 'leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const FETCH_TIMEOUT_MS = 8000;

// ---- grey Pivotal palette ---------------------------------------------------
const LAND = '#595959';
const WATER = '#191919';

const BASE_RECOLOR = {
  background: LAND,
  park: '#565c56',
  water: WATER,
  waterway: WATER,
  landuse_residential: '#626262', // urban footprint slightly lighter — towns read as blobs
  landcover_wood: '#515751',
  'aeroway-taxiway': '#4a4a4a',
  'aeroway-runway': '#4a4a4a',
  'aeroway-area': '#4f4f4f',
  road_area_pier: LAND,
  road_pier: '#4a4a4a',
  highway_minor: '#494949',
  highway_major_inner: '#404040',
  highway_major_subtle: '#464646',
  highway_motorway_inner: '#383838',
  highway_motorway_subtle: '#3f3f3f',
  highway_motorway_bridge_inner: '#383838',
  tunnel_motorway_inner: '#444444',
  boundary_2: '#808080',
  boundary_3: '#787878', // counties — see filter override below
};

// Positron layers that don't belong on a broadcast weather map: building
// footprints, foot paths, railways, road casings (roads render as single
// dark lines on grey), glaciers, disputed borders.
const BASE_DROP =
  /^(building|highway_path|railway|.*_casing$|landcover_ice_shelf|landcover_glacier|boundary_disputed)/;

// ---- label styling ----------------------------------------------------------
const TEXT_SCALE = 1.25; // broadcast legibility at 1080p

// Per-layer text colors; everything else gets plain white.
const TEXT_COLOR = {
  waterway_line_label: '#a8c3d4',
  water_name_point_label: '#a8c3d4',
  water_name_line_label: '#a8c3d4',
  label_other: '#dcdcdc',
  label_state: '#c9c9c9',
};

// GL minzoom overrides (Leaflet = GL + 1):
//  - city/town/village labels start at GL 7.45 = Leaflet 8.45, the exact
//    cutoff where the curated overlay in map/cities.js hands off (keep in
//    sync!). GL can't collision-avoid DOM markers, so the overview band
//    belongs entirely to curated labels. State capitals (label_city_capital)
//    stay GL at all zooms — the curated list never includes them.
//  - road names/shields are pulled WAY down from their street-app defaults
//    (12.2–15) so they populate at warning-tour zoom.
const LABEL_MINZOOM = {
  label_city: 7.45,
  label_town: 7.45,
  label_village: 8.2,
  label_other: 9,
  'highway-name-major': 9,
  'highway-name-minor': 11,
  'highway-shield-us-interstate': 7,
  road_shield_us: 8,
};

const LABEL_DROP = /^(highway-name-path)$/;

// Scale a text-size / icon-size value by `f`, whatever legal form it takes:
// plain number, {stops:[[z,v],…]}, or interpolate/step expressions.
function scaleSize(value, f) {
  if (typeof value === 'number') return Math.round(value * f * 100) / 100;
  if (Array.isArray(value)) {
    const op = value[0];
    if (op === 'interpolate') {
      const out = value.slice();
      for (let i = 4; i < out.length; i += 2) out[i] = scaleSize(out[i], f);
      return out;
    }
    if (op === 'step') {
      const out = value.slice();
      out[2] = scaleSize(out[2], f);
      for (let i = 4; i < out.length; i += 2) out[i] = scaleSize(out[i], f);
      return out;
    }
    return value; // unknown expression — leave untouched
  }
  if (value && typeof value === 'object' && Array.isArray(value.stops)) {
    return { ...value, stops: value.stops.map(([z, v]) => [z, scaleSize(v, f)]) };
  }
  return value;
}

function buildBaseStyle(style) {
  const layers = [];
  for (const src of style.layers) {
    if (src.type === 'symbol' || BASE_DROP.test(src.id)) continue;
    const layer = structuredClone(src);
    layer.paint = layer.paint || {};
    const color = BASE_RECOLOR[layer.id];
    if (color) {
      if (layer.type === 'background') layer.paint['background-color'] = color;
      else if (layer.type === 'fill') layer.paint['fill-color'] = color;
      else if (layer.type === 'line') layer.paint['line-color'] = color;
    }
    // boundary_3 ships as admin_level 3–6, which includes state lines we
    // already draw in white above the radar. Restrict to 5–6: county lines.
    if (layer.id === 'boundary_3') {
      layer.filter = [
        'all',
        ['>=', ['get', 'admin_level'], 5],
        ['<=', ['get', 'admin_level'], 6],
        ['!=', ['get', 'maritime'], 1],
      ];
    }
    layers.push(layer);
  }
  return {
    version: 8,
    sources: { openmaptiles: style.sources.openmaptiles },
    sprite: style.sprite,
    glyphs: style.glyphs,
    layers,
  };
}

function buildLabelsStyle(style) {
  const layers = [];
  for (const src of style.layers) {
    if (src.type !== 'symbol' || LABEL_DROP.test(src.id)) continue;
    const layer = structuredClone(src);
    layer.paint = layer.paint || {};
    layer.layout = layer.layout || {};
    layer.paint['text-color'] = TEXT_COLOR[layer.id] || '#ffffff';
    layer.paint['text-halo-color'] = '#0a0a0a';
    layer.paint['text-halo-width'] = 1.5;
    layer.paint['text-halo-blur'] = 0.75;
    if (layer.layout['text-size'] != null)
      layer.layout['text-size'] = scaleSize(layer.layout['text-size'], TEXT_SCALE);
    if (layer.layout['icon-size'] != null)
      layer.layout['icon-size'] = scaleSize(layer.layout['icon-size'], TEXT_SCALE);
    if (LABEL_MINZOOM[layer.id] != null) layer.minzoom = LABEL_MINZOOM[layer.id];
    layers.push(layer);
  }
  return {
    version: 8,
    sources: { openmaptiles: style.sources.openmaptiles },
    sprite: style.sprite,
    glyphs: style.glyphs,
    layers, // no background layer → transparent canvas over the radar
  };
}

/**
 * Add the vector base + label layers to a Leaflet map.
 * Throws if the style can't be fetched — caller falls back to raster.
 */
export async function addVectorBasemap(map) {
  const res = await fetch(STYLE_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`style HTTP ${res.status}`);
  const style = await res.json();

  const baseStyle = buildBaseStyle(style);
  const base = L.maplibreGL({
    style: baseStyle,
    attribution: '', // Leaflet attribution set once in basemap.js
  }).addTo(map);

  const labelsStyle = buildLabelsStyle(style);
  const labels = L.maplibreGL({
    pane: 'labels',
    style: labelsStyle,
    attribution: '',
  }).addTo(map);

  // Cut GL repaint cost while the camera flies. Under software rendering (no GPU
  // on the VPS) every frame of a flyTo re-rasters the whole scene, and the
  // parabola's wide zoom-out frames are the priciest — that's the zoom stutter.
  // Two things dominate a repaint and are both useless mid-flight, so drop them
  // for the duration of the move and restore on settle:
  //   1. Labels — symbol placement/collision is the single most expensive step,
  //      and text is illegible while moving anyway.
  //   2. Heavy base geometry — roads, landuse, aeroway: the bulk of the line
  //      tessellation. Land/water/boundaries stay so the map keeps its shape.
  const HEAVY_BASE = /^(highway|road|tunnel|bridge|landuse|landcover|aeroway|park)/;
  const heavyBaseIds = baseStyle.layers.filter(l => HEAVY_BASE.test(l.id)).map(l => l.id);
  const labelIds = labelsStyle.layers.map(l => l.id);
  const glBase = base.getMaplibreMap();
  const glLabels = labels.getMaplibreMap();

  // setLayoutProperty throws if the style isn't loaded yet (an early boot fly);
  // guard so a stray move can never error — the layers just stay put that once.
  const setVis = (gl, ids, v) => {
    if (!gl.isStyleLoaded()) return;
    for (const id of ids) gl.setLayoutProperty(id, 'visibility', v);
  };
  const hideForMove = () => { setVis(glLabels, labelIds, 'none'); setVis(glBase, heavyBaseIds, 'none'); };
  const showOnSettle = () => { setVis(glLabels, labelIds, 'visible'); setVis(glBase, heavyBaseIds, 'visible'); };
  map.on('movestart zoomstart', hideForMove);
  map.on('moveend zoomend', showOnSettle);

  return { base, labels };
}
