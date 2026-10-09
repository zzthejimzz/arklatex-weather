// NOAA NDBC BuoyCAMs — six-camera panoramas from offshore weather buoys,
// the "what does it look like out there" companion to an active storm's
// track/cone and satellite shots. US-government work (public domain), so
// unlike every DOT/beach video feed it's freely restreamable (see
// docs/live-cams-research.md). Daylight only: a camera that's gone dark is
// filtered by photo age, so the shot quietly drops out of the rotation at
// night and comes back after sunrise.
//
// The station list (KML) carries each camera's newest photo URL + timestamp;
// the matching realtime2 text file adds the buoy's own wind/wave/pressure.
// None of it sends CORS headers → proxied, the photo included: the card reads
// its pixels to auto-brighten a storm-dark shot, which needs same-origin.
import { fetchWithTimeout } from '../utils/net.js';

const IS_DEV = import.meta.env.DEV;
const UPSTREAM = 'https://www.ndbc.noaa.gov';

const REFRESH_MS = 10 * 60 * 1000; // cameras shoot every ~15 min in daylight
const RETRY_MS = 3 * 60 * 1000;
const MAX_PHOTO_AGE_MS = 90 * 60 * 1000; // older = camera stopped for the night (or broke)
const MAX_OBS_AGE_MS = 3 * 60 * 60 * 1000;
const NEAR_STORM_KM = 500;
const MAX_PER_STORM = 3;

function url(path) {
  if (IS_DEV) return `/api/ndbc/${path}`;
  return `/proxy.php?url=${encodeURIComponent(`${UPSTREAM}/${path}`)}`;
}

// Same-origin URL for one of NDBC's absolute photo URLs.
function proxiedPhoto(img) {
  return url(img.replace(`${UPSTREAM}/`, ''));
}

// The panorama: six 480×270 photos side by side over a 30px caption strip
// (2880×300 overall).
export const VIEWS = 6;
const PHOTO_H = 270;
// A view that's one flat tone is a dead camera — solid black, or blown out
// to solid white (42003 had four such views the day Isaias came ashore).
// Storm-dark but working views still carry texture (stddev ≥ ~5).
const DEAD_STDDEV = 3.5;
const MIN_LIVE_VIEWS = 2;
// Auto-exposure: under a hurricane's rain shield the cameras shoot near-black
// frames (mean luma ~12/255 at 42039 that same day). Lift dark shots toward a
// readable mean, capped so noise doesn't take over, and bake it into the
// pixels once — a live CSS filter would re-run on every repaint on the
// GPU-less VPS.
const TARGET_LUMA = 80;
const MAX_GAIN = 2.5;

// → { url, gain, live: [view indexes worth showing] }
async function analyzePhoto(img) {
  const src = proxiedPhoto(img);
  const el = new Image();
  el.src = src;
  await el.decode();
  const pw = 32, ph = 18; // per-view probe size
  const probe = document.createElement('canvas');
  probe.width = pw * VIEWS; probe.height = ph;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(el, 0, 0, el.naturalWidth, PHOTO_H, 0, 0, probe.width, probe.height);
  const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
  const views = Array.from({ length: VIEWS }, (_, v) => {
    let sum = 0, sq = 0, n = 0;
    for (let y = 0; y < ph; y++) {
      for (let x = v * pw; x < (v + 1) * pw; x++) {
        const i = (y * probe.width + x) * 4;
        const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        sum += l; sq += l * l; n++;
      }
    }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  });
  const live = views.map((s, i) => (s.sd >= DEAD_STDDEV ? i : -1)).filter(i => i >= 0);
  if (!live.length) return { url: src, gain: 1, live };
  const mean = live.reduce((a, i) => a + views[i].mean, 0) / live.length;
  const gain = Math.min(MAX_GAIN, Math.max(1, TARGET_LUMA / Math.max(mean, 1)));
  if (gain < 1.15) return { url: src, gain: 1, live };
  const c = document.createElement('canvas');
  c.width = el.naturalWidth; c.height = el.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.filter = `brightness(${gain.toFixed(2)})`;
  ctx.drawImage(el, 0, 0);
  return { url: c.toDataURL('image/jpeg', 0.9), gain, live };
}

async function fetchText(path) {
  const res = await fetchWithTimeout(url(path), { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function kmBetween(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(a));
}

// Placemark description: "PENSACOLA - 115NM SSE of Pensacola, FL - picture
// taken at 10/09/2026 1510 UTC</br><img src=".../Z80A_2026_10_09_1510.jpg" ...>"
function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const out = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const id = pm.getElementsByTagName('name')[0]?.textContent.trim();
    const desc = pm.getElementsByTagName('description')[0]?.textContent ?? '';
    const coords = pm.getElementsByTagName('coordinates')[0]?.textContent.split(',').map(Number);
    const img = desc.match(/src="([^"]+\.jpg)"/)?.[1];
    const t = desc.match(/(\d\d)\/(\d\d)\/(\d{4}) (\d\d)(\d\d) UTC/);
    if (!id || !img || !t || !coords || coords.length < 2) continue;
    const takenAt = new Date(Date.UTC(+t[3], +t[1] - 1, +t[2], +t[4], +t[5]));
    // "PENSACOLA - 115NM SSE of Pensacola, FL - picture taken…" → the
    // human-readable location is the second dash field.
    const where = desc.split(' - ')[1]?.replace(/(\d)\s*nm\b/i, '$1 NM').trim() || `Station ${id}`;
    out.push({ id, where, lat: coords[1], lon: coords[0], img: img.replace(/^http:/, 'https:'), takenAt });
  }
  return out;
}

// realtime2 standard met file: two header lines, then newest row first.
// Missing values are "MM". Each reading takes the newest row that has it —
// waves are only reported hourly, wind every 10 min.
function parseObs(text) {
  const rows = text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.trim().split(/\s+/));
  const col = { WDIR: 5, WSPD: 6, GST: 7, WVHT: 8, PRES: 12 };
  const now = Date.now();
  const pick = (name) => {
    for (const r of rows) {
      const at = Date.UTC(+r[0], +r[1] - 1, +r[2], +r[3], +r[4]);
      if (now - at > MAX_OBS_AGE_MS) return null;
      const v = r[col[name]];
      if (v && v !== 'MM') return { v: Number(v), at };
    }
    return null;
  };
  const wdir = pick('WDIR'), wspd = pick('WSPD'), gst = pick('GST'), wvht = pick('WVHT'), pres = pick('PRES');
  if (!wspd && !wvht && !pres) return null;
  const MPS_TO_MPH = 2.23694;
  return {
    windDir: wdir ? compass(wdir.v) : null,
    windMph: wspd ? Math.round(wspd.v * MPS_TO_MPH) : null,
    gustMph: gst ? Math.round(gst.v * MPS_TO_MPH) : null,
    wavesFt: wvht ? Math.round(wvht.v * 3.28084) : null,
    presIn: pres ? (pres.v * 0.02953).toFixed(2) : null,
    at: new Date(Math.max(...[wspd, wvht, pres].filter(Boolean).map(x => x.at))),
  };
}

function compass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// onChange fires when the set of daylit cameras changes — first load,
// sunrise, sunset — so the director can fold the shot in (or drop it) within
// a stop instead of a lap later, the same signal tropical-storm.js gives.
export function createBuoycamSource(onChange) {
  let stations = [];
  let sig = '';
  const obs = new Map(); // id → parsed obs (or null when the fetch failed)
  const photos = new Map(); // photo URL → Promise<analyzePhoto result | null>
  const verdicts = new Map(); // photo URL → live-view count, once analyzed

  async function poll() {
    let delay = REFRESH_MS;
    try {
      stations = parseKml(await fetchText('kml/buoycams_as_kml.php'));
      const live = new Set(stations.map(s => s.img));
      for (const k of photos.keys()) if (!live.has(k)) { photos.delete(k); verdicts.delete(k); } // superseded photos
      const next = stations.filter(fresh).map(s => s.id).sort().join('|');
      if (next !== sig) { sig = next; onChange?.(); }
    } catch (err) {
      console.warn('[buoycam] station list fetch failed:', err);
      if (!stations.length) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  const fresh = s => Date.now() - s.takenAt.getTime() <= MAX_PHOTO_AGE_MS;

  // Analyze each photo once; a failed analysis resolves null (the card then
  // falls back to the raw photo, all six views).
  function photo(station) {
    if (!photos.has(station.img)) {
      photos.set(station.img, analyzePhoto(station.img).catch(err => {
        console.warn(`[buoycam] photo analysis failed for ${station.id}:`, err);
        return null;
      }));
    }
    return photos.get(station.img);
  }

  // Daylit cameras near a storm's current fix, closest first — minus any
  // whose latest photo turned out to be mostly dead views. Photos get
  // analyzed on first sight here, so by the time the planned shot comes up
  // the verdict (and the brightened image) is usually ready.
  function near(storm) {
    const fix = storm?.points?.[0]?.geometry?.coordinates;
    if (!fix) return [];
    const nearby = stations
      .filter(fresh)
      .map(s => ({ ...s, km: kmBetween(fix[1], fix[0], s.lat, s.lon) }))
      .filter(s => s.km <= NEAR_STORM_KM)
      .sort((a, b) => a.km - b.km);
    for (const s of nearby) {
      if (!photos.has(s.img)) photo(s).then(r => { if (r) verdicts.set(s.img, r.live.length); });
    }
    return nearby
      .filter(s => (verdicts.get(s.img) ?? VIEWS) >= MIN_LIVE_VIEWS)
      .slice(0, MAX_PER_STORM);
  }

  // Latest obs for one station — fetched on demand when its shot comes up
  // (a few stations at most, every several minutes). Resolves null on failure:
  // the photo is the shot, the numbers are a bonus.
  async function observations(id) {
    try {
      const o = parseObs(await fetchText(`data/realtime2/${id}.txt`));
      obs.set(id, o);
      return o;
    } catch (err) {
      console.warn(`[buoycam] obs fetch failed for ${id}:`, err);
      return obs.get(id) ?? null;
    }
  }

  return {
    start() { poll(); },
    near,
    photo,
    observations,
    get: () => stations,
  };
}
