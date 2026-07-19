// Bottom scrolling ticker. Rotating content, most urgent first:
//   active alerts → SPC Day 1 risk for the region → live city observations →
//   sunrise/sunset almanac → branding line. New content swaps in at the loop
//   seam (animationiteration) so the scroll never visibly jumps.
//   (Phase 4: now-playing music info.)
import { styleForEvent } from '../utils/alert-style.js';
import { formatLocalTime } from '../utils/time.js';
import { fetchOutlook } from '../utils/spc-api.js';
import { CATEGORICAL, normalizeLabel } from '../utils/map-colors.js';
import { geometriesIntersect } from '../utils/geometry.js';
import { sunTimes } from '../utils/sun.js';
import { icon } from './icons.js';

// Ticker's six anchor cities, pulled from the shared observations feed
// (data/observations.js) — it fetches these stations plus the wider set the
// temps map mode uses.
const TICKER_CITIES = ['Shreveport', 'Texarkana', 'Tyler', 'Longview', 'Monroe', 'Lufkin'];
// Almanac anchor: Shreveport. Sunrise varies under two minutes across the CWA.
const SUN_LAT = 32.52;
const SUN_LON = -93.75;
const BRAND = 'ARKLATEX WEATHER LIVE · 24/7 coverage for NE Texas · NW Louisiana · SW Arkansas · SE Oklahoma';
const OBS_MS = 5 * 60 * 1000; // re-read the shared feed (it polls on its own)
const OUTLOOK_MS = 15 * 60 * 1000;
const SCROLL_PX_PER_S = 90;

export function createTicker(el, geo, obsFeed, { live = true } = {}) {
  el.innerHTML = `
    <div class="ticker-track">
      <div class="ticker-content"></div>
      <div class="ticker-content" aria-hidden="true"></div>
    </div>`;
  const track = el.querySelector('.ticker-track');
  const contents = el.querySelectorAll('.ticker-content');

  let alerts = [];
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
    if (outlookText) items.push(`<span class="tk-icon">${icon('lightning')}</span>${outlookText}`);

    const obs = obsFeed?.get() ?? [];
    const obsParts = TICKER_CITIES
      .map(city => obs.find(o => o.city === city))
      .filter(o => o?.tempF != null)
      .map(o => `${o.city} <b>${o.tempF}°</b>${o.windMph ? ` <span class="tk-dim">${o.windMph} mph</span>` : ''}`);
    if (obsParts.length) items.push(`<span class="tk-icon">${icon('hot')}</span>${obsParts.join(' &nbsp;·&nbsp; ')}`);

    const { sunrise, sunset } = sunTimes(new Date(), SUN_LAT, SUN_LON);
    if (sunrise && sunset) {
      items.push(
        `<span class="tk-icon">${icon('sunrise')}</span>Sunrise <b>${formatLocalTime(sunrise)}</b>` +
        ` &nbsp;·&nbsp; <span class="tk-icon">${icon('sunset')}</span> Sunset <b>${formatLocalTime(sunset)}</b>`,
      );
    }

    items.push(`<span class="tk-icon">${icon('broadcast')}</span>${BRAND}`);
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
  if (live) {
    refreshOutlook();
    setInterval(rebuild, OBS_MS); // pick up fresh obs + roll the almanac at midnight
    setInterval(refreshOutlook, OUTLOOK_MS);
  }

  return { setAlerts };
}
