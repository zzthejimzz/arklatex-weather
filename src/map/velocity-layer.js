// Single-site storm-relative velocity (N0S) from IEM's RIDGE archive — the
// "is it rotating?" view. Shown only while the director holds on a tornado /
// severe thunderstorm warning; reflectivity is hidden once velocity is ready.
//
// Velocity is radial, so it only reads near the transmitting radar: each shot
// picks the WSR-88D closest to the warning centroid. Storm-relative velocity
// removes the estimated storm motion, making compact inbound/outbound couplets
// easier to see than in base velocity. Tiles carry the standard NWS palette
// (green = toward the radar, red = away).
//
// IEM no longer publishes a live N0U product for these sites (the apparent
// "current" N0U tiles are years old). N0S is current, and IEM exposes the real
// archived scan times through /json/radar.py. Fetching those timestamps when a
// warning shot starts gives us a genuine loop immediately instead of trying to
// accumulate history in memory over several minutes.
import { safeTmsLayer } from './tms-tile.js';

// WSR-88Ds covering the ArkLaTex and its edges. `id` is the familiar station
// identifier used on air; IEM's RIDGE/API routes use the three-letter form.
const SITES = [
  { id: 'KSHV', iemId: 'SHV', name: 'Shreveport', lat: 32.4508, lon: -93.8412 },
  { id: 'KSRX', iemId: 'SRX', name: 'Fort Smith', lat: 35.2904, lon: -94.3619 },
  { id: 'KLZK', iemId: 'LZK', name: 'Little Rock', lat: 34.8365, lon: -92.2621 },
  { id: 'KPOE', iemId: 'POE', name: 'Fort Polk', lat: 31.1556, lon: -92.9762 },
  { id: 'KFWS', iemId: 'FWS', name: 'Dallas/Fort Worth', lat: 32.5730, lon: -97.3031 },
  { id: 'KDGX', iemId: 'DGX', name: 'Jackson', lat: 32.2797, lon: -89.9846 },
];

const PRODUCT = 'N0S';
const LOOKBACK_MS = 45 * 60 * 1000;
const FRAME_COUNT = 6;
const FRAME_MS = 650;
const HOLD_NEWEST_MS = 2200;
const XFADE_MS = 240;
const MAX_ZOOM = 14;
const OPACITY = 1;

const tileUrl = (site, stamp) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${site.iemId}-${PRODUCT}-${stamp}/{z}/{x}/{y}.png`;

function archiveStamp(ts) {
  return ts.replace(/\D/g, '').slice(0, 12);
}

async function recentScans(site, signal) {
  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_MS);
  const params = new URLSearchParams({
    operation: 'list',
    product: PRODUCT,
    radar: site.iemId,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const res = await fetch(`https://mesonet.agron.iastate.edu/json/radar.py?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const stamps = [...new Set((data.scans ?? []).map(scan => archiveStamp(scan.ts)).filter(Boolean))];
  return stamps.slice(-FRAME_COUNT);
}

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
  // N0S has a cleaner, brighter palette than the retired N0U feed. A modest
  // broadcast boost and one-pixel blur keep couplets vivid without allowing
  // the grey zero-velocity field to wash out roads and warning outlines.
  pane.style.filter = 'blur(1px) saturate(1.8) brightness(1.18) contrast(1.3)';

  // No health beat here: velocity is an occasional overlay, silent for hours
  // on quiet days — registering it would feed the watchdog false alarms.
  let frames = [];
  let idx = -1;
  let site = null;
  let cycleTimer = null;
  let request = null;
  let generation = 0;

  function makeFrame(s, stamp) {
    return safeTmsLayer(tileUrl(s, stamp), {
      pane: 'velocity',
      opacity: 0,
      maxZoom: MAX_ZOOM,
      updateWhenIdle: false,
      keepBuffer: 2,
      crossOrigin: 'anonymous',
    });
  }

  // Crossfade the visible frame — a hard cut reads as flicker on stream.
  function fadeTo(nextIdx) {
    if (!frames[nextIdx]) return;
    const from = frames[idx];
    const to = frames[nextIdx];
    idx = nextIdx;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / XFADE_MS);
      to.setOpacity(OPACITY * t);
      if (from && from !== to) from.setOpacity(OPACITY * (1 - t));
      if (t < 1 && frames[idx] === to) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function startLoop() {
    if (frames.length < 2) return;
    let nextAt = Date.now() + HOLD_NEWEST_MS;
    cycleTimer = setInterval(() => {
      if (Date.now() < nextAt) return;
      const nextIdx = (idx + 1) % frames.length;
      fadeTo(nextIdx);
      nextAt = Date.now() + (nextIdx === frames.length - 1 ? HOLD_NEWEST_MS : FRAME_MS);
    }, 100);
  }

  async function load(s, token, onReady) {
    let stamps;
    try {
      stamps = await recentScans(s, request.signal);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn(`[velocity] ${s.id} archive lookup failed, using latest image:`, err);
      stamps = [];
    }
    if (token !== generation || site?.id !== s.id) return;

    // `0` is IEM's latest-image alias and is the graceful fallback when archive
    // metadata is temporarily unavailable or the radar has not emitted N0S
    // during the lookback window.
    const sources = stamps.length ? stamps : ['0'];
    frames = sources.map(stamp => makeFrame(s, stamp));
    idx = frames.length - 1;
    const newest = frames[idx];

    let readyCalled = false;
    const ready = () => {
      if (readyCalled || token !== generation || !frames.includes(newest)) return;
      readyCalled = true;
      onReady?.();
      startLoop();
    };
    newest.once('load', ready);
    frames.forEach(frame => frame.addTo(map));
    fadeTo(idx);
  }

  function show(atLat, atLon, onReady) {
    const s = nearestSite(atLat, atLon);
    hide();
    site = s;
    const token = generation;
    request = new AbortController();
    load(s, token, onReady);
    return s;
  }

  function hide() {
    generation++;
    request?.abort();
    request = null;
    if (cycleTimer) clearInterval(cycleTimer);
    cycleTimer = null;
    frames.forEach(frame => map.removeLayer(frame));
    frames = [];
    idx = -1;
    site = null;
  }

  return { show, hide, active: () => site };
}
