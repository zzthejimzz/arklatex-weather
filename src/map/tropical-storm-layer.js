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
      const t = tierFor(f.properties);
      const tau = f.properties?.tau ?? 0;
      const isNow = i === 0;
      // Every fix gets a dot (so the track's shape reads), but only the
      // current fix and roughly-daily fixes get a text label — labeling all
      // nine 12-hourly points overlaps badly on a Gulf-wide shot.
      const showLabel = isNow || tau % 24 === 0;
      const label = isNow ? f.properties.stormtype : (f.properties.datelbl ?? '');
      parts.push(L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
        interactive: false,
        icon: L.divIcon({
          className: `storm-pt${isNow ? ' now' : ''}`,
          html: `<span class="dot" style="background:${t.color}"></span>${showLabel ? `<span class="lbl">${label}</span>` : ''}`,
          iconSize: [20, 20],
        }),
      }));
    });

    layer = L.layerGroup(parts).addTo(map);

    const bbox = unionBounds([
      storm.cone?.geometry, storm.track?.geometry,
      ...storm.points.map(p => p.geometry),
    ]);

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
      bbox,
    };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
