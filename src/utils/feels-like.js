// Apparent-temperature math, straight from the NWS formulas. Heat index is
// the Rothfusz regression with the low/high-humidity adjustments; wind chill
// is the 2001 NWS/JAG-TI curve. Outside each formula's validity range the
// air temperature *is* the feels-like, so feelsLikeF always returns a number.

// Valid for T >= 80°F. rh in percent.
export function heatIndexF(t, rh) {
  // NWS practice: start from the simple Steadman average; the full
  // regression only applies once that average reaches 80.
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return t;
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  } else if (rh > 85 && t >= 80 && t <= 87) {
    hi += ((rh - 85) / 10) * ((87 - t) / 2);
  }
  return hi;
}

// Valid for T <= 50°F and wind > 3 mph.
export function windChillF(t, mph) {
  const v = Math.pow(mph, 0.16);
  return 35.74 + 0.6215 * t - 35.75 * v + 0.4275 * t * v;
}

// Rounded apparent temperature for an observation, or null when the inputs
// needed for the applicable formula are missing.
export function feelsLikeF(tempF, rhPct, windMph) {
  if (tempF == null) return null;
  if (tempF >= 80) {
    if (rhPct == null) return null;
    return Math.round(heatIndexF(tempF, rhPct));
  }
  if (tempF <= 50 && windMph != null && windMph > 3) {
    return Math.round(windChillF(tempF, windMph));
  }
  return tempF;
}
