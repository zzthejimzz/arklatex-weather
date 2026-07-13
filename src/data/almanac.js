// Daily climate almanac — today's normal and record high/low for the region's
// climate cities, from the RCC ACIS web service (data.rcc-acis.org: free,
// no key, CORS-open; the same backend xmACIS uses). ThreadEx ids where they
// exist (century-plus threaded records), the airport station otherwise.
// Two small POSTs per city, refreshed once a day just after local midnight.
import { fetchWithTimeout } from '../utils/net.js';

// [acisSid, on-air name, state, obs station id (matches observations.js)]
const CITIES = [
  ['SHVthr 9', 'Shreveport', 'LA', 'KSHV'],
  ['TYRthr 9', 'Tyler',      'TX', 'KTYR'],
  ['TXK',      'Texarkana',  'AR', 'KTXK'],
  ['GGGthr 9', 'Longview',   'TX', 'KGGG'],
  ['MLUthr 9', 'Monroe',     'LA', 'KMLU'],
  ['LFK',      'Lufkin',     'TX', 'KLFK'],
];

const ENDPOINT = 'https://data.rcc-acis.org/StnData';
const RETRY_MS = 30 * 60 * 1000;

// The stream clock is Central; the machine runs in Central. Local date keys
// both the queries and the staleness check.
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function msToNextMidnight() {
  const next = new Date();
  next.setHours(24, 5, 0, 0); // 12:05 AM — give ACIS a beat to roll the day
  return next - Date.now();
}

async function query(body) {
  const res = await fetchWithTimeout(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const num = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

async function fetchCity([sid, name, state, obsId], date) {
  const mmdd = date.slice(5); // "MM-DD"
  const rec = { interval: 'dly', duration: 'dly', smry_only: 1, groupby: ['year', mmdd, mmdd] };
  const [normals, records] = await Promise.all([
    query({
      sid, sdate: date, edate: date,
      elems: [{ name: 'maxt', normal: '1' }, { name: 'mint', normal: '1' }],
    }),
    query({
      sid, sdate: 'por', edate: 'por',
      meta: ['name', 'valid_daterange'],
      elems: [
        { name: 'maxt', ...rec, smry: { reduce: 'max', add: 'date' } },
        { name: 'mint', ...rec, smry: { reduce: 'min', add: 'date' } },
      ],
    }),
  ]);
  const [, nHi, nLo] = normals.data?.[0] ?? [];
  const [recHi, recHiDate] = records.smry?.[0]?.[0] ?? [];
  const [recLo, recLoDate] = records.smry?.[1]?.[0] ?? [];
  const since = num(records.meta?.valid_daterange?.[0]?.[0]?.slice(0, 4));
  return {
    name, state, obsId,
    normalHi: num(nHi), normalLo: num(nLo),
    recordHi: num(recHi), recordHiYear: num(recHiDate?.slice(0, 4)),
    recordLo: num(recLo), recordLoYear: num(recLoDate?.slice(0, 4)),
    since,
  };
}

export function createAlmanacSource() {
  let cities = []; // today's entries, CITIES order (failed cities dropped)
  let forDate = null;

  async function refresh() {
    const date = localDateStr();
    let delay;
    try {
      const results = await Promise.allSettled(CITIES.map(c => fetchCity(c, date)));
      const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value)
        .filter(c => c.normalHi != null && c.recordHi != null);
      const failed = results.length - ok.length;
      if (failed) console.warn(`[almanac] ${failed} of ${CITIES.length} cities failed`);
      if (ok.length) {
        cities = ok;
        forDate = date;
        delay = msToNextMidnight();
      } else {
        throw new Error('no cities resolved');
      }
    } catch (err) {
      console.warn('[almanac] fetch failed:', err);
      delay = RETRY_MS;
    } finally {
      setTimeout(refresh, delay);
    }
  }

  return {
    start() { refresh(); },
    // Fresh means "for today" — yesterday's records are the wrong story.
    ready: () => cities.length > 0 && forDate === localDateStr(),
    get: () => cities,
    dateLabel: () =>
      new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
  };
}
