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
  /**
   * Colour of everything that is not a coronary artery. 'neutral' (default): a muted blue-grey, so the three risk colours are
   * the only saturated colours in the scene. 'natural': the pink of the GLB. Never carries risk information.
   */
  bodyStyle?: BodyStyle;
  /**
   * Visual calibre exaggeration of the arteries: the vessel surface is pushed outward by `vesselBoost * 0.006` model units
   * (heart ~1 unit wide), so thin branches stay visible at default zoom. Default 1; 0 draws the arteries at modelled size.
   * Purely cosmetic: picking, anchors and the triangle budget are unaffected.
   */
  vesselBoost?: number;
  /** In-canvas vessel labels (DOM, aria-hidden): 'risk' (default) = "LAD 76%", 'name' = "LAD", 'off'. Hidden for a vessel the heart wall fully hides. */
  labels?: LabelMode;
  /** Draw a faint see-through copy of arteries where the heart wall hides them, so all three stay visible from any side. Default: true, except in low-power mode (software GL), where the extra pass is skipped. */
  showHidden?: boolean;
  /**
   * How much of the limiting canvas dimension (the shorter one, after the aspect ratio) the heart's silhouette, aorta and arteries included, fills
   * at the home view, 0.5 to 0.98. Default 0.88: the remaining ~6% each side keeps the label chips and the halo inside the canvas. The camera is
   * re-fitted to this on every resize and on resetView(); see docs/viewer.md "Framing".
   */
  fill?: number;
}

export type BodyStyle = 'neutral' | 'natural';
export type LabelMode = 'off' | 'name' | 'risk';

export type FallbackLevel = 'none' | 'lite' | 'procedural';

export interface ViewerStatus {
  loaded: boolean;
  usingFallback: FallbackLevel;
  webgl: boolean;
  triangles: number;
  /** Frames per second measured while the scene was continuously redrawn (orbiting, tween); undefined when idle. */
  fps?: number;
}

/** Diagnostic snapshot of the camera framing (see HeartViewer.getFraming). */
export interface ViewerFraming {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** Camera distance now, and the distance the auto-fit chose for the current orbit angle. */
  distance: number;
  autoDistance: number;
  /** Unit vector from the orbit centre to the camera (the orbit angle). */
  direction: [number, number, number];
  /** true while the camera is still at the auto-fit distance (so a resize re-fits it); false after the user zoomed or selected a vessel. */
  fitted: boolean;
  /** Projected silhouette of the model (arteries and aorta included) in CSS px from the canvas's top-left; null before a model is loaded. */
  silhouette: { x0: number; y0: number; x1: number; y1: number } | null;
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
