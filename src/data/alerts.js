// Live NWS alert source: polls the active-alerts feed for the four ArkLaTex
// states, filters to the region, and enriches each alert for the map/director.
import { geometriesIntersect, geometryBounds } from '../utils/geometry.js';
import { scoreAlert } from '../director/scoring.js';
import { styleForEvent } from '../utils/alert-style.js';
import { populationIn } from './population.js';

const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&area=AR,LA,TX,OK';
const POLL_MS = 30_000;

// VTEC gives a stable identity across CON/EXT updates of the same warning
// (each update gets a fresh CAP id, but office+phenomenon+significance+ETN
// stays put) — this stops the director from re-touring every update.
export function parseVtec(props) {
  const raw = props?.parameters?.VTEC?.[0];
  if (!raw) return null;
  const m = raw.match(/\/?[A-Z]\.([A-Z]{3})\.(K[A-Z]{3})\.([A-Z]{2})\.([A-Z])\.(\d{4})/);
  if (!m) return null;
  return { action: m[1], office: m[2], phen: m[3], sig: m[4], etn: m[5] };
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

export function enrichAlert(feature, geo) {
  const props = feature.properties;
  const vtec = parseVtec(props);
  const key = vtec ? `${vtec.office}.${vtec.phen}.${vtec.sig}.${vtec.etn}` : (props.id ?? feature.id);

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
    states,
  };
}

function notExpired(feature) {
  const end = feature.properties?.expires ?? feature.properties?.ends;
  return !end || new Date(end) > new Date();
}

export function createLiveSource(geo) {
  const seen = new Set();
  let first = true;
  let timer = null;

  return {
    mode: 'LIVE',
    start(onUpdate, onStatus = () => {}) {
      const poll = async () => {
        try {
          const res = await fetch(ALERTS_URL, { headers: { Accept: 'application/geo+json' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const alerts = (data.features ?? [])
            .filter(f => notExpired(f) && alertInRegion(f, geo))
            .map(f => enrichAlert(f, geo))
            .sort((a, b) => b.score - a.score);

          // Suppress "new" on the very first poll — booting into an active day
          // shouldn't fire a tour for every pre-existing warning at once.
          const added = first ? [] : alerts.filter(a => !seen.has(a.key));
          for (const a of alerts) seen.add(a.key);
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
