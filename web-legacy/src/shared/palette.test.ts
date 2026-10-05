import { describe, expect, it } from 'vitest';
import { mockMeta } from '../api';
import { bandInfos, findBand, safeColors, segments } from './palette';

const ramp: Record<string, string> = { '--safe-band-0': '#111111', '--safe-band-1': '#808080', '--safe-band-2': '#ffffff' };
const read = (n: string) => ramp[n] ?? '';

describe('band colours', () => {
  it('config palette passes through the /meta colours, lowest risk first', () => {
    const b = bandInfos(mockMeta, 'config', read);
    expect(b.map((x) => x.id)).toEqual(['low', 'moderate', 'high']);
    expect(b.map((x) => x.color)).toEqual(mockMeta.risk_bands.map((x) => x.color));
    expect(b.map((x) => x.index)).toEqual([0, 1, 2]);
  });
  it('safe palette swaps colours but keeps ids and labels', () => {
    const b = bandInfos(mockMeta, 'safe', read);
    expect(b.map((x) => x.color)).toEqual(['#111111', '#808080', '#ffffff']);
    expect(b.map((x) => x.label)).toEqual(mockMeta.risk_bands.map((x) => x.label));
  });
  it('interpolates the ramp when the config has a different number of bands', () => {
    expect(safeColors(5, read)).toEqual(['#111111', '#494949', '#808080', '#c0c0c0', '#ffffff']);
    expect(safeColors(2, read)).toEqual(['#111111', '#ffffff']);
    expect(safeColors(1, read)).toEqual(['#111111']);
  });
  it('falls back to the config colours when the ramp is missing', () => {
    const b = bandInfos(mockMeta, 'safe', () => '');
    expect(b.map((x) => x.color)).toEqual(mockMeta.risk_bands.map((x) => x.color));
  });
  it('finds a band by id', () => {
    expect(findBand(bandInfos(mockMeta, 'config', read), 'moderate')?.label).toBe('Moderate risk');
    expect(findBand(bandInfos(mockMeta, 'config', read), 'nope')).toBeUndefined();
  });
});

describe('segments (legend and gauge)', () => {
  const bands = bandInfos(mockMeta, 'config', read);
  it("use the target's own cut points: they differ by vessel", () => {
    const [lad, rca] = ['LAD', 'RCA'].map((id) =>
      segments(
        bands,
        mockMeta.targets.find((t) => t.id === id)!,
      ),
    );
    expect(lad![0]!.to).toBeCloseTo(0.3069, 3);
    expect(lad![2]!.from).toBeCloseTo(0.7297, 3);
    expect(rca![0]!.to).toBeCloseTo(0.236, 3);
    expect(rca![2]!.from).toBeCloseTo(0.5446, 3);
    expect(lad![0]!.to).not.toBe(rca![0]!.to);
  });
  it('tile 0 to 1 without gaps', () => {
    const s = segments(bands, { rule_out: 0.2, rule_in: 0.6, threshold: 0.4 });
    expect(s[0]!.from).toBe(0);
    expect(s.at(-1)!.to).toBe(1);
    for (let i = 1; i < s.length; i++) expect(s[i]!.from).toBeCloseTo(s[i - 1]!.to, 12);
  });
  it('share the middle span when there are more than three bands', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, label: `B${i}`, color: '#000000', index: i }));
    const s = segments(five, { rule_out: 0.2, rule_in: 0.8, threshold: 0.5 });
    expect(s.map((x) => +x.to.toFixed(2))).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });
});
