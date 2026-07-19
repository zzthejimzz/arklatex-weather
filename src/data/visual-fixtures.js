// Deterministic data for the 1920×1080 screenshot-regression suite. Enabled
// only by ?visual-test; production and ordinary dev query states still use
// their live sources.
import { icon } from '../ui/icons.js';
import { enrichAlert } from './alerts.js';

export const VISUAL_NOW_ISO = '2026-07-19T18:00:00.000Z';

const days = [
  { dow: 'SUN', icon: icon('sun'), short: 'Sunny and hot', hi: 96, lo: 76, precip: 5, wind: 9 },
  { dow: 'MON', icon: icon('partly-cloudy'), short: 'Partly cloudy', hi: 94, lo: 75, precip: 20, wind: 12 },
  { dow: 'TUE', icon: icon('storm'), short: 'Scattered thunderstorms', hi: 89, lo: 72, precip: 50, wind: 18 },
];

const forecastCities = [
  ['Shreveport', 'LA', 0],
  ['Texarkana', 'TX/AR', -2],
  ['Tyler', 'TX', 1],
  ['Longview', 'TX', 0],
  ['Monroe', 'LA', 2],
  ['Lufkin', 'TX', -1],
].map(([name, state, delta]) => ({
  name,
  state,
  days: days.map(d => ({ ...d, hi: d.hi + delta, lo: d.lo + delta })),
}));

const pollenCities = [
  ['Shreveport', 'LA', 32.525, -93.750, 8.7],
  ['Tyler', 'TX', 32.351, -95.301, 7.4],
  ['Texarkana', 'TX/AR', 33.425, -94.048, 6.8],
  ['Longview', 'TX', 32.500, -94.740, 8.1],
  ['Monroe', 'LA', 32.510, -92.119, 5.9],
  ['Lufkin', 'TX', 31.338, -94.729, 7.7],
].map(([name, state, lat, lon, index]) => ({
  name, state, lat, lon, index,
  label: index > 7.2 ? 'Medium-High' : 'Medium',
  color: index > 7.2 ? '#fb923c' : '#facc15',
  advice: 'Enough pollen to bother many allergy sufferers — limit time outside on breezy afternoons.',
  date: 'July 19, 2026',
  triggers: [
    { name: 'Grass', icon: icon('grass') },
    { name: 'Oak', icon: icon('tree') },
  ],
  days: [
    { dow: 'Sun', index: 8.7, color: '#fb923c' },
    { dow: 'Mon', index: 7.9, color: '#fb923c' },
    { dow: 'Tue', index: 6.4, color: '#facc15' },
    { dow: 'Wed', index: 5.8, color: '#facc15' },
    { dow: 'Thu', index: 7.2, color: '#facc15' },
  ],
}));

export const VISUAL_FIXTURES = {
  forecast: { at: Date.parse(VISUAL_NOW_ISO), cities: forecastCities },
  almanac: {
    name: 'Shreveport', state: 'LA', obsId: 'KSHV', since: 1874,
    normalHi: 94, normalLo: 75, recordHi: 108, recordHiYear: 1901,
    recordLo: 62, recordLoYear: 1967,
  },
  uv: {
    name: 'Shreveport', state: 'LA', date: 'July 19, 2026', index: 10,
    label: 'Very High', color: '#f87171', alert: true,
    advice: 'Extra protection needed. Seek shade and limit midday sun exposure.',
  },
  aqi: {
    name: 'Shreveport', state: 'LA', aqi: 87, label: 'Moderate', color: '#facc15',
    pm25: 23.4, pm10: 41.2, ozone: 88.6,
    advice: 'Air quality is acceptable; unusually sensitive people may notice mild symptoms.',
  },
  pollen: pollenCities,
  aurora: {
    updatedAt: VISUAL_NOW_ISO,
    current: { kp: 4.3 },
    currentG: { label: 'Active', color: '#facc15' },
    peak: { kp: 8.0, label: 'G4 Severe', color: '#f87171', time: new Date('2026-07-21T03:00:00.000Z') },
    worstScale: 4,
    days: [
      { day: 'Sun', label: 'G1 Minor', color: '#a3e635', visible: 'Aurora favored across northern states' },
      { day: 'Mon', label: 'G4 Severe', color: '#f87171', visible: 'Possible as far south as the ArkLaTex' },
      { day: 'Tue', label: 'G2 Moderate', color: '#facc15', visible: 'Best viewed well north of the region' },
    ],
  },
};

export function createVisualForecasts() {
  return { start() {}, get: () => VISUAL_FIXTURES.forecast };
}

export function createVisualAlertSource() {
  return {
    mode: 'LIVE',
    start(onUpdate, onStatus) {
      onUpdate({ alerts: [], added: [] });
      onStatus({ ok: true, at: Date.now() });
    },
  };
}

export function createVisualWarningSource(geo) {
  const sent = VISUAL_NOW_ISO;
  const expires = new Date(Date.parse(VISUAL_NOW_ISO) + 120 * 60_000).toISOString();
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-94.10, 32.45], [-93.55, 32.55], [-93.65, 32.90],
        [-94.20, 32.80], [-94.10, 32.45],
      ]],
    },
    properties: {
      id: 'visual-tor-shreveport', sent, effective: sent, onset: sent, expires,
      event: 'Tornado Warning',
      headline: 'Tornado Warning for Caddo and Bossier Parishes LA',
      description: 'A radar-indicated tornado is moving east toward the Shreveport metro.',
      severity: 'Extreme', certainty: 'Likely', urgency: 'Immediate',
      areaDesc: 'Caddo, LA; Bossier, LA',
      geocode: { UGC: ['LAC017', 'LAC015'] },
      parameters: {
        tornadoDetection: ['RADAR INDICATED'],
        tornadoDamageThreat: ['CONSIDERABLE'],
        maxHailSize: ['1.00'],
        maxWindGust: ['70 MPH'],
        eventMotionDescription: ['2026-07-19T18:00:00-00:00...storm...270DEG...40KT...32.55,-93.95'],
      },
    },
  };
  const alert = enrichAlert(feature, geo);
  alert.key = 'visual-warning';
  return {
    mode: 'REPLAY',
    start(onUpdate, onStatus) {
      onUpdate({ alerts: [alert], added: [alert] });
      onStatus({ ok: true, at: Date.now() });
    },
  };
}
