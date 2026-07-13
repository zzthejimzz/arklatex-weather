// The broadcast "director": decides where the camera looks. Something should
// always be happening on screen.
//
// Warnings active:  overview ↔ tour each warning by severity; a newly issued
//                   warning pre-empts whatever is on screen. A lone warning
//                   gets most of the airtime, and a high-end warning (tornado /
//                   destructive severe) gets revisited between every other stop.
// No warnings:      idle plan built fresh each cycle from whatever exists —
//                   watches (flashing outline + detail card), lower-tier alerts
//                   (flood warnings / statements / advisories, each with the
//                   detail card), radar echo clusters from the precip scout,
//                   SPC outlooks Days 1–3 (wide), current temps, GOES
//                   satellite (IR/water vapor around the clock, visible by
//                   day), rainfall totals + drought monitor (+ fire weather
//                   when SPC has an Elevated+ area locally, + the tropical
//                   outlook when the Atlantic has a development area), then
//                   the forecast board.
import L from 'leaflet';
import { boundsToLeaflet, pointInGeometry } from '../utils/geometry.js';
import { GULF_BBOX } from '../map/tropical-layer.js';
import { isTourable, announces } from './scoring.js';
import { track } from '../utils/health.js';
import { formatInches, legendHtml } from '../map/rainfall-layer.js';

const TOUR_DWELL_MS = 25_000;
const OVERVIEW_DWELL_MS = 30_000;
const SOLO_TOUR_DWELL_MS = 45_000; // lone warning holds the shot longer
const SOLO_OVERVIEW_DWELL_MS = 15_000;
const FLY_MS = 2_400;
const TOUR_MAX_ZOOM = 12.4; // vector road names populate from GL z11 (Leaflet 12) — streets read on air
const WATCH_MAX_ZOOM = 8.5;
const POI_MAX_ZOOM = 9.4;
const MINOR_MAX_ZOOM = 9.8; // flood warnings / statements cover zones — stay wide enough to frame them
const MCD_MAX_ZOOM = 8.2;   // MCDs span multiple counties — keep the whole outline framed
const REPORT_MAX_ZOOM = 11; // storm report pins: close enough to name the town
const REPORT_BOX_M = 36_000; // fly frame around a report point (~36 km square)
// Reports inside an active warning polygon join the warning rotation —
// ground truth from inside the box beats another polygon lap. Same 3 h window
// as the map pins; shorter dwell than idle stops so warnings keep the airtime.
const REPORT_IN_WARN_WINDOW_MS = 3 * 60 * 60 * 1000;
const REPORT_IN_WARN_DWELL_MS = 15_000;
const REPORT_IN_WARN_MAX = 2;

// Storm-scale warnings get a two-act shot: reflectivity while the camera
// settles, then a switch to single-site base velocity for the back half of the
// dwell — the "is it rotating?" look. Reflectivity stays dimmed underneath.
const VELOCITY_EVENTS = new Set(['tornado warning', 'severe thunderstorm warning']);
const VELOCITY_AT = 0.45; // fraction of the dwell spent on reflectivity first

// Destructive severe and every tornado warning: the rotation returns to it
// between other stops and it holds the shot longer.
const FOCUS_SCORE = 70;
function dwellFor(alert, base) {
  if (alert.score >= 90) return base + 15_000;
  if (alert.score >= FOCUS_SCORE) return base + 8_000;
  return base;
}

export function createDirector({ map, alertsLayer, outlookLayer, popup, forecastPanel, regionBounds, precipScout, radar, reportsLayer, reportsFeed, mcdLayer, mcdFeed, tempsLayer, obsFeed, velocityLayer, satelliteLayer, rainfallLayer, droughtLayer, droughtFeed, firewxLayer, firewxFeed, tropicalLayer, tropicalFeed, almanacFeed }) {
  const chipEl = document.getElementById('outlook-chip');
  const wideBounds = regionBounds.pad(1.6); // outlook shots need the multi-state pattern

  // Every camera move goes through here so the radar loop can warm the
  // destination's tiles while the shot is still in the air.
  function fly(bounds, maxZoom) {
    radar?.prewarm(bounds, maxZoom);
    map.flyToBounds(bounds, { duration: FLY_MS / 1000, ...(maxZoom ? { maxZoom } : {}) });
  }

  let active = [];
  let queue = [];      // newly issued warnings awaiting an interrupt tour
  let touring = null;
  let dwellUntil = Infinity; // advance() runs once boot() arms the loop
  let rotIdx = -1;     // warning rotation position: 0 = overview, then warnings, then in-warning reports
  let idlePlan = [];
  let idleIdx = 0;
  let spotIdx = 0; // 7-day city spotlight rotation — next city each idle cycle
  let rainIdx = 0; // rainfall-totals window rotation (24h → 48h → 3-day)
  let satIdx = 0;  // satellite channel rotation (vis when daylit → IR → WV)
  let almIdx = 0;  // almanac city rotation — next city each idle cycle

  function onAlerts({ alerts, added }) {
    active = alerts;

    const fresh = added.filter(announces);
    if (fresh.length) {
      queue.push(...fresh.filter(f => !queue.some(q => q.key === f.key)));
      queue.sort((a, b) => b.score - a.score);
      dwellUntil = 0; // cut the current shot
    }

    if (touring) {
      const live = active.find(a => a.key === touring.key);
      if (!live) {
        touring = null;
        dwellUntil = 0; // toured alert expired/cancelled — move on
      } else {
        // Only re-render the popup on a real update (CON/EXT gets a fresh CAP
        // id) — every poll returns new objects, and re-showing each tick would
        // replay the card animation constantly.
        if (live.id !== touring.id) popup.show(live, false);
        touring = live;
      }
    }
  }

  function advance() {
    // 1. New warnings pre-empt everything. Announce-only alerts (CONSIDERABLE
    //    flash flood warnings) get this one tour framed wide, then fall back
    //    to the idle plan.
    while (queue.length) {
      const next = queue.shift();
      const live = active.find(a => a.key === next.key);
      if (live) return startTour(live, true, TOUR_DWELL_MS, isTourable(live) ? TOUR_MAX_ZOOM : MINOR_MAX_ZOOM);
    }

    // 2. Active warnings: rotate overview ↔ warnings by severity. When the
    //    top warning is high-end, interleave it so it owns most of the airtime.
    //    Recent reports from INSIDE a warning polygon ride at the end of the
    //    rotation — a spotter confirming the damage is the money shot.
    const warnings = active.filter(isTourable).sort((a, b) => b.score - a.score);
    if (warnings.length) {
      idlePlan = [];
      const solo = warnings.length === 1;
      const cutoff = Date.now() - REPORT_IN_WARN_WINDOW_MS;
      const inWarn = (reportsFeed?.all() ?? [])
        .filter(r => new Date(r.valid).getTime() >= cutoff)
        .filter(r => warnings.some(w => w.geometry && pointInGeometry([r.lon, r.lat], w.geometry)))
        .sort((a, b) => b.priority - a.priority || new Date(b.valid) - new Date(a.valid))
        .slice(0, REPORT_IN_WARN_MAX);

      const rotation = [{ kind: 'overview', dwell: solo ? SOLO_OVERVIEW_DWELL_MS : OVERVIEW_DWELL_MS }];
      const alertStop = (w, base) => ({ kind: 'alert', alert: w, dwell: dwellFor(w, base) });
      if (solo) {
        // Lone warning: mostly stay on it, brief overview resets for context.
        rotation.push(alertStop(warnings[0], SOLO_TOUR_DWELL_MS));
      } else if (warnings[0].score >= FOCUS_SCORE) {
        for (const w of warnings.slice(1)) rotation.push(alertStop(warnings[0], TOUR_DWELL_MS), alertStop(w, TOUR_DWELL_MS));
        rotation.push(alertStop(warnings[0], TOUR_DWELL_MS));
      } else {
        for (const w of warnings) rotation.push(alertStop(w, TOUR_DWELL_MS));
      }
      for (const r of inWarn) rotation.push({ kind: 'report', id: r.id, dwell: REPORT_IN_WARN_DWELL_MS });

      rotIdx = (rotIdx + 1) % rotation.length;
      const stop = rotation[rotIdx];
      if (stop.kind === 'overview') return goOverview(stop.dwell);
      if (stop.kind === 'report') return startReport(stop.id, stop.dwell);
      return startTour(stop.alert, false, stop.dwell);
    }

    // 3. No warnings: idle plan (rebuilt each time it wraps, so new watches /
    //    precip areas / outlook changes get picked up every cycle).
    rotIdx = -1;
    if (idleIdx >= idlePlan.length) {
      idlePlan = buildIdlePlan();
      idleIdx = 0;
    }
    runIdleStep(idlePlan[idleIdx++]);
  }

  function buildIdlePlan() {
    const watches = active
      .filter(a => a.style.watch && a.geometry)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    // Lower-tier alerts (flood warnings, special weather statements,
    // advisories): not worth chasing like a severe warning, but each gets a
    // camera visit with the detail card so viewers see what's in effect.
    const minors = active
      .filter(a => a.geometry && !isTourable(a) && !a.style.watch)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    // Mesoscale Discussions: SPC watching an area (often before a watch). Each
    // gets a wide camera visit with the detail card, like a watch.
    const mcds = mcdFeed ? mcdFeed.get() : [];
    const pois = precipScout ? precipScout.get() : [];
    const reports = reportsFeed ? reportsFeed.get() : [];
    const busy = watches.length > 0 || mcds.length > 0 || pois.length > 0 || minors.length > 0 || reports.length > 0;

    const plan = [{ type: 'overview', dwell: busy ? 25_000 : 45_000 }];
    for (const w of watches) plan.push({ type: 'watch', key: w.key, dwell: 25_000 });
    for (const m of mcds) plan.push({ type: 'mcd', key: m.key, dwell: 22_000 });
    for (const r of reports) plan.push({ type: 'report', id: r.id, dwell: 18_000 });
    for (const m of minors) plan.push({ type: 'minor', key: m.key, dwell: 18_000 });
    for (const p of pois) plan.push({ type: 'poi', poi: p, dwell: 20_000 });
    // Days 1–2 also carry SPC's tornado/wind/hail probabilities — each rides
    // right behind its categorical shot, and self-skips at runtime when no
    // probability area touches the region (the data isn't fetched until the
    // shot airs, so the plan can't know yet).
    const hazardStops = [['torn', '🌪️ Tornado'], ['wind', '💨 Damaging Wind'], ['hail', '🧊 Large Hail']];
    plan.push({ type: 'outlook', day: 'day1', label: 'Day 1 Convective Outlook', dwell: busy ? 15_000 : 20_000 });
    for (const [hz, name] of hazardStops) plan.push({ type: 'outlook', day: 'day1', hazard: hz, label: `${name} Threat — Day 1`, dwell: busy ? 12_000 : 16_000 });
    plan.push({ type: 'outlook', day: 'day2', label: 'Day 2 Convective Outlook', dwell: busy ? 12_000 : 20_000 });
    for (const [hz, name] of hazardStops) plan.push({ type: 'outlook', day: 'day2', hazard: hz, label: `${name} Threat — Day 2`, dwell: busy ? 12_000 : 16_000 });
    plan.push({ type: 'outlook', day: 'day3', label: 'Day 3 Convective Outlook', dwell: busy ? 12_000 : 20_000 });
    // Quiet-day depth, in "now → recent past → next 3 days → the week" order:
    // current temps, rainfall totals + the drought picture (a natural pair:
    // who got rain, who still needs it), the 3-day board, one city's 7 days.
    const obs = obsFeed?.get() ?? [];
    if (obs.length >= 6) plan.push({ type: 'temps', dwell: busy ? 15_000 : 22_000 });
    // Feels-like right after temps, but only when it's a story: heat index
    // hitting 100°+ or wind chill 25°- somewhere, and actually diverging from
    // the plain temp (otherwise it's the temps shot with a different title).
    const feels = obs.filter(o => o.feelsF != null);
    if (feels.length >= 6) {
      const peak = Math.max(...feels.map(o => o.feelsF));
      const chill = Math.min(...feels.map(o => o.feelsF));
      const diverges = feels.some(o => Math.abs(o.feelsF - o.tempF) >= 2);
      if (diverges && (peak >= 100 || chill <= 25)) {
        plan.push({ type: 'feels', hot: peak >= 100, dwell: busy ? 15_000 : 22_000 });
      }
    }
    // Satellite — the view from space. One GOES channel per cycle; the
    // visible channel is only in the rotation while the sun is up.
    const sat = satelliteLayer?.channels() ?? [];
    if (sat.length) plan.push({ type: 'satellite', channel: sat[satIdx++ % sat.length].key, dwell: busy ? 15_000 : 22_000 });
    // Rainfall stop only when something actually fell (the scan gates it);
    // the accumulation window rotates across cycles so repeats stay fresh.
    const rain = rainfallLayer?.periods() ?? [];
    if (rain.length) plan.push({ type: 'rainfall', period: rain[rainIdx++ % rain.length], dwell: busy ? 15_000 : 22_000 });
    // Drought shot from D1 (moderate) up — D0 alone is not a story.
    if ((droughtFeed?.worst() ?? -1) >= 1) plan.push({ type: 'drought', dwell: busy ? 14_000 : 20_000 });
    // Fire weather rides right behind drought (same dry-season story) — only
    // when SPC has an Elevated+ area over the region, per outlook day.
    for (const day of firewxFeed?.days() ?? []) {
      plan.push({ type: 'firewx', day, dwell: busy ? 14_000 : 20_000 });
    }
    // Tropical outlook whenever the Atlantic has a 7-day development area —
    // existence is the gate (no local-overlap test: remnants travel).
    if (tropicalFeed?.active()) plan.push({ type: 'tropical', dwell: busy ? 15_000 : 22_000 });
    if (forecastPanel?.ready()) {
      plan.push({ type: 'forecast', dwell: 30_000 });
      plan.push({ type: 'forecast-city', dwell: busy ? 18_000 : 25_000 });
    }
    // Climate almanac rides the same panel right after the forecast pages —
    // one city per cycle, today's normals + records.
    if (almanacFeed?.ready()) plan.push({ type: 'almanac', dwell: busy ? 18_000 : 25_000 });
    return plan;
  }

  // Back to plain reflectivity: cancel a pending mid-shot velocity switch,
  // drop the velocity/rainfall/drought overlays, and restore the ambient
  // outlook if the drought shot hid it. Every shot starts from here.
  let velTimer = null;
  let outlookHidden = false;
  function resetRadarMode() {
    if (velTimer) { clearTimeout(velTimer); velTimer = null; }
    velocityLayer?.hide();
    radar?.setDim(false);
    radar?.setHidden(false);
    satelliteLayer?.hide();
    rainfallLayer?.hide();
    droughtLayer?.hide();
    firewxLayer?.hide();
    tropicalLayer?.hide();
    if (outlookHidden) {
      outlookHidden = false;
      outlookLayer.show('day1');
    }
  }

  function runIdleStep(step) {
    resetRadarMode();
    if (step.type !== 'report') reportsLayer?.highlight(null);
    if (step.type !== 'mcd') mcdLayer?.highlight(null);
    if (step.type !== 'temps' && step.type !== 'feels') tempsLayer?.hide();
    switch (step.type) {
      case 'report': {
        outlookLayer.show('day1'); // reset from any outlook step
        return startReport(step.id, step.dwell);
      }
      case 'mcd': {
        outlookLayer.show('day1'); // reset from any outlook step
        return startMcd(step.key, step.dwell);
      }
      case 'watch': {
        const live = active.find(a => a.key === step.key);
        if (!live) return advance();
        return startTour(live, false, step.dwell, WATCH_MAX_ZOOM);
      }
      case 'minor': {
        const live = active.find(a => a.key === step.key);
        if (!live) return advance();
        return startTour(live, false, step.dwell, MINOR_MAX_ZOOM);
      }
      case 'forecast': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        hideChip();
        outlookLayer.show('day1');
        if (!forecastPanel?.show()) return advance();
        // show() already shrank the map + invalidateSize'd, so this fly
        // frames the region in the reduced viewport.
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'forecast-city': {
        // Runs right after the board, so the panel is usually already open —
        // the content swap (board → one city's week) reads as a page turn.
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        hideChip();
        outlookLayer.show('day1');
        if (!forecastPanel?.showCity(spotIdx++)) return advance();
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'almanac': {
        // Third page in the panel sequence: today's normals + records for one
        // city, rotating through the climate cities cycle by cycle.
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        hideChip();
        outlookLayer.show('day1');
        const cities = almanacFeed?.get() ?? [];
        if (!cities.length) return advance();
        const c = cities[almIdx++ % cities.length];
        const nowF = (obsFeed?.get() ?? []).find(o => o.id === c.obsId)?.tempF ?? null;
        if (!forecastPanel?.showAlmanac(c, { nowF, dateLabel: almanacFeed.dateLabel() })) return advance();
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'temps': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        outlookLayer.show('day1');
        tempsLayer?.show(obsFeed?.get() ?? []);
        showChip('🌡️ Current Temperatures<span class="sub">NWS observations</span>');
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'feels': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        outlookLayer.show('day1');
        // Recompute the extreme from live obs — the plan may be minutes old.
        const feels = (obsFeed?.get() ?? []).filter(o => o.feelsF != null);
        if (feels.length < 6) return advance();
        tempsLayer?.show(feels, 'feelsF');
        const ext = feels.reduce((a, b) =>
          (step.hot ? b.feelsF > a.feelsF : b.feelsF < a.feelsF) ? b : a);
        showChip(step.hot
          ? `🥵 Feels Like — Heat Index<span class="sub">Peak: <b>${ext.feelsF}°</b> at ${ext.city} · temperature + humidity</span>`
          : `🥶 Feels Like — Wind Chill<span class="sub">Coldest: <b>${ext.feelsF}°</b> at ${ext.city} · temperature + wind</span>`);
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'satellite': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        const ch = satelliteLayer?.show(step.channel);
        if (!ch) return advance();
        outlookLayer.hide(); // full-frame imagery — risk fills bleeding through read as color cast
        outlookHidden = true;
        showChip(`🛰️ ${ch.label}<span class="sub">${ch.sub} · GOES-East</span>`);
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'rainfall': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        outlookLayer.show('day1');
        const p = step.period;
        // Radar hides only once the totals tiles are painted — both are precip
        // palettes, but a brief overlap beats holes in the map on air.
        rainfallLayer.show(p.key, () => radar?.setHidden(true));
        showChip(`🌧️ ${p.label} Totals<span class="sub">Heaviest: ${formatInches(p.maxMm)} near ${p.place} · MRMS radar estimate</span>${legendHtml()}`);
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'drought': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        const info = droughtLayer?.show(droughtFeed?.get() ?? []);
        if (!info) return advance(); // data gone since the plan was built
        outlookLayer.hide(); // outlook risk fills run the same color ramp
        outlookHidden = true;
        const legend = info.legend
          .map(m => `<span class="sw" style="background:${m.color}"></span>D${m.dm}`)
          .join(' ');
        showChip(`🏜️ U.S. Drought Monitor<span class="sub">Worst locally: <b style="color:${info.worst.chip}">${info.worst.label}</b></span><span class="sub">${legend} &nbsp;·&nbsp; burn bans common in D2+ counties</span>`);
        fly(regionBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'firewx': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        const worst = firewxFeed?.worst(step.day);
        const info = worst && firewxLayer?.show(firewxFeed.get(step.day));
        if (!info) return advance(); // area gone since the plan was built
        outlookLayer.hide(); // convective risk fills run the same orange/red ramp
        outlookHidden = true;
        const dayNum = step.day === 'day1' ? '1' : '2';
        const legend = info.legend
          .map(m => `<span class="sw" style="background:${m.color}"></span>${m.label}`)
          .join(' ');
        showChip(`🔥 Day ${dayNum} Fire Weather Outlook<span class="sub">Highest locally: <b style="color:${worst.chip}">${worst.label} Fire Risk</b></span><span class="sub">${legend} &nbsp;·&nbsp; gusty wind + low humidity — SPC</span>`);
        fly(wideBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'tropical': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        const info = tropicalLayer?.show(tropicalFeed?.get() ?? { areas: [], points: [] });
        if (!info) return advance(); // basin went quiet since the plan was built
        outlookLayer.hide(); // convective risk fills run the same yellow→red ramp
        outlookHidden = true;
        const legend = info.legend
          .map(m => `<span class="sw" style="background:${m.color}"></span>${m.label}`)
          .join(' ');
        showChip(`🌀 Tropical Weather Outlook<span class="sub">Highest 7-day formation chance: <b style="color:${info.top.chip}">${info.top.prob}% (${info.top.label})</b></span><span class="sub">${legend} &nbsp;·&nbsp; ✕ current location — NHC</span>`);
        // Gulf always in frame, stretched to reach the region and any area
        // sitting outside it (a Caribbean or open-Atlantic wave stays visible).
        const b = L.latLngBounds(boundsToLeaflet(GULF_BBOX)).extend(regionBounds);
        if (info.bbox) b.extend(L.latLngBounds(boundsToLeaflet(info.bbox)));
        fly(b.pad(0.05));
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'poi': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        outlookLayer.show('day1');
        showChip(`📡 Tracking precipitation<span class="sub">near ${step.poi.name}</span>`);
        fly(L.latLngBounds(boundsToLeaflet(step.poi.bounds)).pad(0.15), POI_MAX_ZOOM);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'outlook': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        forecastPanel?.hide();
        fly(wideBounds);
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        // The fetch resolves mid-fly; if a fresh warning pre-empted the shot
        // meanwhile, dwellUntil has moved and this result belongs to a dead shot.
        const myShot = dwellUntil;
        outlookLayer.show(step.day, { emphasize: true, hazard: step.hazard ?? 'cat' }).then(info => {
          if (dwellUntil !== myShot) return;
          if (step.hazard) {
            // Probability shot with nothing over the region — cut it now
            // rather than air a blank map.
            if (!info?.worst) { dwellUntil = 0; return; }
            const legend = info.legend
              .map(m => `<span class="sw" style="background:${m.color}"></span>${m.label}`)
              .join(' ');
            const sig = info.sig ? ' &nbsp;·&nbsp; hatched: intense potential' : '';
            showChip(`${step.label}<span class="sub">Highest locally: <b style="color:${info.worst.color}">${info.worst.label}</b> chance within 25 mi of a point</span><span class="sub">${legend}${sig} &nbsp;·&nbsp; SPC</span>`);
            return;
          }
          const sub = info
            ? (info.worst
              ? `Highest risk locally: <b style="color:${info.worst.color}">${info.worst.label}</b>`
              : 'No severe risk in the ArkLaTex')
            : '';
          showChip(`${step.label}<span class="sub">${sub}</span>`);
        });
        return;
      }
      default: { // overview
        hideChip();
        return goOverview(step.dwell); // goOverview restores the ambient outlook
      }
    }
  }

  // Camera visit to a Local Storm Report pin — used by both the idle plan and
  // the warning rotation (for reports inside an active warning polygon).
  function startReport(id, dwell) {
    const live = (reportsFeed?.all() ?? []).find(r => r.id === id);
    if (!live) return advance();
    resetRadarMode();
    touring = null;
    alertsLayer.highlight(null);
    mcdLayer?.highlight(null);
    tempsLayer?.hide();
    forecastPanel?.hide();
    hideChip();
    reportsLayer?.highlight(live.id);
    popup.showReport(live);
    fly(L.latLng(live.lat, live.lon).toBounds(REPORT_BOX_M), REPORT_MAX_ZOOM);
    dwellUntil = Date.now() + FLY_MS + dwell;
  }

  // Camera visit to a Mesoscale Discussion outline — idle plan only (MCDs are
  // context, not something to chase mid-warning). Frames the whole outline wide
  // and shows the detail card with SPC's summary.
  function startMcd(key, dwell) {
    const live = (mcdFeed?.all() ?? []).find(m => m.key === key);
    if (!live || !live.bounds) return advance();
    resetRadarMode();
    touring = null;
    alertsLayer.highlight(null);
    reportsLayer?.highlight(null);
    tempsLayer?.hide();
    forecastPanel?.hide();
    hideChip();
    mcdLayer?.highlight(live.key);
    popup.showMcd(live);
    fly(L.latLngBounds(boundsToLeaflet(live.bounds)).pad(0.25), MCD_MAX_ZOOM);
    dwellUntil = Date.now() + FLY_MS + dwell;
  }

  function startTour(alert, isNew, dwell = TOUR_DWELL_MS, maxZoom = TOUR_MAX_ZOOM) {
    resetRadarMode();
    outlookLayer.show('day1'); // an emphasized hazard/outlook shot must not linger under the warning
    touring = alert;
    hideChip();
    reportsLayer?.highlight(null);
    mcdLayer?.highlight(null);
    tempsLayer?.hide();
    forecastPanel?.hide(); // restores full-width map before the fly is computed
    const bounds = L.latLngBounds(boundsToLeaflet(alert.bounds)).pad(0.3);
    fly(bounds, maxZoom);
    alertsLayer.highlight(alert.key);
    if (isNew) alertsLayer.flash(alert.key); // ~10 s white strobe as the camera arrives
    popup.show(alert, isNew);
    dwellUntil = Date.now() + FLY_MS + dwell;

    // Act two: swap to base velocity partway through the hold on storm-scale
    // warnings. Guarded by key so a pre-empted or expired shot never flips a
    // later, unrelated shot into velocity mode.
    const ev = (alert.props?.event ?? '').toLowerCase();
    if (velocityLayer && VELOCITY_EVENTS.has(ev) && alert.bounds) {
      const [w, s, e, n] = alert.bounds;
      velTimer = setTimeout(() => {
        velTimer = null;
        if (touring?.key !== alert.key) return;
        const site = velocityLayer.show((s + n) / 2, (w + e) / 2);
        if (!site) return;
        radar?.setDim(true);
        showChip(`🌀 Storm Velocity — ${site.id} ${site.name}<span class="sub">green: toward radar · red: away · tight couplet = rotation</span>`);
      }, FLY_MS + dwell * VELOCITY_AT);
    }
  }

  function goOverview(dwell) {
    resetRadarMode();
    outlookLayer.show('day1'); // back to ambient categorical
    touring = null;
    popup.hide();
    alertsLayer.highlight(null);
    reportsLayer?.highlight(null);
    mcdLayer?.highlight(null);
    tempsLayer?.hide();
    forecastPanel?.hide();
    fly(regionBounds);
    dwellUntil = Date.now() + FLY_MS + dwell;
  }

  function showChip(html) {
    if (!chipEl) return;
    chipEl.innerHTML = html;
    chipEl.style.display = 'block';
  }

  function hideChip() {
    if (chipEl) chipEl.style.display = 'none';
  }

  function boot() {
    // The director tick is the camera's pulse — if it dies the stream freezes
    // on one shot forever. Critical: the watchdog reloads on silence.
    const beat = track('director', { pollMs: 1000, critical: true });
    dwellUntil = 0;
    setInterval(() => {
      try {
        if (Date.now() >= dwellUntil) advance();
        beat.ok();
      } catch (err) {
        // dwellUntil is still in the past, so next tick retries; the heartbeat
        // is withheld, so a *persistent* throw trips the watchdog reload
        // instead of freezing the camera forever.
        console.error('[director] advance failed:', err);
      }
    }, 1000);
  }

  return { onAlerts, boot };
}
