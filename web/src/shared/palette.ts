import type { BandMeta, Meta, TargetMeta } from '../api/types';
import { lerpHex } from './color';

export type PaletteMode = 'config' | 'safe';

export interface BandInfo extends BandMeta {
  index: number;
}

export type VarReader = (name: string) => string;

const cssVar: VarReader = (name) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim());

/** The alternative ramp is defined in theme.css as --safe-band-0, --safe-band-1, ... lowest risk first. */
function safeRamp(read: VarReader): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const v = read(`--safe-band-${i}`);
    if (!v) break;
    out.push(v);
  }
  return out;
}

/** n colours along the ramp (interpolated when the config has a different number of bands than the ramp). */
export function safeColors(n: number, read: VarReader = cssVar): string[] {
  const ramp = safeRamp(read);
  if (ramp.length === 0) return [];
  if (n <= 1) return ramp.slice(0, 1);
  return Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * (ramp.length - 1);
    const lo = Math.floor(x);
    const hi = Math.min(ramp.length - 1, lo + 1);
    return lo === hi ? ramp[lo]! : lerpHex(ramp[lo]!, ramp[hi]!, x - lo);
  });
}

/** Bands lowest risk first. Colours come from /meta (config/risk_bands.yaml), or from the safe ramp. */
export function bandInfos(meta: Pick<Meta, 'risk_bands'>, mode: PaletteMode, read: VarReader = cssVar): BandInfo[] {
  const safe = mode === 'safe' ? safeColors(meta.risk_bands.length, read) : [];
  return meta.risk_bands.map((b, index) => ({ ...b, index, color: safe[index] ?? b.color }));
}

export const findBand = (bands: BandInfo[], id: string): BandInfo | undefined => bands.find((b) => b.id === id);

export interface Segment {
  band: BandInfo;
  from: number;
  to: number;
}

/**
 * The target's own band boundaries for a legend or gauge. Cut points differ by target (config/risk_bands.yaml):
 * lowest band below rule_out, highest band from rule_in, anything between shares the span in between.
 */
export function segments(bands: BandInfo[], t: Pick<TargetMeta, 'rule_out' | 'rule_in' | 'threshold'>): Segment[] {
  const n = bands.length;
  if (n === 0) return [];
  const lo = t.rule_out ?? t.threshold ?? 0.33;
  const hi = t.rule_in ?? t.threshold ?? 0.66;
  if (n === 1) return [{ band: bands[0]!, from: 0, to: 1 }];
  if (n === 2)
    return [
      { band: bands[0]!, from: 0, to: t.threshold ?? lo },
      { band: bands[1]!, from: t.threshold ?? lo, to: 1 },
    ];
  const mids = n - 2;
  return bands.map((band, i) => {
    if (i === 0) return { band, from: 0, to: lo };
    if (i === n - 1) return { band, from: hi, to: 1 };
    return { band, from: lo + ((hi - lo) * (i - 1)) / mids, to: lo + ((hi - lo) * i) / mids };
  });
}
