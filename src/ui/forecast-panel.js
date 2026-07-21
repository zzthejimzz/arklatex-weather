// Slide-in 3-day forecast board for the idle cycle. The map snaps narrower
// the moment the panel starts sliding in (the resize reads as part of the
// panel motion on air), and the director re-frames the region right after —
// so invalidateSize must run synchronously here, before that fly starts.
import { formatLocalTime, formatDate } from '../utils/time.js';
import { tempColor, rampGradient } from '../map/temps-layer.js';
import { moonInfo, nextPhases } from '../utils/moon.js';
import { LOCAL_THRESHOLD } from '../data/aurora.js';
import { icon } from './icons.js';

function dayCell(d) {
  const lo = d.lo != null ? ` / <span class="lo">${d.lo}°</span>` : '';
  const wind = d.wind >= 15 ? ` · ${icon('wind')} ${d.wind}` : '';
  return `
    <div class="fc-day">
      <div class="fc-dow">${d.dow}</div>
      <div class="fc-ico">${d.icon}</div>
      <div class="fc-temp"><b>${d.hi}°</b>${lo}</div>
      <div class="fc-meta">${icon('drop')} ${d.precip}%${wind}</div>
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
  const wind = d.wind >= 15 ? ` ${icon('wind')} ${d.wind}` : '';
  return `
    <div class="fc-spot-row">
      <div class="sr-dow">${d.dow}</div>
      <div class="sr-ico">${d.icon}</div>
      <div class="sr-short">${d.short}</div>
      <div class="sr-temp"><b>${d.hi}°</b>${lo}</div>
      <div class="sr-meta">${icon('drop')} ${d.precip}%${wind}</div>
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
        <div class="fc-title">${icon('calendar')} 3-Day <span class="grad">Forecast</span></div>
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
        <div class="fc-title">${icon('calendar')} ${c.name} <span class="grad">7-Day</span></div>
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
        <div class="fc-title">${icon('book')} ${c.name} <span class="grad">Almanac</span></div>
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
        ${cell('hot', `${icon('fire')} High`, c.recordHi, c.recordHiYear)}
        ${cell('cold', `${icon('ice')} Low`, c.recordLo, c.recordLoYear)}
      </div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Frost/freeze & growing-season page — one city's spring/fall 32°F freeze
  // normals plus the growing-season length, from NCEI climate normals. The
  // bar plots the frost-free window on a Jan→Dec axis; the tip line reads
  // the 80%-of-years bounds as plain planting/protecting guidance.
  function showFrost(c) {
    if (!c) return false;
    const bandL = (c.lastFreeze.median.doy / 365) * 100;
    const bandW = Math.max(((c.firstFreeze.median.doy - c.lastFreeze.median.doy) / 365) * 100, 2);
    const freezeCell = (icon, label, f) => `
      <div class="alm-cell frost-cell">
        <div class="ac-label">${icon} ${label}</div>
        <div class="ac-val">${f.median.label}</div>
        <div class="ac-year">${f.early.label} – ${f.late.label}</div>
      </div>`;
    const hard = c.hardFreeze.last && c.hardFreeze.first
      ? `<div class="fc-sub frost-hard">${icon('freeze')} Hard freeze (28°F) normals: ends ${c.hardFreeze.last.label} · begins ${c.hardFreeze.first.label}</div>`
      : '';
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('sprout')} ${c.name} <span class="grad">Growing Season</span></div>
        <div class="fc-sub">${c.state} · NCEI 1991–2020 Climate Normals · 32°F threshold</div>
      </div>
      <div class="alm-now">
        <div class="an-label">Frost-Free Growing Season</div>
        <div class="an-read"><b>${c.growingSeasonDays}</b><span class="an-pill even">days, average</span></div>
      </div>
      <div class="alm-meter frost-meter">
        <div class="am-track frost-track">
          <div class="am-band frost-band" style="left:${bandL}%;width:${bandW}%"></div>
        </div>
        <div class="am-scale">
          <span class="am-end lo">Jan</span>
          <span class="am-band-tag" style="left:${Math.min(Math.max(bandL + bandW / 2, 20), 80)}%">frost-free</span>
          <span class="am-end hi">Dec</span>
        </div>
      </div>
      <div class="alm-sec">Freeze Dates (32°F)</div>
      <div class="alm-row">
        ${freezeCell(icon('sprout'), 'Last Freeze — Spring', c.lastFreeze)}
        ${freezeCell(icon('leaf'), 'First Freeze — Fall', c.firstFreeze)}
      </div>
      ${hard}
      <div class="frost-tip">${icon('flower')} Typically safe to set out tender plants after <b>${c.lastFreeze.late.label}</b> &nbsp;·&nbsp; bring them back in by <b>${c.firstFreeze.early.label}</b></div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // UV Index page — one city's EPA daily UV forecast on a 0–11+ meter
  // (colored by category, like the almanac's record-span meter), with the
  // EPA's own sun-safety guidance for that category as the tip line.
  function showUv(c) {
    if (!c) return false;
    const AXIS_MAX = 12; // headroom past the 11+ Extreme threshold
    const pos = i => Math.max(0, Math.min(100, (i / AXIS_MAX) * 100));
    const nowPos = pos(c.index);
    const alertLine = c.alert
      ? `<div class="fc-sub uv-alert">${icon('warning')} EPA UV Alert in effect for ${c.name}</div>` : '';
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('sun')} ${c.name} <span class="grad">UV Index</span></div>
        <div class="fc-sub">${c.state} · EPA UV Forecast · ${c.date}</div>
      </div>
      <div class="alm-now">
        <div class="an-label">Today's Peak</div>
        <div class="an-read">
          <b style="color:${c.color}">${c.index}</b>
          <span class="an-pill" style="color:${c.color};background:${c.color}1f;border-color:${c.color}66">${c.label}</span>
        </div>
      </div>
      <div class="alm-meter">
        <div class="am-track uv-track">
          <div class="am-now" style="left:${nowPos}%"></div>
          <div class="am-now-tag" style="left:${Math.min(Math.max(nowPos, 10), 90)}%">UV ${c.index}</div>
        </div>
        <div class="am-scale">
          <span class="am-end lo">0</span>
          <span class="am-end hi">11+</span>
        </div>
      </div>
      ${alertLine}
      <div class="frost-tip uv-tip">${icon('sun')} ${c.advice}</div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Air quality page — one city's current US AQI (Open-Meteo, EPA breakpoints)
  // on the same style meter, pollutant detail row, and EPA's health guidance
  // for that category as the tip line.
  function showAqi(c) {
    if (!c) return false;
    const AXIS_MAX = 400; // headroom past the 300+ Hazardous threshold
    const pos = v => Math.max(0, Math.min(100, (v / AXIS_MAX) * 100));
    const nowPos = pos(c.aqi);
    const detail = (label, val, unit) => `
      <div class="alm-cell aqi-cell">
        <div class="ac-label">${label}</div>
        <div class="ac-val">${val != null ? val.toFixed(1) : '—'}<span class="aqi-unit">${unit}</span></div>
      </div>`;
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('fog')} ${c.name} <span class="grad">Air Quality</span></div>
        <div class="fc-sub">${c.state} · U.S. AQI · updated now</div>
      </div>
      <div class="alm-now">
        <div class="an-label">Current AQI</div>
        <div class="an-read">
          <b style="color:${c.color}">${c.aqi}</b>
          <span class="an-pill" style="color:${c.color};background:${c.color}1f;border-color:${c.color}66">${c.label}</span>
        </div>
      </div>
      <div class="alm-meter">
        <div class="am-track aqi-track">
          <div class="am-now" style="left:${nowPos}%"></div>
          <div class="am-now-tag" style="left:${Math.min(Math.max(nowPos, 10), 90)}%">AQI ${c.aqi}</div>
        </div>
        <div class="am-scale">
          <span class="am-end lo">0</span>
          <span class="am-end hi">400+</span>
        </div>
      </div>
      <div class="alm-sec">Pollutant Detail</div>
      <div class="alm-row aqi-row">
        ${detail('PM2.5', c.pm25, 'µg/m³')}
        ${detail('PM10', c.pm10, 'µg/m³')}
        ${detail('Ozone', c.ozone, 'µg/m³')}
      </div>
      <div class="frost-tip aqi-tip">${icon('fog')} ${c.advice}</div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Pollen page — one city's Pollen.com (IQVIA) index on a 0–12 meter, the
  // dominant allergens named as chips, and the 5-day trend strip. The map
  // beside it shows every climate city's index dot (pollen-layer), so this
  // card doubles as the shared scale for those dots.
  function showPollen(c) {
    if (!c) return false;
    const AXIS_MAX = 12;
    const pos = i => Math.max(0, Math.min(100, (i / AXIS_MAX) * 100));
    const nowPos = pos(c.index);
    const trigs = c.triggers.length
      ? c.triggers.map(t => `<span class="pollen-trig">${t.icon} ${t.name}</span>`).join('')
      : '<span class="pollen-trig none">None reported today</span>';
    const day = d => `
      <div class="pollen-day">
        <div class="pd-dow">${d.dow}</div>
        <div class="pd-val" style="color:${d.color}">${d.index.toFixed(1)}</div>
      </div>`;
    const trend = c.days.length ? `
      <div class="alm-sec">5-Day Trend</div>
      <div class="pollen-days">${c.days.map(day).join('')}</div>` : '';
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('flower')} ${c.name} <span class="grad">Pollen</span></div>
        <div class="fc-sub">${c.state} · Pollen.com (IQVIA) forecast${c.date ? ` · ${c.date}` : ''}</div>
      </div>
      <div class="alm-now">
        <div class="an-label">Today's Index</div>
        <div class="an-read">
          <b style="color:${c.color}">${c.index.toFixed(1)}</b>
          <span class="an-pill" style="color:${c.color};background:${c.color}1f;border-color:${c.color}66">${c.label}</span>
        </div>
      </div>
      <div class="alm-meter">
        <div class="am-track pollen-track">
          <div class="am-now" style="left:${nowPos}%"></div>
          <div class="am-now-tag" style="left:${Math.min(Math.max(nowPos, 10), 90)}%">${c.index.toFixed(1)}</div>
        </div>
        <div class="am-scale">
          <span class="am-end lo">0</span>
          <span class="am-end hi">12</span>
        </div>
      </div>
      <div class="alm-sec">Top Allergens</div>
      <div class="pollen-trigs">${trigs}</div>
      ${trend}
      <div class="frost-tip pollen-tip">${icon('flower')} ${c.advice}</div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Aurora / geomagnetic-storm outlook — current Kp + NOAA G-scale on a
  // 0-9 meter (colored by G-level, like the almanac's record-span meter),
  // the highest scale forecast the next 3 days, and a day-by-day G-scale
  // list. The tip line calls out whether the ArkLaTex itself is in range
  // (G4+ only — see LOCAL_THRESHOLD in data/aurora.js).
  function showAurora(data) {
    if (!data) return false;
    const { current, currentG, peak, days, worstScale } = data;
    const pos = kp => Math.max(0, Math.min(100, (kp / 9) * 100));
    const nowPos = pos(current.kp);
    const threshPos = pos(8); // Kp 8 = where NOAA's G4 (Severe) band begins
    const showPeak = peak && peak.kp > current.kp + 0.34; // a full 1/3-Kp step, not noise
    const dayRow = d => `
      <div class="aur-row">
        <div class="ar-day">${d.day}</div>
        <div class="ar-pill" style="color:${d.color};background:${d.color}1f;border-color:${d.color}66">${d.label}</div>
        <div class="ar-vis">${d.visible}</div>
      </div>`;
    const tip = worstScale >= LOCAL_THRESHOLD
      ? `${icon('aurora')} Aurora may be visible from the ArkLaTex over the next few nights — look north after dark, away from city lights.`
      : `${icon('aurora')} Quiet stretch — a G${LOCAL_THRESHOLD}+ (Severe) storm is needed to see aurora this far south, and those are rare.`;
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('aurora')} Aurora <span class="grad">Forecast</span></div>
        <div class="fc-sub">NOAA Space Weather Prediction Center · updated ${formatLocalTime(data.updatedAt)}</div>
      </div>
      <div class="alm-now">
        <div class="an-label">Right Now</div>
        <div class="an-read">
          <b style="color:${currentG.color}">Kp ${current.kp.toFixed(1)}</b>
          <span class="an-pill" style="color:${currentG.color};background:${currentG.color}1f;border-color:${currentG.color}66">${currentG.label}</span>
        </div>
      </div>
      <div class="alm-meter aur-meter">
        <div class="am-track aur-track">
          <div class="am-now" style="left:${nowPos}%"></div>
          <div class="am-now-tag" style="left:${Math.min(Math.max(nowPos, 10), 90)}%">NOW Kp ${current.kp.toFixed(1)}</div>
          <div class="aur-thresh" style="left:${threshPos}%"></div>
        </div>
        <div class="am-scale">
          <span class="am-end lo">Kp 0</span>
          <span class="am-band-tag" style="left:${Math.min(threshPos, 78)}%">G${LOCAL_THRESHOLD}+ reaches here</span>
          <span class="am-end hi">Kp 9</span>
        </div>
      </div>
      ${showPeak ? `<div class="fc-sub aur-peak-line">${icon('chart')} Highest forecast in the next 3 days: <b style="color:${peak.color}">Kp ${peak.kp.toFixed(1)} (${peak.label})</b> — ${formatDate(peak.time)} ${formatLocalTime(peak.time)}</div>` : ''}
      <div class="alm-sec">Next 3 Days — NOAA G-Scale</div>
      <div class="aur-list">${days.map(dayRow).join('')}</div>
      <div class="frost-tip aur-tip">${tip}</div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Heat-safety page — surfaces the NWS's own preparedness advice while a heat
  // warning/advisory/watch is in effect (heat.js picks the top product). The
  // tips are the canonical NWS heat-safety messaging; the card header ties them
  // to the live alert, and the tier drives the accent color + pill.
  function showHeat(heat) {
    if (!heat) return false;
    const TIER_LABEL = {
      warning: 'Warning in effect',
      advisory: 'Advisory in effect',
      watch: 'Watch — dangerous heat possible',
    };
    const tips = [
      { icon: 'drop', text: 'Drink plenty of water — don\'t wait until you\'re thirsty.' },
      { icon: 'hot', text: 'Stay in air conditioning during the hottest part of the day.' },
      { icon: 'warning', text: 'Never leave children or pets in a parked vehicle.' },
      { icon: 'population', text: 'Check on elderly relatives, neighbors, and anyone without AC.' },
      { icon: 'clock', text: 'Save hard outdoor work for early morning or evening.' },
      { icon: 'sun', text: 'Wear light, loose clothing and rest often in the shade.' },
    ];
    const { color } = heat;
    const area = heat.count > 1 ? `${heat.count} areas under this alert` : 'In effect for the ArkLaTex';
    const tipRow = t => `
      <div class="heat-tip">
        <span class="ht-ico" style="color:${color}">${icon(t.icon)}</span>
        <span class="ht-text">${t.text}</span>
      </div>`;
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('hot')} Heat <span class="grad">Safety</span></div>
        <div class="fc-sub">${area} · National Weather Service</div>
      </div>
      <div class="alm-now heat-now" style="border-color:${color}66">
        <div class="an-label">${heat.event}</div>
        <div class="an-read">
          <span class="an-pill" style="color:${color};background:${color}1f;border-color:${color}66">${TIER_LABEL[heat.tier]}</span>
        </div>
      </div>
      <div class="alm-sec">Stay Safe in the Heat</div>
      <div class="heat-tips">${tips.map(tipRow).join('')}</div>
      <div class="frost-tip heat-illness">${icon('warning')} Heat stroke is a medical emergency — call <b>911</b> if someone has hot, dry skin, confusion, or stops sweating. Move them somewhere cool and cool them with water while you wait.</div>`;
    stage.classList.add('forecast-open');
    root.classList.add('open');
    map.invalidateSize({ animate: false });
    open = true;
    return true;
  }

  // Moon-phases page — computed locally in moon.js, so unlike the other
  // pages there is no feed to wait on and this can never return false.
  function showMoon() {
    const now = new Date();
    const m = moonInfo(now);
    const fmtDate = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const inDays = d => {
      const n = Math.round((d - now) / 86_400_000);
      return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
    };
    const row = p => `
      <div class="moon-row">
        <div class="mr-ico">${p.icon}</div>
        <div class="mr-name">${p.name}</div>
        <div class="mr-date">${fmtDate(p.date)}</div>
        <div class="mr-in">${inDays(p.date)}</div>
      </div>`;
    root.innerHTML = `
      <div class="fc-head">
        <div class="fc-title">${icon('moon')} Moon <span class="grad">Phases</span></div>
        <div class="fc-sub">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
      <div class="moon-hero">
        <div class="mh-emoji">${m.icon}</div>
        <div>
          <div class="mh-name">${m.name}</div>
          <div class="mh-sub">${Math.round(m.fraction * 100)}% illuminated · ${m.waxing ? 'waxing — filling toward full' : 'waning — thinning toward new'}</div>
        </div>
      </div>
      <div class="alm-sec">Coming Up</div>
      <div class="moon-list">${nextPhases(now, 4).map(row).join('')}</div>`;
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

  return { show, showCity, showAlmanac, showFrost, showUv, showAqi, showPollen, showAurora, showHeat, showMoon, hide, ready };
}
