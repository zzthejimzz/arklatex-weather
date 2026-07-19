// Visual identity per NWS event type — colors follow conventional US warning-map
// palettes (tornado red, severe yellow, flash flood green, winter pinks/purples).
// `watch: true` renders dashed with a faint fill; warnings get solid outlines.
// Icons are ui/icons.js SVG marks — they inherit the parent's `color`, so the
// severity color set alongside them tints the glyph wherever it renders.
import { icon } from '../ui/icons.js';

const STYLES = [
  [/tornado warning/i,                 { color: '#ff2b2b', icon: icon('tornado'),      abbr: 'TOR',       tone: 'red' }],
  [/severe thunderstorm warning/i,     { color: '#ffd23f', icon: icon('storm'),        abbr: 'SVR',       tone: 'amber' }],
  [/flash flood warning/i,             { color: '#2ecc55', icon: icon('flash-flood'),  abbr: 'FFW',       tone: 'green' }],
  [/extreme wind warning/i,            { color: '#ff5ce1', icon: icon('extreme-wind'), abbr: 'EWW',       tone: 'red' }],
  // Watches follow NWS convention: tornado watch yellow, severe t-storm watch
  // orange (our call — NWS pale pink reads as nothing on a grey broadcast map).
  // TOR watch is a deeper golden yellow than the SVR *warning* polygon
  // (#ffd23f) so the two never read as the same alert when they share the
  // screen during outbreaks; dashed-vs-solid carries the rest.
  [/tornado watch/i,                   { color: '#e8b400', icon: icon('tornado'),      abbr: 'TOR WATCH', tone: 'amber', watch: true }],
  [/severe thunderstorm watch/i,       { color: '#ff8c1a', icon: icon('storm'),        abbr: 'SVR WATCH', tone: 'amber', watch: true }],
  [/flash flood watch|flood watch/i,   { color: '#4dbd91', icon: icon('flood'),        abbr: 'FFA',       tone: 'green', watch: true }],
  [/flood (warning|statement)/i,       { color: '#00a878', icon: icon('flood'),        abbr: 'FLOOD',     tone: 'green' }],
  [/flood advisory/i,                  { color: '#57d9a3', icon: icon('flood'),        abbr: 'FLD ADV',   tone: 'green' }],
  [/blizzard/i,                        { color: '#ff4500', icon: icon('ice'),          abbr: 'BLIZZ',     tone: 'red' }],
  [/ice storm/i,                       { color: '#c86bfa', icon: icon('ice-storm'),    abbr: 'ICE',       tone: 'blue' }],
  [/winter storm warning/i,            { color: '#ff69b4', icon: icon('ice'),          abbr: 'WSW',       tone: 'blue' }],
  [/winter storm watch/i,              { color: '#c9a0dc', icon: icon('ice'),          abbr: 'WSW WATCH', tone: 'blue',  watch: true }],
  [/winter weather/i,                  { color: '#b57edc', icon: icon('ice'),          abbr: 'WINTER',    tone: 'blue' }],
  [/freeze|frost|cold/i,               { color: '#5b8dd6', icon: icon('freeze'),       abbr: 'COLD',      tone: 'blue' }],
  [/high wind|wind advisory/i,         { color: '#d8b25c', icon: icon('wind'),         abbr: 'WIND',      tone: 'amber' }],
  [/heat/i,                            { color: '#e0555f', icon: icon('hot'),          abbr: 'HEAT',      tone: 'red' }],
  [/dense fog/i,                       { color: '#8fa3bf', icon: icon('fog'),          abbr: 'FOG',       tone: 'blue' }],
  [/red flag|fire/i,                   { color: '#ff6347', icon: icon('fire'),         abbr: 'FIRE',      tone: 'red' }],
  [/special weather/i,                 { color: '#9bb0d3', icon: icon('warning'),      abbr: 'SPS',       tone: 'blue' }],
];

function initials(event) {
  return event.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
}

// Dark text on light alert colors (yellow SVR, light greens), white otherwise.
export function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111827' : '#ffffff';
}

export function styleForEvent(event = '') {
  for (const [re, style] of STYLES) {
    if (re.test(event)) return style;
  }
  return { color: '#22d3ee', icon: icon('warning'), abbr: initials(event || 'ALERT'), tone: 'blue' };
}
