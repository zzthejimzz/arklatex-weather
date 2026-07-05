// Builds the two data files the broadcast page needs:
//   public/geo/arklatex.json         — NWS Shreveport (SHV) county + forecast-zone
//                                      geometries, region convex hull, bbox
//   public/geo/population-grid.json  — [lon, lat, pop2020] points for those
//                                      counties (TIGERweb Census2020; decennial
//                                      API fallback for population). Each tract's
//                                      population is spread over a ~2.5 km lattice
//                                      clipped to the tract polygon, so small
//                                      warning polygons still catch points —
//                                      a single centroid per rural tract made
//                                      storm-scale warnings sum to 0 people.
// Run: npm run build-geo   (Node 18+, needs network)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInRing } from '../src/utils/geometry.js';

const OFFICE = 'SHV';
const NWS = 'https://api.weather.gov';
const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer';
const UA = 'arklatex-live geo build (zzthejimzz@gmail.com)';
const STATE_FIPS = { TX: '48', LA: '22', AR: '05', OK: '40' };

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'geo');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, accept = 'application/geo+json', tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw new Error(`${url}: ${err.message ?? err}`);
      await sleep(1000 * (i + 1));
    }
  }
}

// Round coords to 3 decimals (~110 m) and drop consecutive duplicates — keeps
// the zones file small; broadcast rendering doesn't need survey precision.
function simplifyGeometry(geom) {
  const roundRing = ring => {
    const out = [];
    for (const [x, y] of ring) {
      const p = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    if (out.length > 1) {
      const [f, l] = [out[0], out[out.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) out.push([...f]); // keep ring closed
    }
    return out;
  };
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(roundRing) };
  }
  if (geom.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geom.coordinates.map(p => p.map(roundRing)) };
  }
  if (geom.type === 'GeometryCollection') {
    return { type: 'GeometryCollection', geometries: geom.geometries.map(simplifyGeometry) };
  }
  return geom;
}

function* outerVertices(geom) {
  if (geom.type === 'Polygon') yield* geom.coordinates[0];
  else if (geom.type === 'MultiPolygon') for (const p of geom.coordinates) yield* p[0];
  else if (geom.type === 'GeometryCollection') for (const g of geom.geometries) yield* outerVertices(g);
}

// Andrew's monotone chain convex hull; returns a closed ring.
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = list => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.push([...hull[0]]);
  return hull;
}

async function fetchZones() {
  console.log(`Fetching NWS office ${OFFICE}…`);
  const office = await getJson(`${NWS}/offices/${OFFICE}`, 'application/ld+json');
  const urls = [
    ...(office.responsibleCounties ?? []),
    ...(office.responsibleForecastZones ?? []),
  ];
  if (!urls.length) throw new Error('office returned no zones — API shape changed?');
  console.log(`  ${office.responsibleCounties?.length ?? 0} counties, ${office.responsibleForecastZones?.length ?? 0} forecast zones`);

  const zones = {};
  let done = 0;
  for (const url of urls) {
    const zone = await getJson(url);
    const p = zone.properties ?? {};
    const code = p.id ?? url.split('/').pop();
    if (zone.geometry) {
      zones[code] = {
        name: p.name ?? code,
        state: p.state ?? code.slice(0, 2),
        type: p.type ?? (code[2] === 'C' ? 'county' : 'forecast'),
        geometry: simplifyGeometry(zone.geometry),
      };
    }
    if (++done % 10 === 0) console.log(`  …${done}/${urls.length}`);
    await sleep(120);
  }
  return zones;
}

async function buildRegionFile(zones) {
  const counties = Object.entries(zones).filter(([code]) => code[2] === 'C');
  const verts = [];
  for (const [, z] of counties) verts.push(...outerVertices(z.geometry));
  const hull = convexHull(verts);
  const bbox = [
    Math.min(...verts.map(v => v[0])), Math.min(...verts.map(v => v[1])),
    Math.max(...verts.map(v => v[0])), Math.max(...verts.map(v => v[1])),
  ];
  const out = { office: OFFICE, generated: new Date().toISOString(), bbox, hull, zones };
  await fs.writeFile(path.join(outDir, 'arklatex.json'), JSON.stringify(out));
  console.log(`Wrote arklatex.json (${counties.length} counties, bbox ${bbox.map(n => n.toFixed(2)).join(', ')})`);
  return counties.map(([code]) => code);
}

async function findTractsLayerId() {
  const svc = await getJson(`${TIGER}?f=json`, 'application/json');
  const layer = (svc.layers ?? []).find(l => /^census tracts$/i.test(l.name));
  if (!layer) throw new Error(`No "Census Tracts" layer on ${TIGER}`);
  return layer.id;
}

// Even-odd containment over a raw esri `rings` array. TIGERweb returns all
// rings (outers and holes, possibly several parts) in one flat list; ray-cast
// parity across every ring classifies points correctly without sorting out
// which ring is which.
function pointInEsriRings(pt, rings) {
  let inside = false;
  for (const ring of rings) if (pointInRing(pt, ring)) inside = !inside;
  return inside;
}

// Spread one tract's population across lattice cell centers inside its rings.
// Lattice is anchored to multiples of CELL_DEG so cells line up across tracts.
const CELL_DEG = 0.025; // ~2.5 km N–S; warning polygons are tens of km across
function rasterizeTract(rings, pop, fallbackPt) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  const cells = [];
  const x0 = (Math.floor(w / CELL_DEG) + 0.5) * CELL_DEG;
  const y0 = (Math.floor(s / CELL_DEG) + 0.5) * CELL_DEG;
  for (let x = x0; x <= e; x += CELL_DEG) {
    for (let y = y0; y <= n; y += CELL_DEG) {
      if (pointInEsriRings([x, y], rings)) cells.push([x, y]);
    }
  }
  if (!cells.length) cells.push(fallbackPt); // tract smaller than one cell
  const share = Math.round((pop / cells.length) * 10) / 10;
  return cells.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000, share]);
}

async function buildPopulationGrid(countyCodes) {
  const layerId = await findTractsLayerId();
  console.log(`TIGERweb tracts layer id: ${layerId}`);

  const grid = [];
  const missingPop = []; // GEOIDs needing the decennial-API fallback
  for (const code of countyCodes) {
    const st = STATE_FIPS[code.slice(0, 2)];
    const county = code.slice(3);
    if (!st) continue;
    const where = encodeURIComponent(`STATE='${st}' AND COUNTY='${county}'`);
    const url = `${TIGER}/${layerId}/query?where=${where}&outFields=GEOID,POP100,CENTLAT,CENTLON&returnGeometry=true&geometryPrecision=4&outSR=4326&f=json`;
    const data = await getJson(url, 'application/json');
    for (const f of data.features ?? []) {
      const a = f.attributes;
      const lat = parseFloat(a.CENTLAT);
      const lon = parseFloat(a.CENTLON);
      const pop = Number(a.POP100);
      if (isNaN(lat) || isNaN(lon)) continue;
      const pt = [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000];
      const rings = f.geometry?.rings ?? [];
      if (Number.isFinite(pop) && pop >= 0 && a.POP100 !== null) {
        if (rings.length) grid.push(...rasterizeTract(rings, pop, pt));
        else grid.push([...pt, pop]);
      } else {
        missingPop.push({ geoid: a.GEOID, pt, rings });
      }
    }
    await sleep(120);
  }

  if (missingPop.length) {
    console.log(`POP100 missing on ${missingPop.length} tracts — joining 2020 decennial API…`);
    const popByGeoid = new Map();
    for (const st of new Set(countyCodes.map(c => STATE_FIPS[c.slice(0, 2)]).filter(Boolean))) {
      const rows = await getJson(
        `https://api.census.gov/data/2020/dec/pl?get=P1_001N&for=tract:*&in=state:${st}`,
        'application/json',
      );
      for (const [pop, state, county, tract] of rows.slice(1)) {
        popByGeoid.set(`${state}${county}${tract}`, Number(pop));
      }
    }
    for (const { geoid, pt, rings } of missingPop) {
      const pop = popByGeoid.get(geoid);
      if (!Number.isFinite(pop)) continue;
      if (rings.length) grid.push(...rasterizeTract(rings, pop, pt));
      else grid.push([...pt, pop]);
    }
  }

  const total = grid.reduce((s, [, , p]) => s + p, 0);
  await fs.writeFile(path.join(outDir, 'population-grid.json'), JSON.stringify(grid));
  console.log(`Wrote population-grid.json (${grid.length} points, total pop ${Math.round(total).toLocaleString()})`);
}

const zones = await fetchZones();
const countyCodes = await buildRegionFile(zones);
await buildPopulationGrid(countyCodes);
console.log('Done.');
