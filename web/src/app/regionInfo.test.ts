import { describe, expect, it } from 'vitest';
import { mockMeta, mockPredict, type FullPrediction, type Inputs } from '../api';
import { specs } from '../dashboard/form';
import { bandInfos } from '../shared/palette';
import { buildRegionCard, reliabilityNotes, territoryNote, type CardContext } from './regionInfo';

const meta = mockMeta;
const bands = bandInfos(meta, 'config', () => '');
const allSpecs = specs(meta);
const inputs: Inputs = { age: 70, sex: 1, bp: 160, ef_tte: 35, dm: 1, current_smoker: 1, region_rwma: 2 };
const full = mockPredict('full', inputs) as FullPrediction;

const ctx = (regionId: string, over: Partial<CardContext> = {}): CardContext => ({
  regionId,
  meta,
  bands,
  prediction: full,
  full,
  inputs,
  specs: allSpecs,
  ...over,
});

describe('vessel cards', () => {
  it('carry the probability, band, interval and the top drivers of that vessel', () => {
    const c = buildRegionCard(ctx('LAD'));
    expect(c.live).toBe(true);
    expect(c.kind).toBe('vessel');
    expect(c.headline?.probability).toBeCloseTo(full.targets.LAD!.probability, 9);
    expect(c.headline?.band?.id).toBe(full.targets.LAD!.band);
    expect(c.headline?.interval).not.toBeNull();
    expect(c.drivers.length).toBeGreaterThan(0);
    expect(c.drivers.length).toBeLessThanOrEqual(4);
    expect(c.explains?.id).toBe('LAD');
  });
  it('says what it cannot tell: per vessel, not per lesion', () => {
    expect(buildRegionCard(ctx('RCA')).notes.some((n) => /not per lesion/.test(n.text))).toBe(true);
  });
  it('asks for a prediction when there is none, and never invents numbers', () => {
    const c = buildRegionCard(ctx('LCX', { prediction: null, full: null }));
    expect(c.headline).toBeNull();
    expect(c.drivers).toEqual([]);
    expect(c.notes[0]?.text).toMatch(/No prediction yet/);
  });
  it('waits for the full prediction before showing drivers', () => {
    const fast = mockPredict('fast', inputs);
    const c = buildRegionCard(ctx('LAD', { prediction: fast, full: null }));
    expect(c.headline?.interval).toBeNull();
    expect(c.drivers).toEqual([]);
    expect(c.notes.some((n) => /full prediction/.test(n.text))).toBe(true);
  });
});

describe('reliability notes', () => {
  it('flags the weak vessels as coarse and not the strong ones', () => {
    expect(reliabilityNotes('LCX', null).some((n) => /coarse/.test(n.text))).toBe(true);
    expect(reliabilityNotes('RCA', null).some((n) => /coarse/.test(n.text))).toBe(true);
    expect(reliabilityNotes('CAD', null)).toEqual([]);
  });
  it('warns when the patient is in an age band where the estimate did worse', () => {
    const warn = reliabilityNotes('LCX', 70).find((n) => n.tone === 'warn');
    expect(warn?.text).toMatch(/65\+/);
    expect(warn?.text).toMatch(/0\.5/);
    expect(reliabilityNotes('LCX', 40).some((n) => n.tone === 'warn')).toBe(false);
  });
  it('ignores a missing or nonsensical age', () => {
    expect(reliabilityNotes('LCX', undefined).some((n) => n.tone === 'warn')).toBe(false);
    expect(reliabilityNotes('LCX', Number.NaN).some((n) => n.tone === 'warn')).toBe(false);
  });
});

describe('anchored regions', () => {
  it('shows the patient values anchored to the left ventricle, with their contribution to CAD', () => {
    const c = buildRegionCard(ctx('left_ventricle'));
    expect(c.live).toBe(true);
    expect(c.explains?.kind).toBe('overall');
    const ef = c.rows.find((r) => r.feature === 'ef_tte');
    expect(ef?.value).toMatch(/35/);
    expect(ef?.contribution).not.toBeNull();
    expect(c.rows.map((r) => r.feature)).toEqual(expect.arrayContaining(['ef_tte', 'region_rwma', 'lvh']));
  });
  it('lists the three arteries as the territory of the muscle and says the shading is approximate', () => {
    const c = buildRegionCard(ctx('left_ventricle'));
    expect(c.territory?.map((t) => t.id)).toEqual(['LAD', 'LCX', 'RCA']);
    expect(c.notes.some((n) => n.text === territoryNote)).toBe(true);
    expect(territoryNote).toMatch(/not a lesion location/);
  });
  it('shows blood pressure on the aorta', () => {
    const c = buildRegionCard(ctx('ascending_aorta'));
    expect(c.rows.map((r) => r.feature)).toEqual(['bp']);
    expect(c.rows[0]?.value).toMatch(/160/);
    expect(c.territory).toBeNull();
  });
  it('shows blank inputs as not provided, not as zero', () => {
    const c = buildRegionCard(ctx('ascending_aorta', { inputs: {} }));
    expect(c.rows[0]?.value).toBeNull();
  });
});

describe('structures without data', () => {
  it('can be named but says nothing about the patient', () => {
    for (const id of ['left_atrium', 'right_atrium', 'right_ventricle', 'pulmonary_trunk']) {
      const c = buildRegionCard(ctx(id));
      if (id === 'right_ventricle') continue; // anchored in config only if a feature points to it
      expect(c.live).toBe(false);
      expect(c.rows).toEqual([]);
      expect(c.headline).toBeNull();
      expect(c.blurb).toBeTruthy();
      expect(c.notes.some((n) => /No input or output of the model/.test(n.text))).toBe(true);
    }
  });
  it('survives an unknown region id', () => {
    const c = buildRegionCard(ctx('nonsense'));
    expect(c.live).toBe(false);
    expect(c.title).toBe('nonsense');
  });
});
