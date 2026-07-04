import 'leaflet/dist/leaflet.css';
import './broadcast.css';
import L from 'leaflet';
import { createBroadcastMap, addStateBorders } from './map/basemap.js';
import { createRadarLoop } from './map/radar-loop.js';
import { createOutlookLayer } from './map/outlook-layer.js';
import { createAlertsLayer } from './map/alerts-layer.js';
import { createMcdLayer } from './map/mcd-layer.js';
import { addCityLabels } from './map/cities.js';
import { createBanner } from './ui/banner.js';
import { createPopup } from './ui/warning-popup.js';
import { createTicker } from './ui/ticker.js';
import { createDirector } from './director/director.js';
import { createLiveSource } from './data/alerts.js';
import { createReplaySource } from './data/replay.js';
import { loadPopulationGrid } from './data/population.js';
import { createPrecipScout } from './data/precip-scout.js';
import { boundsToLeaflet } from './utils/geometry.js';

const STAGE_W = 1920;
const STAGE_H = 1080;
// Rough ArkLaTex box, used only until `npm run build-geo` produces the real
// SHV-CWA region file. County/zone-based alerts are skipped in fallback mode.
const FALLBACK_BBOX = [-96.5, 30.5, -91.3, 35.0];

function fitStage() {
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  document.getElementById('stage').style.transform =
    `translate(-50%, -50%) scale(${scale})`;
}

async function loadGeo() {
  try {
    const res = await fetch('/geo/arklatex.json');
    if (res.ok) return await res.json();
  } catch { /* fall through to fallback */ }
  console.warn('[geo] /geo/arklatex.json missing — run `npm run build-geo`. Using fallback bbox.');
  const [w, s, e, n] = FALLBACK_BBOX;
  return {
    zones: {},
    hull: [[w, s], [e, s], [e, n], [w, n], [w, s]],
    bbox: FALLBACK_BBOX,
  };
}

async function boot() {
  fitStage();
  window.addEventListener('resize', fitStage);

  const [geo] = await Promise.all([loadGeo(), loadPopulationGrid()]);

  const map = createBroadcastMap(document.getElementById('map'), geo.bbox);
  addStateBorders(map);
  addCityLabels(map);
  createRadarLoop(map);
  createMcdLayer(map, geo);

  const outlookLayer = createOutlookLayer(map);
  outlookLayer.show('day1');

  const alertsLayer = createAlertsLayer(map);
  const banner = createBanner(document.getElementById('banner'));
  const popup = createPopup(document.getElementById('popup-root'));
  const ticker = createTicker(document.getElementById('ticker'), geo);
  const precipScout = createPrecipScout(geo);

  const regionBounds = L.latLngBounds(boundsToLeaflet(geo.bbox)).pad(0.04);
  const director = createDirector({ map, alertsLayer, outlookLayer, popup, regionBounds, precipScout });

  const replayName = new URLSearchParams(location.search).get('replay');
  const source = replayName ? createReplaySource(geo, replayName) : createLiveSource(geo);

  const chip = document.getElementById('mode-chip');
  chip.classList.toggle('replay', !!replayName);
  const renderChip = (status) => {
    const at = status?.at ? new Date(status.at).toLocaleTimeString() : '—';
    const state = status?.ok === false ? ' · <span style="color:#f59e0b">retrying</span>' : '';
    chip.innerHTML = `
      <span class="live-dot"></span>
      <span class="mode-label">${source.mode}</span>
      <span>data ${at}${state}</span>`;
  };
  renderChip(null);

  source.start(
    update => {
      alertsLayer.update(update.alerts);
      banner.setAlerts(update.alerts);
      ticker.setAlerts(update.alerts);
      director.onAlerts(update);
    },
    status => renderChip(status),
  );

  director.boot();
}

boot();
