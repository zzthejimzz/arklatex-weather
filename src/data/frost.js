// Frost/freeze & growing-season normals for the region's climate cities, from
// NCEI's 1991–2020 U.S. Climate Normals (Access Data Service: CORS-open, no
// key). Median (50% probability) spring last-freeze and fall first-freeze
// dates at the 32°F threshold, the 10/90 percentile spread around each (how
// much the date actually moves year to year), and the 28°F hard-freeze dates
// — the same figures county extension offices hand out for planting
// guidance. Static data (next normals release isn't until the 2030s), so
// this fetches once rather than polling.
import { fetchWithTimeout } from '../utils/net.js';

// [GHCND station id, on-air name, state] — same six cities as the almanac.
const CITIES = [
  ['USW00013957', 'Shreveport', 'LA'],
  ['USW00013972', 'Tyler',      'TX'],
  ['USC00418942', 'Texarkana',  'AR'],
  ['USW00003901', 'Longview',   'TX'],
  ['USW00013942', 'Monroe',     'LA'],
  ['USW00093987', 'Lufkin',     'TX'],
];

const ENDPOINT = 'https://www.ncei.noaa.gov/access/services/data/v1';
const RETRY_MS = 30 * 60 * 1000;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// NCEI returns freeze dates as "MM/DD" strings (the normal, not tied to any
// particular year) — turn one into a label + day-of-year for bar placement.
function parseMD(s) {
  const m = /^(\d{2})\/(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]);
  let doy = dd;
  for (let i = 0; i < mm - 1; i++) doy += MONTH_DAYS[i];
  return { label: `${MONTH_ABBR[mm - 1]} ${dd}`, doy };
}

const earlier = (a, b) => (a && b ? (a.doy <= b.doy ? a : b) : (a ?? b));
const later = (a, b) => (a && b ? (a.doy >= b.doy ? a : b) : (a ?? b));

function url() {
  const params = new URLSearchParams({
    dataset: 'normals-annualseasonal',
    stations: CITIES.map(c => c[0]).join(','),
    // Normals aren't tied to a year — any single date returns the full record.
    startDate: '2010-01-01',
    endDate: '2010-01-01',
    format: 'json',
  });
  return `${ENDPOINT}?${params}`;
}

// Field naming: ANN-TMIN-PRB{FST|LST}-T{threshold}FP{probability}. FST =
// first fall freeze, LST = last spring freeze, GSL = growing season length
// (days between them). The FP10/FP90 pair brackets the middle 80% of years —
// which raw field is the earlier date isn't consistent between FST and LST,
// so earlier()/later() sort them rather than assuming a side.
function build(row) {
  const fst50 = parseMD(row['ANN-TMIN-PRBFST-T32FP50']);
  const fst10 = parseMD(row['ANN-TMIN-PRBFST-T32FP10']);
  const fst90 = parseMD(row['ANN-TMIN-PRBFST-T32FP90']);
  const lst50 = parseMD(row['ANN-TMIN-PRBLST-T32FP50']);
  const lst10 = parseMD(row['ANN-TMIN-PRBLST-T32FP10']);
  const lst90 = parseMD(row['ANN-TMIN-PRBLST-T32FP90']);
  const gsl = parseInt(row['ANN-TMIN-PRBGSL-T32FP50'], 10);
  if (!fst50 || !lst50 || !Number.isFinite(gsl)) return null;
  return {
    lastFreeze: { median: lst50, early: earlier(lst10, lst90), late: later(lst10, lst90) },
    firstFreeze: { median: fst50, early: earlier(fst10, fst90), late: later(fst10, fst90) },
    growingSeasonDays: gsl,
    hardFreeze: {
      last: parseMD(row['ANN-TMIN-PRBLST-T28FP50']),
      first: parseMD(row['ANN-TMIN-PRBFST-T28FP50']),
    },
  };
}

export function createFrostSource() {
  let cities = []; // built entries, CITIES order (unresolved cities dropped)

  async function fetchOnce() {
    let retry = false;
    try {
      const res = await fetchWithTimeout(url(), { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const byStation = new Map(rows.map(r => [r.STATION, r]));
      cities = CITIES
        .map(([sid, name, state]) => {
          const info = byStation.has(sid) ? build(byStation.get(sid)) : null;
          return info && { name, state, ...info };
        })
        .filter(Boolean);
      if (!cities.length) throw new Error('no cities resolved');
    } catch (err) {
      console.warn('[frost] fetch failed:', err);
      retry = true;
    } finally {
      if (retry) setTimeout(fetchOnce, RETRY_MS);
    }
  }

  return {
    start() { fetchOnce(); },
    ready: () => cities.length > 0,
    get: () => cities,
  };
}
