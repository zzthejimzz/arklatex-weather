// Bottom rotating ticker. One item shows at a time as a static full-width
// line; every DWELL_MS the next item rolls up into place (~ROLL_MS). This
// replaced the continuous scroll: the VPS's software renderer + fixed-30fps
// capture can't keep perpetual motion smooth (any missed frame reads as
// judder), but text that is stationary between brief transitions hides a
// dropped frame completely. Rotation order, most urgent first:
//   active alerts → SPC Day 1 risk for the region → live city observations →
//   sunrise/sunset almanac → branding line. A brand-new alert jumps the
//   rotation to its page immediately instead of waiting its turn.
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
const DWELL_MS = 8000; // static hold per page
const ROLL_MS = 350;   // matches .tk-roll transition in broadcast.css

export function createTicker(el, geo, obsFeed, { live = true } = {}) {
  el.innerHTML = `
    <div class="ticker-page tk-live"></div>
    <div class="ticker-page" aria-hidden="true"></div>`;
  const pages = [...el.querySelectorAll('.ticker-page')];
  let cur = 0;        // which page is on screen
  let idx = 0;        // which item it shows
  let items = [];
  let alerts = [];
  let knownAlerts = new Set();
  let outlookText = null;
  let dwellTimer = null;

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

  const pageHtml = i => `<span class="tk-item">${items[i]}</span>`;

  function rebuild() {
    items = buildItems();
    if (idx >= items.length) idx = 0;
    if (!pages[cur].innerHTML) pages[cur].innerHTML = pageHtml(idx); // first fill
  }

  // Roll the page at items[nextIdx] up into view. The incoming line is parked
  // below the frame with transitions off, then both lines translate up one
  // full ticker height together. Transform-only, and static the rest of the
  // dwell — nothing for the software compositor to resample frame-to-frame.
  function rollTo(nextIdx) {
    idx = nextIdx;
    const html = pageHtml(idx);
    if (html === pages[cur].innerHTML) return; // same content — hold, don't roll to itself
    const outgoing = pages[cur];
    const incoming = pages[1 - cur];
    clearTimeout(incoming.tkCleanup); // a still-pending cleanup would snap a re-armed line
    clearTimeout(outgoing.tkCleanup);
    incoming.classList.remove('tk-roll', 'tk-live', 'tk-out');
    incoming.innerHTML = html;
    void incoming.offsetWidth; // commit the parked position before animating
    incoming.classList.add('tk-roll', 'tk-live');
    incoming.removeAttribute('aria-hidden');
    outgoing.classList.add('tk-roll', 'tk-out');
    outgoing.classList.remove('tk-live');
    outgoing.setAttribute('aria-hidden', 'true');
    cur = 1 - cur;
    // Disarm both transitions once the roll lands: the outgoing line snaps
    // back to its parked spot, and the live line goes fully static.
    outgoing.tkCleanup = incoming.tkCleanup = setTimeout(() => {
      outgoing.classList.remove('tk-roll', 'tk-out');
      incoming.classList.remove('tk-roll');
    }, ROLL_MS + 50);
  }

  function scheduleDwell() {
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      if (items.length) rollTo((idx + 1) % items.length);
      scheduleDwell();
    }, DWELL_MS);
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
    // Jump the rotation to a never-before-seen alert (alerts are items[0..n-1],
    // in list order) rather than waiting up to a full cycle to reach it.
    const fresh = list.findIndex(a => !knownAlerts.has(a.id ?? a.key));
    knownAlerts = new Set(list.map(a => a.id ?? a.key));
    rebuild();
    if (fresh >= 0 && live) {
      rollTo(fresh);
      scheduleDwell(); // restart the hold so the new alert gets a full dwell
    }
  }

  rebuild();
  if (live) {
    refreshOutlook();
    setInterval(rebuild, OBS_MS); // pick up fresh obs + roll the almanac at midnight
    setInterval(refreshOutlook, OUTLOOK_MS);
    scheduleDwell();
  }

  return { setAlerts };
}
