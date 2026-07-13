// Lightweight GeoJSON geometry helpers — enough for broadcast needs, no turf.
// Coordinates are GeoJSON order: [lon, lat].

export function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Polygon coordinates = [outerRing, ...holeRings]
export function pointInPolygon(pt, coords) {
  if (!coords.length || !pointInRing(pt, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(pt, coords[i])) return false;
  }
  return true;
}

export function pointInGeometry(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(c => pointInPolygon(pt, c));
  if (geom.type === 'GeometryCollection') return (geom.geometries ?? []).some(g => pointInGeometry(pt, g));
  return false;
}

// Iterate every outer-ring vertex of a Polygon/MultiPolygon.
export function* outerVertices(geom) {
  if (!geom) return;
  if (geom.type === 'Point') yield geom.coordinates;
  else if (geom.type === 'Polygon') yield* geom.coordinates[0] ?? [];
  else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) yield* poly[0] ?? [];
  } else if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries ?? []) yield* outerVertices(g);
  }
}

// Returns [west, south, east, north] or null for empty geometry.
export function geometryBounds(geom) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of outerVertices(geom)) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return w === Infinity ? null : [w, s, e, n];
}

// [west, south, east, north] → Leaflet [[south, west], [north, east]]
export function boundsToLeaflet(b) {
  return [[b[1], b[0]], [b[3], b[2]]];
}

export function bboxesOverlap(a, b) {
  return !!a && !!b && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

// Approximate intersection test: bbox precheck, then mutual vertex containment.
// Misses the edge-crossing-only case (no vertex of either inside the other),
// which is rare for warning-polygon-vs-region tests and fine for filtering.
export function geometriesIntersect(a, b) {
  if (!bboxesOverlap(geometryBounds(a), geometryBounds(b))) return false;
  for (const v of outerVertices(a)) if (pointInGeometry(v, b)) return true;
  for (const v of outerVertices(b)) if (pointInGeometry(v, a)) return true;
  return false;
}
