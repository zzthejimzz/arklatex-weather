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
//                   SPC outlooks Days 1–3 (wide), then the city forecast board.
import L from 'leaflet';
import { boundsToLeaflet, pointInGeometry } from '../utils/geometry.js';
import { isTourable } from './scoring.js';

const TOUR_DWELL_MS = 25_000;
const OVERVIEW_DWELL_MS = 30_000;
const SOLO_TOUR_DWELL_MS = 45_000; // lone warning holds the shot longer
const SOLO_OVERVIEW_DWELL_MS = 15_000;
const FLY_MS = 2_400;
const TOUR_MAX_ZOOM = 12.4; // vector road names populate from GL z11 (Leaflet 12) — streets read on air
const WATCH_MAX_ZOOM = 8.5;
const POI_MAX_ZOOM = 9.4;
const MINOR_MAX_ZOOM = 9.8; // flood warnings / statements cover zones — stay wide enough to frame them
const REPORT_MAX_ZOOM = 11; // storm report pins: close enough to name the town
const REPORT_BOX_M = 36_000; // fly frame around a report point (~36 km square)
// Reports inside an active warning polygon join the warning rotation —
// ground truth from inside the box beats another polygon lap. Same 3 h window
// as the map pins; shorter dwell than idle stops so warnings keep the airtime.
const REPORT_IN_WARN_WINDOW_MS = 3 * 60 * 60 * 1000;
const REPORT_IN_WARN_DWELL_MS = 15_000;
const REPORT_IN_WARN_MAX = 2;

// Destructive severe and every tornado warning: the rotation returns to it
// between other stops and it holds the shot longer.
const FOCUS_SCORE = 70;
function dwellFor(alert, base) {
  if (alert.score >= 90) return base + 15_000;
  if (alert.score >= FOCUS_SCORE) return base + 8_000;
  return base;
}

export function createDirector({ map, alertsLayer, outlookLayer, popup, forecastPanel, regionBounds, precipScout, radar, reportsLayer, reportsFeed }) {
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

  function onAlerts({ alerts, added }) {
    active = alerts;

    const fresh = added.filter(isTourable);
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
    // 1. New warnings pre-empt everything.
    while (queue.length) {
      const next = queue.shift();
      const live = active.find(a => a.key === next.key);
      if (live) return startTour(live, true);
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
    const pois = precipScout ? precipScout.get() : [];
    const reports = reportsFeed ? reportsFeed.get() : [];
    const busy = watches.length > 0 || pois.length > 0 || minors.length > 0 || reports.length > 0;

    const plan = [{ type: 'overview', dwell: busy ? 25_000 : 45_000 }];
    for (const w of watches) plan.push({ type: 'watch', key: w.key, dwell: 25_000 });
    for (const r of reports) plan.push({ type: 'report', id: r.id, dwell: 18_000 });
    for (const m of minors) plan.push({ type: 'minor', key: m.key, dwell: 18_000 });
    for (const p of pois) plan.push({ type: 'poi', poi: p, dwell: 20_000 });
    plan.push(
      { type: 'outlook', day: 'day1', label: 'Day 1 Convective Outlook', dwell: busy ? 15_000 : 20_000 },
      { type: 'outlook', day: 'day2', label: 'Day 2 Convective Outlook', dwell: busy ? 12_000 : 20_000 },
      { type: 'outlook', day: 'day3', label: 'Day 3 Convective Outlook', dwell: busy ? 12_000 : 20_000 },
    );
    if (forecastPanel?.ready()) plan.push({ type: 'forecast', dwell: 30_000 });
    return plan;
  }

  function runIdleStep(step) {
    if (step.type !== 'report') reportsLayer?.highlight(null);
    switch (step.type) {
      case 'report': {
        outlookLayer.show('day1'); // reset from any outlook step
        return startReport(step.id, step.dwell);
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
        outlookLayer.show(step.day, { emphasize: true }).then(info => {
          showChip(`${step.label}<span class="sub">${info?.maxRisk ?? ''}</span>`);
        });
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      default: { // overview
        hideChip();
        outlookLayer.show('day1'); // back to ambient
        return goOverview(step.dwell);
      }
    }
  }

  // Camera visit to a Local Storm Report pin — used by both the idle plan and
  // the warning rotation (for reports inside an active warning polygon).
  function startReport(id, dwell) {
    const live = (reportsFeed?.all() ?? []).find(r => r.id === id);
    if (!live) return advance();
    touring = null;
    alertsLayer.highlight(null);
    forecastPanel?.hide();
    hideChip();
    reportsLayer?.highlight(live.id);
    popup.showReport(live);
    fly(L.latLng(live.lat, live.lon).toBounds(REPORT_BOX_M), REPORT_MAX_ZOOM);
    dwellUntil = Date.now() + FLY_MS + dwell;
  }

  function startTour(alert, isNew, dwell = TOUR_DWELL_MS, maxZoom = TOUR_MAX_ZOOM) {
    touring = alert;
    hideChip();
    reportsLayer?.highlight(null);
    forecastPanel?.hide(); // restores full-width map before the fly is computed
    const bounds = L.latLngBounds(boundsToLeaflet(alert.bounds)).pad(0.3);
    fly(bounds, maxZoom);
    alertsLayer.highlight(alert.key);
    if (isNew) alertsLayer.flash(alert.key); // ~10 s white strobe as the camera arrives
    popup.show(alert, isNew);
    dwellUntil = Date.now() + FLY_MS + dwell;
  }

  function goOverview(dwell) {
    touring = null;
    popup.hide();
    alertsLayer.highlight(null);
    reportsLayer?.highlight(null);
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
    dwellUntil = 0;
    setInterval(() => {
      if (Date.now() >= dwellUntil) advance();
    }, 1000);
  }

  return { onAlerts, boot };
}
