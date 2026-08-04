// CPC 6–10 / 8–14 day outlook map mode: the "warmer/cooler, wetter/drier than
// normal next week" fills, shown only while the director runs a "cpc" idle stop.
// Lives in overlayPane (below the radar pane) like the other risk fills, and
// the ambient convective outlook is hidden while this is up.
//
// CPC's real product is a fine probability ramp (a dozen bins per direction).
// Here it's restyled to a single directional color per category with fill
// opacity scaled by the probability — the same restyle-for-the-dark-basemap
// choice the fire/ERO layers make (their native fills are too pale). That keeps
// the legend a clean three-stop scale instead of a dozen near-black swatches.
import L from 'leaflet';

// metric → directional palette. Above/Below are the two poles; Normal is the
// Equal-Chances wash. `dir` is the on-air adjective, `chip` a readable-on-dark
// variant for chip text and legend swatches. Poles sit on the Section-8 accent
// families: warmer→red, cooler→blue, wetter→green, drier→amber/tan.
const PALETTE = {
  temp: {
    Above:  { dir: 'Warmer', color: '#ff6b4a', chip: '#ff8f6b' },
    Below:  { dir: 'Cooler', color: '#4aa8ff', chip: '#7cc4ff' },
    Normal: { dir: 'Near normal', color: '#8a94a6', chip: '#aab4c6' },
  },
  precip: {
    Above:  { dir: 'Wetter', color: '#37c871', chip: '#5fd38a' },
    Below:  { dir: 'Drier',  color: '#d9a066', chip: '#e6b784' },
    Normal: { dir: 'Near normal', color: '#8a94a6', chip: '#aab4c6' },
  },
};

// Fill opacity tracks the probability: an Equal-Chances wash sits faint, a 90%
// signal reads strong. Non-normal bands span 33→90% onto 0.30→0.75.
function fillOpacity(cat, prob) {
  if (cat === 'Normal') return 0.16;
  const t = Math.max(0, Math.min(1, (prob - 33) / 57));
  return 0.30 + t * 0.45;
}

export function metricOf(product) {
  return product.endsWith('temp') ? 'temp' : 'precip';
}

// Directional descriptor for a (metric, cat) pair — used by the chip headline.
export function cpcDir(metric, cat) {
  return PALETTE[metric][cat] ?? PALETTE[metric].Normal;
}

export function createCpcLayer(map) {
  let layer = null;

  // Draws every returned feature (the wide shot benefits from the full
  // multi-state picture); the director gates the shot on a local lean.
  function show(product, features) {
    hide();
    const pal = PALETTE[metricOf(product)];
    const drawable = (features ?? []).filter(f => f.geometry && pal[f.properties?.cat]);
    if (!drawable.length) return null;
    // Equal-Chances first, then ascending probability. The bands partition
    // space so overlap is nil, but a stable order keeps repeats byte-identical
    // for the capture rig.
    const rank = f => (f.properties.cat === 'Normal' ? -1 : f.properties.prob);
    const sorted = [...drawable].sort((a, b) => rank(a) - rank(b));
    layer = L.geoJSON({ type: 'FeatureCollection', features: sorted }, {
      pane: 'overlayPane',
      interactive: false,
      style: f => {
        const m = pal[f.properties.cat];
        return {
          color: m.color,
          weight: 1.2,
          opacity: 0.85,
          fillColor: m.color,
          fillOpacity: fillOpacity(f.properties.cat, f.properties.prob),
        };
      },
    }).addTo(map);

    // Fixed three-stop legend for the metric (the two poles + near-normal) — a
    // "what the colors mean" scale, not one swatch per probability band.
    const legend = [
      { color: pal.Below.chip, label: pal.Below.dir },
      { color: pal.Normal.chip, label: pal.Normal.dir },
      { color: pal.Above.chip, label: pal.Above.dir },
    ];
    return { legend };
  }

  function hide() {
    if (layer) map.removeLayer(layer);
    layer = null;
  }

  return { show, hide };
}
