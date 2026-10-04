import type { FeatureMeta, Inputs, Meta } from '../api/types';
import { formatUnit, num } from '../shared/format';

// Everything about the input form is derived from /meta: control type, options, bounds and hints.

export type FieldKind = 'binary' | 'select' | 'number';

export interface Option {
  value: number;
  label: string;
}

export interface FieldSpec {
  feature: FeatureMeta;
  kind: FieldKind;
  options: Option[];
  /** Hard plausibility window: values outside it are rejected. */
  bounds: { min: number; max: number } | null;
  integer: boolean;
  step: number;
}

export type Raw = Record<string, string>;

export interface Check {
  level: 'ok' | 'error' | 'warn';
  message: string;
}

const OK: Check = { level: 'ok', message: '' };

const labelFor = (key: string, code: number) => (key.length ? `${key} (${num(code)})` : String(code));

export function fieldSpec(f: FeatureMeta): FieldSpec {
  let kind: FieldKind = 'number';
  let options: Option[] = [];
  if (f.type === 'binary') {
    kind = 'binary';
  } else if (f.map) {
    kind = 'select';
    options = Object.entries(f.map)
      .map(([k, v]) => ({ value: v, label: labelFor(k, v) }))
      .sort((a, b) => a.value - b.value);
  } else if (f.type === 'categorical' && f.allowed && f.allowed.length > 0) {
    kind = 'select';
    options = f.allowed.map((v) => ({ value: v, label: String(v) }));
  }
  const integer =
    kind !== 'number' ||
    (!!f.stats &&
      Number.isInteger(f.stats.min) &&
      Number.isInteger(f.stats.max) &&
      Number.isInteger(f.stats.median) &&
      f.stats.std > 0 &&
      f.stats.max - f.stats.min <= 10);
  let bounds: FieldSpec['bounds'] = null;
  if (f.stats && kind === 'number') {
    const span = f.stats.max - f.stats.min || Math.abs(f.stats.max) || 1;
    bounds = { min: f.stats.min >= 0 ? Math.max(0, f.stats.min - span) : f.stats.min - span, max: f.stats.max + span };
  }
  const step = integer ? 1 : f.stats ? niceStep(f.stats.max - f.stats.min) : 0.1;
  return { feature: f, kind, options, bounds, integer, step };
}

function niceStep(span: number): number {
  if (span >= 100) return 1;
  if (span >= 10) return 0.1;
  return 0.01;
}

export function specs(meta: Pick<Meta, 'features'>): FieldSpec[] {
  return meta.features.map(fieldSpec);
}

/** Reference-range position, used for a hint next to the control. */
export function rangeStatus(f: FeatureMeta, v: number): 'low' | 'normal' | 'high' | null {
  if (!f.range) return null;
  return v < f.range[0] ? 'low' : v > f.range[1] ? 'high' : 'normal';
}

export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/** Validates one raw field value. Blank is always fine: the model estimates it. */
export function check(spec: FieldSpec, raw: string | undefined): Check {
  if (raw === undefined || raw.trim() === '') return OK;
  const { feature: f } = spec;
  const v = parseNumber(raw);
  if (v === null || Number.isNaN(v)) return { level: 'error', message: 'Enter a number.' };
  if (spec.kind !== 'number') {
    const allowed = spec.kind === 'binary' ? [0, 1] : spec.options.map((o) => o.value);
    return allowed.includes(v) ? OK : { level: 'error', message: `Choose one of the listed values.` };
  }
  if (spec.integer && !Number.isInteger(v)) return { level: 'error', message: 'Enter a whole number.' };
  const u = formatUnit(f.unit);
  if (spec.bounds && (v < spec.bounds.min || v > spec.bounds.max)) {
    return { level: 'error', message: `Not plausible: expected ${num(spec.bounds.min)} to ${num(spec.bounds.max)}${u ? ' ' + u : ''}.` };
  }
  if (f.stats && (v < f.stats.min || v > f.stats.max)) {
    return { level: 'warn', message: `Outside the training range (${num(f.stats.min)} to ${num(f.stats.max)}): the estimate extrapolates.` };
  }
  return OK;
}

export interface Parsed {
  inputs: Inputs;
  errors: Record<string, string>;
  filled: number;
}

/** Raw form state to the flat inputs dict. Blank fields are null (missing). Invalid fields are reported, not sent. */
export function parseForm(all: FieldSpec[], raw: Raw): Parsed {
  const inputs: Inputs = {};
  const errors: Record<string, string> = {};
  let filled = 0;
  for (const s of all) {
    const r = raw[s.feature.name];
    const c = check(s, r);
    if (c.level === 'error') {
      errors[s.feature.name] = c.message;
      continue;
    }
    const v = r === undefined ? null : parseNumber(r);
    inputs[s.feature.name] = v === null || Number.isNaN(v) ? null : v;
    if (inputs[s.feature.name] !== null) filled += 1;
  }
  return { inputs, errors, filled };
}

/** Number to the string the form shows. */
export function toRaw(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '' : String(Number(v.toFixed(4)));
}

export function rawFrom(values: Record<string, number | null | undefined>, all: FieldSpec[]): Raw {
  const raw: Raw = {};
  for (const s of all) {
    const v = values[s.feature.name];
    if (v !== undefined && v !== null) raw[s.feature.name] = toRaw(v);
  }
  return raw;
}

export function groupTitle(group: string): string {
  if (group.length <= 3) return group.toUpperCase();
  return group.charAt(0).toUpperCase() + group.slice(1);
}

export function byGroup(all: FieldSpec[], groups: string[]): { group: string; specs: FieldSpec[] }[] {
  return groups.map((group) => ({ group, specs: all.filter((s) => s.feature.group === group) })).filter((g) => g.specs.length > 0);
}

/** How a raw field value reads to a person: Yes, No, a map label, or a number with its unit. null when blank. */
export function valueLabel(spec: FieldSpec, raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const v = parseNumber(raw);
  if (v === null || Number.isNaN(v)) return null;
  if (spec.kind === 'binary') return v === 1 ? 'Yes' : 'No';
  if (spec.kind === 'select') return spec.options.find((o) => o.value === v)?.label ?? num(v);
  const u = formatUnit(spec.feature.unit);
  return `${num(v)}${u ? (u === '%' ? '' : ' ') + u : ''}`;
}
