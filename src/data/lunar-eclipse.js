// Lunar eclipse events. A handful of nights a year at most, so this is a
// small static datebook (like a launch calendar) rather than a live feed —
// timing/geometry doesn't need fetching, just adding an entry ahead of the
// next one. "Viewing chance" is the one part that's actually live: it reads
// the NWS hourly forecast's shortForecast wording for the hours spanning the
// partial phase (same text forecast.js already parses for its icon picks)
// and reports the cloudiest hour in that window, since a single bad stretch
// during the show is enough to spoil it.
import { fetchWithTimeout } from '../utils/net.js';

// Anchor point: Shreveport-ish center of the CWA, same as the Sun & Daylight
// card. Cloud cover varies more locally than sunrise/sunset does, but this is
// the "is tonight worth stepping outside" read, not a per-county forecast.
const LAT = 32.525;
const LON = -93.750;

const REFRESH_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;

// All stage times are UTC ISO strings — rendered in America/Chicago at
// display time via utils/time.js, so DST is handled for free.
// Source: NASA/EarthSky August 27-28, 2026 circumstances (umbral magnitude
// 0.93, greatest eclipse 04:13 UTC Aug 28 = 11:13 PM CDT Aug 27), cross-
// checked against wire reports of "11:12 PM CT" for maximum.
export const EVENTS = [
  {
    id: '2026-08-28',
    type: 'Deep Partial Lunar Eclipse',
    magnitudePct: 96,
    stages: [
      { stage: 'Penumbral begins', time: '2026-08-28T01:24:00Z', note: 'Faint shading starts creeping onto the disk — easy to miss with the naked eye.' },
      { stage: 'Partial begins', time: '2026-08-28T02:33:00Z', note: "Earth's umbra starts biting into the Moon — this is when it gets worth watching." },
      { stage: 'Maximum eclipse', time: '2026-08-28T04:13:00Z', note: '96% of the Moon sits in shadow — about as deep as a partial eclipse gets, with a coppery-red tint on the shaded part.' },
      { stage: 'Partial ends', time: '2026-08-28T05:52:00Z', note: 'The umbra recedes off the disk.' },
      { stage: 'Penumbral ends', time: '2026-08-28T07:01:00Z', note: 'Eclipse complete.' },
    ],
    facts: [
      'Visible from all 50 U.S. states, with the entire event visible across the Central and Eastern time zones.',
      "At 96%, this is about as deep as a partial eclipse gets without crossing into total — the sliver of Moon left in direct sunlight stays bright while the rest goes coppery-red.",
      "The red tint comes from sunlight bending through Earth's atmosphere onto the Moon — the same effect that reddens sunrises and sunsets.",
    ],
  },
];

// Sky-condition wording (identical vocabulary to forecast.js's shortForecast
// text) bucketed into a viewing-chance tier. Order matters, first match wins:
// precip/obscuration beats any cloud reading, and the "partly" qualifiers
// must be checked before the bare "cloudy"/"clear" they contain as substrings.
const SKY_RULES = [
  [/tornado|thunder|rain|shower|drizzle|snow|sleet|freezing|fog|haze|smoke/i, 'poor'],
  [/partly cloudy|partly sunny/i, 'fair'],
  [/mostly cloudy|overcast|cloudy/i, 'poor'],
  [/mostly clear|mostly sunny/i, 'good'],
  [/clear|sunny|fair/i, 'great'],
];
const TIER_RANK = ['poor', 'fair', 'good', 'great'];
export const VIEWING_TIERS = {
  poor: { label: 'Poor Viewing', color: '#f87171', blurb: 'Clouds are likely to spoil the view — a livestream is the safer bet tonight.' },
  fair: { label: 'Fair Viewing', color: '#fbbf24', blurb: 'Partly cloudy skies — you may catch it in gaps between clouds.' },
  good: { label: 'Good Viewing', color: '#a3e635', blurb: 'Mostly clear skies — conditions favor a good look.' },
  great: { label: 'Great Viewing', color: '#4ade80', blurb: 'Clear skies expected — about as good as eclipse-watching gets.' },
};

function classifySky(shortForecast = '') {
  for (const [re, tier] of SKY_RULES) if (re.test(shortForecast)) return tier;
  return 'fair'; // unrecognized wording — assume the middle rather than oversell it
}

// The event to surface: from the afternoon before first penumbral contact
// through the following morning, so the card can run as a "tonight" teaser
// during the day and still make sense if it's airing after midnight.
function activeEvent(now = new Date()) {
  return EVENTS.find(ev => {
    const first = new Date(ev.stages[0].time);
    const last = new Date(ev.stages[ev.stages.length - 1].time);
    return now >= new Date(first.getTime() - 12 * 3600_000) && now <= new Date(last.getTime() + 3 * 3600_000);
  }) ?? null;
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// Worst (cloudiest) tier among the NWS hourly periods overlapping the
// partial-phase window — the part of the show people are actually out for.
async function viewingChanceFor(event) {
  const pt = await fetchJson(`https://api.weather.gov/points/${LAT},${LON}`);
  const hourly = await fetchJson(pt.properties.forecastHourly);
  const start = new Date(event.stages[1].time); // partial begins
  const end = new Date(event.stages[3].time);   // partial ends
  const periods = (hourly.properties?.periods ?? [])
    .filter(p => new Date(p.endTime) > start && new Date(p.startTime) < end);
  if (!periods.length) return null; // event too far out for the 7-day hourly window
  let worst = 'great';
  for (const p of periods) {
    const t = classifySky(p.shortForecast);
    if (TIER_RANK.indexOf(t) < TIER_RANK.indexOf(worst)) worst = t;
  }
  return { tier: worst, ...VIEWING_TIERS[worst] };
}

export function createLunarEclipseSource() {
  let data = null;
  let timer = null;

  async function poll() {
    let delay = REFRESH_MS;
    const event = activeEvent();
    if (!event) {
      data = null;
      timer = setTimeout(poll, REFRESH_MS);
      return;
    }
    try {
      const viewingChance = await viewingChanceFor(event);
      data = { event, viewingChance, updatedAt: new Date() };
    } catch (err) {
      console.warn('[lunar-eclipse] viewing-chance fetch failed:', err);
      if (!data || data.event !== event) data = { event, viewingChance: null, updatedAt: new Date() };
      delay = RETRY_MS;
    } finally {
      timer = setTimeout(poll, delay);
    }
  }

  return {
    start() { poll(); },
    stop() { clearTimeout(timer); },
    ready: () => data != null,
    get: () => data,
  };
}
