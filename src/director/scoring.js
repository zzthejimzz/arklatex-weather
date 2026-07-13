// Severity ranking for the director and banner. Higher = more urgent.
// NWS CAP parameters (properties.parameters) carry the impact tags:
//   tornadoDetection: RADAR INDICATED | OBSERVED
//   tornadoDamageThreat: CONSIDERABLE (PDS) | CATASTROPHIC (emergency)
//   thunderstormDamageThreat: CONSIDERABLE | DESTRUCTIVE

export function param(props, key) {
  const v = props?.parameters?.[key];
  return Array.isArray(v) ? v[0] : v ?? null;
}

export function scoreAlert(props) {
  const ev = (props.event || '').toLowerCase();
  const text = `${props.headline ?? ''} ${props.description ?? ''}`;
  const torThreat = String(param(props, 'tornadoDamageThreat') ?? '').toUpperCase();
  const stormThreat = String(param(props, 'thunderstormDamageThreat') ?? '').toUpperCase();
  const detection = String(param(props, 'tornadoDetection') ?? '').toUpperCase();

  if (ev === 'tornado warning') {
    if (torThreat === 'CATASTROPHIC' || /tornado emergency/i.test(text)) return 100;
    if (torThreat === 'CONSIDERABLE') return 90;
    return detection === 'OBSERVED' ? 85 : 80;
  }
  if (ev === 'extreme wind warning') return 88;
  if (ev === 'severe thunderstorm warning') {
    if (stormThreat === 'DESTRUCTIVE') return 70;
    if (stormThreat === 'CONSIDERABLE') return 60;
    return 50;
  }
  if (ev === 'flash flood warning') {
    // Only a flash flood emergency tours like a storm-scale warning. FFWs run
    // for hours — above TOUR_THRESHOLD they monopolize the rotation (solo
    // warning mode) and the idle plan (statements, forecast, almanac) never
    // airs. CONSIDERABLE still tops the minor stops and announces itself once
    // on issuance (see announces()); the base tag just rides the idle plan.
    const ffThreat = String(param(props, 'flashFloodDamageThreat') ?? '').toUpperCase();
    if (ffThreat === 'CATASTROPHIC' || /flash flood emergency/i.test(text)) return 75;
    if (ffThreat === 'CONSIDERABLE') return 38;
    return 35;
  }
  if (ev === 'tornado watch') return 30;
  if (ev === 'severe thunderstorm watch') return 25;
  if (ev === 'flood warning') return 20;

  const sev = (props.severity || '').toLowerCase();
  if (sev === 'extreme') return 18;
  if (sev === 'severe') return 12;
  if (sev === 'moderate') return 6;
  return 2;
}

// Only storm-scale warnings get the pan-and-zoom treatment; watches,
// advisories, and base flash flood warnings stay on the map (and get idle-plan
// camera visits) but the warning rotation doesn't chase them.
const TOUR_THRESHOLD = 40;

export function isTourable(alert) {
  return alert.score >= TOUR_THRESHOLD && !!alert.geometry;
}

// Alerts that pre-empt the current shot once when first issued, even if they
// don't join the warning rotation afterward: everything tourable, plus a
// CONSIDERABLE flash flood warning — life-threatening flooding deserves an
// on-air announcement before settling in as the top minor stop.
export function announces(alert) {
  if (isTourable(alert)) return true;
  const ev = (alert.props?.event ?? '').toLowerCase();
  return ev === 'flash flood warning' && !!alert.geometry
    && String(param(alert.props, 'flashFloodDamageThreat') ?? '').toUpperCase() === 'CONSIDERABLE';
}
