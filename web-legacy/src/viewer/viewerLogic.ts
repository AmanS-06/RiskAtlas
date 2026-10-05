// Pure logic of the viewer (no three.js, no DOM), so it is unit-testable without WebGL.

import type { Band, BodyStyle, FallbackLevel, LabelMode, OverallState, VesselId, VesselState } from './types';

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

// ---- camera framing ---------------------------------------------------------

export type Vec3 = readonly [number, number, number];

/** Default share of the limiting canvas dimension the heart's silhouette fills at the home view (the rest is margin for the label chips and the halo). */
export const FRAME_FILL = 0.88;
export const clampFill = (f: number | undefined): number => (typeof f === 'number' && Number.isFinite(f) ? Math.min(0.98, Math.max(0.5, f)) : FRAME_FILL);

/**
 * The points of a cloud (flat x,y,z array) that are extreme along `directions` evenly spread directions (Fibonacci sphere).
 * They are a small stand-in for the convex hull, which is all a silhouette fit needs: fitting thousands of vertices on every resize
 * would be wasteful, and a bounding sphere or box is 30 to 40 percent too loose for a heart.
 */
export function supportPoints(pos: ArrayLike<number>, directions = 192): Float32Array {
  const n = Math.floor(pos.length / 3);
  if (n === 0) return new Float32Array(0);
  const stride = Math.max(1, Math.ceil(n / 150_000));
  const best = new Int32Array(directions).fill(-1), bestDot = new Float64Array(directions).fill(-Infinity);
  const dx = new Float64Array(directions), dy = new Float64Array(directions), dz = new Float64Array(directions);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < directions; k++) {
    const y = 1 - (2 * (k + 0.5)) / directions, r = Math.sqrt(1 - y * y);
    dx[k] = Math.cos(golden * k) * r; dy[k] = y; dz[k] = Math.sin(golden * k) * r;
  }
  for (let i = 0; i < n; i += stride) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    for (let k = 0; k < directions; k++) {
      const d = x * dx[k] + y * dy[k] + z * dz[k];
      if (d > bestDot[k]) { bestDot[k] = d; best[k] = i; }
    }
  }
  const chosen = [...new Set(best)].filter((i) => i >= 0);
  const out = new Float32Array(chosen.length * 3);
  chosen.forEach((i, j) => { out[j * 3] = pos[i * 3]; out[j * 3 + 1] = pos[i * 3 + 1]; out[j * 3 + 2] = pos[i * 3 + 2]; });
  return out;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Camera basis for a camera at target + dir * distance looking at the target, world up +Y (what THREE's lookAt builds). */
export function cameraBasis(dir: Vec3): { right: Vec3; up: Vec3; back: Vec3 } {
  const back = norm3(dir);
  const worldUp: Vec3 = Math.abs(back[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const right = norm3(cross3(worldUp, back));
  return { right, up: cross3(back, right), back };
}

/** Where the silhouette of `points` lands on screen (NDC, -1..1) for a camera at target + dir * dist. Points behind the camera are skipped; null when none is in front. */
export function projectExtent(points: ArrayLike<number>, dir: Vec3, target: Vec3, dist: number, fovDeg: number, aspect: number): { x0: number; x1: number; y0: number; y1: number } | null {
  const { right, up, back } = cameraBasis(dir);
  const tanV = Math.tan((fovDeg * Math.PI) / 360), tanH = tanV * Math.max(0.05, aspect);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const rel = sub3([points[i], points[i + 1], points[i + 2]], target);
    const depth = dist - dot3(rel, back);
    if (depth <= 1e-6) continue;
    const x = dot3(rel, right) / (depth * tanH), y = dot3(rel, up) / (depth * tanV);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return x0 === Infinity ? null : { x0, x1, y0, y1 };
}

/**
 * Smallest camera distance at which every point of the cloud lies within `fill` (0..1) of the half-extent of the canvas, horizontally and
 * vertically (perspective included), for a camera looking at `target` from direction `dir`. With `centre`, the look-at point is first moved in
 * the screen plane so the silhouette sits in the middle of the canvas (the heart plus its aorta is not symmetric about its bounding-box centre).
 * Exact for a given target; the centring needs a few passes because the shift changes the perspective a little.
 */
export function fitPoints(points: ArrayLike<number>, dir: Vec3, target: Vec3, fovDeg: number, aspect: number, fill = FRAME_FILL, centre = false): { dist: number; target: Vec3 } {
  const f = clampFill(fill);
  const { right, up, back } = cameraBasis(dir);
  const tanV = Math.tan((fovDeg * Math.PI) / 360), tanH = tanV * Math.max(0.05, aspect);
  const need = (t: Vec3): number => {
    let d = 0;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const rel = sub3([points[i], points[i + 1], points[i + 2]], t);
      d = Math.max(d, dot3(rel, back) + Math.max(Math.abs(dot3(rel, right)) / (f * tanH), Math.abs(dot3(rel, up)) / (f * tanV)));
    }
    return d;
  };
  let t = target, dist = need(t);
  if (centre && points.length >= 3) {
    for (let pass = 0; pass < 6; pass++) {
      const e = projectExtent(points, dir, t, dist, fovDeg, aspect);
      if (!e) break;
      const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
      if (Math.abs(cx) < 1e-4 && Math.abs(cy) < 1e-4) break;
      t = [t[0] + (right[0] * cx * tanH + up[0] * cy * tanV) * dist, t[1] + (right[1] * cx * tanH + up[1] * cy * tanV) * dist, t[2] + (right[2] * cx * tanH + up[2] * cy * tanV) * dist];
      dist = need(t);
    }
  }
  return { dist: Math.max(dist, 1e-3), target: t };
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

// ---- appearance: neutral body, vessel legibility ---------------------------

/**
 * Body colours of bodyStyle 'neutral': a muted slate blue-grey (chroma well below any band colour). Mid-dark on purpose: the three band colours span
 * the lightness range of a mid-light body (amber and green sit at L* 62 to 70), whereas against a slate body each of them is lighter or
 * more saturated, and it still shows against both the light and the dark app background. `chamber` = atria and ventricles, `other` = great vessels and everything else that is not a scored artery, `stem` = the unscored left main stem
 * (a darker grey, so it reads as an artery without taking a risk colour). A viewer constant, not data: risk colours always come from the app (config/risk_bands.yaml).
 * Measured against the three config band colours in the browser tests (pixel read-back, CIE76 delta E).
 */
export const BODY_NEUTRAL = { chamber: '#728092', other: '#909aaa', stem: '#4c5461' } as const;

/** Vessel legibility. `inflate` = outward shift of the artery surface along its smooth normal, model units (the heart is ~1 unit wide;
 *  arteries are 0.01 to 0.05 wide, so 0.006 about doubles the thinnest branches). `edge` = permanent dark outline thickness added on top of
 *  inflate. `rim` = strength of the view-dependent rim light (fresnel) in the vessel's own, lightened colour. `ghost` = opacity of the
 *  see-through copy drawn where the heart wall hides a vessel. `lift` = view-space shift toward the camera (model units) so an artery that is slightly buried in the heart surface still draws. `lowPowerScale` multiplies `lift` for the coarse lite model, whose arteries sit deeper in the surface. `proceduralScale` multiplies inflate and edge for the built-in schematic heart, whose arteries are much thinner. */
export const VESSEL_LOOK: Readonly<{ inflate: number; edge: number; edgeColor: string; rim: number; ghost: number; lift: number; lowPowerScale: number; proceduralScale: number }> = { inflate: 0.006, edge: 0.0025, edgeColor: '#0c1016', rim: 0.45, ghost: 0.32, lift: 0.02, lowPowerScale: 1.5, proceduralScale: 0.35 };

/** Colour of an artery that has no prediction yet. Neutral body: a light grey, clearly lighter than the slate body and without any hue, so it cannot be mistaken for a risk colour. */
export const UNSCORED_VESSEL = { neutral: '#c9ced6', natural: '#9e9ea3' } as const;

/** Share of the overall-glow chamber tint kept in the neutral body (the halo behind the heart carries the overall state; a strong tint would make the grey body pink again). */
export const NEUTRAL_TINT_SHARE = 0.35;

/** Colour of a body mesh. `natural` keeps the GLB colour (null = caller keeps its own). */
export function bodyColor(style: BodyStyle, meshName: string): string | null {
  if (style === 'natural') return null;
  if (/atrium|ventricle/.test(meshName)) return BODY_NEUTRAL.chamber;
  return /^left_coronary_artery$/.test(meshName) ? BODY_NEUTRAL.stem : BODY_NEUTRAL.other;
}

// ---- perceptual colour (CIE L*a*b*), colour-vision-deficiency simulation -----

const toLin3 = (hex: string): [number, number, number] => {
  const c = parseHex(hex);
  return c ? [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)] : [0, 0, 0];
};

/** CIE L*a*b* (D65) of an sRGB colour given as hex or as 0..255 channels. */
export function rgbToLab(rgb: string | readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = typeof rgb === 'string' ? toLin3(rgb) : (rgb.map((v) => srgbToLinear(v / 255)) as [number, number, number]);
  const xyz = [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883,
  ];
  const f = xyz.map((t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** CIE76 delta E (the measure used by web/scripts/cvd_check.mjs). Below about 20 two colours are hard to tell apart in a small, shaded patch. */
export function deltaE(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Machado et al. 2009, severity 1.0, applied in linear sRGB (same matrices as web/scripts/cvd_check.mjs). */
export const CVD_MATRICES = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
export type Vision = 'normal' | keyof typeof CVD_MATRICES;

/** The colour as seen with the given colour-vision deficiency, 0..255 channels. */
export function simulateVision(rgb: readonly [number, number, number], kind: Vision): [number, number, number] {
  if (kind === 'normal') return [rgb[0], rgb[1], rgb[2]];
  const lin = rgb.map((v) => srgbToLinear(v / 255));
  return CVD_MATRICES[kind].map((row) => 255 * linearToSrgb(Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])))) as [number, number, number];
}

// ---- in-canvas labels ---------------------------------------------------------

/** Text of a vessel label. 'risk' adds the probability when the vessel has a state; null = no label. */
export function labelText(id: VesselId, s: VesselState | undefined, mode: LabelMode): string | null {
  if (mode === 'off') return null;
  if (mode === 'risk' && s) return `${id} ${Math.round(clamp01(s.probability) * 100)}%`;
  return id;
}

export interface LabelPlacement { x: number; y: number; angle: number; length: number }

/**
 * Where a label chip sits relative to its anchor on the artery: pushed `gap` px away from the heart's screen centre, so the
 * chip does not cover the vessel it names, then clamped so the whole chip (w x h, centred on the returned point) stays inside the
 * container. `angle` and `length` describe the leader line from the anchor to the chip centre.
 */
export function labelPlacement(anchor: { x: number; y: number }, centre: { x: number; y: number }, chip: { w: number; h: number }, box: { w: number; h: number }, gap = 26): LabelPlacement {
  let dx = anchor.x - centre.x, dy = anchor.y - centre.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = 0; dy = -1; } else { dx /= d; dy /= d; }
  // distance along (dx,dy) at which a chip of this size no longer overlaps the anchor point
  const reach = Math.abs(dx) * chip.w / 2 + Math.abs(dy) * chip.h / 2 + gap * 0.45;
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const x = clamp(anchor.x + dx * reach, chip.w / 2 + 2, box.w - chip.w / 2 - 2);
  const y = clamp(anchor.y + dy * reach, chip.h / 2 + 2, box.h - chip.h / 2 - 2);
  return { x, y, angle: Math.atan2(y - anchor.y, x - anchor.x), length: Math.hypot(x - anchor.x, y - anchor.y) };
}

/**
 * Picks the chip position among 8 directions x 3 distances around the anchor that covers the fewest obstacle points (screen positions of
 * vessel vertices, so the chip does not hide any artery), does not overlap chips already placed, stays inside the box, and otherwise
 * prefers the direction away from the heart centre and a short leader line. Greedy, deterministic.
 */
export function chooseLabelSpot(anchor: { x: number; y: number }, centre: { x: number; y: number }, chip: { w: number; h: number }, box: { w: number; h: number },
  obstacles: readonly { x: number; y: number }[], taken: readonly ChipRect[] = [], gap = 26): LabelPlacement {
  const outward = Math.atan2(anchor.y - centre.y, anchor.x - centre.x);
  let best: { x: number; y: number; cost: number } | null = null;
  const m = 3; // margin around the chip that must be free of vessel pixels
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, dx = Math.cos(a), dy = Math.sin(a);
    const reach = Math.abs(dx) * chip.w / 2 + Math.abs(dy) * chip.h / 2 + gap * 0.45;
    for (const extra of [0, 16, 36]) {
      const cx0 = anchor.x + dx * (reach + extra), cy0 = anchor.y + dy * (reach + extra);
      const cx = Math.min(box.w - chip.w / 2 - 2, Math.max(chip.w / 2 + 2, cx0)), cy = Math.min(box.h - chip.h / 2 - 2, Math.max(chip.h / 2 + 2, cy0));
      let cost = Math.hypot(cx - cx0, cy - cy0) * 0.5 + (1 - Math.cos(a - outward)) * 4 + extra * 0.05;
      for (const o of obstacles) if (Math.abs(o.x - cx) < chip.w / 2 + m && Math.abs(o.y - cy) < chip.h / 2 + m) cost += 1;
      for (const t of taken) if (Math.abs(t.x - cx) < (t.w + chip.w) / 2 + 2 && Math.abs(t.y - cy) < (t.h + chip.h) / 2 + 2) cost += 60;
      if (!best || cost < best.cost) best = { x: cx, y: cy, cost };
    }
  }
  const b = best!;
  return { x: b.x, y: b.y, angle: Math.atan2(b.y - anchor.y, b.x - anchor.x), length: Math.hypot(b.x - anchor.x, b.y - anchor.y) };
}

export interface ChipRect { x: number; y: number; w: number; h: number } // centre and size

/**
 * Pushes overlapping label chips apart (vertically, the smaller overlap axis of a horizontal label row) and keeps them inside `box`.
 * Order is stable: with equal y the earlier chip stays above. Returns new centres; inputs are not modified.
 */
export function separateChips(chips: readonly ChipRect[], box: { w: number; h: number }, pad = 3): { x: number; y: number }[] {
  const out = chips.map((c) => ({ x: c.x, y: c.y }));
  const lo = (c: ChipRect) => c.h / 2 + 2, hi = (c: ChipRect) => box.h - c.h / 2 - 2;
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const dx = Math.abs(out[i].x - out[j].x), dy = out[j].y - out[i].y;
        const needX = (chips[i].w + chips[j].w) / 2 + pad, needY = (chips[i].h + chips[j].h) / 2 + pad;
        if (dx >= needX || Math.abs(dy) >= needY) continue;
        const push = (needY - Math.abs(dy)) / 2 + 0.5;
        const dir = dy >= 0 ? 1 : -1; // j goes further the way it already lies from i
        out[i].y = Math.min(hi(chips[i]), Math.max(lo(chips[i]), out[i].y - dir * push));
        out[j].y = Math.min(hi(chips[j]), Math.max(lo(chips[j]), out[j].y + dir * push));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
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
