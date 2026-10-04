// Pure logic of the viewer (no three.js, no DOM), so it is unit-testable without WebGL.

import type { Band, FallbackLevel, OverallState, VesselId, VesselState } from './types';

/** The vessels the viewer scores. Must equal the `mesh` names in config/manifest.yaml; checked against the loaded model's node names. */
export const VESSEL_IDS: readonly VesselId[] = ['LAD', 'LCX', 'RCA'];

export function isVesselId(x: unknown): x is VesselId {
  return typeof x === 'string' && (VESSEL_IDS as readonly string[]).includes(x);
}

/** Vessel ids whose node is missing from the loaded model's node names. */
export function missingVesselNodes(nodeNames: Iterable<string>, ids: readonly string[] = VESSEL_IDS): string[] {
  const have = new Set(nodeNames);
  return ids.filter((id) => !have.has(id));
}

// ---- colour --------------------------------------------------------------

export interface RGB { r: number; g: number; b: number } // sRGB, 0..1

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function toHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Relative luminance (Rec. 709 weights on linear light) of an sRGB colour. */
export function luminance({ r, g, b }: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

// ---- uncertainty ---------------------------------------------------------

/**
 * Uncertainty width (10th-90th percentile interval, 0..1) to desaturation amount (0..MAX).
 *   t = clamp((width - CRISP) / (FULL - CRISP), 0, 1)
 *   amount = MAX * smoothstep(t)
 * Widths up to CRISP are drawn crisp; FULL and wider get the maximum desaturation.
 * MAX < 1 keeps some hue, so a very uncertain vessel can still be told apart by band.
 */
export const UNCERTAINTY = { CRISP: 0.05, FULL: 0.35, MAX: 0.8 } as const;

export function desaturationAmount(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width)) return 0;
  const t = Math.min(1, Math.max(0, (width - UNCERTAINTY.CRISP) / (UNCERTAINTY.FULL - UNCERTAINTY.CRISP)));
  return UNCERTAINTY.MAX * t * t * (3 - 2 * t);
}

/**
 * Colour actually drawn for a vessel: the supplied colour mixed toward the grey of equal luminance, in linear light:
 *   c' = c + (Y(c) - c) * amount          (per linear channel, Y = relative luminance)
 * Luminance is unchanged, so desaturation never changes how light or dark the vessel is.
 */
export function applyUncertainty(hex: string, width: number | undefined): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const a = desaturationAmount(width);
  if (a === 0) return toHex(rgb);
  const lin = [srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b)];
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const [r, g, b] = lin.map((v) => linearToSrgb(v + (y - v) * a));
  return toHex({ r, g, b });
}

// ---- emphasis ------------------------------------------------------------

/** Emissive strength of a vessel material (multiplies the vessel colour). Selection adds an outline and a pulse on top. */
export const EMISSIVE = { base: 0.3, hover: 0.5, selected: 0.7, pulseExtra: 0.35 } as const;

/** Pulse: number of cycles and period, ms. After the last cycle the vessel stays at the steady selected level. */
export const PULSE = { cycles: 3, periodMs: 700 } as const;

export function pulseExtra(elapsedMs: number, reduced: boolean): number {
  if (reduced) return 0;
  const total = PULSE.cycles * PULSE.periodMs;
  if (elapsedMs < 0 || elapsedMs >= total) return 0;
  return EMISSIVE.pulseExtra * 0.5 * (1 - Math.cos((2 * Math.PI * elapsedMs) / PULSE.periodMs));
}

export function pulseActive(elapsedMs: number, reduced: boolean): boolean {
  return !reduced && elapsedMs >= 0 && elapsedMs < PULSE.cycles * PULSE.periodMs;
}

// ---- overall (heart-level) glow -------------------------------------------

export interface Glow { color: string; probability: number; source: 'overall' | VesselId }

const BAND_RANK: Record<Band, number> = { low: 0, moderate: 1, high: 2 };

/**
 * Heart-level glow = the strongest of the overall CAD state and every scored vessel. "Strongest" is the higher band
 * (low < moderate < high), then the higher probability; ties go to the overall state. The glow takes that entity's
 * colour, and the highest probability among all of them for its intensity, so it is never visually weaker than any vessel
 * in colour severity or in strength. Bands are compared as well as probabilities because each target has its own cut
 * points (`rule_out` / `rule_in`): a vessel can be in a higher band than CAD even though P(vessel) <= P(CAD).
 * No overall state (null) means no glow.
 */
export function overallGlow(overall: OverallState | null, vessels: Partial<Record<VesselId, VesselState>>): Glow | null {
  if (!overall) return null;
  const rank = (band: Band) => BAND_RANK[band] ?? 0;
  let best: Glow = { color: overall.color, probability: clamp01(overall.probability), source: 'overall' };
  let bestRank = rank(overall.band), bestP = best.probability, maxP = best.probability;
  for (const id of VESSEL_IDS) {
    const v = vessels[id];
    if (!v) continue;
    const p = clamp01(v.probability), r = rank(v.band);
    maxP = Math.max(maxP, p);
    if (r > bestRank || (r === bestRank && p > bestP)) { best = { color: v.color, probability: p, source: id }; bestRank = r; bestP = p; }
  }
  return { ...best, probability: maxP };
}

/**
 * Halo opacity, halo size (times the heart radius) and chamber tint for a glow probability. Both opacity and size grow
 * with probability, so the halo also reads without colour (bigger and denser = riskier).
 */
export const GLOW = { haloMin: 0.2, haloMax: 0.95, sizeMin: 2.1, sizeMax: 3.0, tintMin: 0.05, tintMax: 0.22, lowPowerTintBoost: 1.6 } as const;
export const glowHalo = (p: number) => GLOW.haloMin + (GLOW.haloMax - GLOW.haloMin) * clamp01(p);
export const glowSize = (p: number) => GLOW.sizeMin + (GLOW.sizeMax - GLOW.sizeMin) * clamp01(p);
export const glowTint = (p: number) => GLOW.tintMin + (GLOW.tintMax - GLOW.tintMin) * clamp01(p);

export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

// ---- selection -----------------------------------------------------------

/** Selection state machine. Invalid ids are rejected; selecting the current value is not a change. */
export class SelectionModel {
  private current: VesselId | null = null;
  get selected(): VesselId | null { return this.current; }
  /** Returns true when the selection changed. */
  select(id: VesselId | null): boolean {
    if (id !== null && !isVesselId(id)) return false;
    if (id === this.current) return false;
    this.current = id;
    return true;
  }
}

export class Emitter<T> {
  private cbs = new Set<(v: T) => void>();
  get size(): number { return this.cbs.size; }
  on(cb: (v: T) => void): () => void {
    this.cbs.add(cb);
    return () => { this.cbs.delete(cb); };
  }
  emit(v: T): void {
    for (const cb of [...this.cbs]) {
      try { cb(v); } catch (e) { console.error('[HeartViewer] listener threw', e); }
    }
  }
  clear(): void { this.cbs.clear(); }
}

// ---- keyboard ------------------------------------------------------------

export type KeyAction =
  | { type: 'select'; id: VesselId }
  | { type: 'clear' }
  | { type: 'rotate'; dAzimuth: number; dPolar: number }
  | { type: 'zoom'; factor: number }
  | { type: 'reset' };

export const KEY_STEP = { rotate: 0.12, zoomIn: 0.88, zoomOut: 1 / 0.88 } as const;

/** Keys: 1..n select the n-th vessel, Escape clears, arrows rotate, +/- zoom, 0 resets. Ctrl/Alt/Meta combos are left to the browser. */
export function keyAction(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }, ids: readonly VesselId[] = VESSEL_IDS): KeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = e.key;
  if (/^[1-9]$/.test(k)) {
    const id = ids[Number(k) - 1];
    return id ? { type: 'select', id } : null;
  }
  switch (k) {
    case 'Escape': return { type: 'clear' };
    case 'ArrowLeft': return { type: 'rotate', dAzimuth: -KEY_STEP.rotate, dPolar: 0 };
    case 'ArrowRight': return { type: 'rotate', dAzimuth: KEY_STEP.rotate, dPolar: 0 };
    case 'ArrowUp': return { type: 'rotate', dAzimuth: 0, dPolar: -KEY_STEP.rotate };
    case 'ArrowDown': return { type: 'rotate', dAzimuth: 0, dPolar: KEY_STEP.rotate };
    case '+': case '=': return { type: 'zoom', factor: KEY_STEP.zoomIn };
    case '-': case '_': return { type: 'zoom', factor: KEY_STEP.zoomOut };
    case '0': return { type: 'reset' };
    default: return null;
  }
}

// ---- model loading / fallback ----------------------------------------------

export interface LoadStep { level: FallbackLevel; url?: string }

/** Order of attempts. Normal: standard, lite, procedural. lowPower (and a lite url): lite, standard, procedural. */
export function planLoadSteps(o: { modelUrl: string; liteModelUrl?: string; lowPower: boolean }): LoadStep[] {
  const std: LoadStep = { level: 'none', url: o.modelUrl };
  const lite: LoadStep | null = o.liteModelUrl ? { level: 'lite', url: o.liteModelUrl } : null;
  const steps = lite ? (o.lowPower ? [lite, std] : [std, lite]) : [std];
  return [...steps, { level: 'procedural' }];
}

export type LoadOutcome<T> = { ok: true; level: FallbackLevel; value: T } | { ok: false; errors: unknown[] };

/** Try each step in order; the first loader that resolves wins. Never rejects. */
export async function runLoadChain<T>(steps: LoadStep[], loader: (s: LoadStep) => Promise<T>, onError?: (s: LoadStep, e: unknown) => void): Promise<LoadOutcome<T>> {
  const errors: unknown[] = [];
  for (const s of steps) {
    try {
      return { ok: true, level: s.level, value: await loader(s) };
    } catch (e) {
      errors.push(e);
      onError?.(s, e);
    }
  }
  return { ok: false, errors };
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ---- rendering budget ------------------------------------------------------

export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

export interface RenderBudget { maxPixelRatio: number; maxPixels: number }

/** Pixel-ratio cap and drawing-buffer pixel budget. Beyond the budget the canvas is rendered smaller and scaled up by CSS. */
export function renderBudget(lowPower: boolean): RenderBudget {
  return lowPower ? { maxPixelRatio: 1, maxPixels: 800_000 } : { maxPixelRatio: 1.5, maxPixels: 1_800_000 };
}

export function computePixelRatio(cssW: number, cssH: number, devicePixelRatio: number, b: RenderBudget): number {
  const area = Math.max(1, cssW * cssH);
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(0.25, Math.min(dpr, b.maxPixelRatio, Math.sqrt(b.maxPixels / area)));
}

/** Camera distance at which a sphere of `radius` fits the view in both directions (fov in degrees, vertical). */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * Math.max(0.05, aspect));
  return radius / Math.sin(Math.min(v, h));
}

// ---- picking geometry -------------------------------------------------------

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a 2D triangle (screen pixels); 0 when the point is inside. Used to find vessels near the pointer. */
export function pointTriangleDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const s1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const s2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const s3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = s1 < 0 || s2 < 0 || s3 < 0, pos = s1 > 0 || s2 > 0 || s3 > 0;
  if (!(neg && pos)) return 0;
  return Math.min(segmentDistance(px, py, ax, ay, bx, by), segmentDistance(px, py, bx, by, cx, cy), segmentDistance(px, py, cx, cy, ax, ay));
}

// ---- frame-rate meter ------------------------------------------------------

/** Median-based fps over the last frames. Gaps over 250 ms (idle, then a new interaction) are not frame intervals and are skipped. */
export class FrameMeter {
  private last = 0;
  private dts: number[] = [];
  constructor(private readonly keep = 30) {}
  tick(nowMs: number): void {
    if (this.last > 0) {
      const dt = nowMs - this.last;
      if (dt > 0 && dt <= 250) {
        this.dts.push(dt);
        if (this.dts.length > this.keep) this.dts.shift();
      } else if (dt > 250) {
        this.dts.length = 0;
      }
    }
    this.last = nowMs;
  }
  /** fps, or undefined with fewer than 5 intervals or when the last frame is older than `staleMs`. */
  fps(nowMs: number, staleMs = 1000): number | undefined {
    if (this.dts.length < 5 || nowMs - this.last > staleMs) return undefined;
    const s = [...this.dts].sort((a, b) => a - b);
    const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return 1000 / med;
  }
  reset(): void { this.last = 0; this.dts.length = 0; }
}

// ---- tween -----------------------------------------------------------------

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Eased progress 0..1 of a tween; jumps to 1 when motion is reduced. */
export function tweenProgress(elapsedMs: number, durationMs: number, reduced: boolean): number {
  if (reduced || durationMs <= 0) return 1;
  return easeInOutCubic(Math.min(1, Math.max(0, elapsedMs / durationMs)));
}

// ---- text ------------------------------------------------------------------

export const ARIA_LABEL =
  'Interactive 3D heart with the coronary arteries LAD, LCX and RCA. Keys: 1, 2 or 3 select an artery, Escape clears the selection, arrow keys rotate, plus and minus zoom, 0 resets the view.';

export function describeVessel(id: VesselId, s: VesselState | undefined): string {
  if (!s) return `${id} selected. No prediction yet.`;
  const pct = Math.round(clamp01(s.probability) * 100);
  return `${id} selected. ${s.band} risk, probability ${pct} percent.`;
}

export function describeSummary(states: Partial<Record<VesselId, VesselState>>): string {
  const parts = VESSEL_IDS.filter((id) => states[id]).map((id) => `${id}: ${states[id]!.band} risk (${Math.round(clamp01(states[id]!.probability) * 100)}%)`);
  return parts.length ? parts.join('; ') : 'No prediction yet.';
}
