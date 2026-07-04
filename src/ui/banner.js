// Top broadcast banner: most-severe active alert with expiry countdown (left),
// brand + Central-time clock (center), top-5 alert-type counts (right).
import { styleForEvent, textColorFor } from '../utils/alert-style.js';
import { formatClock, formatLocalTime, countdown, expiresSoon } from '../utils/time.js';

const MAX_COUNT_CHIPS = 5;

export function createBanner(el) {
  el.innerHTML = `
    <div class="banner-alert">
      <div class="banner-quiet"><span class="ok-dot"></span>No active alerts in the ArkLaTex</div>
    </div>
    <div class="banner-brand">
      <div class="banner-brand-title">ARKLATEX <span class="grad">WEATHER</span> LIVE</div>
      <div class="banner-clock"><span class="date"></span> &middot; <span class="time"></span></div>
    </div>
    <div class="banner-counts"><span class="counts-none">ALL CLEAR</span></div>`;

  const alertEl = el.querySelector('.banner-alert');
  const countsEl = el.querySelector('.banner-counts');
  const dateEl = el.querySelector('.banner-clock .date');
  const timeEl = el.querySelector('.banner-clock .time');

  let top = null;          // most severe active alert
  let lastTopId = false;   // sentinel ≠ null so the quiet state renders once
  let lastCountsSig = null;

  function setAlerts(alerts) {
    top = alerts[0] ?? null; // sources deliver sorted by score desc
    // Re-render only on change — every poll returns fresh objects, and
    // rebuilding the DOM each tick makes countdowns and animations stutter.
    const topId = top?.id ?? null;
    if (topId !== lastTopId) {
      lastTopId = topId;
      renderAlertSection();
    }
    renderCounts(alerts);
  }

  function renderAlertSection() {
    if (!top) {
      alertEl.classList.remove('has-alert');
      alertEl.style.removeProperty('--alert-color');
      alertEl.innerHTML =
        '<div class="banner-quiet"><span class="ok-dot"></span>No active alerts in the ArkLaTex</div>';
      return;
    }
    const areas = (top.props.areaDesc ?? '').split(';').map(s => s.trim()).filter(Boolean);
    const areaText = areas.length > 2
      ? `${areas.slice(0, 2).join(', ')} +${areas.length - 2} more`
      : areas.join(', ');

    alertEl.classList.add('has-alert');
    alertEl.style.setProperty('--alert-color', top.style.color);
    alertEl.innerHTML = `
      <div class="banner-alert-badge ${top.score >= 80 ? 'pulse' : ''}"
           style="box-shadow: 0 0 24px ${top.style.color}55; background:${top.style.color}; color:${textColorFor(top.style.color)}">
        ${top.style.icon} ${top.props.event ?? 'Alert'}
      </div>
      <div class="banner-alert-info">
        <div class="banner-alert-area">${areaText}</div>
        <div class="banner-alert-meta">
          Until ${formatLocalTime(top.props.expires)} &middot; expires in
          <span class="cd">${countdown(top.props.expires) ?? '—'}</span>
        </div>
      </div>`;
  }

  function renderCounts(alerts) {
    const groups = new Map(); // event → { count, score }
    for (const a of alerts) {
      const ev = a.props.event ?? 'Alert';
      const g = groups.get(ev) ?? { event: ev, count: 0, score: 0 };
      g.count += 1;
      g.score = Math.max(g.score, a.score);
      groups.set(ev, g);
    }
    const chips = [...groups.values()]
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, MAX_COUNT_CHIPS);

    const sig = chips.map(g => `${g.event}:${g.count}`).join('|');
    if (sig === lastCountsSig) return;
    lastCountsSig = sig;

    if (!chips.length) {
      countsEl.innerHTML = '<span class="counts-none">ALL CLEAR</span>';
      return;
    }
    countsEl.innerHTML = chips.map(g => {
      const s = styleForEvent(g.event);
      return `
        <div class="count-chip tone-${s.tone}">
          <div class="icon-row"><span>${s.icon}</span><span class="count">${g.count}</span></div>
          <div class="abbr">${s.abbr}</div>
        </div>`;
    }).join('');
  }

  function tick() {
    const { date, time } = formatClock();
    dateEl.textContent = date;
    timeEl.textContent = time;

    const cd = alertEl.querySelector('.cd');
    if (cd && top) {
      cd.textContent = countdown(top.props.expires) ?? '—';
      cd.classList.toggle('expires-soon', expiresSoon(top.props.expires));
    }
  }
  setInterval(tick, 1000);
  tick();

  return { setAlerts };
}
