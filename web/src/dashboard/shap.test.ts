import { describe, expect, it } from 'vitest';
import example from '../api/mock/example_prediction.json';
import { direction, relativeContribution, shapView } from './shap';

const lad = example.output.targets.LAD;

describe('shapView', () => {
  it('sorts by absolute contribution and caps at top-k', () => {
    const v = shapView(lad.shap, lad.probability, 5);
    expect(v.rows).toHaveLength(5);
    const abs = v.rows.map((r) => Math.abs(r.value));
    expect([...abs].sort((a, b) => b - a)).toEqual(abs);
    expect(v.rows[0]?.feature).toBe('typical_chest_pain');
  });
  it('marks direction with up for risk-raising and down for risk-lowering', () => {
    const v = shapView(lad.shap, lad.probability, 50);
    for (const r of v.rows) expect(r.direction).toBe(r.value > 0 ? 'up' : 'down');
    expect(v.rows.some((r) => r.direction === 'down')).toBe(true);
  });
  it('base plus contributions equals the probability (the documented additivity)', () => {
    for (const t of Object.values(example.output.targets)) {
      const v = shapView(t.shap, t.probability, 5);
      expect(v.additivity.ok).toBe(true);
      expect(v.additivity.total).toBeCloseTo(t.probability, 9);
    }
  });
  it('flags an explanation that does not add up', () => {
    expect(shapView(lad.shap, lad.probability + 0.2, 5).additivity.ok).toBe(false);
  });
  it('rolls everything beyond top-k into a rest row whose sum closes the books', () => {
    const v = shapView(lad.shap, lad.probability, 3);
    const shown = v.rows.reduce((a, r) => a + r.value, 0);
    expect(shown + v.rest.sum + v.additivity.base).toBeCloseTo(lad.probability, 9);
    expect(v.rest.count).toBe(Object.keys(lad.shap.contributions).length - 3);
  });
  it('treats sub-display contributions as no effect and keeps them out of the rows', () => {
    expect(direction(0.0001)).toBe('none');
    expect(direction(-0.0001)).toBe('none');
    expect(direction(0.01)).toBe('up');
    const v = shapView({ base: 0.5, contributions: { a: 0.0001, b: 0.1, c: -0.05 } }, 0.5501, 10);
    expect(v.rows.map((r) => r.feature)).toEqual(['b', 'c']);
  });
});

describe('relativeContribution', () => {
  it('shares of all inputs sum to one', () => {
    const total = Object.keys(lad.shap.contributions).reduce((a, k) => a + relativeContribution(lad.shap, k).share, 0);
    expect(total).toBeCloseTo(1, 9);
  });
  it('unknown features contribute nothing', () => {
    expect(relativeContribution(lad.shap, 'nope')).toEqual({ value: 0, share: 0 });
  });
});
