// SPC Mesoscale Discussions via the Iowa Environmental Mesonet:
//   /api/1/nws/spc_mcd.geojson    → MCDs valid right now (polygon + metadata)
//   /api/1/nwstext/<product_id>   → the raw product text (CORS-open) for the
//                                   "Areas affected" and "SUMMARY" lines that
//                                   make the on-air card useful.
// The geojson alone gives us the polygon, MCD number, the "concerning" tag
// (e.g. an in-effect watch) and IEM's parsed watch-issuance probability.
import { geometriesIntersect, geometryBounds } from '../utils/geometry.js';
import { fetchWithTimeout } from '../utils/net.js';
import { track } from '../utils/health.js';

const MCD_URL = 'https://mesonet.agron.iastate.edu/api/1/nws/spc_mcd.geojson';
const TEXT_URL = id => `https://mesonet.agron.iastate.edu/api/1/nwstext/${encodeURIComponent(id)}`;
const POLL_MS = 5 * 60 * 1000;
const TICK_MS = 2_000;
const TOUR_MAX = 2; // rarely more than a couple over the region; cap the idle plan

// Pull one "Label...text" section out of the product, collapsing wrapped
// lines into a single sentence (the products hard-wrap at ~69 cols).
function section(text, label) {
  const re = new RegExp(`${label}\\.\\.\\.([\\s\\S]*?)(?:\\n\\n|$)`, 'i');
  const m = text.match(re);
  return m ? m[1].replace(/\s*\n\s*/g, ' ').trim() : '';
}

export function enrichMcd(feature) {
  const p = feature.properties ?? {};
  const geometry = feature.geometry ?? null;
  const wc = p.watch_confidence;
  return {
    // MCD number is stable across corrections/updates; product_id is the
    // per-issuance id used to fetch text.
    key: String(p.num),
    id: p.product_id ?? String(p.num),
    num: p.num,
    concerning: p.concerning ?? '',
    watchProb: Number.isFinite(wc) ? wc : null,
    issue: p.issue,
    expire: p.expire,
    // Filled from the product text (live) or carried on the feature (replay).
    areas: p.areas ?? '',
    summary: p.summary ?? '',
    geometry,
    bounds: geometry ? geometryBounds(geometry) : null,
  };
}

// The idle-tour short list: everything currently valid in the region, newest
// first, capped. MCDs are all worth a look — there are seldom many.
export function pickTourMcds(mcds, max = TOUR_MAX) {
  return [...mcds]
    .filter(m => m.bounds)
    .sort((a, b) => new Date(b.issue) - new Date(a.issue))
    .slice(0, max);
}

// Live source: poll the geojson, keep MCDs intersecting the region, and fetch
// each product's text once (cached) for the card's Areas/Summary lines.
export function createMcdSource(geo) {
  const hull = geo?.hull ? { type: 'Polygon', coordinates: [geo.hull] } : null;
  const textCache = new Map(); // product_id → { areas, summary }
  const seen = new Set();
  let first = true;
  let timer = null;
  let warned = false;
  const beat = track('mcd', { pollMs: POLL_MS });

  async function loadText(id) {
    if (!id) return {};
    if (textCache.has(id)) return textCache.get(id);
    try {
      const res = await fetchWithTimeout(TEXT_URL(id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = { areas: section(text, 'Areas affected'), summary: section(text, 'SUMMARY') };
      textCache.set(id, parsed);
      // MCDs valid at once are few, but a 24/7 page sees every issuance —
      // drop the oldest entries rather than growing forever.
      if (textCache.size > 100) {
        for (const k of textCache.keys()) {
          textCache.delete(k);
          if (textCache.size <= 80) break;
        }
      }
      return parsed;
    } catch {
      return {}; // card still works without the narrative
    }
  }

  return {
    start(onUpdate) {
      const poll = async () => {
        beat.attempt();
        try {
          const res = await fetchWithTimeout(MCD_URL);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const feats = (data.features ?? []).filter(
            f => f.geometry && (!hull || geometriesIntersect(f.geometry, hull)),
          );
          const mcds = [];
          for (const f of feats) {
            const base = enrichMcd(f);
            const extra = await loadText(f.properties?.product_id);
            mcds.push({ ...base, ...extra });
          }

          const added = first ? [] : mcds.filter(m => !seen.has(m.key));
          for (const m of mcds) seen.add(m.key);
          first = false;

          beat.ok();
          onUpdate({ mcds, added });
        } catch (err) {
          if (!warned) {
            console.warn('[mcd] fetch failed (will keep retrying):', err);
            warned = true;
          }
        } finally {
          timer = setTimeout(poll, POLL_MS);
        }
      };
      poll();
    },
    stop() { clearTimeout(timer); },
  };
}

// Replay source: reads an optional `mcds` array from /replay/<name>.json, the
// same file the alert replay uses. Each entry is
//   { delaySec, durationSec, feature: { geometry, properties } }
// and issue/expire are time-shifted to "now" so countdowns behave live. Lets
// the MCD tour be exercised on a quiet day (there's no live MCD locally now).
export function createMcdReplaySource(geo, name) {
  let timer = null;

  return {
    async start(onUpdate) {
      let entries = [];
      try {
        const res = await fetch(`/replay/${encodeURIComponent(name)}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        entries = (await res.json()).mcds ?? [];
      } catch (err) {
        console.warn(`[mcd] replay "${name}" has no mcds or failed to load:`, err);
        return;
      }
      if (!entries.length) return;

      const speed = 1;
      const t0 = Date.now();
      const activated = new Set();

      const tick = () => {
        const elapsed = (Date.now() - t0) / 1000 * speed;
        const mcds = [];
        const added = [];
        entries.forEach((entry, i) => {
          const { delaySec, durationSec } = entry;
          if (elapsed < delaySec || elapsed > delaySec + durationSec) return;
          const feature = structuredClone(entry.feature);
          feature.properties.issue = new Date(t0 + (delaySec / speed) * 1000).toISOString();
          feature.properties.expire = new Date(t0 + ((delaySec + durationSec) / speed) * 1000).toISOString();
          const m = enrichMcd(feature);
          m.key = `replay-mcd-${i}`;
          m.id = `replay-mcd-${i}`;
          mcds.push(m);
          if (!activated.has(i)) { activated.add(i); added.push(m); }
        });
        onUpdate({ mcds, added });
      };

      tick();
      timer = setInterval(tick, TICK_MS);
    },
    stop() { clearInterval(timer); },
  };
}
