// Warning detail card shown while the director tours an alert. Fixed position
// (top-right under the banner) rather than map-anchored — steadier on video.
import { param } from '../director/scoring.js';
import { formatPopulation } from '../data/population.js';
import { formatLocalTime, countdown } from '../utils/time.js';

const STATE_NAMES = { TX: 'Texas', LA: 'Louisiana', AR: 'Arkansas', OK: 'Oklahoma' };

function row(icon, label, value, hot = false) {
  return `
    <div class="warn-row">
      <span class="w-icon">${icon}</span>
      <span class="w-label">${label}</span>
      <span class="w-value ${hot ? 'hot' : ''}">${value}</span>
    </div>`;
}

export function createPopup(root) {
  let current = null;

  function show(alert, isNew) {
    current = alert;
    const p = alert.props;

    const rows = [];
    rows.push(row('⏱️', 'Expires', `${formatLocalTime(p.expires)} · <span class="cd">${countdown(p.expires) ?? '—'}</span>`));

    const detection = param(p, 'tornadoDetection');
    if (detection) rows.push(row('📡', 'Source', titleCase(detection)));

    const threat = param(p, 'tornadoDamageThreat') ?? param(p, 'thunderstormDamageThreat');
    if (threat) rows.push(row('⚠️', 'Threat', titleCase(threat), true));

    const hail = param(p, 'maxHailSize');
    if (hail && parseFloat(hail) > 0) {
      rows.push(row('🧊', 'Max hail', `${parseFloat(hail).toFixed(2)}"`));
    }
    const gust = param(p, 'maxWindGust');
    if (gust) rows.push(row('💨', 'Max wind', /mph/i.test(gust) ? gust.toLowerCase() : `${gust} mph`));

    const pop = formatPopulation(alert.population);
    if (pop) rows.push(row('👥', 'In path', `~${pop} people`));

    rows.push(row('🕐', 'Issued', formatLocalTime(p.sent)));

    const states = alert.states.map(s => STATE_NAMES[s] ?? s).join(' · ');
    const areas = (p.areaDesc ?? '').split(';').map(s => s.trim()).filter(Boolean);
    const areaText = areas.length > 3 ? `${areas.slice(0, 3).join(', ')} +${areas.length - 3} more` : areas.join(', ');

    root.innerHTML = `
      <div class="warn-card" style="--alert-color:${alert.style.color}">
        <div class="warn-card-head">
          <div class="warn-card-event">${p.event ?? 'Alert'}</div>
          ${isNew ? '<div class="warn-card-new">NEW</div>' : ''}
        </div>
        <div class="warn-card-area">${areaText}<br><span class="states">${states}</span></div>
        <div class="warn-card-rows">${rows.join('')}</div>
      </div>`;
  }

  function hide() {
    current = null;
    root.innerHTML = '';
  }

  function tick() {
    const cd = root.querySelector('.cd');
    if (cd && current) cd.textContent = countdown(current.props.expires) ?? '—';
  }
  setInterval(tick, 1000);

  return { show, hide };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
