// Year-to-date storm-warning map: every county in the region shaded by how
// many severe/tornado/flash-flood warnings it has been under this year, with
// chips on the three most-warned. Rides beside the YTD warnings panel card so
// the map shows *where* while the panel shows *how many*.
import L from 'leaflet';

// Rainbow "heat" ramp, blue (fewest) → green → yellow → orange → red (most),
// interpolated between stops so every county gets its own shade. Stretched
// across the actual min–max of the warned counties — every county in an
// active CWA racks up 10+, so a 0-based ramp left the whole region one flat
// shade. Opacity stays high throughout: a hue ramp washed out over the gray
// basemap turns the low end muddy instead of blue.
const STOPS = [
  [0.00, [37, 99, 235]],  // blue-600
  [0.25, [34, 197, 94]],  // green-500
  [0.50, [250, 204, 21]], // yellow-400
  [0.75, [249, 115, 22]], // orange-500
  [1.00, [239, 68, 68]],  // red-500
];
const LO_FILL = 0.62;
const HI_FILL = 0.82;

/** Fill for a county count given the warned-county range; null = unwarned. */
export function ytdStyle(count, lo, hi) {
  if (!count) return null;
  const t = hi > lo ? Math.min(1, Math.max(0, (count - lo) / (hi - lo))) : 1;
  const k = Math.max(1, STOPS.findIndex(([at]) => at >= t));
  const [a, ca] = STOPS[k - 1];
  const [b, cb] = STOPS[k];
  const u = (t - a) / (b - a);
  const mix = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * u);
  return { color: `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`, opacity: LO_FILL + (HI_FILL - LO_FILL) * t };
}

export function ytdRange(counties = {}) {
  const vals = Object.values(counties).filter(Boolean);
  return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
}

export function createWarningsYtdLayer(map, zones) {
  const group = L.layerGroup();
  let visible = false;

  // County chips land on county centers, which is exactly where the city
  // labels sit (Harrison → Longview, Caddo → Shreveport). Hide just the labels
  // a chip covers; re-checked whenever the camera settles, since the label
  // layer re-culls itself on zoom.
  const cityLabels = () => map.getPane('cities')?.querySelectorAll('.city-label') ?? [];
  function declutter() {
    const chips = [...(map.getPane('temps')?.querySelectorAll('.ytd-chip') ?? [])]
      .map(el => el.getBoundingClientRect());
    const range = document.createRange();
    for (const label of cityLabels()) {
      // The label box itself is zero-width (text overflows a 0×0 anchor), so
      // measure the text run.
      range.selectNodeContents(label);
      const r = range.getBoundingClientRect();
      const hit = chips.some(c => c.left < r.right + 4 && r.left < c.right + 4 && c.top < r.bottom + 4 && r.top < c.bottom + 4);
      label.style.visibility = hit ? 'hidden' : '';
    }
  }

  // Label point: center of the county's largest ring's bounds — good enough
  // for these compact county shapes, and immune to stray detached slivers.
  function labelPoint(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let best = null;
    for (const poly of polys) {
      const b = L.latLngBounds(poly[0].map(([lon, lat]) => [lat, lon]));
      const area = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
      if (!best || area > best.area) best = { area, center: b.getCenter() };
    }
    return best?.center;
  }

  function show(data) {
    group.clearLayers();
    const counts = data?.counties ?? {};
    const [lo, hi] = ytdRange(counts);
    const features = Object.entries(zones)
      .filter(([, z]) => z.geometry)
      .map(([ugc, z]) => ({ type: 'Feature', properties: { ugc, count: counts[ugc] ?? 0 }, geometry: z.geometry }));

    group.addLayer(L.geoJSON({ type: 'FeatureCollection', features }, {
      pane: 'overlayPane',
      interactive: false,
      style: f => {
        const fill = ytdStyle(f.properties.count, lo, hi);
        return fill
          ? { color: '#0b1220', weight: 0.8, opacity: 0.5, fillColor: fill.color, fillOpacity: fill.opacity }
          : { stroke: false, fill: false }; // outside the CWA (or genuinely unwarned)
      },
    }));

    (data?.top ?? []).forEach((t, i) => {
      const at = zones[t.ugc]?.geometry && labelPoint(zones[t.ugc].geometry);
      if (!at) return;
      group.addLayer(L.marker(at, {
        pane: 'temps',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'temp-anchor',
          html: `
            <div class="temp-chip ytd-chip">
              <b style="color:${ytdStyle(t.count, lo, hi)?.color}">${t.count}</b>
              <span>#${i + 1} ${t.name}</span>
            </div>`,
          iconSize: [0, 0],
        }),
      }));
    });

    group.addTo(map); // city labels stay up — viewers need them to place the shading
    if (!visible) map.on('zoomend moveend', declutter);
    visible = true;
    requestAnimationFrame(declutter);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    map.off('zoomend moveend', declutter);
    group.remove();
    group.clearLayers();
    for (const label of cityLabels()) label.style.visibility = '';
  }

  return { show, hide };
}
