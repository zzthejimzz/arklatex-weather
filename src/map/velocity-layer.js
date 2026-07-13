// Single-site base velocity (N0U) from IEM's RIDGE tile cache — the "is it
// rotating?" view. Shown only while the director holds on a tornado / severe
// thunderstorm warning; the reflectivity loop fades out underneath it.
//
// Velocity is radial, so it only reads near the transmitting radar: each shot
// picks the WSR-88D closest to the warning centroid. Tiles carry the standard
// NWS palette (green = toward the radar, red = away; a tight red/green couplet
// is rotation). Unlike n0q there is no published index→value table for these
// tiles, so no data-space smoothing — a light CSS blur on the pane melts the
// raw RIDGE blocks enough for broadcast without inventing data. The stock
// RIDGE palette is dark and desaturated — at partial opacity over the dimmed
// reflectivity it read as "faded reflectivity" on stream — so the pane also
// boosts saturation/brightness/contrast and the tiles run fully opaque.
import L from 'leaflet';

// WSR-88Ds covering the ArkLaTex and its edges.
const SITES = [
  { id: 'KSHV', name: 'Shreveport', lat: 32.4508, lon: -93.8412 },
  { id: 'KSRX', name: 'Fort Smith', lat: 35.2904, lon: -94.3619 },
  { id: 'KLZK', name: 'Little Rock', lat: 34.8365, lon: -92.2621 },
  { id: 'KPOE', name: 'Fort Polk', lat: 31.1556, lon: -92.9762 },
  { id: 'KFWS', name: 'Dallas/Fort Worth', lat: 32.5730, lon: -97.3031 },
  { id: 'KDGX', name: 'Jackson', lat: 32.2797, lon: -89.9846 },
];

const url = (site, ts) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${site}-N0U-0/{z}/{x}/{y}.png?_ts=${ts}`;
// New volume scan roughly every 4–6 min in precip mode; re-bust well inside that.
const REFRESH_MS = 2 * 60 * 1000;
const MAX_ZOOM = 14;
const OPACITY = 1; // partial opacity let reflectivity greens bleed through and muddy the couplets

export function nearestSite(lat, lon) {
  let best = SITES[0];
  let bestD = Infinity;
  for (const s of SITES) {
    const d = (s.lat - lat) ** 2 + ((s.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function createVelocityLayer(map) {
  // Own pane just above the reflectivity loop, below state borders.
  map.createPane('velocity');
  const pane = map.getPane('velocity');
  pane.style.zIndex = 452;
  pane.style.pointerEvents = 'none';
  // Blur melts RIDGE pixel blocks at broadcast distance; the color boost
  // turns the dark stock palette into TV-bright red/green so rotation pops.
  pane.style.filter = 'blur(1.5px) saturate(2.2) brightness(1.2) contrast(1.2)';

  // No health beat here: velocity is an occasional overlay, silent for hours
  // on quiet days — registering it would just feed the watchdog false alarms.
  // If tiles fail, the shot still has the dimmed reflectivity underneath.
  let layer = null;
  let site = null;
  let refreshTimer = null;

  function show(atLat, atLon) {
    const s = nearestSite(atLat, atLon);
    if (layer && site?.id === s.id) return s; // already up for this radar
    hide();
    site = s;
    layer = L.tileLayer(url(s.id, Date.now()), {
      pane: 'velocity',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      updateWhenIdle: false,
      keepBuffer: 2,
      crossOrigin: 'anonymous',
    }).addTo(map);

    // Fade in over the (already fading) reflectivity — reads as a crossfade.
    const t0 = performance.now();
    const lyr = layer;
    const step = (now) => {
      if (lyr !== layer) return; // hidden/replaced mid-fade
      const t = Math.min(1, (now - t0) / 350);
      lyr.setOpacity(OPACITY * t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    refreshTimer = setInterval(() => {
      layer?.setUrl(url(s.id, Date.now()));
    }, REFRESH_MS);
    return s;
  }

  function hide() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (layer) map.removeLayer(layer);
    layer = null;
    site = null;
  }

  return { show, hide, active: () => site };
}
