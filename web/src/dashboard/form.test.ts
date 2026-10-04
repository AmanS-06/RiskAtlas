import { describe, expect, it } from 'vitest';
import { mockMeta } from '../api';
import { byGroup, check, fieldSpec, groupTitle, parseForm, rawFrom, specs, valueLabel } from './form';
import presets from './presets.json';

const spec = (name: string) => fieldSpec(mockMeta.features.find((f) => f.name === name)!);
const all = specs(mockMeta);

describe('control types come from /meta', () => {
  it('binary features get a Yes/No control, even with a text map (sex)', () => {
    expect(spec('sex').kind).toBe('binary');
    expect(spec('dm').kind).toBe('binary');
  });
  it('mapped and categorical features get a select with their own options', () => {
    expect(spec('bbb').kind).toBe('select');
    expect(spec('bbb').options.map((o) => o.value)).toEqual([0, 1, 2]);
    expect(spec('bbb').options.map((o) => o.label)).toEqual(['N (0)', 'LBBB (1)', 'RBBB (2)']);
    expect(spec('vhd').kind).toBe('select'); // numeric type but has a map
    expect(spec('region_rwma').options.map((o) => o.value)).toEqual([0, 1, 2, 3, 4]);
  });
  it('numeric features get a number field with a plausibility window around the training range', () => {
    const s = spec('bp');
    expect(s.kind).toBe('number');
    expect(s.bounds).toEqual({ min: 0, max: 290 }); // training 90 to 190, span 100
    expect(spec('age').bounds!.min).toBe(0);
  });
  it('every feature gets a spec and every group of /meta appears with its fields', () => {
    expect(all.length).toBe(mockMeta.features.length);
    const grouped = byGroup(all, mockMeta.groups);
    expect(grouped.map((g) => g.group)).toEqual(mockMeta.groups);
    expect(grouped.reduce((a, g) => a + g.specs.length, 0)).toBe(all.length);
  });
  it('titles groups', () => {
    expect(groupTitle('labs')).toBe('Labs');
    expect(groupTitle('ecg')).toBe('ECG');
  });
});

describe('validation', () => {
  it('blank is always fine (missing is allowed)', () => {
    expect(check(spec('bp'), '').level).toBe('ok');
    expect(check(spec('dm'), undefined).level).toBe('ok');
  });
  it('rejects text, accepts comma decimals', () => {
    expect(check(spec('bmi'), 'abc').level).toBe('error');
    expect(check(spec('bmi'), '25,5').level).toBe('ok');
    expect(check(spec('bmi'), '1e3').level).toBe('error');
  });
  it('rejects implausible values and warns outside the training range', () => {
    expect(check(spec('bp'), '-5').level).toBe('error');
    expect(check(spec('bp'), '900').level).toBe('error');
    expect(check(spec('bp'), '230').level).toBe('warn'); // plausible but beyond the 190 maximum seen in training
    expect(check(spec('bp'), '120').level).toBe('ok');
  });
  it('enforces allowed codes and whole numbers', () => {
    expect(check(spec('dm'), '2').level).toBe('error');
    expect(check(spec('bbb'), '3').level).toBe('error');
    expect(check(spec('bbb'), '2').level).toBe('ok');
    expect(check(spec('function_class'), '1.5').level).toBe('error');
  });
});

describe('parseForm', () => {
  it('builds the flat inputs dict: blanks are null, invalid fields are reported and not sent', () => {
    const p = parseForm(all, { age: '65', bp: '', bmi: 'x', dm: '1' });
    expect(p.inputs.age).toBe(65);
    expect(p.inputs.bp).toBeNull();
    expect(p.inputs.dm).toBe(1);
    expect('bmi' in p.inputs).toBe(false);
    expect(Object.keys(p.errors)).toEqual(['bmi']);
    expect(p.filled).toBe(2);
  });
});

describe('presets', () => {
  it('are labelled illustrative and only use features that /meta defines, with valid values', () => {
    expect(presets).toHaveLength(3);
    const names = new Set(mockMeta.features.map((f) => f.name));
    for (const p of presets) {
      expect(p.label.toLowerCase()).toContain('illustrative');
      for (const k of Object.keys(p.values)) expect(names.has(k)).toBe(true);
      const parsed = parseForm(all, rawFrom(p.values, all));
      expect(parsed.errors).toEqual({});
      expect(parsed.filled).toBe(Object.keys(p.values).length);
    }
  });
  it('never contain a label column', () => {
    for (const p of presets)
      for (const k of Object.keys(p.values)) expect(mockMeta.forbidden_inputs.map((x) => x.toLowerCase())).not.toContain(k.toLowerCase());
  });
});

describe('valueLabel', () => {
  it('reads values the way a person would', () => {
    expect(valueLabel(spec('dm'), '1')).toBe('Yes');
    expect(valueLabel(spec('dm'), '0')).toBe('No');
    expect(valueLabel(spec('bbb'), '1')).toBe('LBBB (1)');
    expect(valueLabel(spec('bp'), '150')).toBe('150 mmHg');
    expect(valueLabel(spec('bmi'), '26.775510204')).toBe('26.78 kg/m²');
    expect(valueLabel(spec('bp'), '')).toBeNull();
  });
});
