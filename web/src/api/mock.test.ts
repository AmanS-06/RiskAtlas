import { describe, expect, it } from 'vitest';
import example from './mock/example_prediction.json';
import { MockProvider, mockMeta, mockPredict } from './mock';
import { isFull, type Inputs } from './types';

const exampleInput = example.input as Record<string, number>;

describe('mock data', () => {
  it('meta is built from config: features, groups, targets with meshes, bands', () => {
    expect(mockMeta.features.length).toBeGreaterThan(40);
    expect(mockMeta.targets.filter((t) => t.mesh).map((t) => t.mesh)).toEqual(['LAD', 'LCX', 'RCA']);
    expect(mockMeta.risk_bands.map((b) => b.id)).toEqual(['low', 'moderate', 'high']);
    expect(mockMeta.groups).toContain('labs');
    expect(mockMeta.forbidden_inputs).toEqual(expect.arrayContaining(['LAD', 'LCX', 'RCA', 'Cath']));
    expect(mockMeta.mock).toBe(true);
  });

  it('the example patient reproduces the example payload', () => {
    const out = mockPredict('full', exampleInput);
    for (const [id, t] of Object.entries(example.output.targets)) {
      expect(out.targets[id]?.probability).toBeCloseTo(t.probability, 9);
      expect(out.targets[id]?.band).toBe(t.band);
    }
    expect(out.mock).toBe(true);
  });

  it('keeps SHAP additive and vessels at or below CAD whatever is entered', () => {
    for (const inputs of [{} as Inputs, { age: 20 }, { age: 90, bp: 300, ldl: 400, dm: 1 }, { ...exampleInput, bp: 90, fbs: 70, ldl: 40, current_smoker: 0 }]) {
      const out = mockPredict('full', inputs);
      for (const t of Object.values(out.targets)) {
        const sum = Object.values(t.shap.contributions).reduce((a, b) => a + b, 0);
        expect(t.shap.base + sum).toBeCloseTo(t.probability, 9);
        expect(t.probability).toBeGreaterThan(0);
        expect(t.probability).toBeLessThan(1);
      }
      for (const v of ['LAD', 'LCX', 'RCA']) expect(out.targets[v]!.probability).toBeLessThanOrEqual(out.targets.CAD!.probability + 1e-12);
      expect(Object.values(out.coherence).every((c) => !c.below_top_vessel)).toBe(true);
    }
  });

  it('responds to inputs so sliders visibly move the result', () => {
    const hi = mockPredict('full', { ...exampleInput, bp: 190 }).targets.CAD!.probability;
    const lo = mockPredict('full', { ...exampleInput, bp: 100 }).targets.CAD!.probability;
    expect(hi).toBeGreaterThan(lo);
  });

  it("assigns bands from each target's own cut points", () => {
    const t = mockMeta.targets.find((x) => x.id === 'LCX')!;
    const out = mockPredict('full', exampleInput).targets.LCX!;
    expect(out.rule_out).toBe(t.rule_out);
    expect(out.rule_in).toBe(t.rule_in);
    const expected = out.probability < out.rule_out ? 'low' : out.probability >= out.rule_in ? 'high' : 'moderate';
    expect(out.band).toBe(expected);
  });

  it('reports missing and ignored inputs and computes physiology status from config ranges', () => {
    const out = mockPredict('full', { bp: 150, hdl: 30, ldl: 80, notAFeature: 1, age: null });
    expect(out.input.missing).toContain('age');
    expect(out.input.missing).not.toContain('bp');
    expect(out.input.ignored).toEqual(['notAFeature']);
    expect(out.physiology.bp).toMatchObject({ value: 150, status: 'high' });
    expect(out.physiology.hdl).toMatchObject({ value: 30, status: 'low' });
    expect(out.physiology.ldl).toMatchObject({ value: 80, status: 'normal' });
    expect(out.physiology.fbs).toMatchObject({ value: null, status: 'missing' });
  });

  it('fast mode has probabilities and bands only', () => {
    const out = mockPredict('fast', exampleInput);
    expect(isFull(out)).toBe(false);
    expect(Object.values(out.targets).every((t) => !('shap' in t) && 'probability' in t && 'rule_in' in t)).toBe(true);
    expect(out.physiology).toBeTruthy();
  });

  it('counterfactual changes only mention features whose value matches what was entered', () => {
    const out = mockPredict('full', { ...exampleInput, bp: 130 });
    expect(out.targets.CAD!.counterfactual.changes.map((c) => c.feature)).not.toContain('bp');
    expect(out.targets.CAD!.counterfactual.note.length).toBeGreaterThan(10);
  });

  it('MockProvider honours abort', async () => {
    const p = new MockProvider({ fast: 50, full: 50 });
    const ctl = new AbortController();
    const pending = p.predict('fast', {}, ctl.signal);
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});
