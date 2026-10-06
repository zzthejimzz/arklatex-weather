// Year-to-date warnings & watches — a quiet-day filler summarizing how much
// severe weather the local office has actually issued this year, from the
// Iowa Environmental Mesonet's VTEC archive (CORS-open, no key, complete
// back to 1986). Scoped to wfo=SHV — the same Shreveport County Warning Area
// the whole app's region file is built from, so this always matches what the
// live map would have shown.
//
// Beyond the per-hazard tally it derives the season's shape: last year's
// count at this same date (pace), storm warnings by month, the busiest day,
// warnings per county (the card's map layer), and the last tornado warning.
import { fetchWithTimeout } from '../utils/net.js';
import { styleForEvent } from '../utils/alert-style.js';

const ENDPOINT = 'https://mesonet.agron.iastate.edu/json/vtec_events_bywfo.py';
const WFO = 'SHV';
const REFRESH_MS = 3 * 60 * 60 * 1000; // a yearly tally barely moves hour to hour
const RETRY_MS = 30 * 60 * 1000;

// phenomena/significance pairs bucketed per category, each keyed to a
// representative NWS event name so color + icon come straight from
// alert-style.js (the same palette the map itself uses) instead of a second
// hardcoded copy. Categories that fold multiple VTEC types together (flood
// warning+advisory, the heat tiers, the winter-weather tiers) show under the
// warning-tier color; the count still includes every tier folded in.
// Order is the on-air tile order: storm hazards first, then the seasonal ones.
const CATEGORIES = [
  { key: 'tor',   label: 'Tornado',      rep: 'Tornado Warning',             match: [['TO', 'W']] },
  { key: 'svr',   label: 'Severe Storm', rep: 'Severe Thunderstorm Warning', match: [['SV', 'W']] },
  { key: 'ffw',   label: 'Flash Flood',  rep: 'Flash Flood Warning',         match: [['FF', 'W']] },
  { key: 'fld',   label: 'Flood',        rep: 'Flood Warning',               match: [['FL', 'W'], ['FA', 'W'], ['FA', 'Y']] },
  { key: 'watch', label: 'Watches',      rep: 'Tornado Watch',               match: [['TO', 'A'], ['SV', 'A']] },
  // NWS VTEC's phenomena code for Excessive Heat is "XH", not the "EH" the
  // event-name regex might suggest — confirmed against a live SHV product
  // (alerts.js has a real XH.W example in its own comments).
  { key: 'heat',  label: 'Heat',         rep: 'Heat Advisory',               match: [['HT', 'Y'], ['XH', 'W'], ['XH', 'A']] },
  { key: 'wtr',   label: 'Winter',       rep: 'Winter Weather Advisory',     match: [['WS', 'W'], ['WW', 'Y'], ['IS', 'W']] },
];

// The convective "storm warnings" — what the month strip, busiest day and
// county map count. Floods/heat/winter are slow, zone-wide, or seasonal and
// would swamp the picture of where storms actually hit.
const STORM = new Set(['SV.W', 'TO.W', 'FF.W']);

const TZ = 'America/Chicago';
const monthDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

function categoryFor(phenomena, significance) {
  return CATEGORIES.find(c => c.match.some(([p, s]) => p === phenomena && s === significance));
}

// Central-time month index (0–11) and "M/D" day key for an ISO timestamp.
function localParts(iso) {
  const parts = monthDayFmt.formatToParts(new Date(iso));
  const m = +parts.find(p => p.type === 'month').value;
  const d = +parts.find(p => p.type === 'day').value;
  return { month: m - 1, dayKey: `${m}/${d}` };
}

// One row per UGC zone an event covered — same "one VTEC id, many segments"
// shape alerts.js dedupes for the live feed. Events are keyed by phenomena +
// significance + eventid (wfo is constant, we only ever request one); county
// hits additionally by UGC.
function tally(events, cutoffMs = Infinity) {
  const seen = new Set();
  const counts = new Map(CATEGORIES.map(c => [c.key, 0]));
  const months = Array.from({ length: 12 }, () => ({ svr: 0, tor: 0, ffw: 0 }));
  const days = new Map();
  const countySeen = new Set();
  const counties = {};
  let lastTornado = null;

  for (const e of events) {
    if (Date.parse(e.issue) > cutoffMs) continue;
    const cat = categoryFor(e.phenomena, e.significance);
    if (!cat) continue;
    const vtec = `${e.phenomena}.${e.significance}`;
    const id = `${vtec}.${e.eventid}`;
    const storm = STORM.has(vtec);

    if (storm && e.ugc && !countySeen.has(`${id}.${e.ugc}`)) {
      countySeen.add(`${id}.${e.ugc}`);
      counties[e.ugc] = (counties[e.ugc] ?? 0) + 1;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    counts.set(cat.key, counts.get(cat.key) + 1);

    if (storm) {
      const { month, dayKey } = localParts(e.issue);
      months[month][cat.key] += 1;
      days.set(dayKey, { count: (days.get(dayKey)?.count ?? 0) + 1, iso: e.issue });
    }
    if (vtec === 'TO.W' && (!lastTornado || e.issue > lastTornado)) lastTornado = e.issue;
  }

  let busiest = null;
  for (const d of days.values()) if (!busiest || d.count > busiest.count) busiest = d;

  return {
    counts,
    total: [...counts.values()].reduce((a, b) => a + b, 0),
    months,
    warnDays: days.size,
    busiest: busiest && { date: shortDateFmt.format(new Date(busiest.iso)), count: busiest.count },
    counties,
    lastTornado,
  };
}

async function fetchYear(year) {
  const res = await fetchWithTimeout(`${ENDPOINT}?wfo=${WFO}&year=${year}`, { timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).events ?? [];
}

/**
 * @param {object} [opts]
 * @param {Record<string, {name: string, state: string}>} [opts.zones]  region
 *        county lookup (geo/arklatex.json) for naming the most-warned county
 */
export function createWarningsYtdSource({ zones = {} } = {}) {
  let data = null;
  // Last year's archive is closed history — fetch it once per calendar year.
  let prev = { year: null, events: null };

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const now = new Date();
      const year = now.getFullYear();
      const events = await fetchYear(year);
      if (prev.year !== year - 1) {
        try {
          prev = { year: year - 1, events: await fetchYear(year - 1) };
        } catch (err) {
          console.warn('[warnings-ytd] last-year fetch failed (pace omitted):', err);
        }
      }

      const cur = tally(events);
      // Same moment last year — a fair "pace" comparison, not a full-year one.
      const cutoff = new Date(now);
      cutoff.setFullYear(year - 1);
      const last = prev.events ? tally(prev.events, cutoff.getTime()) : null;

      const top = Object.entries(cur.counties)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([ugc, count]) => ({ ugc, count, name: zones[ugc]?.name ?? ugc, state: zones[ugc]?.state ?? '' }));

      data = {
        year,
        total: cur.total,
        prevTotal: last?.total ?? null,
        categories: CATEGORIES.map(c => {
          const style = styleForEvent(c.rep);
          return {
            key: c.key, label: c.label, color: style.color, iconHtml: style.icon,
            count: cur.counts.get(c.key), prev: last ? last.counts.get(c.key) : null,
          };
        }),
        months: cur.months,
        monthNow: localParts(now.toISOString()).month,
        warnDays: cur.warnDays,
        prevWarnDays: last?.warnDays ?? null,
        busiest: cur.busiest,
        counties: cur.counties,
        top,
        lastTornado: cur.lastTornado,
        updated: Date.now(),
      };
    } catch (err) {
      console.warn('[warnings-ytd] fetch failed:', err);
      if (!data) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  return {
    start() { poll(); },
    ready: () => data != null,
    get: () => data,
  };
}
