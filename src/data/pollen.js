// Pollen forecast for the region's climate cities, from Pollen.com's (IQVIA)
// forecast API — the only keyless US pollen source (Open-Meteo's pollen
// fields are Europe-only nulls here; Google/Ambee/Tomorrow.io all need keyed
// accounts). Unofficial endpoint: it 403s without a pollen.com Referer and a
// browser User-Agent, so every mode rides a proxy that attaches them (vite
// dev/preview proxies, deploy/serve.js). Per-ZIP product: a 0–12 index with
// the dominant allergens named (current) plus a 5-day index trend (extended).
import { fetchWithTimeout } from '../utils/net.js';
import { icon } from '../ui/icons.js';

const IS_DEV = import.meta.env.DEV;
const UPSTREAM = 'https://www.pollen.com/api';

// [ZIP, lat, lon, on-air name, state] — same six cities as the almanac/frost cards.
const CITIES = [
  ['71101', 32.525, -93.750, 'Shreveport', 'LA'],
  ['75701', 32.351, -95.301, 'Tyler',      'TX'],
  ['71854', 33.425, -94.048, 'Texarkana',  'AR'],
  ['75601', 32.500, -94.740, 'Longview',   'TX'],
  ['71201', 32.510, -92.119, 'Monroe',     'LA'],
  ['75901', 31.338, -94.729, 'Lufkin',     'TX'],
];

const REFRESH_MS = 2 * 60 * 60 * 1000; // daily product; a couple checks a day is plenty
const RETRY_MS = 30 * 60 * 1000;

// IQVIA's own 0–12 index categories + plain-language allergy guidance.
export const POLLEN_SCALE = [
  { max: 2.4,      label: 'Low',         color: '#4ade80', advice: 'Little to bother most allergy sufferers — a good day to be outside.' },
  { max: 4.8,      label: 'Low-Medium',  color: '#a3e635', advice: 'Mild — only the most pollen-sensitive will notice symptoms.' },
  { max: 7.2,      label: 'Medium',      color: '#facc15', advice: 'Sneezing weather — take allergy medication before heading out.' },
  { max: 9.6,      label: 'Medium-High', color: '#fb923c', advice: 'Enough to bother most allergy sufferers — limit time outside on breezy afternoons.' },
  { max: Infinity, label: 'High',        color: '#f87171', advice: 'Rough day for allergies — keep windows closed and shower after yard work.' },
];

export function pollenInfo(index) {
  return POLLEN_SCALE.find(b => index <= b.max) ?? POLLEN_SCALE[POLLEN_SCALE.length - 1];
}

const TYPE_ICONS = { Tree: icon('tree'), Grass: icon('grass'), Weed: icon('weed') };

function url(kind, zip) {
  const path = `forecast/${kind}/pollen/${zip}`;
  if (IS_DEV) return `/api/pollen/${path}`;
  return `/proxy.php?url=${encodeURIComponent(`${UPSTREAM}/${path}`)}`;
}

async function fetchJson(kind, zip) {
  const res = await fetchWithTimeout(url(kind, zip), { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ForecastDate carries the site's own UTC offset ("2026-07-17T00:00:00-04:00")
// — midnight there is the previous evening here, so Date-parsing it would
// label the card a day early. The calendar date substring is the truth.
function dateLabel(iso) {
  const [y, m, d] = (iso ?? '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function fetchCity([zip, lat, lon, name, state]) {
  const current = await fetchJson('current', zip);
  const periods = current?.Location?.periods ?? [];
  const today = periods.find(p => p.Type === 'Today');
  const index = Number(today?.Index);
  if (!Number.isFinite(index)) throw new Error('no Today period');
  const { label, color, advice } = pollenInfo(index);
  const triggers = (today.Triggers ?? []).map(t => ({
    name: t.Name,
    icon: TYPE_ICONS[t.PlantType] ?? icon('flower'),
  }));

  // The 5-day trend is a separate product — a miss only costs the strip.
  let days = [];
  try {
    const ext = await fetchJson('extended', zip);
    days = (ext?.Location?.periods ?? [])
      .map(p => {
        const v = Number(p.Index);
        const d = new Date(p.Period); // no offset on these — parses as local
        if (!Number.isFinite(v) || Number.isNaN(d.getTime())) return null;
        return { dow: d.toLocaleDateString('en-US', { weekday: 'short' }), index: v, color: pollenInfo(v).color };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[pollen] extended fetch failed for ${name}:`, err);
  }

  return { name, state, lat, lon, index, label, color, advice, triggers, days, date: dateLabel(current.ForecastDate) };
}

export function createPollenSource() {
  let cities = []; // CITIES order, failed cities dropped

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const results = await Promise.allSettled(CITIES.map(fetchCity));
      const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (!ok.length) throw new Error('no cities resolved');
      cities = ok;
    } catch (err) {
      console.warn('[pollen] fetch failed:', err);
      if (!cities.length) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  return {
    start() { poll(); },
    ready: () => cities.length > 0,
    get: () => cities,
  };
}
