// SPC categorical outlook overlay. Sits in overlayPane (z 400) below the radar
// pane so echoes read on top of the risk fills. Day 1 stays on at low opacity
// as ambient context; the idle tour re-shows days 1–3 emphasized.
import L from 'leaflet';
import { fetchOutlook } from '../utils/spc-api.js';
import { styleForFeature, normalizeLabel, CATEGORICAL } from '../utils/map-colors.js';

const AMBIENT_OPACITY = 0.22;
const EMPHASIZED_OPACITY = 0.5;
const REFRESH_MS = 15 * 60 * 1000;

export function createOutlookLayer(map) {
  let layer = null;
  let currentDay = null;
  let emphasized = false;
  let lastKey = null;
  let lastSummary = null;

  async function show(day = 'day1', { emphasize = false, force = false } = {}) {
    // The director calls show('day1') on every overview pass — skip the
    // re-render when nothing changed (the refresh timer passes force).
    const key = `${day}:${emphasize ? 1 : 0}`;
    if (!force && key === lastKey && layer) return lastSummary;

    let data;
    try {
      data = await fetchOutlook(day, 'cat');
    } catch (err) {
      console.warn(`[outlook] ${day} fetch failed:`, err);
      return null;
    }

    const next = L.geoJSON(data, {
      interactive: false,
      style: f => {
        const s = styleForFeature('cat', f);
        return {
          ...s,
          fillOpacity: emphasize ? Math.min(s.fillOpacity, EMPHASIZED_OPACITY) : AMBIENT_OPACITY,
          weight: 1,
          opacity: emphasize ? 1 : 0.5,
        };
      },
    });

    if (layer) layer.remove();
    layer = next.addTo(map);
    currentDay = day;
    emphasized = emphasize;
    lastKey = key;
    lastSummary = summarize(data);
    return lastSummary;
  }

  // Highest categorical risk present — for the idle-tour chip.
  function summarize(data) {
    let best = null;
    for (const f of data?.features ?? []) {
      const entry = CATEGORICAL[normalizeLabel(f)];
      if (entry && (!best || entry.order > best.order)) best = entry;
    }
    return { maxRisk: best?.label ?? 'No severe risk outlined' };
  }

  // Fully off — for shots whose own fills would collide with the risk colors
  // (the drought monitor runs the same yellow→orange→red ramp). currentDay is
  // cleared so the refresh timer can't resurrect the layer mid-shot; the next
  // show() call brings it back.
  function hide() {
    if (layer) layer.remove();
    layer = null;
    currentDay = null;
    lastKey = null;
  }

  // Keep the ambient layer current — outlooks are reissued several times a day.
  setInterval(() => {
    if (currentDay) show(currentDay, { emphasize: emphasized, force: true });
  }, REFRESH_MS);

  return { show, hide };
}
