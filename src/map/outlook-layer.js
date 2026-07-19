// SPC outlook overlay (categorical + Day 1/2 tornado/wind/hail probabilities).
// Sits in overlayPane (z 400) below the radar pane so echoes read on top of
// the risk fills. Day 1 categorical stays on at low opacity as ambient
// context, except General Thunder (TSTM), whose green can be mistaken for
// radar echoes; the idle tour re-shows days 1–3 (and the Day 1/2 hazard
// probabilities) emphasized with every tier visible.
import L from 'leaflet';
import { fetchOutlook } from '../utils/spc-api.js';
import { styleForFeature, normalizeLabel, HAZARD_MAPS } from '../utils/map-colors.js';
import { geometriesIntersect } from '../utils/geometry.js';

const AMBIENT_OPACITY = 0.22;
const EMPHASIZED_OPACITY = 0.5;
const REFRESH_MS = 15 * 60 * 1000;

export function createOutlookLayer(map, geo) {
  const hull = { type: 'Polygon', coordinates: [geo.hull] };
  let layer = null;
  let currentDay = null;
  let currentHazard = 'cat';
  let emphasized = false;
  let lastKey = null;
  let lastSummary = null;
  let gen = 0; // bumped by every show()/hide() — an in-flight show that lost the race must not paint

  async function show(day = 'day1', { emphasize = false, force = false, hazard = 'cat' } = {}) {
    // The director calls show('day1') on every overview pass — skip the
    // re-render when nothing changed (the refresh timer passes force).
    const key = `${day}:${hazard}:${emphasize ? 1 : 0}`;
    if (!force && key === lastKey && layer) return lastSummary;
    const myGen = ++gen;

    let data;
    try {
      data = await fetchOutlook(day, hazard);
    } catch (err) {
      console.warn(`[outlook] ${day}/${hazard} fetch failed:`, err);
      return null;
    }
    // A hide() (drought/fire shot) or newer show() happened while we awaited —
    // painting now would resurrect the layer under someone else's fills.
    if (myGen !== gen) return null;

    const next = L.geoJSON(data, {
      interactive: false,
      filter: f => emphasize || hazard !== 'cat' || normalizeLabel(f) !== 'TSTM',
      style: f => {
        const s = styleForFeature(hazard, f);
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
    currentHazard = hazard;
    emphasized = emphasize;
    lastKey = key;
    lastSummary = summarize(data, hazard);
    return lastSummary;
  }

  // Fetch + summarize without painting — the director checks that a hazard
  // has a local area before committing the camera (and the screen) to the
  // shot. fetchOutlook caches, so the show() that follows a good peek is free.
  async function peek(day, hazard) {
    try {
      return summarize(await fetchOutlook(day, hazard), hazard);
    } catch (err) {
      console.warn(`[outlook] ${day}/${hazard} peek failed:`, err);
      return null;
    }
  }

  // Regional summary for the idle-tour chip: only tiers whose polygons touch
  // the ArkLaTex hull count — a High risk over Kansas is not our headline.
  // Hatched CIG (higher-intensity) areas don't rank; they set a flag.
  function summarize(data, hazard) {
    const colorMap = HAZARD_MAPS[hazard] ?? {};
    const local = new Map(); // normalized label → entry, tiers over the region
    let sig = false;
    for (const f of data?.features ?? []) {
      const key = normalizeLabel(f);
      const entry = colorMap[key];
      if (!entry || !f.geometry) continue;
      if (!geometriesIntersect(f.geometry, hull)) continue;
      if (entry.isHatch) { sig = true; continue; }
      local.set(key, entry);
    }
    const rank = ([k, e]) => e.order ?? parseInt(k, 10);
    const tiers = [...local.entries()].sort((a, b) => rank(a) - rank(b));
    const worst = tiers.length ? tiers[tiers.length - 1][1] : null;
    return {
      worst: worst ? { label: worst.label, color: worst.fill } : null,
      sig,
      legend: tiers.map(([, e]) => ({ label: e.label, color: e.fill })),
    };
  }

  // Fully off — for shots whose own fills would collide with the risk colors
  // (the drought monitor and fire weather outlook run the same
  // yellow→orange→red ramp). currentDay is
  // cleared so the refresh timer can't resurrect the layer mid-shot; the next
  // show() call brings it back.
  function hide() {
    gen++;
    if (layer) layer.remove();
    layer = null;
    currentDay = null;
    lastKey = null;
  }

  // Keep the ambient layer current — outlooks are reissued several times a day.
  setInterval(() => {
    if (currentDay) show(currentDay, { emphasize: emphasized, force: true, hazard: currentHazard });
  }, REFRESH_MS);

  return { show, hide, peek };
}
