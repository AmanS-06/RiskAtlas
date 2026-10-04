// Public types of the 3D viewer. Re-exported from HeartViewer.ts.

export type Band = 'low' | 'moderate' | 'high';
export type VesselId = 'LAD' | 'LCX' | 'RCA';

export interface VesselState {
  probability: number;
  band: Band;
  /** css hex chosen by the app from config/risk_bands.yaml */
  color: string;
  /** 0..1 (targets.<T>.uncertainty.width). Narrow = crisp, wide = desaturated. */
  uncertaintyWidth?: number;
}

export interface OverallState {
  probability: number;
  band: Band;
  color: string;
}

export interface HeartViewerOptions {
  container: HTMLElement;
  modelUrl: string;
  liteModelUrl?: string;
  /** Prefer the lite model, no antialiasing, pixel ratio 1. Default: auto (true on software GL). */
  lowPower?: boolean;
  /** No damping, no camera tweens, no pulse. Default: the OS prefers-reduced-motion setting. */
  reducedMotion?: boolean;
}

export type FallbackLevel = 'none' | 'lite' | 'procedural';

export interface ViewerStatus {
  loaded: boolean;
  usingFallback: FallbackLevel;
  webgl: boolean;
  triangles: number;
  /** Frames per second measured while the scene was continuously redrawn (orbiting, tween); undefined when idle. */
  fps?: number;
}

/** A feature callout to pin to a mesh node (config/features.yaml `anchor`). */
export interface AnchorSpec {
  key: string;
  node: string;
}

/** Screen position of an anchor, CSS px relative to the container's top-left corner. */
export interface ScreenAnchor {
  key: string;
  node: string;
  x: number;
  y: number;
  /** false when the node does not exist, the point is off screen, or it is on the far side of the heart (near-hemisphere test; no occlusion test). */
  visible: boolean;
}
