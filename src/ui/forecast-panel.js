// Slide-in 3-day forecast board for the idle cycle. The map snaps narrower
// the moment the panel starts sliding in (the resize reads as part of the
// panel motion on air), and the director re-frames the region right after —
// so invalidateSize must run synchronously here, before that fly starts.
import { formatLocalTime } from '../utils/time.js';
import { tempColor, rampGradient } from '../map/temps-layer.js';

function dayCell(d) {
  const lo = d.lo != null ? ` / <span class="lo">${d.lo}°</span>` : '';
  const wind = d.wind >= 15 ? ` · 💨 ${d.wind}` : '';
  return `
    <div class="fc-day">
      <div class="fc-dow">${d.dow}</div>
      <div class="fc-ico">${d.icon}</div>
      <div class="fc-temp"><b>${d.hi}°</b>${lo}</div>
      <div class="fc-meta">💧 ${d.precip}%${wind}</div>
    </div>`;
}

function cityRow(c) {
  return `
    <div class="fc-city">
      <div class="fc-name">
        ${c.name}
        <span class="fc-state">${c.state}</span>
        <span class="fc-short">${c.days[0].short}</span>
      </div>
      ${c.days.slice(0, 3).map(dayCell).join('')}
    </div>`;
}

// One row per day of the single-city 7-day spotlight.
function spotRow(d) {
  const lo = d.lo != null ? ` / <span class="lo">${d.lo}°</span>` : '';
  const wind = d.wind >= 15 ? ` 💨 ${d.wind}` : '';
  return `
    <div class="fc-spot-row">
      <div class="sr-dow">${d.dow}</div>
      <div class="sr-ico">${d.icon}</div>
      <div class="sr-short">${d.short}</div>
      <div class="sr-temp"><b>${d.hi}°</b>${lo}</div>
      <div class="sr-meta">💧 ${d.precip}%${wind}</div>
    </div>`;
}

export function createForecastPanel({ root, map, forecasts }) {
  const stage = document.getElementById('stage');
  let open = false;

  function ready() {
    return !!forecasts.get();
  }

  function show() {
    const data = forecasts.get();
    if (!data) return false;
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">📅 3-Day <span class="grad">Forecast</span></div>
        <div class="fc-sub">National Weather Service · updated ${formatLocalTime(data.at)}</div>
      </div>
      ${data.cities.map(cityRow).join('')}`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Single-city 7-day spotlight — same slide-in panel, one city per idle
  // cycle (the director hands us a rotation index).
  function showCity(idx) {
    const data = forecasts.get();
    if (!data?.cities.length) return false;
    const c = data.cities[idx % data.cities.length];
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">📅 ${c.name} <span class="grad">7-Day</span></div>
        <div class="fc-sub">${c.state} · National Weather Service · updated ${formatLocalTime(data.at)}</div>
      </div>
      <div class="fc-spot">${c.days.map(spotRow).join('')}</div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Daily climate almanac page — one city's normals + records for today,
  // with the live temp up top when the obs feed has one for this city, and
  // a record-span meter showing where right now sits between the extremes.
  function showAlmanac(c, { nowF, dateLabel }) {
    if (!c) return false;
    const cell = (cls, label, val, year) => `
      <div class="alm-cell${cls ? ` ${cls}` : ''}">
        <div class="ac-label">${label}</div>
        <div class="ac-val"${val == null ? '' : ` style="color:${tempColor(val)}"`}>${val == null ? '—' : `${val}°`}</div>
        ${year ? `<div class="ac-year">${year}</div>` : ''}
      </div>`;
    let now = '';
    if (nowF != null) {
      const dev = nowF - c.normalHi;
      const pill = dev === 0
        ? '<span class="an-pill even">right at the normal high</span>'
        : `<span class="an-pill ${dev > 0 ? 'above' : 'below'}">${dev > 0 ? '▲' : '▼'} ${Math.abs(dev)}° ${dev > 0 ? 'above' : 'below'} normal high</span>`;
      now = `
        <div class="alm-now">
          <div class="an-label">Right Now</div>
          <div class="an-read"><b style="color:${tempColor(nowF)}">${nowF}°</b>${pill}</div>
        </div>`;
    }
    // The span meter needs the full record range plus the normal band; skip
    // it (rather than draw a half-scale) when any corner is missing.
    let meter = '';
    if (c.recordLo != null && c.recordHi != null && c.normalLo != null && c.normalHi != null) {
      const lo = c.recordLo;
      const span = Math.max(c.recordHi - lo, 1);
      const pos = t => Math.max(0, Math.min(100, ((t - lo) / span) * 100));
      const bandL = pos(c.normalLo);
      const bandW = Math.max(pos(c.normalHi) - bandL, 2);
      // Marker sits at the true reading; its tag clamps inward so a reading
      // near a record doesn't push the label out of the panel.
      const nowMark = nowF == null ? '' : `
          <div class="am-now" style="left:${pos(nowF)}%"></div>
          <div class="am-now-tag" style="left:${Math.min(Math.max(pos(nowF), 10), 90)}%">NOW ${nowF}°</div>`;
      meter = `
        <div class="alm-meter">
          <div class="am-track" style="background:${rampGradient(lo, c.recordHi)}">
            <div class="am-band" style="left:${bandL}%;width:${bandW}%"></div>${nowMark}
          </div>
          <div class="am-scale">
            <span class="am-end lo">${c.recordLo}°</span>
            <span class="am-band-tag" style="left:${Math.min(Math.max(bandL + bandW / 2, 20), 80)}%">normal ${c.normalLo}–${c.normalHi}°</span>
            <span class="am-end hi">${c.recordHi}°</span>
          </div>
        </div>`;
    }
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">📖 ${c.name} <span class="grad">Almanac</span></div>
        <div class="fc-sub">${c.state} · ${dateLabel}${c.since ? ` · records back to ${c.since}` : ''} · NWS climate data</div>
      </div>
      ${now}
      ${meter}
      <div class="alm-sec">Today's Normals</div>
      <div class="alm-row">
        ${cell('', 'High', c.normalHi)}
        ${cell('', 'Low', c.normalLo)}
      </div>
      <div class="alm-sec">All-Time Records</div>
      <div class="alm-row alm-rec">
        ${cell('hot', '🔥 High', c.recordHi, c.recordHiYear)}
        ${cell('cold', '❄️ Low', c.recordLo, c.recordLoYear)}
      </div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  function hide() {
    if (!open) return;
    open = false;
    stage.classList.remove('forecast-open');
    root.classList.remove('open');
    map.invalidateSize({ animate: false });
  }

  return { show, showCity, showAlmanac, hide, ready };
}
