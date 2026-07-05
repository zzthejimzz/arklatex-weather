// Bottom-left status chip: mode (LIVE/REPLAY) + data freshness. Self-ticking —
// it renders from the health registry on its own clock, so a dead poll loop
// can't freeze the chip at a reassuring old timestamp. That's the point: on an
// unattended stream the chip is the one honest witness. Viewers glancing at it
// should see either "data 4:52 PM" (fresh) or an amber "as of" age — never a
// 40-minute-old frame presented as live.
import { ageOf } from '../utils/health.js';

const TICK_MS = 5_000;
// ~4 missed alert polls: worth a quiet "retrying". A single failed poll is
// routine (api.weather.gov burps constantly) and shouldn't flash anything.
const ALERTS_RETRY_MS = 2 * 60 * 1000;
const ALERTS_STALE_MS = 5 * 60 * 1000;
// 3 missed radar refresh cycles. Tiles load near-constantly while the director
// flies the camera, so silence this long means IEM is down or unreachable.
const RADAR_STALE_MS = 15 * 60 * 1000;

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
});

function ageText(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min old`;
  return `${Math.floor(min / 60)}h ${min % 60}m old`;
}

export function createStatusChip(el, mode) {
  el.classList.toggle('replay', mode === 'REPLAY');

  function render() {
    const alertsAge = ageOf('alerts');
    const radarAge = ageOf('radar-tiles');
    const parts = [];
    let stale = false;

    if (alertsAge == null) {
      parts.push('data —');
    } else if (alertsAge > ALERTS_STALE_MS) {
      stale = true;
      parts.push(`<span class="stale-text">data as of ${timeFmt.format(Date.now() - alertsAge)} · ${ageText(alertsAge)}</span>`);
    } else if (alertsAge > ALERTS_RETRY_MS) {
      parts.push(`data ${timeFmt.format(Date.now() - alertsAge)} <span class="stale-text">· retrying</span>`);
    } else {
      parts.push(`data ${timeFmt.format(Date.now() - alertsAge)}`);
    }

    if (radarAge != null && radarAge > RADAR_STALE_MS) {
      stale = true;
      parts.push(`<span class="stale-text">radar ${ageText(radarAge)}</span>`);
    }

    el.classList.toggle('stale', stale);
    el.innerHTML = `
      <span class="live-dot"></span>
      <span class="mode-label">${mode}</span>
      <span>${parts.join(' · ')}</span>`;
  }

  render();
  setInterval(render, TICK_MS);
}
