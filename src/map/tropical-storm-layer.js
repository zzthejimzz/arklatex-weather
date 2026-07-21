// NHC active-storm tracking map mode: forecast track, cone of uncertainty,
// and forecast points for one NHC-numbered system at a time — the follow-up
// to the 7-day outlook's formation-chance shot once a disturbance actually
// gets a track. Cone/points use the storm's current classification color;
// the track is a black-cased white line, same casing convention as warning
// outlines in alerts-layer.js, so it reads over any basemap or radar core.
import L from 'leaflet';
import { geometryBounds } from '../utils/geometry.js';
import { compass8 } from '../utils/storm-motion.js';

const KT_TO_MPH = 1.15078;
const MIN_MOTION_KT = 3; // slower reads as drifting/stationary, not a heading

const knotsToMph = kt => Math.round((parseInt(kt) || 0) * KT_TO_MPH);

// NHC's classification tiers, escalating like the rest of the broadcast's
// risk ramps but starting a step cooler (blue) — a depression is real news,
// not yet warning-grade. `chip` is the readable-on-dark variant for chip text.
export const STORM_META = {
  TD: { label: 'Tropical Depression', color: '#4d9fff', chip: '#8fc1ff' },
  TS: { label: 'Tropical Storm',      color: '#ffe066', chip: '#fff2a8' },
  HU: { label: 'Hurricane',           color: '#ff9e00', chip: '#ffb84d' },
  MH: { label: 'Major Hurricane',     color: '#ff0000', chip: '#ff4d4d' },
};

// NHC's coastal watch/warning classes, keyed by the `tcww` field, in NHC's
// own official colors. `rank` escalates watch→warning and TS→hurricane so the
// more serious segment paints on top where two ever meet; `chip` is the
// readable-on-dark variant (the TS-warning blue especially needs lifting).
export const WW_META = {
  TWA: { label: 'Tropical Storm Watch',   color: '#ffff00', chip: '#ffff54', rank: 0 },
  TWR: { label: 'Tropical Storm Warning', color: '#004da8', chip: '#5b9bff', rank: 1 },
  HWA: { label: 'Hurricane Watch',        color: '#ff7f7f', chip: '#ff9e9e', rank: 2 },
  HWR: { label: 'Hurricane Warning',      color: '#ff0000', chip: '#ff4d4d', rank: 3 },
};

// ssnum is NHC's own Saffir-Simpson category (0 below hurricane strength) —
// more reliable than re-deriving "major" from wind speed ourselves.
function tierFor(props) {
  const type = props?.stormtype ?? '';
  const cat = parseInt(props?.ssnum) || 0;
  if (type === 'HU') return cat >= 3 ? STORM_META.MH : STORM_META.HU;
  if (type.includes('S')) return STORM_META.TS; // TS, STS
  return STORM_META.TD; // TD, STD, PTC, LO, DB, ...
}

function unionBounds(geoms) {
  const boxes = geoms.map(geometryBounds).filter(Boolean);
  return boxes.length ? [
    Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
    Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
  ] : null;
}

export function createTropicalStormLayer(map) {
  let layer = null;

  // storm = { points, track, cone } from data/tropical-storm.js — points
  // sorted ascending by forecast hour (tau), index 0 is the current fix.
  function show(storm) {
    hide();
    if (!storm?.points?.length) return null;
    const now = storm.points[0];
    const meta = tierFor(now.properties);

    const parts = [];
    if (storm.cone) {
      parts.push(L.geoJSON(storm.cone, {
        pane: 'overlayPane',
        interactive: false,
        style: {
          color: meta.color, weight: 2, opacity: 0.85, dashArray: '8 6',
          fillColor: meta.color, fillOpacity: 0.15,
        },
      }));
    }
    // Coastal watch/warning segments, drawn above the cone fill but below the
    // track/points. Least-serious first so a warning paints over a watch where
    // they abut; each is black-cased then filled in its official color, the
    // same casing convention as the track so it reads over land or water.
    const warnSegs = (storm.warnings ?? [])
      .filter(f => f.geometry && WW_META[f.properties?.tcww])
      .sort((a, b) => WW_META[a.properties.tcww].rank - WW_META[b.properties.tcww].rank);
    warnSegs.forEach(f => {
      const wm = WW_META[f.properties.tcww];
      parts.push(L.geoJSON(f, {
        pane: 'overlayPane', interactive: false,
        style: { color: '#000000', weight: 8, opacity: 0.7, lineCap: 'round' },
      }));
      parts.push(L.geoJSON(f, {
        pane: 'overlayPane', interactive: false,
        style: { color: wm.color, weight: 4.5, opacity: 0.95, lineCap: 'round' },
      }));
    });
    if (storm.track) {
      parts.push(L.geoJSON(storm.track, {
        pane: 'overlayPane', interactive: false,
        style: { color: '#000000', weight: 5.5, opacity: 0.8 },
      }));
      parts.push(L.geoJSON(storm.track, {
        pane: 'overlayPane', interactive: false,
        style: { color: '#ffffff', weight: 2, opacity: 0.95 },
      }));
    }
    storm.points.forEach((f, i) => {
      // NHC intermittently emits a forecast fix with null geometry; skip its
      // dot rather than dereference null coordinates (an uncaught throw here
      // takes down the whole director tick, blanking the storm every lap).
      if (!f.geometry?.coordinates) return;
      const t = tierFor(f.properties);
      const tau = f.properties?.tau ?? 0;
      const isNow = i === 0;
      // Every fix gets a dot (so the track's shape reads), but only the
      // current fix and roughly-daily fixes get a text label — labeling all
      // nine 12-hourly points overlaps badly on a Gulf-wide shot.
      const showLabel = isNow || tau % 24 === 0;
      const label = isNow ? f.properties.stormtype : (f.properties.datelbl ?? '');
      // The current fix gets a pulsing ring in the tier color so the eye lands
      // on where the storm is right now, not on the forecast trail behind it.
      const ring = isNow ? `<span class="ring" style="border-color:${t.color}"></span>` : '';
      parts.push(L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
        interactive: false,
        icon: L.divIcon({
          className: `storm-pt${isNow ? ' now' : ''}`,
          html: `${ring}<span class="dot" style="background:${t.color}"></span>${showLabel ? `<span class="lbl">${label}</span>` : ''}`,
          iconSize: [20, 20],
        }),
      }));
    });

    layer = L.layerGroup(parts).addTo(map);

    const bbox = unionBounds([
      storm.cone?.geometry, storm.track?.geometry,
      ...storm.points.map(p => p.geometry),
      ...warnSegs.map(f => f.geometry), // keep the whole warned coast in frame
    ]);

    // Which watch/warning classes are up, most serious last for a legend.
    const warnings = [...new Set(warnSegs.map(f => WW_META[f.properties.tcww]))]
      .sort((a, b) => a.rank - b.rank);

    const props = now.properties;
    const moves = (parseInt(props.tcspd) || 0) >= MIN_MOTION_KT;
    return {
      ...meta,
      title: props.stormname || meta.label,
      windMph: knotsToMph(props.maxwind),
      gustMph: knotsToMph(props.gust),
      moveDir: moves ? compass8(props.tcdir) : null,
      moveMph: moves ? knotsToMph(props.tcspd) : null,
      advisNum: props.advisnum,
      advDate: props.advdate,
      warnings,
      bbox,
    };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
