// Live NWS alert source: polls the active-alerts feed for the four ArkLaTex
// states, filters to the region, and enriches each alert for the map/director.
import { geometriesIntersect, geometryBounds } from '../utils/geometry.js';
import { scoreAlert } from '../director/scoring.js';
import { styleForEvent } from '../utils/alert-style.js';
import { populationIn } from './population.js';
import { fetchWithTimeout } from '../utils/net.js';
import { parseMotion } from '../utils/storm-motion.js';

const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&area=AR,LA,TX,OK';
const POLL_MS = 30_000;

// VTEC gives a stable identity across CON/EXT updates of the same warning
// (each update gets a fresh CAP id, but office+phenomenon+significance+ETN
// stays put) — this stops the director from re-touring every update.
function parseVtecString(raw) {
  const m = raw?.match(/\/?[A-Z]\.([A-Z]{3})\.(K[A-Z]{3})\.([A-Z]{2})\.([A-Z])\.(\d{4})/);
  if (!m) return null;
  return { action: m[1], office: m[2], phen: m[3], sig: m[4], etn: m[5] };
}

export function parseVtec(props) {
  return parseVtecString(props?.parameters?.VTEC?.[0]);
}

// Actions meaning the event is over or replaced by a different product. Such
// segments stay in /alerts/active until their *message* expires — observed
// live: an EXP severe thunderstorm warning listed 6 minutes past its end —
// so they must be filtered or a dead warning lingers on air. A segment can
// carry several VTEC lines (e.g. CAN one product + NEW its replacement);
// only drop it when every line says the event is done.
const DEAD_ACTIONS = new Set(['CAN', 'EXP', 'UPG']);
export function eventEnded(props) {
  if (props?.messageType === 'Cancel') return true;
  const vtecs = (props?.parameters?.VTEC ?? []).map(parseVtecString).filter(Boolean);
  return vtecs.length > 0 && vtecs.every(v => DEAD_ACTIONS.has(v.action));
}

// Zone/county-based products (watches, winter, flood) often ship without a
// polygon — union the geometries of their UGC zones from our region file.
function geometryFromUgc(props, geo) {
  const polys = [];
  for (const code of props.geocode?.UGC ?? []) {
    const zone = geo?.zones?.[code];
    if (!zone?.geometry) continue;
    if (zone.geometry.type === 'Polygon') polys.push(zone.geometry.coordinates);
    else if (zone.geometry.type === 'MultiPolygon') polys.push(...zone.geometry.coordinates);
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
}

export function alertInRegion(feature, geo) {
  const codes = feature.properties?.geocode?.UGC ?? [];
  if (geo?.zones && codes.some(c => geo.zones[c])) return true;
  if (feature.geometry && geo?.hull) {
    return geometriesIntersect(feature.geometry, { type: 'Polygon', coordinates: [geo.hull] });
  }
  return false;
}

// Stable identity for an alert: its VTEC event (office+phenomenon+significance+
// ETN), falling back to the CAP id when a product carries no VTEC.
export function alertKey(feature) {
  const vtec = parseVtec(feature.properties);
  return vtec ? `${vtec.office}.${vtec.phen}.${vtec.sig}.${vtec.etn}`
              : (feature.properties?.id ?? feature.id);
}

// One VTEC event can arrive as several CAP features, each covering a *different*
// batch of UGC zones — SHV routinely issues a single heat warning as two
// segments (e.g. XH.W.0002 came as a Shreveport-core batch and an eastern-
// parishes batch on the same minute). They share one key, so keeping just one
// feature per key drops every segment but one and punches holes in the warning
// on the map. Merge same-key features into one alert whose footprint is the
// union of all their zones. (A genuine original+update pair for the same segment
// also shares the key; unioning its identical zones is a no-op, and we still
// take the newest message's props for the headline and timing.)
export function mergeSameKey(features) {
  const base = features.reduce((a, b) =>
    new Date(b.properties?.sent ?? 0) > new Date(a.properties?.sent ?? 0) ? b : a);
  if (features.length === 1) return base;

  const ugc = [...new Set(features.flatMap(f => f.properties?.geocode?.UGC ?? []))];
  // Union polygons only when every segment ships one; if any segment is zone-
  // only (the common heat/winter case) leave geometry null so enrichAlert
  // rebuilds the whole footprint from the merged UGC list.
  const geometry = features.every(f => f.geometry)
    ? {
        type: 'MultiPolygon',
        coordinates: features.flatMap(f =>
          f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates),
      }
    : null;

  return {
    ...base,
    geometry,
    properties: { ...base.properties, geocode: { ...base.properties?.geocode, UGC: ugc } },
  };
}

export function enrichAlert(feature, geo) {
  const props = feature.properties;
  const key = alertKey(feature);

  const geometry = feature.geometry ?? geometryFromUgc(props, geo);
  const bounds = geometry ? geometryBounds(geometry) : null;
  const states = [...new Set((props.geocode?.UGC ?? []).map(c => c.slice(0, 2)))];

  return {
    key,
    id: props.id ?? feature.id,
    props,
    geometry,
    bounds,
    style: styleForEvent(props.event),
    score: scoreAlert(props),
    population: geometry ? populationIn(geometry) : null,
    motion: parseMotion(props),
    states,
  };
}

// `ends` is when the event ends; `expires` is only when this *message* goes
// stale (long-fuse products like flood warnings carry ends hours past expires
// and get refreshed by follow-up statements — 8 of 24 alerts in a live feed
// sample had ends > expires). Prefer the event end.
function notExpired(feature) {
  const end = feature.properties?.ends ?? feature.properties?.expires;
  return !end || new Date(end) > new Date();
}

const SEEN_TTL_MS = 24 * 60 * 60 * 1000; // don't grow forever on a 24/7 page

export function createLiveSource(geo) {
  const seen = new Map(); // key → last time it appeared in the feed
  let first = true;
  let timer = null;

  return {
    mode: 'LIVE',
    start(onUpdate, onStatus = () => {}) {
      const poll = async () => {
        try {
          const res = await fetchWithTimeout(ALERTS_URL, { headers: { Accept: 'application/geo+json' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          // Group every in-region feature by VTEC key, then collapse each group
          // to one alert. This folds an original + its update (same segment) and,
          // crucially, the multiple zone segments of one event into a single
          // alert covering the union of their zones — downstream layers/plans key
          // by VTEC and expect one entry per event.
          const groups = new Map();
          for (const f of data.features ?? []) {
            if (!notExpired(f) || eventEnded(f.properties) || !alertInRegion(f, geo)) continue;
            const k = alertKey(f);
            const g = groups.get(k);
            if (g) g.push(f); else groups.set(k, [f]);
          }
          const alerts = [...groups.values()]
            .map(fs => enrichAlert(mergeSameKey(fs), geo))
            .sort((a, b) => b.score - a.score);

          // Suppress "new" on the very first poll — booting into an active day
          // shouldn't fire a tour for every pre-existing warning at once.
          const now = Date.now();
          const added = first ? [] : alerts.filter(a => !seen.has(a.key));
          for (const a of alerts) seen.set(a.key, now);
          for (const [key, at] of seen) if (now - at > SEEN_TTL_MS) seen.delete(key);
          first = false;

          onStatus({ ok: true, at: Date.now() });
          onUpdate({ alerts, added });
        } catch (err) {
          console.error('[alerts] poll failed:', err);
          onStatus({ ok: false, at: Date.now(), error: String(err) });
        } finally {
          timer = setTimeout(poll, POLL_MS);
        }
      };
      poll();
    },
    stop() { clearTimeout(timer); },
  };
}
