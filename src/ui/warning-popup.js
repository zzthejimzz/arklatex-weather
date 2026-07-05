// Warning detail card shown while the director tours an alert. Fixed position
// (top-right under the banner) rather than map-anchored — steadier on video.
import { param } from '../director/scoring.js';
import { formatPopulation } from '../data/population.js';
import { formatLocalTime, countdown } from '../utils/time.js';
import { MCD_COLOR } from '../map/mcd-layer.js';

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

    const pop = alert.population > 0 ? formatPopulation(alert.population) : null;
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

  // Detail card for a Local Storm Report the director is visiting — same
  // card chrome as warnings, but headed by the report type and closing with
  // the spotter's remark (the human detail is the broadcast gold).
  function showReport(report) {
    current = null; // no expiry countdown to tick
    const rows = [];
    rows.push(row('🕐', 'Reported', `${formatLocalTime(report.valid)} · ${agoText(report.valid)}`));
    if (report.magnitude) rows.push(row('📏', 'Magnitude', report.magnitude, true));
    if (report.source) rows.push(row('🗣️', 'Source', titleCase(report.source)));
    rows.push(row('🏢', 'Relayed by', `NWS ${report.wfo ?? '—'}`));

    const state = STATE_NAMES[report.st] ?? report.st ?? '';
    const remark = (report.remark ?? '').trim();

    root.innerHTML = `
      <div class="warn-card" style="--alert-color:${report.style.color}">
        <div class="warn-card-tag">Local Storm Report</div>
        <div class="warn-card-head">
          <div class="warn-card-event">${report.style.icon} ${report.style.label}</div>
        </div>
        <div class="warn-card-area">${report.city}, ${report.county} County<br>
          <span class="states">${state}</span></div>
        <div class="warn-card-rows">${rows.join('')}</div>
        ${remark ? `<div class="warn-card-remark">${escapeHtml(remark)}</div>` : ''}
      </div>`;
  }

  // Detail card for a Mesoscale Discussion the director is visiting. Same card
  // chrome as reports, headed by the MCD number and closing with SPC's SUMMARY
  // line. `current` is set to a minimal expiry holder so the countdown ticks.
  function showMcd(mcd) {
    current = { props: { expires: mcd.expire } };
    const rows = [];
    rows.push(row('⏱️', 'Valid until', `${formatLocalTime(mcd.expire)} · <span class="cd">${countdown(mcd.expire) ?? '—'}</span>`));
    if (mcd.concerning) rows.push(row('🎯', 'Concerning', titleCase(mcd.concerning), true));
    if (Number.isFinite(mcd.watchProb)) {
      rows.push(row('📊', 'Watch chance', `${mcd.watchProb}%`, mcd.watchProb >= 40));
    }
    rows.push(row('🕐', 'Issued', formatLocalTime(mcd.issue)));

    const summary = (mcd.summary ?? '').trim();
    root.innerHTML = `
      <div class="warn-card" style="--alert-color:${MCD_COLOR}">
        <div class="warn-card-tag">SPC Mesoscale Discussion</div>
        <div class="warn-card-head">
          <div class="warn-card-event">🛰️ MCD #${mcd.num}</div>
        </div>
        ${mcd.areas ? `<div class="warn-card-area">${escapeHtml(mcd.areas)}</div>` : ''}
        <div class="warn-card-rows">${rows.join('')}</div>
        ${summary ? `<div class="warn-card-remark">${escapeHtml(summary)}</div>` : ''}
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

  return { show, showReport, showMcd, hide };
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function agoText(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60_000));
  if (min < 1) return 'just in';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m ago`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
