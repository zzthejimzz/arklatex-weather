// Year-to-date warnings & watches — a quiet-day filler summarizing how much
// severe weather the local office has actually issued this year, from the
// Iowa Environmental Mesonet's VTEC archive (CORS-open, no key, complete
// back to 1986). Scoped to wfo=SHV — the same Shreveport County Warning Area
// the whole app's region file is built from, so this always matches what the
// live map would have shown.
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
const CATEGORIES = [
  { key: 'svr',   label: 'Severe T-storm Warnings',    rep: 'Severe Thunderstorm Warning', match: [['SV', 'W']] },
  { key: 'tor',   label: 'Tornado Warnings',            rep: 'Tornado Warning',             match: [['TO', 'W']] },
  { key: 'ffw',   label: 'Flash Flood Warnings',        rep: 'Flash Flood Warning',         match: [['FF', 'W']] },
  { key: 'fld',   label: 'Flood Warnings & Advisories', rep: 'Flood Warning',               match: [['FL', 'W'], ['FA', 'W'], ['FA', 'Y']] },
  // NWS VTEC's phenomena code for Excessive Heat is "XH", not the "EH" the
  // event-name regex might suggest — confirmed against a live SHV product
  // (alerts.js has a real XH.W example in its own comments).
  { key: 'heat',  label: 'Heat Advisories & Warnings',  rep: 'Heat Advisory',               match: [['HT', 'Y'], ['XH', 'W'], ['XH', 'A']] },
  { key: 'wtr',   label: 'Winter Weather Events',       rep: 'Winter Weather Advisory',     match: [['WS', 'W'], ['WW', 'Y'], ['IS', 'W']] },
  { key: 'watch', label: 'Severe Weather Watches',      rep: 'Tornado Watch',               match: [['TO', 'A'], ['SV', 'A']] },
];

function categoryFor(phenomena, significance) {
  return CATEGORIES.find(c => c.match.some(([p, s]) => p === phenomena && s === significance));
}

// One row per UGC zone an event covered — same "one VTEC id, many segments"
// shape alerts.js dedupes for the live feed, here deduped by phenomena +
// significance + eventid (wfo is constant, we only ever request one).
function tally(events) {
  const seen = new Set();
  const counts = new Map(CATEGORIES.map(c => [c.key, 0]));
  for (const e of events) {
    const cat = categoryFor(e.phenomena, e.significance);
    if (!cat) continue;
    const id = `${e.phenomena}.${e.significance}.${e.eventid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    counts.set(cat.key, counts.get(cat.key) + 1);
  }
  const categories = CATEGORIES
    .map(c => {
      const style = styleForEvent(c.rep);
      return { key: c.key, label: c.label, color: style.color, iconHtml: style.icon, count: counts.get(c.key) };
    })
    .sort((a, b) => b.count - a.count);
  return { categories, total: categories.reduce((sum, c) => sum + c.count, 0) };
}

export function createWarningsYtdSource() {
  let data = null;

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const year = new Date().getFullYear();
      const url = `${ENDPOINT}?wfo=${WFO}&year=${year}`;
      const res = await fetchWithTimeout(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const { categories, total } = tally(body.events ?? []);
      data = { year, categories, total, updated: Date.now() };
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
