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
//
// Animation: unlike the n0q mosaic, IEM's RIDGE tile cache has no real
// time-lag history for single-site products — every "-m05m".."-m90m" suffix
// on a ridge:: URL comes back byte-identical (verified by hash), while only
// the bare (current) URL is live. There's no server-side loop to draw from,
// so this builds its own: a ring of frames, refreshed one at a time on a
// timer, swept oldest → newest with the same crossfade/hold pacing as the
// reflectivity loop. Freshly shown, all frames are the same current snapshot
// (nothing to animate yet); real motion appears over the next few refresh
// cycles as each slot gets overwritten with an actual later scan.
import { safeTmsLayer } from './tms-tile.js';

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
// New volume scan roughly every 4–6 min in precip mode; snapshot well inside
// that so a fresh scan is picked up promptly. Doubles as the loop's history
// cadence: FRAME_COUNT * SNAPSHOT_MS is how far back the built-up loop reaches.
const SNAPSHOT_MS = 2 * 60 * 1000;
const FRAME_COUNT = 6; // ~12 min of history once fully built up
const FRAME_MS = 650; // sweep pace, oldest → newest
const HOLD_NEWEST_MS = 2200;
const XFADE_MS = 240;
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
  let order = []; // ring buffer, oldest → newest, mutated in place by rotation
  let current = null; // the frame currently faded in (or fading in)
  let site = null;
  let cycleTimer = null;
  let lastSnapshotAt = 0;

  function makeFrame(s, ts) {
    return safeTmsLayer(url(s.id, ts), {
      pane: 'velocity',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      updateWhenIdle: false,
      keepBuffer: 2,
      crossOrigin: 'anonymous',
    }).addTo(map);
  }

  // Crossfade the visible frame — a hard cut reads as flicker on stream.
  function fadeTo(next) {
    const from = current;
    current = next;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / XFADE_MS);
      next.setOpacity(OPACITY * t);
      if (from) from.setOpacity(OPACITY * (1 - t));
      if (t < 1 && current === next) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function show(atLat, atLon) {
    const s = nearestSite(atLat, atLon);
    if (order.length && site?.id === s.id) return s; // already up for this radar, keep its built-up history
    hide();
    site = s;
    const ts = Date.now();
    order = Array.from({ length: FRAME_COUNT }, () => makeFrame(s, ts));
    lastSnapshotAt = ts;

    // Fade in over the (already fading) reflectivity — reads as a crossfade.
    fadeTo(order[order.length - 1]);

    let nextAt = Date.now() + HOLD_NEWEST_MS;
    cycleTimer = setInterval(() => {
      const i = order.indexOf(current);
      const atNewest = i === order.length - 1;
      // Only safe to repurpose the oldest frame while holding on newest —
      // that's the one point in the sweep where the oldest slot is guaranteed
      // off-screen, so overwriting its URL can't flash a mid-load blank tile.
      if (atNewest && Date.now() - lastSnapshotAt >= SNAPSHOT_MS) {
        const oldest = order.shift();
        oldest.setUrl(url(s.id, Date.now()));
        order.push(oldest);
        lastSnapshotAt = Date.now();
      }
      if (Date.now() < nextAt) return;
      const ni = (order.indexOf(current) + 1) % order.length;
      fadeTo(order[ni]);
      nextAt = Date.now() + (ni === order.length - 1 ? HOLD_NEWEST_MS : FRAME_MS);
    }, 100);
    return s;
  }

  function hide() {
    if (cycleTimer) clearInterval(cycleTimer);
    cycleTimer = null;
    order.forEach((l) => map.removeLayer(l));
    order = [];
    current = null;
    site = null;
  }

  return { show, hide, active: () => site };
}
