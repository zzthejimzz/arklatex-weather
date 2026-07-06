import 'leaflet/dist/leaflet.css';
import './broadcast.css';
import L from 'leaflet';
import { createBroadcastMap, addStateBorders } from './map/basemap.js';
import { createRadarLoop } from './map/radar-loop.js';
import { createVelocityLayer } from './map/velocity-layer.js';
import { createOutlookLayer } from './map/outlook-layer.js';
import { createAlertsLayer } from './map/alerts-layer.js';
import { createReportsLayer } from './map/reports-layer.js';
import { createMcdLayer } from './map/mcd-layer.js';
import { createTempsLayer } from './map/temps-layer.js';
import { createRainfallLayer } from './map/rainfall-layer.js';
import { createDroughtLayer } from './map/drought-layer.js';
import { createDroughtSource } from './data/drought.js';
import { addCityLabels } from './map/cities.js';
import { createBanner } from './ui/banner.js';
import { createPopup } from './ui/warning-popup.js';
import { createTicker } from './ui/ticker.js';
import { createForecastPanel } from './ui/forecast-panel.js';
import { createCityForecasts } from './data/forecast.js';
import { createObservationsSource } from './data/observations.js';
import { createDirector } from './director/director.js';
import { createLiveSource } from './data/alerts.js';
import { createReportsSource, pickTourReports } from './data/reports.js';
import { createMcdSource, createMcdReplaySource, pickTourMcds } from './data/mcd.js';
import { createReplaySource } from './data/replay.js';
import { loadPopulationGrid } from './data/population.js';
import { createPrecipScout } from './data/precip-scout.js';
import { boundsToLeaflet } from './utils/geometry.js';
import { track, startWatchdog } from './utils/health.js';
import { createStatusChip } from './ui/status-chip.js';
import { startSoakMonitor } from './utils/soak.js';
import { radarCacheSize } from './map/radar-loop.js';

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
  const radar = createRadarLoop(map);
  const velocityLayer = createVelocityLayer(map);
  const mcdLayer = createMcdLayer(map);

  const outlookLayer = createOutlookLayer(map);
  outlookLayer.show('day1');

  const alertsLayer = createAlertsLayer(map);
  const banner = createBanner(document.getElementById('banner'));
  const popup = createPopup(document.getElementById('popup-root'));
  const precipScout = createPrecipScout(geo);

  // Shared surface observations: the ticker's temp strip and the director's
  // current-temps map mode read the same feed.
  const obsSource = createObservationsSource();
  obsSource.start();
  const ticker = createTicker(document.getElementById('ticker'), geo, obsSource);
  const tempsLayer = createTempsLayer(map);

  // Quiet-day map modes: MRMS rainfall totals (self-scanning) and the weekly
  // U.S. Drought Monitor picture.
  const rainfallLayer = createRainfallLayer(map, geo);
  const droughtSource = createDroughtSource(geo);
  droughtSource.start();
  const droughtLayer = createDroughtLayer(map);

  const forecasts = createCityForecasts();
  forecasts.start();
  const forecastPanel = createForecastPanel({
    root: document.getElementById('forecast-root'), map, forecasts,
  });

  const params = new URLSearchParams(location.search);
  const replayName = params.get('replay');
  const source = replayName
    ? createReplaySource(geo, replayName, { loop: params.has('loop') })
    : createLiveSource(geo);

  // Local Storm Reports (ground truth pins + director tour stops). Live only —
  // current real-world reports would be incongruent over a replayed outbreak.
  const reportsLayer = createReportsLayer(map);
  let latestReports = [];
  if (!replayName) {
    createReportsSource(geo).start(({ reports, added }) => {
      reportsLayer.update(reports, added);
      latestReports = reports;
    });
  }
  // get() = curated idle-tour picks (computed on demand — the recency window
  // keeps sliding); all() = everything on the map, for in-warning matching.
  const reportsFeed = {
    get: () => pickTourReports(latestReports),
    all: () => latestReports,
  };

  // Mesoscale Discussions — outline on the map + director idle-tour stops. Runs
  // in both modes: live from IEM, or from the replay file's `mcds` array (so
  // the tour can be exercised when there's no live MCD over the region).
  let latestMcds = [];
  const mcdSource = replayName ? createMcdReplaySource(geo, replayName) : createMcdSource(geo);
  mcdSource.start(({ mcds }) => {
    mcdLayer.update(mcds);
    latestMcds = mcds;
  });
  const mcdFeed = {
    get: () => pickTourMcds(latestMcds),
    all: () => latestMcds,
  };

  const regionBounds = L.latLngBounds(boundsToLeaflet(geo.bbox)).pad(0.04);
  const director = createDirector({
    map, alertsLayer, outlookLayer, popup, forecastPanel, regionBounds, precipScout,
    radar, reportsLayer, reportsFeed, mcdLayer, mcdFeed, tempsLayer, obsFeed: obsSource,
    velocityLayer, rainfallLayer, droughtLayer, droughtFeed: droughtSource,
  });

  // The chip renders itself from the health registry on its own clock — a
  // dead poll loop can't freeze it at a reassuring old timestamp.
  createStatusChip(document.getElementById('mode-chip'), source.mode);

  // Alert freshness feeds the chip and (critical) the watchdog reload. Wired
  // through onStatus so live and replay sources are covered identically.
  const alertsBeat = track('alerts', { pollMs: 30_000, critical: true });

  source.start(
    update => {
      alertsLayer.update(update.alerts);
      banner.setAlerts(update.alerts);
      ticker.setAlerts(update.alerts);
      director.onAlerts(update);
    },
    status => (status.ok ? alertsBeat.ok() : alertsBeat.attempt()),
  );

  startWatchdog();
  if (params.has('soak')) {
    startSoakMonitor({ map, extras: { imgCache: radarCacheSize } });
  }

  // Dev-only: ?cam=lat,lon,zoom parks the camera and skips the director —
  // for checking framing / label collision at arbitrary zooms. ?panel forces
  // the forecast panel open as soon as its data arrives.
  const cam = params.get('cam');
  if (cam) {
    const [lat, lon, z] = cam.split(',').map(Number);
    map.setView([lat, lon], z);
  } else if (params.has('lsr')) {
    // Dev-only: park on the newest storm report with its card + highlighted
    // pin — checks the report visuals without waiting out the director.
    const t = setInterval(() => {
      const r = latestReports[0];
      if (!r) return;
      clearInterval(t);
      map.setView([r.lat, r.lon], 10.5);
      reportsLayer.highlight(r.id);
      popup.showReport(r);
    }, 500);
  } else if (params.has('mcd')) {
    // Dev-only: park on the newest MCD with its outline highlighted + card —
    // checks the MCD visuals without waiting out the director.
    const t = setInterval(() => {
      const m = latestMcds[0];
      if (!m || !m.bounds) return;
      clearInterval(t);
      map.fitBounds(boundsToLeaflet(m.bounds), { padding: [80, 80], maxZoom: 8.2 });
      mcdLayer.highlight(m.key);
      popup.showMcd(m);
    }, 500);
  } else if (params.has('vel')) {
    // Dev-only: park near the warning-sized default view with the velocity
    // overlay up — checks velocity tiles + dimmed reflectivity without a live
    // warning. ?vel=lat,lon picks the nearest radar to that point.
    const [vlat, vlon] = (params.get('vel') || '32.45,-93.84').split(',').map(Number);
    map.setView([vlat, vlon], 9.5);
    velocityLayer.show(vlat, vlon);
    radar.setDim(true);
  } else if (params.has('temps')) {
    // Dev-only: park wide with the current-temps chips as soon as obs arrive.
    map.fitBounds(regionBounds);
    const t = setInterval(() => {
      const obs = obsSource.get();
      if (obs.length < 5) return;
      clearInterval(t);
      tempsLayer.show(obs);
    }, 500);
  } else if (params.has('rain')) {
    // Dev-only: park wide with rainfall totals over a hidden radar loop.
    // ?rain picks 24h; ?rain=p48h / ?rain=p72h select the other windows.
    map.fitBounds(regionBounds);
    rainfallLayer.show(params.get('rain') || 'p24h', () => radar.setHidden(true));
  } else if (params.has('drought')) {
    // Dev-only: park wide with the drought monitor fills once they arrive.
    map.fitBounds(regionBounds);
    outlookLayer.hide();
    const t = setInterval(() => {
      const features = droughtSource.get();
      if (!features.length) return;
      clearInterval(t);
      droughtLayer.show(features);
    }, 500);
  } else {
    director.boot();
  }
  if (params.has('panel')) {
    // ?panel forces the 3-day board; ?panel=city forces the 7-day spotlight.
    const city = params.get('panel') === 'city';
    const t = setInterval(() => {
      if (city ? forecastPanel.showCity(0) : forecastPanel.show()) clearInterval(t);
    }, 500);
  }
}

boot();
