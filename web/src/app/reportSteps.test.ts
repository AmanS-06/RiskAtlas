import { describe, expect, it } from 'vitest';
import { mockMeta, mockPredict, type FullPrediction, type Inputs } from '../api';
import { specs } from '../dashboard/form';
import { DISCLAIMER } from '../shared/constants';
import { bandInfos } from '../shared/palette';
import type { CardContext } from './regionInfo';
import { buildReportSteps } from './reportSteps';

const meta = mockMeta;
const bands = bandInfos(meta, 'config', () => '');
const inputs: Inputs = { age: 70, sex: 1, bp: 160, ef_tte: 35, dm: 1, current_smoker: 1, region_rwma: 2 };
const full = mockPredict('full', inputs) as FullPrediction;
const ctx: CardContext = { regionId: '', meta, bands, prediction: full, full, inputs, specs: specs(meta) };

describe('report steps', () => {
  it('is empty without a prediction', () => {
    expect(buildReportSteps({ ...ctx, prediction: null, full: null })).toEqual([]);
  });

  it('goes overview, arteries from highest risk down, left ventricle, limits', () => {
    const steps = buildReportSteps(ctx);
    expect(steps[0]!.id).toBe('overview');
    expect(steps[0]!.regionId).toBeNull();
    const arteries = steps.filter((s) => ['LAD', 'LCX', 'RCA'].includes(s.id));
    expect(arteries).toHaveLength(3);
    const probs = arteries.map((s) => full.targets[s.id]!.probability);
    expect(probs).toEqual([...probs].sort((a, b) => b - a));
    expect(steps.at(-2)!.id).toBe('left_ventricle');
    expect(steps.at(-1)!.id).toBe('limits');
  });

  it('points the camera at the artery or region each step is about', () => {
    for (const s of buildReportSteps(ctx)) {
      if (['LAD', 'LCX', 'RCA', 'left_ventricle'].includes(s.id)) expect(s.regionId).toBe(s.id);
      else expect(s.regionId).toBeNull();
    }
  });

  it('puts the real probability and band in each artery step', () => {
    const lad = buildReportSteps(ctx).find((s) => s.id === 'LAD')!;
    expect(lad.title).toContain(`${Math.round(full.targets.LAD!.probability * 100)}%`);
    expect(lad.band?.id).toBe(full.targets.LAD!.band);
    expect(lad.lines.some((l) => /percentage points/.test(l))).toBe(true);
  });

  it('carries the reliability warnings of the weak arteries into their steps', () => {
    const lcx = buildReportSteps(ctx).find((s) => s.id === 'LCX')!;
    expect(lcx.notes.some((n) => /coarse/.test(n))).toBe(true);
    expect(lcx.notes.some((n) => /65\+/.test(n))).toBe(true);
  });

  it('ends with the limits and the disclaimer', () => {
    const last = buildReportSteps(ctx).at(-1)!;
    expect(last.lines.join(' ')).toMatch(/single-centre/);
    expect(last.notes).toContain(DISCLAIMER);
  });

  it('reports missing inputs on the overview', () => {
    const steps = buildReportSteps({ ...ctx, prediction: { ...full, input: { ...full.input, missing: ['age', 'bp'] } } });
    expect(steps[0]!.lines.join(' ')).toMatch(/Estimated without 2 of 52 inputs/);
  });
});
