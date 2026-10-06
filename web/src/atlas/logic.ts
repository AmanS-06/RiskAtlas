// Pure logic of the Atlas heart: region manifest, heartbeat curve, artery territories, quality tiers. No three.js here, so it is unit-tested.

export type RegionKind = 'vessel' | 'chamber' | 'great' | 'minor';

export interface RegionDef {
  id: string;
  label: string;
  kind: RegionKind;
  /** glTF node names that make up the region (see web/public/models3d/heart.glb) */
  nodes: string[];
}

/**
 * Every structure of the heart model, grouped into the regions a person can point at. All of them can be identified; only the ones that carry
 * model or patient data are "live" (see liveRegions). LAD, LCX and RCA ids are the mesh names from config/manifest.yaml.
 */
export const REGIONS: readonly RegionDef[] = [
  { id: 'LAD', label: 'Left anterior descending', kind: 'vessel', nodes: ['LAD'] },
  { id: 'LCX', label: 'Left circumflex', kind: 'vessel', nodes: ['LCX'] },
  { id: 'RCA', label: 'Right coronary artery', kind: 'vessel', nodes: ['RCA'] },
  { id: 'left_main', label: 'Left main stem', kind: 'vessel', nodes: ['left_coronary_artery'] },
  { id: 'left_ventricle', label: 'Left ventricle', kind: 'chamber', nodes: ['left_ventricle', 'inferior_papillary_muscle_of_left_ventricle'] },
  {
    id: 'right_ventricle',
    label: 'Right ventricle',
    kind: 'chamber',
    nodes: [
      'right_ventricle',
      'anterior_papillary_muscle_of_right_ventricle',
      'inferior_papillary_muscle_of_right_ventricle',
      'septal_papillary_muscle_of_right_ventricle',
    ],
  },
  { id: 'left_atrium', label: 'Left atrium', kind: 'chamber', nodes: ['left_atrium'] },
  { id: 'right_atrium', label: 'Right atrium', kind: 'chamber', nodes: ['right_atrium'] },
  { id: 'ascending_aorta', label: 'Aorta', kind: 'great', nodes: ['ascending_aorta'] },
  {
    id: 'pulmonary_trunk',
    label: 'Pulmonary artery',
    kind: 'great',
    nodes: ['pulmonary_trunk', 'bifurcation_of_pulmonary_trunk', 'right_pulmonary_artery', 'left_pulmonary_artery'],
  },
  { id: 'superior_vena_cava', label: 'Superior vena cava', kind: 'great', nodes: ['superior_vena_cava'] },
  {
    id: 'pulmonary_veins',
    label: 'Pulmonary veins',
    kind: 'minor',
    nodes: ['left_superior_pulmonary_vein', 'left_inferior_pulmonary_vein', 'right_superior_pulmonary_vein', 'right_inferior_pulmonary_vein'],
  },
];

export const regionById = (id: string): RegionDef | undefined => REGIONS.find((r) => r.id === id);

/** Region that owns a glTF node name, or undefined. */
export function regionOfNode(node: string): RegionDef | undefined {
  return REGIONS.find((r) => r.nodes.includes(node));
}

/**
 * Regions that carry data: the vessel targets from /meta (their `mesh`), plus any region a feature is anchored to (`anchor` in /meta features).
 * Everything else can be named but has nothing to show, and the UI says so rather than inventing a value.
 */
export function liveRegions(vesselMeshes: readonly string[], featureAnchors: readonly (string | null)[]): Set<string> {
  const live = new Set<string>(vesselMeshes);
  for (const a of featureAnchors) if (a && regionById(a)) live.add(a);
  return live;
}

// ---- heartbeat ------------------------------------------------------------

export const BPM = { min: 40, max: 180, rest: 72 } as const;

/** A usable beat rate from the pulse-rate input: out-of-range or missing values fall back to a resting rate. */
export function clampBpm(pr: number | null | undefined): number {
  if (typeof pr !== 'number' || !Number.isFinite(pr) || pr <= 0) return BPM.rest;
  return Math.min(BPM.max, Math.max(BPM.min, pr));
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Smooth 0..1..0 bump between a and b. */
export function bump(p: number, a: number, b: number): number {
  if (p <= a || p >= b) return 0;
  const m = (a + b) / 2;
  return p < m ? smooth((p - a) / (m - a)) : smooth((b - p) / (b - m));
}

export interface BeatPose {
  /** 0..1 contraction of the atria, the ventricles and the aortic recoil, and the "dub" valve-closure flash */
  atria: number;
  ventricle: number;
  aorta: number;
  dub: number;
}

/**
 * One cardiac cycle as a function of phase (0..1): atrial systole, then ventricular systole, then the aortic recoil and a second, smaller
 * beat ("lub-dub") as the valves close. Shown as motion only; there is no sound.
 */
export function beatPose(phase: number): BeatPose {
  const p = ((phase % 1) + 1) % 1;
  return {
    atria: bump(p, 0.0, 0.16),
    ventricle: bump(p, 0.12, 0.4),
    aorta: bump(p, 0.18, 0.5),
    dub: bump(p, 0.4, 0.5),
  };
}

export const BEAT_SCALE = { ventricle: 0.055, atria: 0.04, aorta: 0.035 } as const;

/** Phase advance in seconds for a rate in beats per minute. */
export const beatPeriod = (bpm: number): number => 60 / clampBpm(bpm);

// ---- territories ----------------------------------------------------------

/**
 * Approximate supplied territory: for each muscle vertex, how strongly each artery's course influences it, by distance to sampled artery points.
 * Weights are normalised over the arteries; `cover` is how close the nearest artery is (1 = on it, 0 = far), used to fade the tint where no artery
 * is near. This is an estimate of which artery is nearest, not a measured perfusion territory, and the UI labels it so.
 */
export function territoryWeights(
  vertices: ArrayLike<number>,
  arteries: readonly ArrayLike<number>[],
  sigma: number,
): { weights: Float32Array; cover: Float32Array } {
  const n = Math.floor(vertices.length / 3);
  const k = arteries.length;
  const weights = new Float32Array(n * k);
  const cover = new Float32Array(n);
  const inv = 1 / (2 * sigma * sigma);
  for (let v = 0; v < n; v++) {
    const x = vertices[v * 3]!,
      y = vertices[v * 3 + 1]!,
      z = vertices[v * 3 + 2]!;
    let sum = 0;
    let best = 0;
    for (let a = 0; a < k; a++) {
      const pts = arteries[a]!;
      let d2 = Infinity;
      for (let i = 0; i + 2 < pts.length; i += 3) {
        const dx = x - pts[i]!,
          dy = y - pts[i + 1]!,
          dz = z - pts[i + 2]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < d2) d2 = d;
      }
      const w = Math.exp(-d2 * inv);
      weights[v * k + a] = w;
      sum += w;
      if (w > best) best = w;
    }
    if (sum > 1e-9) for (let a = 0; a < k; a++) weights[v * k + a]! /= sum;
    cover[v] = best;
  }
  return { weights, cover };
}

/** Every `step`-th vertex of a position array, as a flat array: enough points to describe an artery's course. */
export function subsample(positions: ArrayLike<number>, step: number): Float32Array {
  const n = Math.floor(positions.length / 3);
  const out: number[] = [];
  for (let v = 0; v < n; v += Math.max(1, step)) out.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
  return Float32Array.from(out);
}

// ---- quality tiers --------------------------------------------------------

export type QualityTier = 'high' | 'low';

export interface Quality {
  tier: QualityTier;
  bloom: boolean;
  /** upper bound of the device pixel ratio the canvas renders at */
  maxPixelRatio: number;
  /** lite glTF instead of the full model */
  lite: boolean;
  scan: boolean;
  particles: boolean;
}

/** Full effects on a real GPU (the team's machines), a plain but still smooth scene on a software renderer. */
export function qualityFor(software: boolean, override?: QualityTier): Quality {
  const tier: QualityTier = override ?? (software ? 'low' : 'high');
  return tier === 'high'
    ? { tier, bloom: true, maxPixelRatio: 1.5, lite: false, scan: true, particles: true }
    : { tier, bloom: false, maxPixelRatio: 1, lite: true, scan: false, particles: false };
}

/** Auto-downgrade: true when the recent frame times say the machine cannot hold the full effects. */
export function shouldDowngrade(frameMs: readonly number[], budgetMs = 24, minFrames = 90): boolean {
  if (frameMs.length < minFrames) return false;
  const mean = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
  return mean > budgetMs;
}

// ---- adapting to the machine ------------------------------------------------

/** Where the viewer is on its way down (or back up): the share of the full resolution it draws at, the most it may return to, and how far down the ladder it is. */
export interface Adapt {
  scale: number;
  ceiling: number;
  calm: number;
  level: number;
}

export type AdaptAction = 'none' | 'scale-down' | 'scale-up' | 'drop-particles' | 'drop-bloom' | 'stop-rotate';

export const ADAPT = { slowMs: 22, calmMs: 18.5, minScale: 0.55, down: 0.85, up: 1.08, calmEvals: 6 } as const;
const LADDER: AdaptAction[] = ['drop-particles', 'drop-bloom', 'stop-rotate'];

export const initialAdapt = (): Adapt => ({ scale: 1, ceiling: 1, calm: 0, level: 0 });

/**
 * One decision from the mean frame time of the last window. Too slow (below about 45 fps): draw fewer pixels first, since most laptops that struggle are
 * short of GPU fill rate, and only once the picture is already small take effects away one by one. A long calm stretch at the display's own refresh rate
 * lets the resolution creep back up, but never past the size that was too slow before.
 */
export function adaptStep(a: Adapt, meanMs: number): { next: Adapt; action: AdaptAction } {
  if (meanMs > ADAPT.slowMs) {
    if (a.scale > ADAPT.minScale + 1e-6) {
      const scale = Math.max(ADAPT.minScale, a.scale * ADAPT.down);
      return { next: { ...a, scale, ceiling: Math.min(a.ceiling, a.scale * 0.95), calm: 0 }, action: 'scale-down' };
    }
    const action = LADDER[a.level];
    if (!action) return { next: { ...a, calm: 0 }, action: 'none' };
    return { next: { ...a, level: a.level + 1, calm: 0 }, action };
  }
  if (meanMs <= ADAPT.calmMs) {
    const calm = a.calm + 1;
    if (calm >= ADAPT.calmEvals && a.scale < a.ceiling - 1e-6) {
      return { next: { ...a, scale: Math.min(a.ceiling, a.scale * ADAPT.up), calm: 0 }, action: 'scale-up' };
    }
    return { next: { ...a, calm }, action: 'none' };
  }
  return { next: { ...a, calm: 0 }, action: 'none' };
}
