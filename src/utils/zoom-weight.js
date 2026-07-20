// Shrinks a line's stroke weight as the camera pulls back, so risk-area and
// storm-cone outlines don't read as disproportionately thick once their
// footprint shrinks on screen (e.g. the Gulf-wide tropical shot vs. a
// regional convective outlook). Only meant to be sampled at rest (zoomend) —
// Leaflet's own CSS-transform scaling during the fly already shrinks strokes
// in step with the geometry mid-animation, so there's no need to also
// recompute this every zoom frame; that would cost a per-frame DOM write for
// a correction the transform is already making for free.
export function zoomThin(map, { min = 5, max = 8, floor = 0.5 } = {}) {
  const z = map.getZoom() ?? max;
  if (z >= max) return 1;
  if (z <= min) return floor;
  return floor + (1 - floor) * (z - min) / (max - min);
}
