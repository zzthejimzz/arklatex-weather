// U.S. Drought Monitor polygons for the region, from the NDMC-hosted ArcGIS
// service (the national GeoJSON at droughtmonitor.unl.edu is ~19 MB; this
// bbox query with generalized geometry returns the same picture for the
// ArkLaTex in ~300 KB, CORS-enabled). New map every Thursday morning — the
// refresh here is just "eventually", not a live feed.
import { fetchWithTimeout } from '../utils/net.js';

const SERVICE =
  'https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/0/query';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

export function createDroughtSource(geo) {
  let features = []; // GeoJSON features, DM ascending (paint worst on top)

  function url() {
    const [w, s, e, n] = geo.bbox;
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      geometry: `${w},${s},${e},${n}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'DM',
      outSR: '4326',
      maxAllowableOffset: '0.02', // generalize: broadcast map, not a survey
    });
    return `${SERVICE}?${params}`;
  }

  async function poll() {
    let delay = REFRESH_MS;
    try {
      const res = await fetchWithTimeout(url(), { timeoutMs: 45_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      features = (data.features ?? [])
        .filter(f => f.geometry && Number.isFinite(f.properties?.DM))
        .sort((a, b) => a.properties.DM - b.properties.DM);
    } catch (err) {
      console.warn('[drought] fetch failed:', err);
      if (!features.length) delay = RETRY_MS; // nothing on hand — retry sooner
    } finally {
      setTimeout(poll, delay);
    }
  }

  function start() {
    poll();
  }

  // Worst category present (0–4), or null when there's no drought data —
  // the director gates the shot on this.
  function worst() {
    return features.length ? features[features.length - 1].properties.DM : null;
  }

  return { start, get: () => features, worst };
}
