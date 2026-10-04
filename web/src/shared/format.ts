const SUPERSCRIPT: Record<string, string> = { '2': '²', '3': '³' };

/** Display form of a unit string from config: kg/m2 -> kg/m², percent -> %. */
export function formatUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  if (unit.toLowerCase() === 'percent') return '%';
  return unit.replace(/([a-zA-Z])([23])(?![0-9])/g, (_, l: string, d: string) => l + (SUPERSCRIPT[d] ?? d));
}

/** Probability (0 to 1) as a percentage. Percent signs belong in the UI only (docs/TEAM_STANDARD.md rule 6). */
export function pct(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/** Signed change in percentage points. */
export function pp(delta: number, digits = 1): string {
  const v = delta * 100;
  const s = v.toFixed(digits);
  const zero = Number(s) === 0;
  return `${zero ? '' : v > 0 ? '+' : '−'}${zero ? (0).toFixed(digits) : Math.abs(v).toFixed(digits)} pp`;
}

/** At most `digits` decimals, no trailing zeros. */
export function num(v: number, digits = 2): string {
  return String(Number(v.toFixed(digits)));
}

export function withUnit(v: number, unit: string | null | undefined): string {
  const u = formatUnit(unit);
  return u ? `${num(v)}${u === '%' ? '' : ' '}${u}` : num(v);
}

/** Unsigned size of a change in percentage points. */
export function pts(delta: number, digits = 1): string {
  return `${Math.abs(delta * 100).toFixed(digits)} pp`;
}

/**
 * Status line for a finished full prediction. `cached` comes from the API's `X-Cache: HIT` header. A cache hit reports the
 * time spent copying the stored answer (a fraction of a millisecond), not the model run, so it is never shown as a latency.
 */
export function fullPredictionStatus(totalMs: number | undefined, cached: boolean | undefined): string {
  if (cached) return 'Full prediction (cached answer, no new model run).';
  if (typeof totalMs !== 'number' || !Number.isFinite(totalMs) || totalMs <= 0) return 'Full prediction.';
  return totalMs < 1 ? 'Full prediction in under 1 ms.' : `Full prediction in ${Math.round(totalMs)} ms.`;
}
