// Custom ArkLaTex broadcast icon set. Weather and hazard marks use a roomier
// 32x32 grid with stronger silhouettes; compact utility marks stay on 24x24.
// All artwork defaults to currentColor so alerts and map pins inherit their
// severity color. Forecast containers selectively tint named SVG parts in
// broadcast.css, giving conditions a richer two-tone treatment.

const W = 'class="icon wx-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"';
const D = 'class="icon domain-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"';
const U = 'class="icon ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"';
const M = 'class="icon moon-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"';

export const ICONS = {
  /* Weather conditions: strong silhouettes with named parts for forecast tinting. */
  rain: `<svg ${W}><path class="wx-cloud" d="M8.2 20.2h15.2a5.1 5.1 0 0 0 .7-10.1A7.7 7.7 0 0 0 9.5 8.2a6.1 6.1 0 0 0-1.3 12Z" fill="currentColor" fill-opacity=".16"/><path class="wx-precip" d="m10 24-1.5 3M16.5 24 15 27m8-3-1.5 3" stroke-width="2.8"/></svg>`,
  storm: `<svg ${W}><path class="wx-cloud" d="M7.7 19.4h15.8a5 5 0 0 0 .6-9.9A7.8 7.8 0 0 0 9.3 7.8a6 6 0 0 0-1.6 11.6Z" fill="currentColor" fill-opacity=".16"/><path class="wx-bolt" d="m17.2 17.5-5.8 7.1h4.2l-1 5 6.2-8h-4.3l.7-4.1Z" fill="currentColor" stroke="none"/></svg>`,
  tornado: `<svg ${W}><path class="wx-funnel" d="M3.8 6.2c6.7 2.4 17.7 2.4 24.4 0M6.5 11.2c5.3 2 13.7 2 19 0M9.3 16.1c3.7 1.7 9.7 1.7 13.4 0M12 21c2.2 1.2 5.8 1.2 8 0M14.5 25.6c1.2.8 3.1.8 4.2 0" stroke-width="2.8"/><path d="m5 24-2.2 1.2M25.5 20l3 1" opacity=".65"/></svg>`,
  wind: `<svg ${W}><path class="wx-wind" d="M3.5 10h16.2c3.1 0 3.5-4.8.4-5.2-1.7-.2-2.8.6-3.4 1.8M3.5 16h21.4c3.6 0 4.1 5.4.5 6-2 .3-3.4-.8-4-2.4M3.5 22h11c3.2 0 3.7 4.8.5 5.3-1.8.2-3-.7-3.6-2" stroke-width="2.6"/></svg>`,
  ice: `<svg ${W}><path class="wx-ice" d="M16 3.5v25M5.2 9.7l21.6 12.6m0-12.6L5.2 22.3M11.5 5.7 16 8.5l4.5-2.8m-9 20.6L16 23.5l4.5 2.8M4.7 15l4.5 1-1.3 4.4M27.3 17l-4.5-1 1.3-4.4"/><circle class="wx-ice" cx="16" cy="16" r="2.3" fill="currentColor" stroke="none"/></svg>`,
  sun: `<svg ${W}><circle class="wx-sun" cx="16" cy="16" r="6.4" fill="currentColor" fill-opacity=".82"/><path class="wx-sun-ray" d="M16 2.8v3.5M16 25.7v3.5M29.2 16h-3.5M6.3 16H2.8m22.5-9.3-2.5 2.5M9.2 22.8l-2.5 2.5m18.6 0-2.5-2.5M9.2 9.2 6.7 6.7" stroke-width="2.4"/></svg>`,
  'partly-cloudy': `<svg ${W}><circle class="wx-sun" cx="10.5" cy="10.2" r="5" fill="currentColor" fill-opacity=".82"/><path class="wx-sun-ray" d="M10.5 2.5v2M3 10.2h2m10.9-5.5-1.5 1.5M6.7 14l-1.5 1.5"/><path class="wx-cloud" d="M9.2 25.2h15a5 5 0 0 0 .7-9.9 7.5 7.5 0 0 0-14.2-1.8 5.9 5.9 0 0 0-1.5 11.7Z" fill="currentColor" fill-opacity=".9"/></svg>`,
  hot: `<svg ${W}><path class="wx-hot" d="M12.5 6.8a3.5 3.5 0 0 1 7 0v12.4a6 6 0 1 1-7 0V6.8Z" fill="currentColor" fill-opacity=".12"/><path class="wx-hot" d="M16 10v12" stroke-width="3.2"/><circle class="wx-hot" cx="16" cy="24" r="3.1" fill="currentColor" stroke="none"/><path class="wx-sun-ray" d="M23 7h5m-4.1 4.2 3.4 2M23.9 2.8l3.4-2"/></svg>`,
  cloud: `<svg ${W}><path class="wx-cloud" d="M8.2 24.2h15.2a5.4 5.4 0 0 0 .7-10.7A8 8 0 0 0 9 11.5a6.5 6.5 0 0 0-.8 12.7Z" fill="currentColor" fill-opacity=".32"/></svg>`,
  fog: `<svg ${W}><path class="wx-cloud" d="M8 17.8h15.7a4.8 4.8 0 0 0 .5-9.5A7.6 7.6 0 0 0 9.8 6.7 5.7 5.7 0 0 0 8 17.8Z" fill="currentColor" fill-opacity=".16"/><path class="wx-fog" d="M5 22h22M8 27h16" stroke-width="2.7"/></svg>`,

  /* ── Alert / hazard types ───────────────────────────────────────── */
  'flash-flood': `<svg ${W}><path class="wx-precip" d="m8 5-2 4m8-4-2 4m8-4-2 4m8-4-2 4" stroke-width="2.7"/><path class="wx-water" d="M3 17c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 4.3-2 6.5 0 4.3 2 6.5 0M3 24c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 4.3-2 6.5 0 4.3 2 6.5 0" stroke-width="2.7"/></svg>`,
  'extreme-wind': `<svg ${W}><path class="wx-wind" d="M2.5 8h18.3c3.9 0 4.4-5.8.5-6.3-2.1-.3-3.6.8-4.3 2.6M2.5 15h24c4.2 0 4.7 6.2.5 6.8-2.3.3-3.9-.9-4.6-2.8M2.5 22h12.8c3.6 0 4.1 5.3.5 5.9-2 .3-3.3-.7-4-2.2" stroke-width="3"/></svg>`,
  // Single water-level glyph for flood watch/warning/advisory — ring color
  // distinguishes tiers (§8), not the glyph.
  flood: `<svg ${W}><path class="wx-water" d="M16 3.5c-3.6 4.8-6.3 8.6-6.3 12a6.3 6.3 0 0 0 12.6 0c0-3.4-2.7-7.2-6.3-12Z" fill="currentColor" fill-opacity=".14"/><path class="wx-water" d="M3 26c2.2-1.8 4.3-1.8 6.5 0s4.3 1.8 6.5 0 4.3-1.8 6.5 0 4.3 1.8 6.5 0" stroke-width="2.7"/></svg>`,
  'ice-storm': `<svg ${D}><path class="domain-fill" d="M16 2.8A13.2 13.2 0 1 1 2.8 16 13.2 13.2 0 0 1 16 2.8Z" fill="currentColor" fill-opacity=".1"/><path class="wx-ice" d="M16 6v20M7.3 11l17.4 10m0-10L7.3 21M12 7.8l4 2.4 4-2.4m-8 16.4 4-2.4 4 2.4M6.8 15l3.8 1-1 3.8M25.2 17l-3.8-1 1-3.8"/><circle class="wx-ice" cx="16" cy="16" r="2" fill="currentColor" stroke="none"/></svg>`,
  freeze: `<svg ${W}><path class="wx-ice" d="M18.5 4v24M12 8l13 16M25 8 12 24M14.5 5.8l4 2.5 4-2.5m-8 20.4 4-2.5 4 2.5"/><path class="wx-hot" d="M5.5 5.5v13.2a5 5 0 1 0 5 0V5.5a2.5 2.5 0 0 0-5 0Z" fill="currentColor" fill-opacity=".1"/></svg>`,
  fire: `<svg ${W}><path class="wx-fire" d="M17.2 2.5c1.3 5.2-2.2 7.2-3.6 10.1-1.1 2.4-.1 4.3 1.9 5.6-.2-2.6 1.4-4.2 3.8-6.3 4.7 3.6 7.1 7.1 6.2 11.2-.9 4.2-4.6 6.4-9.4 6.4-5.7 0-9.7-3.2-9.6-8.1.1-4 2.7-7.5 6.1-10.2-.3 3.1.9 4.3 2.1 4.8-1.5-5.2.4-9.6 2.5-13.5Z" fill="currentColor" fill-opacity=".2"/></svg>`,
  hail: `<svg ${W}><path class="wx-cloud" d="M7.7 19.2h15.8a5 5 0 0 0 .6-9.9A7.8 7.8 0 0 0 9.3 7.6a6 6 0 0 0-1.6 11.6Z" fill="currentColor" fill-opacity=".16"/><circle class="wx-hail" cx="9" cy="25" r="2" fill="currentColor" stroke="none"/><circle class="wx-hail" cx="16" cy="27" r="2" fill="currentColor" stroke="none"/><circle class="wx-hail" cx="23" cy="24" r="2" fill="currentColor" stroke="none"/></svg>`,
  lightning: `<svg ${W}><path class="wx-bolt" d="M18.2 2.5 6.5 17.8h8.1L12.7 30 25.5 13.2h-8.2l.9-10.7Z" fill="currentColor" stroke="none"/></svg>`,
  // Generic alert fallback — rounded warning triangle (unrecognized events,
  // SPS, threat rows).
  warning: `<svg ${D}><path class="domain-fill" d="m13.3 5.1-9.8 17a3.1 3.1 0 0 0 2.7 4.7h19.6a3.1 3.1 0 0 0 2.7-4.7l-9.8-17a3.1 3.1 0 0 0-5.4 0Z" fill="currentColor" fill-opacity=".14"/><path d="M16 11v7" stroke-width="3"/><circle cx="16" cy="23" r="1.6" fill="currentColor" stroke="none"/></svg>`,

  /* ── Storm report markers ───────────────────────────────────────── */
  'wind-damage': `<svg ${W}><path d="M16 29V14" stroke-width="3"/><path d="M16 15C13 9 8.2 7 3 7.5c2.4 4.8 6.6 7.1 13 7.5Zm0 4.5c4.2-5.1 8.5-6.7 13-5.1-2.4 4.2-6.7 6-13 5.1Z" fill="currentColor" fill-opacity=".18"/><path d="M8 29h16M4 4l3 1m20 3 2-1"/></svg>`,
  report: `<svg ${D}><rect class="domain-fill" x="6" y="5.5" width="20" height="23" rx="3" fill="currentColor" fill-opacity=".1"/><path class="domain-accent" d="M11 3.5h10a2 2 0 0 1 2 2v2H9v-2a2 2 0 0 1 2-2Z" fill="currentColor" fill-opacity=".5"/><path d="m10.5 15 2.2 2.2 4-4.5M19.5 15h3M10.5 22h11"/></svg>`,
  funnel: `<svg ${W}><path d="M4 5.5c6.6 2.2 17.4 2.2 24 0M7 11c5 1.8 13 1.8 18 0m-15 5.5c3.4 1.5 8.6 1.5 12 0M13 22c1.8 1 4.2 1 6 0m-4 5c1 .6 2.2.6 3.2 0" stroke-width="2.8"/></svg>`,

  /* Moon phases: filled light/shadow geometry with a shared crater texture. */
  'moon-new': `<svg ${M}><circle class="moon-shadow" cx="16" cy="16" r="12" fill="currentColor" fill-opacity=".1"/><circle class="moon-crater" cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" opacity=".35"/><circle class="moon-crater" cx="20" cy="19" r="2" fill="currentColor" stroke="none" opacity=".25"/></svg>`,
  'moon-waxing-crescent': `<svg ${M}><circle class="moon-shadow" cx="16" cy="16" r="12" fill="currentColor" fill-opacity=".1"/><path class="moon-light" d="M18 4.2a12 12 0 0 1 0 23.6A15 15 0 0 0 18 4.2Z" fill="currentColor" stroke="none"/><circle class="moon-crater" cx="22" cy="13" r="1.2" fill="currentColor" stroke="none" opacity=".3"/></svg>`,
  'moon-first-quarter': `<svg ${M}><circle class="moon-shadow" cx="16" cy="16" r="12" fill="currentColor" fill-opacity=".1"/><path class="moon-light" d="M16 4a12 12 0 0 1 0 24Z" fill="currentColor" stroke="none"/><circle class="moon-crater" cx="21" cy="19" r="1.5" fill="currentColor" stroke="none" opacity=".3"/></svg>`,
  'moon-waxing-gibbous': `<svg ${M}><circle class="moon-light" cx="16" cy="16" r="12" fill="currentColor"/><path class="moon-phase-shadow" d="M16 4C9.4 4 4 9.4 4 16s5.4 12 12 12c-4.7-3.3-6.8-7.3-6.8-12S11.3 7.3 16 4Z" fill="currentColor" stroke="none"/><circle class="moon-crater" cx="21" cy="11" r="1.5" fill="currentColor" stroke="none" opacity=".28"/><circle class="moon-crater" cx="20" cy="21" r="2" fill="currentColor" stroke="none" opacity=".2"/></svg>`,
  'moon-full': `<svg ${M}><circle class="moon-light" cx="16" cy="16" r="12" fill="currentColor"/><circle class="moon-crater" cx="11" cy="11" r="2" fill="currentColor" stroke="none" opacity=".24"/><circle class="moon-crater" cx="21" cy="18" r="2.7" fill="currentColor" stroke="none" opacity=".2"/><circle class="moon-crater" cx="12.5" cy="23" r="1.2" fill="currentColor" stroke="none" opacity=".3"/></svg>`,
  'moon-waning-gibbous': `<svg ${M}><circle class="moon-light" cx="16" cy="16" r="12" fill="currentColor"/><path class="moon-phase-shadow" d="M16 4c6.6 0 12 5.4 12 12s-5.4 12-12 12c4.7-3.3 6.8-7.3 6.8-12S20.7 7.3 16 4Z" fill="currentColor" stroke="none"/><circle class="moon-crater" cx="11" cy="12" r="1.5" fill="currentColor" stroke="none" opacity=".28"/><circle class="moon-crater" cx="10" cy="21" r="2" fill="currentColor" stroke="none" opacity=".2"/></svg>`,
  'moon-last-quarter': `<svg ${M}><circle class="moon-shadow" cx="16" cy="16" r="12" fill="currentColor" fill-opacity=".1"/><path class="moon-light" d="M16 4a12 12 0 0 0 0 24Z" fill="currentColor" stroke="none"/><circle class="moon-crater" cx="11" cy="13" r="1.5" fill="currentColor" stroke="none" opacity=".3"/></svg>`,
  'moon-waning-crescent': `<svg ${M}><circle class="moon-shadow" cx="16" cy="16" r="12" fill="currentColor" fill-opacity=".1"/><path class="moon-light" d="M14 4.2a12 12 0 0 0 0 23.6A15 15 0 0 1 14 4.2Z" fill="currentColor" stroke="none"/><circle class="moon-crater" cx="10" cy="18" r="1.2" fill="currentColor" stroke="none" opacity=".3"/></svg>`,
  moon: `<svg ${M}><path class="moon-light" d="M27.5 19A12.5 12.5 0 1 1 13 4.5 10.3 10.3 0 0 0 27.5 19Z" fill="currentColor" fill-opacity=".9"/><path class="moon-star" d="M24 4v4m-2-2h4M28 10v2m-1-1h2"/></svg>`,

  /* ── Pollen types ───────────────────────────────────────────────── */
  tree: `<svg ${D}><path class="botanical-trunk" d="M16 28V17" stroke-width="3"/><path class="botanical-leaf" d="M16 3 7 14h4l-5 7h20l-5-7h4L16 3Z" fill="currentColor" fill-opacity=".18"/><path d="M10 28h12"/></svg>`,
  grass: `<svg ${D}><path class="botanical-leaf" d="M5 28c0-9 2-14 5-21 1 9-.2 15-5 21Zm9 0c0-12 1.4-19 4-25 2 10 .7 18-4 25Zm7 0c0-8 2-13 6-18-.2 8-2 14-6 18Z" fill="currentColor" fill-opacity=".2"/><path d="M3 28h26"/></svg>`,
  weed: `<svg ${D}><path class="botanical-stem" d="M16 29V10" stroke-width="2.8"/><path class="botanical-leaf" d="M16 13C10 12 7 8 6 3c6 1 9 4 10 10Zm0 5c5-1 8-4 10-8-5 0-8 3-10 8Z" fill="currentColor" fill-opacity=".22"/><circle class="pollen-core" cx="16" cy="8" r="2.2" fill="currentColor" stroke="none"/></svg>`,
  flower: `<svg ${D}><path class="botanical-stem" d="M16 18v11M16 24c-4-1-6-3-7-6 4 0 6 2 7 6Z"/><path class="botanical-leaf" d="M16 12c-4-1-6.2-4-5-7.5 3.5.7 5.2 3.2 5 7.5Zm0 0c1-4 4-6.2 7.5-5-1 3.5-3.5 5.2-7.5 5Zm0 0c4 1 6.2 4 5 7.5-3.5-.7-5.2-3.2-5-7.5Zm0 0c-1 4-4 6.2-7.5 5 1-3.5 3.5-5.2 7.5-5Z" fill="currentColor" fill-opacity=".18"/><circle class="pollen-core" cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>`,

  /* ── Freeze markers ─────────────────────────────────────────────── */
  // Last freeze (spring) — sprout.
  sprout: `<svg ${D}><path class="botanical-stem" d="M16 29V13" stroke-width="2.8"/><path class="season-spring" d="M16 14C10 13.5 6.5 10 6 4.5c6 .7 9.5 4 10 9.5Zm0 0c6-.5 9.5-4 10-9.5-6 .7-9.5 4-10 9.5Z" fill="currentColor" fill-opacity=".2"/><path class="wx-ice" d="m8 3-3-2m19 2 3-2"/></svg>`,
  // First freeze (fall) — falling leaf.
  leaf: `<svg ${D}><path class="season-fall" d="M16 3c1 8-2 13-9 16 0-7 3-12 9-16Zm0 9c6 0 10 3 12 8-6 1-10-2-12-8Z" fill="currentColor" fill-opacity=".22"/><path class="botanical-stem" d="M16 3v22m-5 4h10"/><circle class="wx-ice" cx="16" cy="26" r="1.8" fill="currentColor" stroke="none"/></svg>`,

  /* ── Warning-card metadata rows ─────────────────────────────────── */
  radar: `<svg ${U}><circle class="ui-fill" cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity=".08"/><path class="radar-sweep" d="M12 12 7.4 3.7A9.5 9.5 0 0 1 20.3 7.4Z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M12 12V2.5M12 12l8.3 4.6M6.8 14.9A6 6 0 0 1 9 6.8M4.2 16.4A9 9 0 0 1 7.5 4.4"/><circle class="ui-accent" cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle class="radar-return" cx="17.7" cy="8.2" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  'storm-motion': `<svg ${U}><circle class="ui-fill" cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity=".1"/><path class="ui-accent" d="m9 15 7-7m0 0h-4m4 0v4" stroke-width="2.5"/><path d="M7.5 17.5h4" opacity=".55"/></svg>`,
  population: `<svg ${U}><circle class="ui-accent" cx="8.5" cy="7" r="3" fill="currentColor" fill-opacity=".35"/><path class="ui-fill" d="M2.8 21c0-4.2 2.5-7 5.7-7s5.7 2.8 5.7 7Z" fill="currentColor" fill-opacity=".12"/><circle cx="17.2" cy="8" r="2.3"/><path d="M15.6 14.5c3.2.3 5.1 2.7 5.1 6.5"/></svg>`,
  clock: `<svg ${U}><circle class="ui-fill" cx="12" cy="12.5" r="9" fill="currentColor" fill-opacity=".1"/><path class="ui-accent" d="M12 7v5.5l4 2.2" stroke-width="2.5"/><path d="M9 2h6"/></svg>`,
  magnitude: `<svg ${U}><path class="ui-fill" d="m3.3 18.6 15.3-15.3 2.1 2.1L5.4 20.7Z" fill="currentColor" fill-opacity=".12"/><path d="m4 20 16-16M6.5 17.5l-2-2m5-.5-1.5-1.5m5-2-2-2m5-.5-1.5-1.5m5-2-2-2"/></svg>`,
  office: `<svg ${U}><path class="ui-fill" d="M4 21V9l8-5 8 5v12Z" fill="currentColor" fill-opacity=".1"/><path d="M3 21h18M4 21V9l8-5 8 5v12M9.5 21v-6h5v6"/><path class="ui-accent" d="M8 10.5h2m4 0h2" stroke-width="2.5"/></svg>`,
  // MCD concerning area.
  target: `<svg ${U}><circle class="ui-fill" cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity=".08"/><circle cx="12" cy="12" r="5.5"/><circle class="ui-accent" cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2.5v2M21.5 12h-2M12 21.5v-2M2.5 12h2"/></svg>`,
  // Watch probability / trend bars.
  chart: `<svg ${U}><path class="ui-fill" d="M3 13h3v8H3Zm5-3h3v11H8Zm5-4h3v15h-3Zm5-3h3v18h-3Z" fill="currentColor" fill-opacity=".2"/><path class="ui-accent" d="m3 10 6-3 5 1 7-5"/></svg>`,

  /* ── River gauge stages (low→high shape escalation, §11) ────────── */
  // Dry/cracked mark below the waterline.
  'river-low': `<svg ${U}><path class="river-drop" d="M12 2.5c-3.5 4.7-6 8.2-6 11.3a6 6 0 0 0 12 0c0-3.1-2.5-6.6-6-11.3Z" fill="currentColor" fill-opacity=".08"/><path d="m8.7 16 2-2.2 1.6 1.8 2-2.7 1.2 1.5" stroke-width="1.7"/></svg>`,
  // Empty drop — watching, not yet flooding (also the plain water-drop mark).
  drop: `<svg ${U}><path class="river-drop" d="M12 2.5c-3.5 4.7-6 8.2-6 11.3a6 6 0 0 0 12 0c0-3.1-2.5-6.6-6-11.3Z" fill="currentColor" fill-opacity=".12"/><path d="M9 16.5c1.7 1.2 4.3 1.2 6 0" opacity=".55"/></svg>`,
  'river-minor': `<svg ${U}><path class="river-drop" d="M12 2.5c-3.5 4.7-6 8.2-6 11.3a6 6 0 0 0 12 0c0-3.1-2.5-6.6-6-11.3Z" fill="currentColor" fill-opacity=".14"/><path class="river-band" d="M7 15.5c3.3 1.5 6.7 1.5 10 0" stroke-width="2.2"/></svg>`,
  'river-moderate': `<svg ${U}><path class="river-drop" d="M12 2.5c-3.5 4.7-6 8.2-6 11.3a6 6 0 0 0 12 0c0-3.1-2.5-6.6-6-11.3Z" fill="currentColor" fill-opacity=".2"/><path class="river-band" d="M7 16.5c3.3 1.3 6.7 1.3 10 0M8 13c2.7 1.1 5.3 1.1 8 0" stroke-width="2"/></svg>`,
  'river-major': `<svg ${U}><path class="river-drop" d="M12 2.5c-3.5 4.7-6 8.2-6 11.3a6 6 0 0 0 12 0c0-3.1-2.5-6.6-6-11.3Z" fill="currentColor" fill-opacity=".38"/><path d="M12 8.5v5" stroke-width="2.5"/><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/></svg>`,

  /* ── Chip / ticker / page-title marks (new, same grid) ──────────── */
  calendar: `<svg ${U}><rect class="ui-fill" x="3" y="5" width="18" height="16" rx="3" fill="currentColor" fill-opacity=".1"/><path class="ui-accent" d="M3 10h18"/><path d="M8 2.5V7m8-4.5V7"/><path class="ui-accent" d="M7.5 14h3m-3 3.5h6" stroke-width="2.4"/></svg>`,
  book: `<svg ${U}><path class="ui-fill" d="M12 6.5C10 4.8 7.3 4 3.5 4v15c3.8 0 6.5.8 8.5 2.5C14 19.8 16.7 19 20.5 19V4C16.7 4 14 4.8 12 6.5Z" fill="currentColor" fill-opacity=".1"/><path d="M12 6.5v15"/><path class="ui-accent" d="M6.5 9h3M14.5 9h3M6.5 13h3M14.5 13h3"/></svg>`,
  satellite: `<svg ${U}><rect class="ui-accent" x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" fill-opacity=".3"/><path class="ui-fill" d="M2.5 8.5h6v7h-6Zm13 0h6v7h-6Z" fill="currentColor" fill-opacity=".12"/><path d="M2.5 12H9m6 0h6.5M5.5 8.5v7m13-7v7"/></svg>`,
  // Tropical cyclone — solid broadcast hurricane mark with a true cut-out eye.
  hurricane: `<svg ${U}><path class="cyclone-band" fill-rule="evenodd" clip-rule="evenodd" d="M23.6 1.3C16.8-.2 10.2.8 6 4.7 1.4 8.9 3.1 14 6.2 17.4c2.6 2.9 1.5 4.2-5.8 5.2 8.2 1.4 15.5-.7 19.6-5.3 4.4-4.8 2.2-10.1-.5-12.8-2.4-2.4-1.5-3.3 4.1-3.2ZM12 9.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z" fill="currentColor" stroke="none"/></svg>`,
  // Aurora curtain — rays over the northern horizon.
  aurora: `<svg ${U}><path class="ui-fill" d="M4 15c2.7-3.5 5.3-5.2 8-5.2s5.3 1.7 8 5.2c-2.7-1.5-5.3-2.2-8-2.2S6.7 13.5 4 15Z" fill="currentColor" fill-opacity=".18"/><path class="aurora-ray" d="m6 3 1.2 8M12 2v8m6-7-1.2 8"/><path d="M3 17c3-2.7 6-4 9-4s6 1.3 9 4M8.5 21h7"/></svg>`,
  sunrise: `<svg ${U}><path class="solar-disc" d="M7.5 16a4.5 4.5 0 0 1 9 0Z" fill="currentColor" fill-opacity=".35"/><path class="solar-ray" d="M3 16h2.5m13 0H21M6.3 10.3 8 12m9.7-1.7L16 12"/><path d="M3 20h18"/><path class="ui-accent" d="M12 8V3m-2.3 2.3L12 3l2.3 2.3"/></svg>`,
  sunset: `<svg ${U}><path class="solar-disc" d="M7.5 16a4.5 4.5 0 0 1 9 0Z" fill="currentColor" fill-opacity=".35"/><path class="solar-ray" d="M3 16h2.5m13 0H21M6.3 10.3 8 12m9.7-1.7L16 12"/><path d="M3 20h18"/><path class="ui-accent" d="M12 3v5m-2.3-2.3L12 8l2.3-2.3"/></svg>`,
  // Brand / broadcast mark for the ticker.
  broadcast: `<svg ${U}><rect class="ui-fill" x="2.5" y="7" width="19" height="14" rx="3" fill="currentColor" fill-opacity=".1"/><path d="m8 3 4 4 4-4"/><path class="ui-accent" d="M7 13.5h7m-7 3h4"/><circle class="ui-accent" cx="17.5" cy="15" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  // Spotter/relayed-source speech bubble.
  speech: `<svg ${U}><path class="ui-fill" d="M12 3.8c-5.3 0-9.5 3.3-9.5 7.5 0 2.4 1.4 4.5 3.6 5.9-.2 1.4-.8 2.7-2 4 2.3-.3 4.1-1 5.4-1.9.8.2 1.7.3 2.5.3 5.3 0 9.5-3.3 9.5-7.5S17.3 3.8 12 3.8Z" fill="currentColor" fill-opacity=".1"/><path class="ui-accent" d="M8 11.8h.01M12 11.8h.01M16 11.8h.01" stroke-width="3"/></svg>`,
};

// Concept reuse (§6: don't duplicate a concept with a second glyph).
const ALIASES = {
  thunderstorm: 'storm',
  'high-wind': 'wind',
  'wind-gust': 'wind',
  'heavy-rain': 'rain',
  'hail-size': 'hail',
  'river-action': 'drop',
  snow: 'ice',
  sleet: 'ice',
};

// Lookup — unknown names fall back to the generic warning mark rather than
// rendering nothing (mirrors alert-style.js's unrecognized-event fallback).
export function icon(name) {
  return ICONS[ALIASES[name] ?? name] ?? ICONS.warning;
}
