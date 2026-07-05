// Local Storm Reports via Iowa State Mesonet — aggregates the NWS LSR product
// stream (trained spotters, emergency management, broadcast media, and public
// mPING reports relayed by the offices). Free, no API key.
//
// Reports are ground truth: "wind damage reported HERE" is stronger on air
// than any polygon. We keep the last few hours on the map and hand the
// director a short list of tour-worthy ones (recent + significant).
import { pointInGeometry } from '../utils/geometry.js';

const LSR_URL = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=3&states=AR,LA,TX,OK';
const POLL_MS = 2 * 60 * 1000;
// If a pin is on the map (3 h feed window) it's eligible for a camera visit —
// the card shows its age, so staleness is transparent on air. Priority 50
// admits measured gusts (55) but keeps heavy rain / lightning (40) map-only.
const TOUR_WINDOW_MS = 3 * 60 * 60 * 1000;
const TOUR_MAX = 3;
const TOUR_PRIORITY = 50;

// typetext → visual identity + base tour priority. Colors echo the alert
// palette (utils/alert-style.js) so a hail report reads with hail-ish cyan etc.
const TYPES = [
  [/TORNADO/i,               { icon: '🌪️', label: 'Tornado',      color: '#ff2b2b', priority: 100 }],
  [/TSTM WND DMG/i,          { icon: '🌳', label: 'Wind Damage',  color: '#ffd23f', priority: 80 }],
  [/FUNNEL/i,                { icon: '🌪️', label: 'Funnel Cloud', color: '#ff8c1a', priority: 70 }],
  [/FLASH FLOOD/i,           { icon: '🌊', label: 'Flash Flooding', color: '#2ecc55', priority: 65 }],
  [/FLOOD/i,                 { icon: '💧', label: 'Flooding',     color: '#00a878', priority: 60 }],
  [/HAIL/i,                  { icon: '🧊', label: 'Hail',         color: '#22d3ee', priority: 60 }],
  [/TSTM WND GST|HIGH WIND/i,{ icon: '💨', label: 'Wind Gust',    color: '#d8b25c', priority: 55 }],
  [/HEAVY RAIN/i,            { icon: '🌧️', label: 'Heavy Rain',   color: '#57d9a3', priority: 40 }],
  [/LIGHTNING/i,             { icon: '⚡', label: 'Lightning',    color: '#a855f7', priority: 40 }],
];

function styleForType(typetext = '') {
  for (const [re, style] of TYPES) {
    if (re.test(typetext)) return style;
  }
  const label = typetext.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return { icon: '📋', label: label || 'Storm Report', color: '#9bb0d3', priority: 30 };
}

function formatMagnitude(p) {
  const v = Number.isFinite(p.magf) ? p.magf : parseFloat(p.magnitude);
  if (!Number.isFinite(v) || v <= 0) return null;
  const qual = p.qualifier === 'M' ? ' (measured)' : p.qualifier === 'E' ? ' (estimated)' : '';
  if (/mph/i.test(p.unit ?? '')) return `${Math.round(v)} mph${qual}`;
  if (/inch/i.test(p.unit ?? '')) return `${v.toFixed(2)}"${qual}`;
  return `${v}${p.unit ? ` ${p.unit}` : ''}`;
}

// Significance bumps: big hail and truly severe measured gusts tour even
// though their base types usually don't.
function priorityFor(style, p) {
  let pr = style.priority;
  const v = Number.isFinite(p.magf) ? p.magf : NaN;
  if (/HAIL/i.test(p.typetext) && v >= 1.75) pr += 15;
  if (/WND GST/i.test(p.typetext) && v >= 60) pr += 20;
  return pr;
}

function enrichReport(feature) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const style = styleForType(p.typetext);
  return {
    // product_id alone isn't unique — one LSR product carries many reports
    id: `${p.product_id}|${p.typetext}|${p.valid}|${lon},${lat}`,
    style,
    priority: priorityFor(style, p),
    magnitude: formatMagnitude(p),
    city: p.city,
    county: p.county,
    st: p.st,
    wfo: p.wfo,
    source: p.source,
    remark: p.remark ?? '',
    valid: p.valid,
    lat,
    lon,
  };
}

// The short list the director may zoom to: recent, significant, newest first.
export function pickTourReports(reports, max = TOUR_MAX) {
  const cutoff = Date.now() - TOUR_WINDOW_MS;
  return reports
    .filter(r => r.priority >= TOUR_PRIORITY && new Date(r.valid).getTime() >= cutoff)
    .sort((a, b) => b.priority - a.priority || new Date(b.valid) - new Date(a.valid))
    .slice(0, max);
}

export function createReportsSource(geo) {
  const hull = geo?.hull ? { type: 'Polygon', coordinates: [geo.hull] } : null;
  const seen = new Set();
  let first = true;
  let timer = null;

  return {
    start(onUpdate) {
      const poll = async () => {
        try {
          const res = await fetch(LSR_URL);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const reports = (data.features ?? [])
            .filter(f => f.geometry?.type === 'Point')
            .filter(f => !hull || pointInGeometry(f.geometry.coordinates, hull))
            .map(enrichReport)
            .sort((a, b) => new Date(b.valid) - new Date(a.valid));

          // Same first-poll suppression as alerts: booting mid-event shouldn't
          // mark three hours of backlog as "new".
          const added = first ? [] : reports.filter(r => !seen.has(r.id));
          for (const r of reports) seen.add(r.id);
          first = false;

          onUpdate({ reports, added });
        } catch (err) {
          console.error('[reports] LSR poll failed:', err);
        } finally {
          timer = setTimeout(poll, POLL_MS);
        }
      };
      poll();
    },
    stop() { clearTimeout(timer); },
  };
}
