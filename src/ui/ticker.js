// Bottom scrolling ticker. Rotating content, most urgent first:
//   active alerts → SPC Day 1 risk for the region → live city observations →
//   branding line. New content swaps in at the loop seam (animationiteration)
//   so the scroll never visibly jumps. (Phase 4: now-playing music info.)
import { styleForEvent } from '../utils/alert-style.js';
import { formatLocalTime } from '../utils/time.js';
import { fetchOutlook } from '../utils/spc-api.js';
import { CATEGORICAL, normalizeLabel } from '../utils/map-colors.js';
import { geometriesIntersect } from '../utils/geometry.js';
import { fetchWithTimeout } from '../utils/net.js';

const STATIONS = [
  ['Shreveport', 'KSHV'],
  ['Texarkana', 'KTXK'],
  ['Tyler', 'KTYR'],
  ['Longview', 'KGGG'],
  ['Monroe', 'KMLU'],
  ['Lufkin', 'KLFK'],
];
const BRAND = 'ARKLATEX WEATHER LIVE · 24/7 coverage for NE Texas · NW Louisiana · SW Arkansas · SE Oklahoma';
const OBS_MS = 10 * 60 * 1000;
const OUTLOOK_MS = 15 * 60 * 1000;
const SCROLL_PX_PER_S = 90;

export function createTicker(el, geo) {
  el.innerHTML = `
    <div class="ticker-track">
      <div class="ticker-content"></div>
      <div class="ticker-content" aria-hidden="true"></div>
    </div>`;
  const track = el.querySelector('.ticker-track');
  const contents = el.querySelectorAll('.ticker-content');

  let alerts = [];
  const obs = new Map(); // city → { tempF, windMph, desc }
  let outlookText = null;
  let pendingHtml = null;

  function buildItems() {
    const items = [];
    for (const a of alerts) {
      const areas = (a.props.areaDesc ?? '').split(';').map(s => s.trim()).filter(Boolean);
      const areaText = areas.length > 3
        ? `${areas.slice(0, 3).join(', ')} +${areas.length - 3}`
        : areas.join(', ');
      const s = styleForEvent(a.props.event);
      items.push(
        `<span class="tk-icon">${s.icon}</span>` +
        `<b style="color:${s.color}">${a.props.event}</b> ${areaText} · until ${formatLocalTime(a.props.expires)}`,
      );
    }
    if (outlookText) items.push(`<span class="tk-icon">⚡</span>${outlookText}`);

    const obsParts = STATIONS
      .map(([city]) => ({ city, o: obs.get(city) }))
      .filter(({ o }) => o?.tempF != null)
      .map(({ city, o }) => `${city} <b>${o.tempF}°</b>${o.windMph ? ` <span class="tk-dim">${o.windMph} mph</span>` : ''}`);
    if (obsParts.length) items.push(`<span class="tk-icon">🌡️</span>${obsParts.join(' &nbsp;·&nbsp; ')}`);

    items.push(`<span class="tk-icon">📺</span>${BRAND}`);
    return items;
  }

  function rebuild() {
    pendingHtml = buildItems()
      .map(i => `<span class="tk-item">${i}</span>`)
      .join('<span class="tk-sep">◆</span>');
    if (!contents[0].innerHTML) apply(); // first fill — don't wait for the seam
  }

  function apply() {
    if (!pendingHtml) return;
    contents.forEach(c => { c.innerHTML = pendingHtml; });
    pendingHtml = null;
    // Constant scroll speed regardless of content length.
    const w = contents[0].scrollWidth;
    track.style.animationDuration = `${Math.max(20, Math.round(w / SCROLL_PX_PER_S))}s`;
  }
  track.addEventListener('animationiteration', apply);

  async function refreshObs() {
    for (const [city, id] of STATIONS) {
      try {
        const res = await fetchWithTimeout(`https://api.weather.gov/stations/${id}/observations/latest`, {
          headers: { Accept: 'application/geo+json' },
        });
        if (!res.ok) continue;
        const p = (await res.json()).properties;
        const t = p.temperature?.value;
        const ws = p.windSpeed?.value;
        const kmh = (p.windSpeed?.unitCode ?? '').includes('km_h');
        obs.set(city, {
          tempF: t == null ? null : Math.round((t * 9) / 5 + 32),
          windMph: ws == null ? null : Math.round(ws * (kmh ? 0.621 : 2.237)),
          desc: p.textDescription ?? '',
        });
      } catch { /* station down — skip */ }
    }
    rebuild();
  }

  async function refreshOutlook() {
    try {
      const data = await fetchOutlook('day1', 'cat');
      const hull = { type: 'Polygon', coordinates: [geo.hull] };
      let best = null;
      for (const f of data.features ?? []) {
        if (!f.geometry || !geometriesIntersect(f.geometry, hull)) continue;
        const entry = CATEGORICAL[normalizeLabel(f)];
        if (entry && (!best || entry.order > best.order)) best = entry;
      }
      outlookText = best
        ? `SPC Day 1: <b>${best.label}</b> risk in the ArkLaTex`
        : 'SPC Day 1: no severe risk outlined for the ArkLaTex';
    } catch {
      outlookText = null;
    }
    rebuild();
  }

  function setAlerts(list) {
    alerts = list;
    rebuild();
  }

  rebuild();
  refreshObs();
  refreshOutlook();
  setInterval(refreshObs, OBS_MS);
  setInterval(refreshOutlook, OUTLOOK_MS);

  return { setAlerts };
}
