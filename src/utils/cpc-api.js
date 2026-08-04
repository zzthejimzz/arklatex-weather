// CPC 6–10 & 8–14 day temperature/precipitation outlooks — the rung between
// the 3-day SPC/convective board and the seasonal picture. Served from NOAA's
// public ArcGIS vector service, which (unlike SPC/WPC) sends CORS headers, so a
// direct browser fetch works — no proxy.php hop, no host to whitelist.
//
// The geometry is simplified server-side (maxAllowableOffset, in degrees at
// outSR 4326) and clipped to a wide envelope around the region: this is a
// broadcast-zoom multi-state pattern, not a pixel-exact national map, and it
// keeps the payload to a few hundred KB.
import { fetchWithTimeout } from './net.js';

const BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks';

// product key → { service, layer }. Layer 0 is temperature, 1 is precipitation
// in both the 6–10 and 8–14 day services.
const PRODUCTS = {
  '610temp': { service: 'cpc_6_10_day_outlk', layer: 0 },
  '610prcp': { service: 'cpc_6_10_day_outlk', layer: 1 },
  '814temp': { service: 'cpc_8_14_day_outlk', layer: 0 },
  '814prcp': { service: 'cpc_8_14_day_outlk', layer: 1 },
};

export const CPC_PRODUCTS = Object.keys(PRODUCTS);

const TTL_MS = 30 * 60 * 1000; // CPC reissues once daily (~3pm ET); cache generously
const cache = new Map(); // product → { at, data }

// [w, s, e, n] envelope (degrees) → the ArcGIS spatial-filter query params.
function envelopeParams(env) {
  if (!env) return '';
  const [w, s, e, n] = env;
  const geom = encodeURIComponent(JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }));
  return `&geometry=${geom}&geometryType=esriGeometryEnvelope`
    + '&inSR=4326&spatialRel=esriSpatialRelIntersects';
}

export async function fetchCpcOutlook(product, env) {
  const p = PRODUCTS[product];
  if (!p) throw new Error(`Unknown CPC product: ${product}`);

  const hit = cache.get(product);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const url = `${BASE}/${p.service}/MapServer/${p.layer}/query`
    + '?where=1%3D1&outFields=cat,prob,start_date,end_date&outSR=4326'
    + `&maxAllowableOffset=0.04&geometryPrecision=3&f=geojson${envelopeParams(env)}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`CPC ${product}: HTTP ${res.status}`);

  const data = await res.json();
  // ArcGIS answers a bad query with 200 + an { error } body — treat it as a
  // failure so the source keeps its last good data instead of caching junk.
  if (!data || data.error) throw new Error(`CPC ${product}: service error`);
  cache.set(product, { at: Date.now(), data });
  return data;
}
