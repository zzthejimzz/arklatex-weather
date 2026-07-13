// NHC Tropical Weather Outlook: 7-day potential-development areas plus the
// ✕ current-location points, from the NWS tropical MapServer (CORS-enabled,
// so no proxy — unlike SPC). The director gates the shot on an Atlantic-basin
// area existing at all, not on local overlap: a Gulf disturbance five days
// out is exactly the story the ArkLaTex needs early, and a quiet basin means
// no shot. New outlook 4x daily (2/8 am/pm Eastern), plus specials.
import { fetchWithTimeout } from '../utils/net.js';

const SERVICE =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
const AREAS_LAYER = 3;  // Seven-Day: Potential Development Region (polygons)
const POINTS_LAYER = 2; // Seven-Day: Current Location (points)
const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

function url(layer) {
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields: 'basin,prob2day,prob7day,risk7day',
    outSR: '4326',
    maxAllowableOffset: '0.05', // generalize: basin-scale broadcast shot
  });
  return `${SERVICE}/${layer}/query?${params}`;
}

// The service carries every basin under one roof, tagged "Atlantic" /
// "Pacific" — only the Atlantic can put remnants over the region.
const isAtlantic = f => /^atl/i.test(f.properties?.basin ?? '');

export function createTropicalSource() {
  let data = null; // { areas, points } after the first successful poll

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const [areas, points] = await Promise.all([AREAS_LAYER, POINTS_LAYER].map(async l => {
        const res = await fetchWithTimeout(url(l), { timeoutMs: 45_000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return ((await res.json()).features ?? []).filter(f => f.geometry && isAtlantic(f));
      }));
      // Ascending by formation chance so likelier areas paint on top.
      data = {
        areas: areas.sort((a, b) =>
          (parseInt(a.properties.prob7day) || 0) - (parseInt(b.properties.prob7day) || 0)),
        points,
      };
    } catch (err) {
      console.warn('[tropical] fetch failed:', err);
      // An empty basin is a successful answer; only a never-succeeded poll
      // (nothing on hand) retries sooner.
      if (!data) delay = RETRY_MS;
    } finally {
      setTimeout(poll, delay);
    }
  }

  function start() {
    poll();
  }

  return {
    start,
    // Anything brewing in the Atlantic — the director's gate.
    active: () => (data?.areas.length ?? 0) > 0,
    get: () => data ?? { areas: [], points: [] },
  };
}
