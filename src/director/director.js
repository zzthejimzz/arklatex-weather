// The broadcast "director": decides where the camera looks. Something should
// always be happening on screen.
//
// Warnings active:  overview ↔ tour each warning by severity; a newly issued
//                   warning pre-empts whatever is on screen. A lone warning
//                   gets most of the airtime.
// No warnings:      idle plan built fresh each cycle from whatever exists —
//                   watches (flashing outline + detail card), then radar echo
//                   clusters from the precip scout, then SPC outlooks (wide).
import L from 'leaflet';
import { boundsToLeaflet } from '../utils/geometry.js';
import { isTourable } from './scoring.js';

const TOUR_DWELL_MS = 25_000;
const OVERVIEW_DWELL_MS = 30_000;
const SOLO_TOUR_DWELL_MS = 45_000; // lone warning holds the shot longer
const SOLO_OVERVIEW_DWELL_MS = 15_000;
const FLY_MS = 2_400;
const TOUR_MAX_ZOOM = 10.6; // deep enough that streets/towns read on air
const WATCH_MAX_ZOOM = 8.5;
const POI_MAX_ZOOM = 9.4;

export function createDirector({ map, alertsLayer, outlookLayer, popup, regionBounds, precipScout }) {
  const chipEl = document.getElementById('outlook-chip');
  const wideBounds = regionBounds.pad(1.1); // outlook shots need surrounding states

  let active = [];
  let queue = [];      // newly issued warnings awaiting an interrupt tour
  let touring = null;
  let dwellUntil = Infinity; // advance() runs once boot() arms the loop
  let rotIdx = -1;     // warning rotation position: 0 = overview, 1..N = warnings
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

    // 2. Active warnings: rotate overview ↔ warnings by severity.
    const warnings = active.filter(isTourable).sort((a, b) => b.score - a.score);
    if (warnings.length) {
      idlePlan = [];
      if (warnings.length === 1) {
        // Lone warning: mostly stay on it, brief overview resets for context.
        rotIdx = rotIdx === 1 ? 0 : 1;
        return rotIdx === 1
          ? startTour(warnings[0], false, SOLO_TOUR_DWELL_MS)
          : goOverview(SOLO_OVERVIEW_DWELL_MS);
      }
      rotIdx = (rotIdx + 1) % (warnings.length + 1);
      if (rotIdx === 0) return goOverview(OVERVIEW_DWELL_MS);
      return startTour(warnings[rotIdx - 1], false);
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
    const pois = precipScout ? precipScout.get() : [];
    const busy = watches.length > 0 || pois.length > 0;

    const plan = [{ type: 'overview', dwell: busy ? 25_000 : 45_000 }];
    for (const w of watches) plan.push({ type: 'watch', key: w.key, dwell: 25_000 });
    for (const p of pois) plan.push({ type: 'poi', poi: p, dwell: 20_000 });
    if (busy) {
      plan.push({ type: 'outlook', day: 'day1', label: 'Day 1 Convective Outlook', dwell: 15_000 });
    } else {
      plan.push(
        { type: 'outlook', day: 'day1', label: 'Day 1 Convective Outlook', dwell: 20_000 },
        { type: 'outlook', day: 'day2', label: 'Day 2 Convective Outlook', dwell: 20_000 },
        { type: 'outlook', day: 'day3', label: 'Day 3 Convective Outlook', dwell: 20_000 },
      );
    }
    return plan;
  }

  function runIdleStep(step) {
    switch (step.type) {
      case 'watch': {
        const live = active.find(a => a.key === step.key);
        if (!live) return advance();
        return startTour(live, false, step.dwell, WATCH_MAX_ZOOM);
      }
      case 'poi': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        outlookLayer.show('day1');
        showChip(`📡 Tracking precipitation<span class="sub">near ${step.poi.name}</span>`);
        map.flyToBounds(L.latLngBounds(boundsToLeaflet(step.poi.bounds)).pad(0.15), {
          duration: FLY_MS / 1000,
          maxZoom: POI_MAX_ZOOM,
        });
        dwellUntil = Date.now() + FLY_MS + step.dwell;
        return;
      }
      case 'outlook': {
        touring = null;
        popup.hide();
        alertsLayer.highlight(null);
        map.flyToBounds(wideBounds, { duration: FLY_MS / 1000 });
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

  function startTour(alert, isNew, dwell = TOUR_DWELL_MS, maxZoom = TOUR_MAX_ZOOM) {
    touring = alert;
    hideChip();
    const bounds = L.latLngBounds(boundsToLeaflet(alert.bounds)).pad(0.45);
    map.flyToBounds(bounds, { duration: FLY_MS / 1000, maxZoom });
    alertsLayer.highlight(alert.key);
    popup.show(alert, isNew);
    dwellUntil = Date.now() + FLY_MS + dwell;
  }

  function goOverview(dwell) {
    touring = null;
    popup.hide();
    alertsLayer.highlight(null);
    map.flyToBounds(regionBounds, { duration: FLY_MS / 1000 });
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
