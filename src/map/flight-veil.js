// Camera-flight veil. Leaflet never redraws its SVG overlays during an
// animated fly: each pane's <svg> stays clipped to the view the flight left
// from (plus 10% renderer padding) and is just CSS-scaled frame to frame
// until moveend redraws it. Pulling back, that clipped drawing shrinks into a
// box mid-screen — drought/outlook fills and state lines "bunched up" with
// bare map all around — and only snaps out to the full frame on landing. The
// curated city labels have the matching problem: they collision-cull only at
// zoomend, so mid-zoom-out they slide together into a pile.
//
// Redrawing the overlays every frame is exactly the software-raster cost the
// GPU-less VPS can't afford mid-flight, so they sit the glide out instead:
// hidden instantly at movestart (in the same task as the director's layer
// swap, so a new shot's overlay never paints at the old framing), then faded
// back in once moveend has redrawn them for the new view (CSS: .in-flight in
// broadcast.css). The GL basemap re-renders correctly every frame and carries
// the shot meanwhile — vector-basemap.js swaps in a GL state line so the
// geography holds through the glide.
//
// Hard cuts (map._suppressMotionDrop, see director fly()) have no in-between
// frames to hide, so they're never veiled.
export function addFlightVeil(map) {
  const el = map.getContainer();
  let veiled = false;
  map.on('movestart', () => {
    if (map._suppressMotionDrop) return;
    veiled = true;
    el.classList.add('in-flight');
  });
  // Lift on any landing — including a hard cut that interrupts a glide, which
  // fires a suppressed movestart but still ends the move.
  map.on('moveend', () => {
    if (!veiled) return;
    veiled = false;
    el.classList.remove('in-flight');
  });
}
