import './broadcast.css';
import './icon-review.css';
import { icon } from './ui/icons.js';

const CONDITIONS = [
  ['sun', 'Clear'],
  ['partly-cloudy', 'Partly Cloudy'],
  ['cloud', 'Overcast'],
  ['rain', 'Rain'],
  ['storm', 'Thunderstorm'],
  ['wind', 'Wind'],
  ['fog', 'Fog'],
  ['ice', 'Snow / Ice'],
  ['hot', 'Heat'],
  ['tornado', 'Tornado'],
];

const HAZARDS = [
  ['tornado', 'Tornado', '#ff2b2b'],
  ['storm', 'Severe Storm', '#ffd23f'],
  ['flash-flood', 'Flash Flood', '#2ecc55'],
  ['flood', 'Flood', '#00a878'],
  ['extreme-wind', 'Extreme Wind', '#ff5ce1'],
  ['hail', 'Hail', '#22d3ee'],
  ['freeze', 'Freeze', '#5b8dd6'],
  ['fire', 'Fire Weather', '#ff6347'],
  ['lightning', 'Lightning', '#a855f7'],
  ['wind-damage', 'Wind Damage', '#ffd23f'],
  ['ice-storm', 'Ice Storm', '#c86bfa'],
  ['warning', 'General Alert', '#9bb0d3'],
  ['report', 'Storm Report', '#22d3ee'],
  ['funnel', 'Funnel Cloud', '#ff8c1a'],
];

const MOONS = [
  ['moon-new', 'New Moon'],
  ['moon-waxing-crescent', 'Waxing Crescent'],
  ['moon-first-quarter', 'First Quarter'],
  ['moon-waxing-gibbous', 'Waxing Gibbous'],
  ['moon-full', 'Full Moon'],
  ['moon-waning-gibbous', 'Waning Gibbous'],
  ['moon-last-quarter', 'Last Quarter'],
  ['moon-waning-crescent', 'Waning Crescent'],
  ['moon', 'Moon Feature'],
];

const BOTANICAL = [
  ['tree', 'Tree Pollen'],
  ['grass', 'Grass Pollen'],
  ['weed', 'Weed Pollen'],
  ['flower', 'Allergen'],
  ['sprout', 'Last Freeze'],
  ['leaf', 'First Freeze'],
];

const RIVERS = [
  ['river-low', 'Low Water', '#e0c168'],
  ['drop', 'Action Stage', '#fff0a3'],
  ['river-minor', 'Minor Flooding', '#ffc266'],
  ['river-moderate', 'Moderate Flooding', '#ff8080'],
  ['river-major', 'Major Flooding', '#e29bff'],
];

const UTILITIES = [
  'radar', 'storm-motion', 'population', 'clock', 'magnitude', 'office',
  'target', 'chart', 'calendar', 'book', 'satellite', 'hurricane', 'aurora',
  'sunrise', 'sunset', 'broadcast', 'speech',
];

function conditionCard([name, label]) {
  return `
    <article class="condition-card">
      <div class="condition-main weather-colored">${icon(name)}</div>
      <div class="condition-copy"><b>${label}</b><code>${name}</code></div>
      <div class="size-rail" aria-label="${label} at production sizes">
        <span class="s42">${icon(name)}</span>
        <span class="s34">${icon(name)}</span>
        <span class="s19">${icon(name)}</span>
        <span class="s15">${icon(name)}</span>
      </div>
    </article>`;
}

function hazardCard([name, label, color]) {
  return `
    <article class="hazard-card" style="--sample-color:${color}">
      <span class="hazard-pin">${icon(name)}</span>
      <div><b>${label}</b><code>${name}</code></div>
    </article>`;
}

function featureCard([name, label]) {
  return `
    <article class="feature-card domain-colored">
      <span class="feature-icon">${icon(name)}</span>
      <b>${label}</b>
      <code>${name}</code>
    </article>`;
}

document.getElementById('icon-review').innerHTML = `
  <header class="review-head">
    <div>
      <span class="eyebrow">ArkLaTex Weather Live</span>
      <h1>Custom Icon Review</h1>
    </div>
    <div class="size-key"><b>Production sizes</b><span>42</span><span>34</span><span>19</span><span>15</span></div>
  </header>

  <section>
    <div class="section-head"><h2>Forecast Conditions</h2><span>Two-tone display treatment</span></div>
    <div class="condition-grid">${CONDITIONS.map(conditionCard).join('')}</div>
  </section>

  <section>
    <div class="section-head"><h2>Hazards and Reports</h2><span>Monochrome severity treatment</span></div>
    <div class="hazard-grid">${HAZARDS.map(hazardCard).join('')}</div>
  </section>

  <section>
    <div class="section-head"><h2>Moon Phases</h2><span>Filled light and shadow treatment</span></div>
    <div class="feature-grid">${MOONS.map(featureCard).join('')}</div>
  </section>

  <section>
    <div class="section-head"><h2>Pollen and Seasons</h2><span>Botanical and seasonal treatment</span></div>
    <div class="feature-grid">${BOTANICAL.map(featureCard).join('')}</div>
  </section>

  <section>
    <div class="section-head"><h2>River Stages</h2><span>Shape and severity escalation at marker size</span></div>
    <div class="hazard-grid river-grid">${RIVERS.map(hazardCard).join('')}</div>
  </section>

  <section>
    <div class="section-head"><h2>Metadata and Broadcast</h2><span>Semi-filled utility treatment</span></div>
    <div class="utility-row utility-colored">${UTILITIES.map(name => `<span title="${name}">${icon(name)}<code>${name}</code></span>`).join('')}</div>
  </section>`;
