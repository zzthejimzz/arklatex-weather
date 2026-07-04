// Fills are drawn solid (high opacity) over the grey basemap, with state lines
// and city labels rendered in panes above them — same layering as SPC/Pivotal maps.
export const CATEGORICAL = {
  TSTM: { fill: '#c1e9c1', fillOpacity: 0.70, color: '#3d9b3d', weight: 1.5, label: 'General Thunder', order: 0 },
  MRGL: { fill: '#66a366', fillOpacity: 0.75, color: '#2d7a2d', weight: 1.5, label: 'Marginal',         order: 1 },
  SLGT: { fill: '#f5f57a', fillOpacity: 0.75, color: '#c8c820', weight: 1.5, label: 'Slight',           order: 2 },
  ENH:  { fill: '#f5a623', fillOpacity: 0.78, color: '#c97d0a', weight: 2,   label: 'Enhanced',         order: 3 },
  MDT:  { fill: '#e83c00', fillOpacity: 0.80, color: '#b32d00', weight: 2,   label: 'Moderate',         order: 4 },
  HIGH: { fill: '#ff00ff', fillOpacity: 0.80, color: '#cc00cc', weight: 2,   label: 'High',             order: 5 },
};

// Official SPC probability colors — sourced from NOAA MapServer renderer (mapservices.weather.noaa.gov)
// Conditional Intensity Group (CIGn) tiers replace the legacy SIGN hatch; LABEL values are "CIG1"/"CIG2"/"CIG3".
const CIG1 = { fill: 'url(#cig1-hatch)', fillOpacity: 1, color: '#000000', weight: 1.5, label: 'Intensity 1', isHatch: true };
const CIG2 = { fill: 'url(#cig2-hatch)', fillOpacity: 1, color: '#000000', weight: 1.5, label: 'Intensity 2', isHatch: true };
const CIG3 = { fill: 'url(#cig3-hatch)', fillOpacity: 1, color: '#000000', weight: 1.5, label: 'Intensity 3', isHatch: true };

export const TORNADO = {
  '2':  { fill: '#79BA7A', fillOpacity: 0.70, color: '#1A731D', weight: 1.5, label: '2%' },
  '5':  { fill: '#BD998A', fillOpacity: 0.70, color: '#7F3F27', weight: 1.5, label: '5%' },
  '10': { fill: '#FFE481', fillOpacity: 0.72, color: '#FD8A2B', weight: 1.5, label: '10%' },
  '15': { fill: '#FF8080', fillOpacity: 0.75, color: '#FF0000', weight: 2,   label: '15%' },
  '30': { fill: '#FF80FF', fillOpacity: 0.75, color: '#FF00FF', weight: 2,   label: '30%' },
  '45': { fill: '#C896F7', fillOpacity: 0.78, color: '#912CEE', weight: 2,   label: '45%' },
  '60': { fill: '#104E8B', fillOpacity: 0.80, color: '#083358', weight: 2,   label: '60%' },
  CIG1, CIG2, CIG3,
};

// Shared 5–60% color ramp used by both hail and wind (NOAA MapServer values)
const HAIL_WIND_RAMP = {
  '5':  { fill: '#C5A392', fillOpacity: 0.70, color: '#8B4726', weight: 1.5, label: '5%' },
  '15': { fill: '#FFEB7F', fillOpacity: 0.72, color: '#FF9600', weight: 1.5, label: '15%' },
  '30': { fill: '#FF7F7F', fillOpacity: 0.75, color: '#FF0000', weight: 2,   label: '30%' },
  '45': { fill: '#FF7FFF', fillOpacity: 0.75, color: '#FF00FF', weight: 2,   label: '45%' },
  '60': { fill: '#C895F6', fillOpacity: 0.78, color: '#912CEE', weight: 2,   label: '60%' },
};

export const WIND = {
  ...HAIL_WIND_RAMP,
  '75': { fill: '#5C85D6', fillOpacity: 0.80, color: '#2952A3', weight: 2, label: '75%' },
  '90': { fill: '#1AFFFF', fillOpacity: 0.80, color: '#00CCCC', weight: 2, label: '90%' },
  CIG1, CIG2, CIG3,
};

export const HAIL = {
  ...HAIL_WIND_RAMP,
  CIG1, CIG2,
};

export const HAZARD_MAPS = { cat: CATEGORICAL, torn: TORNADO, wind: WIND, hail: HAIL };

export const HAZARD_META = {
  cat:  { label: 'Categorical',  unit: 'risk level' },
  torn: { label: 'Tornado',      unit: 'probability' },
  wind: { label: 'Wind',         unit: 'probability' },
  hail: { label: 'Hail',         unit: 'probability' },
};

// SPC GeoJSON encodes probability as decimals (e.g. LABEL=0.05 for 5%).
// Convert to the integer string keys used in HAZARD_MAPS ("5", "15", …);
// non-numeric labels (TSTM, MRGL, CIG1…) pass through uppercased.
export function normalizeLabel(feature) {
  let raw = String(feature.properties?.LABEL ?? feature.properties?.label ?? '').trim().toUpperCase().replace('%', '');
  const num = parseFloat(raw);
  if (!isNaN(num)) raw = num < 1 ? String(Math.round(num * 100)) : String(Math.round(num));
  return raw;
}

export function styleForFeature(hazard, feature) {
  const colorMap = HAZARD_MAPS[hazard];
  if (!colorMap) return { fillColor: '#fff', fillOpacity: 0.2, color: '#888', weight: 1 };

  const entry = colorMap[normalizeLabel(feature)];
  if (!entry) return { fillColor: '#ffffff', fillOpacity: 0.1, color: '#555', weight: 1 };

  return {
    fillColor:   entry.fill,
    fillOpacity: entry.fillOpacity,
    color:       entry.color,
    weight:      entry.weight ?? 1,
    dashArray:   entry.dashArray ?? null,
    opacity:     1,
  };
}
