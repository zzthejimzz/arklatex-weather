// Slide-in 3-day forecast board for the idle cycle. The map snaps narrower
// the moment the panel starts sliding in (the resize reads as part of the
// panel motion on air), and the director re-frames the region right after —
// so invalidateSize must run synchronously here, before that fly starts.
import { formatLocalTime } from '../utils/time.js';

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

  function hide() {
    if (!open) return;
    open = false;
    stage.classList.remove('forecast-open');
    root.classList.remove('open');
    map.invalidateSize({ animate: false });
  }

  return { show, showCity, hide, ready };
}
