import type { Shap } from '../api/types';

export type Direction = 'up' | 'down' | 'none';

export interface ShapRow {
  feature: string;
  value: number;
  direction: Direction;
  /** |value| as a share of the sum of all |contributions| (0 to 1). */
  share: number;
}

export interface Additivity {
  base: number;
  sum: number;
  total: number;
  probability: number;
  ok: boolean;
}

export interface ShapView {
  rows: ShapRow[];
  /** Features beyond top-k (including zero contributions). */
  rest: { count: number; sum: number };
  additivity: Additivity;
  /** Largest |value| among all rows, for scaling bars. */
  max: number;
}

// Below 0.05 percentage points nothing visible changes (values print as 0.0 pp), so call it no effect.
const EPS = 5e-4;
export const direction = (v: number): Direction => (v > EPS ? 'up' : v < -EPS ? 'down' : 'none');

/** Contributions sorted by size. base + sum(contributions) equals the probability (docs/ml_interface.md section 3). */
export function shapView(shap: Shap, probability: number, topK: number): ShapView {
  const entries = Object.entries(shap.contributions);
  const totalAbs = entries.reduce((a, [, v]) => a + Math.abs(v), 0);
  const all: ShapRow[] = entries
    .map(([feature, value]) => ({ feature, value, direction: direction(value), share: totalAbs > 0 ? Math.abs(value) / totalAbs : 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.feature.localeCompare(b.feature));
  const shown = all.filter((r) => r.direction !== 'none').slice(0, topK);
  const hidden = all.filter((r) => !shown.includes(r));
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  const total = shap.base + sum;
  return {
    rows: shown,
    rest: { count: hidden.length, sum: hidden.reduce((a, r) => a + r.value, 0) },
    additivity: { base: shap.base, sum, total, probability, ok: Math.abs(total - probability) < 1e-6 },
    max: all.reduce((a, r) => Math.max(a, Math.abs(r.value)), 0),
  };
}

/** Share of the target's total absolute contribution that one feature accounts for (0 to 1). */
export function relativeContribution(shap: Shap, feature: string): { value: number; share: number } {
  const v = shap.contributions[feature] ?? 0;
  const totalAbs = Object.values(shap.contributions).reduce((a, b) => a + Math.abs(b), 0);
  return { value: v, share: totalAbs > 0 ? Math.abs(v) / totalAbs : 0 };
}
