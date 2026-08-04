// Dew point via the Magnus–Tetens approximation — a two-liner off temperature
// and relative humidity. Input temperature in °C, RH in percent; output °F,
// rounded (a broadcast "muggy meter" never shows tenths). Down south the dew
// point is what people actually feel, so it earns its own map mode.
const B = 17.625;
const C = 243.04;

export function dewPointF(tempC, rhPct) {
  if (tempC == null || rhPct == null || rhPct <= 0) return null;
  const g = Math.log(rhPct / 100) + (B * tempC) / (C + tempC);
  const tdC = (C * g) / (B - g);
  return Math.round((tdC * 9) / 5 + 32);
}

// Comfort word for a dew point in °F — the classic muggy-meter bands (below
// ~55° feels dry, 65°+ gets sticky, 70°+ is the oppressive Gulf air).
export function dewLabel(f) {
  if (f >= 75) return 'miserable';
  if (f >= 70) return 'oppressive';
  if (f >= 65) return 'uncomfortable';
  if (f >= 60) return 'sticky';
  if (f >= 55) return 'comfortable';
  if (f >= 50) return 'pleasant';
  return 'crisp';
}
