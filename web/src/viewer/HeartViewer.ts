// HeartViewer: framework-free 3D heart with colour-coded LAD / LCX / RCA. Vanilla three.js.
// Contract and behaviour: docs/viewer.md. Pure logic (colour maths, selection, keys, fallback order) is in viewerLogic.ts.
//
// Rendering is on demand: a frame is scheduled only when something changed (camera damping, tween, pulse, new state,
// resize), so an idle page costs nothing. There is no standing requestAnimationFrame loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AnchorSpec, BodyStyle, FallbackLevel, HeartViewerOptions, LabelMode, OverallState, ScreenAnchor, ViewerFraming, ViewerStatus, VesselId, VesselState } from './types';
import {
  ARIA_LABEL, EMISSIVE, Emitter, FrameMeter, NEUTRAL_TINT_SHARE, SelectionModel, UNSCORED_VESSEL, VESSEL_IDS, VESSEL_LOOK, applyUncertainty, bodyColor, computePixelRatio, describeSummary,
  clampFill, describeVessel, fitDistance, fitPoints, projectExtent, supportPoints, GLOW, glowHalo, glowSize, glowTint, isSoftwareRenderer, isVesselId, keyAction, labelText, missingVesselNodes, overallGlow, parseHex,
  planLoadSteps, pointTriangleDistance, pulseActive, pulseExtra, renderBudget, runLoadChain, tweenProgress, withTimeout,
} from './viewerLogic';
import type { LoadStep } from './viewerLogic';
import { buildProceduralHeart } from './procedural';
import { LabelOverlay } from './labels';

export type { Band, VesselId, VesselState, OverallState, HeartViewerOptions, ViewerStatus, FallbackLevel, AnchorSpec, ScreenAnchor, BodyStyle, LabelMode, ViewerFraming } from './types';

type SurfaceMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

const FOV = 35;
const HOME_DIR = new THREE.Vector3(0.85, 0.3, 1).normalize(); // front-left oblique, from a little above: LAD and RCA on the front face, the LCX groove on the left edge (all three in view)
const CLICK_SLOP_PX = 5;
const PICK_RADIUS_PX = { mouse: 6, touch: 14 };
const LOAD_TIMEOUT_MS = 20000;
const TWEEN_MS = 500;
const HULL = { outer: 0.017, inner: 0.009 }; // selection outline thickness in model units (the heart is ~1 unit wide), on top of the vessel inflation
const LABEL_SAMPLES = 20; // candidate points per vessel for its in-canvas label
const LABEL_MIN_MS = 100; // labels are re-placed at most this often while the camera moves (a trailing update follows), keeping the occlusion rays off the frame budget
const LABEL_TOLERANCE = 0.03; // a body hit this much in front of a point still counts as the point being visible (arteries sit partly in the surface)

interface Probe { webgl: boolean; software: boolean; renderer: string }
let probeCache: Probe | null = null;

/** Create a throwaway context to learn whether WebGL works and whether it is a CPU rasteriser (SwiftShader, llvmpipe). */
function probeWebGL(): Probe {
  if (probeCache) return probeCache;
  try {
    const gl = (document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { webgl: false, software: false, renderer: 'none' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (probeCache = { webgl: true, software: isSoftwareRenderer(renderer), renderer });
  } catch {
    return { webgl: false, software: false, renderer: 'error' };
  }
}

interface VesselEntry {
  id: VesselId;
  parts: THREE.Mesh[];
  material: SurfaceMaterial;
  hulls: { outer: THREE.Mesh; inner: THREE.Mesh }[];
  ghosts: THREE.Mesh[]; // see-through copy, drawn only where the heart wall hides the vessel
  samples: { p: THREE.Vector3; out: THREE.Vector3; d: number }[]; // label candidates, spread over the vessel; d = distance to the vessel's centroid (labels prefer the trunk)
  outline: THREE.Vector3[]; // a sparse set of the vessel's vertices; the label chips keep clear of them
  labelAt: number; // index of the sample the label sits on (kept while it stays visible, so the label does not jump)
  soup: { pos: Float32Array; idx: Uint32Array }; // world-space triangles of all parts, for near-miss picking
  state?: VesselState;
}

interface BodyEntry { mesh: THREE.Mesh; material: SurfaceMaterial; chamber: boolean }

interface AnchorPoint { point: THREE.Vector3; outward: THREE.Vector3 }

interface Tween { home: boolean; start: number; dur: number; d0: THREE.Vector3; d1: THREE.Vector3; r0: number; r1: number; t0: THREE.Vector3; t1: THREE.Vector3 }

/** Vessel look on a standard/lambert material: surface pushed out along its smooth normal (calibre exaggeration) and a rim light in the vessel's own lightened colour. */
function patchVesselMaterial(m: SurfaceMaterial, uniforms: { inflate: { value: number }; rim: { value: number }; lift: { value: number } }): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uInflate = uniforms.inflate;
    shader.uniforms.uRim = uniforms.rim;
    shader.uniforms.uLift = uniforms.lift;
    shader.vertexShader = 'uniform float uInflate; uniform float uLift;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += normalize(objectNormal) * uInflate;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tmvPosition.z += uLift; gl_Position = projectionMatrix * mvPosition; // toward the camera: an artery slightly buried in the surface (decimated models) still shows');
    shader.fragmentShader = 'uniform float uRim;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\t{ float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.0); totalEmissiveRadiance += mix(diffuseColor.rgb, vec3(1.0), 0.25) * rim * uRim; }');
  };
  m.customProgramCacheKey = () => 'riskatlas-vessel-v1';
}

const ghostMaterial = (inflate: { value: number }, lift: { value: number }) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth, // only where something nearer (the heart wall) is already in the depth buffer
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, // keeps the vessel's own front faces from ghosting over themselves
    uniforms: { uInflate: inflate, uLift: lift, uColor: { value: new THREE.Color('#9e9ea3') }, uOpacity: { value: VESSEL_LOOK.ghost } },
    vertexShader: 'uniform float uInflate; uniform float uLift; void main() { vec3 p = position + normalize(normal) * uInflate; vec4 mv = modelViewMatrix * vec4(p, 1.0); mv.z += uLift; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main() { gl_FragColor = vec4(uColor, uOpacity);\n#include <colorspace_fragment>\n}',
  });

const hullMaterial = (hex: string, thickness: number, lift: { value: number }) =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uThickness: { value: thickness }, uLift: lift, uColor: { value: new THREE.Color(hex) } },
    vertexShader: 'uniform float uThickness; uniform float uLift; void main() { vec3 p = position + normalize(normal) * uThickness; vec4 mv = modelViewMatrix * vec4(p, 1.0); mv.z += uLift; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0);\n#include <colorspace_fragment>\n}',
  });

const glowMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; void main() { float r = length(vUv * 2.0 - 1.0); float a = smoothstep(1.0, 0.3, r); gl_FragColor = vec4(uColor, a * a * uOpacity);\n#include <colorspace_fragment>\n}',
  });

export class HeartViewer {
  private readonly opts: HeartViewerOptions;
  private readonly container: HTMLElement;
  private readonly lowPower: boolean;
  private readonly reduced: boolean;
  private readonly probe: Probe;
  private readonly bodyStyle: BodyStyle;
  private readonly labelMode: LabelMode;
  private readonly showHidden: boolean;
  private readonly boost: number;
  private readonly fill: number;
  private readonly look = { inflate: { value: 0 }, rim: { value: VESSEL_LOOK.rim }, lift: { value: VESSEL_LOOK.lift } };
  private labels: LabelOverlay | null = null;
  private lastLabelAt = -Infinity;
  private labelTimer: ReturnType<typeof setTimeout> | 0 = 0;

  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
  private controls: OrbitControls | null = null;
  private model: THREE.Object3D | null = null;
  private glow: THREE.Mesh | null = null;

  private readonly vessels = new Map<VesselId, VesselEntry>();
  private bodies: BodyEntry[] = [];
  private pickables: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();

  private states: Partial<Record<VesselId, VesselState>> = {};
  private overall: OverallState | null = null;
  private readonly selection = new SelectionModel();
  private hoverVessel: VesselId | null = null;
  private hoverBody: THREE.Mesh | null = null;
  private readonly selectEmitter = new Emitter<VesselId | null>();
  private readonly anchorEmitter = new Emitter<ScreenAnchor[]>();
  private anchorSpecs: AnchorSpec[] = [];
  private anchorCache = new Map<string, AnchorPoint | null>();
  private lastAnchors = '';
  private warnedAnchors = new Set<string>();
  private warnedSize = false;

  private status: ViewerStatus;
  private loadPromise: Promise<void> | null = null;
  private disposed = false;
  private contextLost = false;
  private raf = 0;
  private pendingHover: { x: number; y: number; touch: boolean } | null = null;
  private hoverRaf = 0;
  private readonly meter = new FrameMeter();
  private tween: Tween | null = null;
  private pulseStart = -1;
  private userMoved = false;
  private bounds = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  private heartCentre = new THREE.Vector3();
  private radius = 0.8;
  private hullPoints: Float32Array | null = null; // extreme points of the model (see supportPoints): what the camera fit is computed from
  private autoDist = 0; // the distance the last auto-fit chose; the camera is 'fitted' while it is still there
  private downAt: { x: number; y: number; id: number; touch: boolean } | null = null;
  private multiTouch = false;

  private readonly disposers: (() => void)[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private liveEl: HTMLElement;
  private fallbackEl: HTMLElement | null = null;
  private readonly savedAttrs: { role: string | null; label: string | null; tabindex: string | null; position: string };
  private lastAnnounce = '';

  constructor(opts: HeartViewerOptions) {
    this.opts = opts;
    this.container = opts.container;
    this.probe = probeWebGL();
    this.lowPower = opts.lowPower ?? this.probe.software;
    this.reduced = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.status = { loaded: false, usingFallback: 'none', webgl: false, triangles: 0 };
    this.bodyStyle = opts.bodyStyle === 'natural' ? 'natural' : 'neutral';
    this.labelMode = opts.labels === 'off' || opts.labels === 'name' ? opts.labels : 'risk';
    this.showHidden = opts.showHidden ?? !this.lowPower; // an extra transparent pass over every artery: skipped on software GL unless asked for
    this.fill = clampFill(opts.fill);
    this.boost = typeof opts.vesselBoost === 'number' && Number.isFinite(opts.vesselBoost) ? Math.min(4, Math.max(0, opts.vesselBoost)) : 1;
    this.look.inflate.value = VESSEL_LOOK.inflate * this.boost;
    this.look.lift.value = VESSEL_LOOK.lift * (this.lowPower ? VESSEL_LOOK.lowPowerScale : 1);

    const c = this.container;
    this.savedAttrs = { role: c.getAttribute('role'), label: c.getAttribute('aria-label'), tabindex: c.getAttribute('tabindex'), position: c.style.position };
    c.setAttribute('role', 'application');
    c.setAttribute('aria-label', ARIA_LABEL);
    if (c.tabIndex < 0) c.setAttribute('tabindex', '0');
    if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
    this.liveEl = this.createLiveRegion();
    c.appendChild(this.liveEl);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6470, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); // headlight: attached to the camera, so every view is lit
    key.position.set(0.4, 0.8, 1);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.createRenderer();
    this.listen(c, 'keydown', this.onKeyDown as EventListener);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(c);
    this.resize();
  }

  // ---- public API --------------------------------------------------------

  /** Load heart.glb (or the lite model first when lowPower), falling back to the other GLB and then to a built-in procedural heart. Never rejects. */
  load(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  /** Merge per-vessel states: a vessel not in `states` is unchanged; an explicit `undefined` clears it back to neutral. */
  setVessels(states: Partial<Record<VesselId, VesselState>>): void {
    if (this.disposed) return;
    for (const id of Object.keys(states)) {
      if (!isVesselId(id)) { console.warn(`[HeartViewer] setVessels: unknown vessel id "${id}" ignored`); continue; }
      const s = states[id];
      if (s === undefined) { delete this.states[id]; continue; }
      if (!parseHex(s.color)) { console.warn(`[HeartViewer] setVessels: ${id} colour "${s.color}" is not a #rgb/#rrggbb hex, ignored`); continue; }
      this.states[id] = { ...s };
    }
    this.applyStates();
    this.refreshFallbackText();
    this.invalidate();
  }

  /**
   * Heart-level glow (halo around the heart plus a faint tint of the chambers) for the overall CAD state.
   * Never weaker than the strongest vessel: see overallGlow() in viewerLogic.ts (the strongest of overall and vessels wins). null = no glow.
   */
  setOverall(state: OverallState | null): void {
    if (this.disposed) return;
    if (state && !parseHex(state.color)) { console.warn(`[HeartViewer] setOverall: colour "${state.color}" is not a #rgb/#rrggbb hex, ignored`); return; }
    this.overall = state ? { ...state } : null;
    this.applyGlow();
    this.invalidate();
  }

  /** Select a vessel (highlight, outline, pulse, camera moves to face it) or clear with null. Emits onSelect when the selection changes. */
  select(id: VesselId | null): void {
    if (this.disposed) return;
    if (id !== null && !isVesselId(id)) { console.warn(`[HeartViewer] select: unknown vessel id "${String(id)}" ignored`); return; }
    this.setSelection(id, true);
  }

  /** Subscribe to selection changes (click, tap, keyboard, select()). Returns the unsubscribe function. */
  onSelect(cb: (id: VesselId | null) => void): () => void {
    return this.selectEmitter.on(cb);
  }

  /** Pin callouts to mesh nodes. Positions arrive through onAnchors after each render. Unknown nodes report visible=false. */
  setAnchors(anchors: AnchorSpec[]): void {
    if (this.disposed) return;
    this.anchorSpecs = anchors.map((a) => ({ key: a.key, node: a.node }));
    this.lastAnchors = '';
    this.emitAnchors();
  }

  /** Screen positions (CSS px from the container's top-left) of the anchors, emitted when they change. Returns the unsubscribe function. */
  onAnchors(cb: (anchors: ScreenAnchor[]) => void): () => void {
    const off = this.anchorEmitter.on(cb);
    this.lastAnchors = '';
    this.emitAnchors();
    return off;
  }

  resetView(): void {
    if (this.disposed) return;
    this.userMoved = false;
    const h = this.homePose();
    this.autoDist = h.dist;
    this.applyZoomLimits();
    this.startTween(h.dir, h.dist, h.target, true);
  }

  /**
   * Re-measure the container, re-frame the camera for the new shape and redraw. Also called automatically by a ResizeObserver.
   * At the home view the heart is re-fitted from scratch. If the user orbited or panned but did not zoom (the camera is still at the
   * auto-fit distance) the orbit angle is kept and the distance re-fitted for it. A deliberately zoomed or vessel-focused view keeps its
   * zoom relative to the canvas instead (the same share of the heart stays in frame).
   */
  resize(): void {
    if (this.disposed || !this.renderer || !this.canvas) return;
    const prevAspect = this.camera.aspect;
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    if (this.container.clientHeight === 0 && !this.warnedSize) { this.warnedSize = true; console.warn('[HeartViewer] the container has no height; give it an explicit size (CSS height or flex/grid sizing)'); }
    const pr = computePixelRatio(w, h, window.devicePixelRatio, renderBudget(this.lowPower));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false); // clears the canvas: redraw synchronously below so a resize never flashes blank
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.refit(prevAspect);
    this.renderNow();
  }

  getStatus(): ViewerStatus {
    const fps = this.disposed ? undefined : this.meter.fps(performance.now());
    return { ...this.status, ...(fps !== undefined ? { fps } : {}) };
  }

  /** Diagnostics for tests and tooling: canvas size, camera distance versus the auto-fit distance, and the projected silhouette in CSS px. */
  getFraming(): ViewerFraming {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const cur = this.currentPose();
    const e = this.hullPoints && this.hullPoints.length ? projectExtent(this.hullPoints, [cur.dir.x, cur.dir.y, cur.dir.z], [cur.target.x, cur.target.y, cur.target.z], cur.dist, FOV, this.camera.aspect || 1) : null;
    return {
      width: w, height: h, distance: cur.dist, autoDistance: this.autoDist, direction: [cur.dir.x, cur.dir.y, cur.dir.z], fitted: this.isFitted(cur.dist),
      silhouette: e ? { x0: (e.x0 * 0.5 + 0.5) * w, x1: (e.x1 * 0.5 + 0.5) * w, y0: (-e.y1 * 0.5 + 0.5) * h, y1: (-e.y0 * 0.5 + 0.5) * h } : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.raf = this.hoverRaf = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls?.dispose();
    this.controls = null;
    for (const off of this.disposers.splice(0)) off();
    this.disposeModel();
    this.glow = null;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.canvas?.remove();
    }
    this.renderer = null;
    this.canvas = null;
    if (this.labelTimer) clearTimeout(this.labelTimer);
    this.labelTimer = 0;
    this.labels?.dispose();
    this.labels = null;
    this.liveEl.remove();
    this.fallbackEl?.remove();
    this.selectEmitter.clear();
    this.anchorEmitter.clear();
    const c = this.container, s = this.savedAttrs;
    for (const [name, v] of [['role', s.role], ['aria-label', s.label], ['tabindex', s.tabindex]] as const) {
      if (v === null) c.removeAttribute(name); else c.setAttribute(name, v);
    }
    c.style.position = s.position;
    this.status = { ...this.status, loaded: false, webgl: false, triangles: 0 };
  }

  // ---- setup ---------------------------------------------------------------

  private createRenderer(): void {
    if (!this.probe.webgl) { this.showFallback('3D view unavailable: WebGL is not supported or is disabled in this browser.'); return; }
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: !this.lowPower && !this.probe.software, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      // out of flow, so the canvas never feeds back into the container's own size (no ResizeObserver loop)
      canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none';
      canvas.setAttribute('aria-hidden', 'true');
      this.container.insertBefore(canvas, this.container.firstChild);
      this.renderer = renderer;
      this.canvas = canvas;
      this.status.webgl = true;
      this.controls = this.createControls(canvas);
      this.listen(canvas, 'pointerdown', this.onPointerDown as EventListener);
      this.listen(canvas, 'pointerup', this.onPointerUp as EventListener);
      this.listen(canvas, 'pointercancel', this.onPointerCancel as EventListener);
      this.listen(canvas, 'pointermove', this.onPointerMove as EventListener);
      this.listen(canvas, 'pointerleave', this.onPointerLeave as EventListener);
      this.listen(canvas, 'webglcontextlost', this.onContextLost as EventListener);
      this.listen(canvas, 'webglcontextrestored', this.onContextRestored as EventListener);
    } catch (e) {
      console.error('[HeartViewer] could not create a WebGL renderer', e);
      this.showFallback('3D view unavailable: the browser could not start WebGL.');
    }
  }

  private createControls(canvas: HTMLCanvasElement): OrbitControls {
    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = !this.reduced;
    c.dampingFactor = 0.1;
    c.enablePan = true;
    c.screenSpacePanning = true;
    c.minDistance = 0.8;
    c.maxDistance = 5; // refined by applyZoomLimits() once the model (and so the fit distance) is known
    c.addEventListener('change', () => {
      this.clampPan();
      this.invalidate();
    });
    c.addEventListener('start', () => { this.userMoved = true; this.tween = null; });
    return c;
  }

  private createLiveRegion(): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';
    return el;
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }

  // ---- loading ---------------------------------------------------------------

  private async doLoad(): Promise<void> {
    if (this.disposed || !this.renderer) { this.publishStatus({ loaded: false, triangles: 0 }); return; }
    const steps = planLoadSteps({ modelUrl: this.opts.modelUrl, liteModelUrl: this.opts.liteModelUrl, lowPower: this.lowPower });
    const outcome = await runLoadChain(steps, (s) => this.loadStep(s), (s, e) =>
      console.error(`[HeartViewer] ${s.url ?? 'procedural heart'} failed (${e instanceof Error ? e.message : String(e)}); trying the next fallback`));
    if (this.disposed) {
      if (outcome.ok) this.disposeObject(outcome.value);
      return;
    }
    if (!outcome.ok) {
      console.error('[HeartViewer] no model could be loaded');
      this.showFallback('3D view unavailable: the heart model could not be loaded.');
      return;
    }
    this.installModel(outcome.value, outcome.level);
  }

  private async loadStep(step: LoadStep): Promise<THREE.Object3D> {
    if (!step.url) return buildProceduralHeart();
    const gltf = await withTimeout(new GLTFLoader().loadAsync(step.url), LOAD_TIMEOUT_MS, step.url);
    const names: string[] = [];
    gltf.scene.traverse((o) => { if (o.name) names.push(o.name); });
    const hasMesh = (id: string) => { let n = 0; gltf.scene.getObjectByName(id)?.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n > 0; };
    const missing = [...missingVesselNodes(names), ...VESSEL_IDS.filter((id) => names.includes(id) && !hasMesh(id))];
    if (missing.length) {
      this.disposeObject(gltf.scene);
      throw new Error(`model has no mesh node named ${missing.join(', ')}; node names must equal the manifest mesh names (config/manifest.yaml)`);
    }
    return gltf.scene;
  }

  private installModel(root: THREE.Object3D, level: FallbackLevel): void {
    this.disposeModel();
    this.model = root;
    this.scene.add(root);
    root.updateMatrixWorld(true);
    const makeMat = (src: THREE.Material, side: THREE.Side): SurfaceMaterial => {
      const color = (src as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xbbbbbb);
      return this.lowPower
        ? new THREE.MeshLambertMaterial({ color, side })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, side });
    };

    const nodeMeshes = (name: string): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      root.getObjectByName(name)?.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
      return out;
    };
    const vesselMeshes = new Set<THREE.Mesh>();
    // the built-in schematic heart has much thinner arteries (radius 0.005 to 0.024) than the GLB: scale the look down so outlines do not swallow them
    const detail = level === 'procedural' ? VESSEL_LOOK.proceduralScale : 1;
    this.look.inflate.value = VESSEL_LOOK.inflate * this.boost * detail;
    const inflate = this.look.inflate.value;
    const edgeWidth = VESSEL_LOOK.edge * detail;
    for (const id of VESSEL_IDS) {
      const parts = nodeMeshes(id);
      const material = makeMat(parts[0].material as THREE.Material, THREE.DoubleSide);
      patchVesselMaterial(material, this.look);
      const ghostMat = this.showHidden ? ghostMaterial(this.look.inflate, this.look.lift) : null;
      const ghosts: THREE.Mesh[] = [];
      const hulls = parts.map((p) => {
        vesselMeshes.add(p);
        disposeMaterials(p.material);
        p.material = material;
        // Smooth normals (welded by position): the inflated surface, the outlines and the ghost all follow them without tearing at split vertices.
        // The triangle list is unchanged, only vertices are shared; the part itself is drawn from the welded geometry.
        const hullGeometry = weldedForOutline(p.geometry);
        p.geometry.dispose();
        p.geometry = hullGeometry;
        const edge = new THREE.Mesh(hullGeometry, hullMaterial(VESSEL_LOOK.edgeColor, inflate + edgeWidth, this.look.lift)); // permanent thin dark outline
        const outer = new THREE.Mesh(hullGeometry, hullMaterial('#101010', inflate + HULL.outer * detail, this.look.lift));
        const inner = new THREE.Mesh(hullGeometry, hullMaterial('#ffffff', inflate + HULL.inner * detail, this.look.lift));
        outer.visible = inner.visible = false;
        edge.userData.hull = outer.userData.hull = inner.userData.hull = true;
        edge.visible = !this.lowPower; // one more pass over every artery: skipped on software GL (the dark body already outlines the arteries)
        p.add(edge, outer, inner);
        if (ghostMat) {
          const g = new THREE.Mesh(hullGeometry, ghostMat);
          g.renderOrder = 5;
          g.userData.hull = true;
          p.add(g);
          ghosts.push(g);
        }
        return { outer, inner };
      });
      this.vessels.set(id, { id, parts, material, hulls, ghosts, samples: [], outline: [], labelAt: -1, soup: triangleSoup(parts) });
    }
    const bodies: BodyEntry[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || vesselMeshes.has(m) || m.userData.hull) return;
      const material = makeMat(m.material as THREE.Material, THREE.DoubleSide);
      const tint = bodyColor(this.bodyStyle, m.name);
      if (tint) material.color.set(tint);
      disposeMaterials(m.material);
      m.material = material;
      bodies.push({ mesh: m, material, chamber: /atrium|ventricle/.test(m.name) });
    });
    this.bodies = bodies;
    this.pickables = [...vesselMeshes, ...bodies.map((b) => b.mesh)];

    this.bounds.setFromObject(root);
    const chambers = new THREE.Box3();
    for (const b of bodies) if (b.chamber) chambers.expandByObject(b.mesh);
    this.heartCentre = (chambers.isEmpty() ? this.bounds : chambers).getCenter(new THREE.Vector3());
    this.radius = this.bounds.getBoundingSphere(new THREE.Sphere()).radius;
    this.hullPoints = supportPoints(worldVertices(root));
    for (const v of this.vessels.values()) {
      v.samples = labelSamples(v.soup.pos, this.heartCentre);
      const n = v.soup.pos.length / 3, stride = Math.max(1, Math.floor(n / 160));
      for (let i = 0; i < n; i += stride) v.outline.push(new THREE.Vector3(v.soup.pos[i * 3], v.soup.pos[i * 3 + 1], v.soup.pos[i * 3 + 2]));
    }
    if (!this.lowPower) this.createGlow();

    let triangles = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.material as THREE.Material).type.startsWith('Shader')) {
        triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      }
    });
    this.anchorCache.clear();
    this.publishStatus({ loaded: true, usingFallback: level, triangles });
    this.userMoved = false;
    this.applyHome();
    this.applyStates();
    this.applyGlow();
    this.applyEmphasis();
    this.refreshFallbackText();
    this.hideFallback();
    this.lastAnchors = '';
    this.invalidate();
    if (this.selection.selected) this.focusOn(this.selection.selected);
  }

  /** Soft radial halo on a camera-facing quad just behind the heart (see updateGlowPlacement). */
  private createGlow(): void {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial());
    g.renderOrder = 10;
    g.visible = false;
    this.glow = g;
    this.scene.add(g);
  }

  private disposeModel(): void {
    if (this.model) this.disposeObject(this.model);
    this.model = null;
    if (this.glow) { this.scene.remove(this.glow); this.disposeObject(this.glow); this.glow = null; }
    this.vessels.clear();
    this.bodies = [];
    this.pickables = [];
    this.hoverVessel = null;
    this.hoverBody = null;
  }

  private disposeObject(o: THREE.Object3D): void {
    o.removeFromParent();
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) disposeMaterials(m.material);
    });
  }

  private publishStatus(p: Partial<ViewerStatus>): void {
    this.status = { ...this.status, ...p };
  }

  // ---- state -> materials ----------------------------------------------------

  private applyStates(): void {
    for (const [id, v] of this.vessels) {
      const s = this.states[id];
      if (s) {
        const hex = applyUncertainty(s.color, s.uncertaintyWidth);
        v.material.color.set(hex);
        v.material.emissive.set(hex);
        for (const g of v.ghosts) (g.material as THREE.ShaderMaterial).uniforms.uColor.value.set(hex);
      } else {
        const grey = this.bodyStyle === 'neutral' ? UNSCORED_VESSEL.neutral : UNSCORED_VESSEL.natural;
        v.material.color.set(grey);
        v.material.emissive.set('#000000');
        for (const g of v.ghosts) (g.material as THREE.ShaderMaterial).uniforms.uColor.value.set(grey);
      }
      v.state = s;
    }
    this.applyGlow();
    this.applyEmphasis();
  }

  /** Emissive level, outline and hover look of every vessel. The selection pulse is layered on top per frame. */
  private applyEmphasis(): void {
    const sel = this.selection.selected;
    for (const [id, v] of this.vessels) {
      const selected = id === sel, hovered = id === this.hoverVessel;
      v.material.emissiveIntensity = !v.state ? 0 : selected ? EMISSIVE.selected : hovered ? EMISSIVE.hover : EMISSIVE.base;
      for (const h of v.hulls) { h.outer.visible = selected && !this.lowPower; h.inner.visible = selected || hovered; } // low power (coarse lite mesh): white ring only
    }
    this.applyBodyEmphasis();
  }

  private applyBodyEmphasis(): void {
    const g = overallGlow(this.overall, this.states);
    for (const b of this.bodies) {
      const hovered = b.mesh === this.hoverBody;
      if (g) {
        b.material.emissive.set(g.color);
        const share = this.bodyStyle === 'neutral' ? NEUTRAL_TINT_SHARE : 1; // a strong tint would turn the neutral body pink again; the halo carries the overall state
        b.material.emissiveIntensity = glowTint(g.probability) * share * (this.glow ? 1 : GLOW.lowPowerTintBoost) + (hovered ? 0.08 : 0); // no halo in low-power mode: stronger tint instead
      } else {
        b.material.emissive.set('#ffffff');
        b.material.emissiveIntensity = hovered ? 0.1 : 0;
      }
    }
  }

  private applyGlow(): void {
    const g = overallGlow(this.overall, this.states);
    if (this.glow) {
      this.glow.visible = !!g;
      if (g) {
        const u = (this.glow.material as THREE.ShaderMaterial).uniforms;
        u.uColor.value.set(g.color);
        u.uOpacity.value = glowHalo(g.probability);
      }
    }
    this.applyBodyEmphasis();
  }

  // ---- selection -----------------------------------------------------------------

  private setSelection(id: VesselId | null, focusCamera: boolean): void {
    if (!this.selection.select(id)) return;
    this.pulseStart = -1;
    this.applyEmphasis();
    if (id && focusCamera) this.focusOn(id);
    this.announce(id ? describeVessel(id, this.states[id]) : 'Selection cleared.');
    this.selectEmitter.emit(id);
    this.invalidate();
  }

  private announce(text: string): void {
    if (this.lastAnnounce === text) text += ' '; // identical text is not re-read by screen readers
    this.lastAnnounce = text;
    this.liveEl.textContent = text;
  }

  // ---- camera -----------------------------------------------------------------------

  /** Distance at which a sphere around the whole model fits: only its ratio between two canvas shapes is used (it is independent of the orbit angle). */
  private sphereFit(aspect: number): number {
    return fitDistance(this.radius, FOV, aspect || 1);
  }

  /** Fit the model's silhouette to `fill` of the canvas for a camera at target + dir * dist, optionally re-centring the look-at point. */
  private fitFor(dir: THREE.Vector3, target: THREE.Vector3, centre: boolean): { dist: number; target: THREE.Vector3 } {
    const pts = this.hullPoints;
    if (!pts || pts.length < 9) return { dist: this.sphereFit(this.camera.aspect) / 0.88, target: target.clone() }; // no model yet: the bounding sphere, a little loosely
    const r = fitPoints(pts, [dir.x, dir.y, dir.z], [target.x, target.y, target.z], FOV, this.camera.aspect || 1, this.fill, centre);
    return { dist: r.dist, target: new THREE.Vector3(r.target[0], r.target[1], r.target[2]) };
  }

  private homePose(): { dir: THREE.Vector3; dist: number; target: THREE.Vector3 } {
    const dir = HOME_DIR.clone();
    const f = this.fitFor(dir, this.bounds.getCenter(new THREE.Vector3()), true);
    return { dir, dist: f.dist, target: f.target };
  }

  private applyHome(): void {
    const h = this.homePose();
    this.autoDist = h.dist;
    this.applyZoomLimits(); // before the pose: OrbitControls clamps the distance to its limits
    this.applyPose(h);
  }

  /** Zoom limits follow the framing: you can always get about 2.5x closer than the fit, and out to at least 2.5x of it (a tall, narrow canvas fits from further away). */
  private applyZoomLimits(): void {
    if (!this.controls) return;
    const fit = this.autoDist || this.sphereFit(this.camera.aspect);
    this.controls.minDistance = Math.min(0.8, fit * 0.4);
    this.controls.maxDistance = Math.max(this.radius * 6, fit * 2.5);
  }

  private isFitted(dist: number): boolean {
    return this.autoDist > 0 && Math.abs(dist - this.autoDist) <= 0.02 * this.autoDist;
  }

  /** Re-frame after the canvas changed shape (see resize()). */
  private refit(prevAspect: number): void {
    if (this.tween) {
      // a camera move is under way: aim it at the destination framed for the new shape
      const t = this.tween;
      if (t.home) {
        const h = this.homePose();
        this.autoDist = h.dist;
        t.d1 = h.dir.clone().normalize(); t.r1 = h.dist; t.t1 = h.target;
      } else {
        const k = this.sphereFit(this.camera.aspect) / this.sphereFit(prevAspect);
        t.r0 *= k; t.r1 *= k;
      }
      this.applyZoomLimits();
      return;
    }
    if (!this.userMoved || !this.model) { this.applyHome(); return; }
    const cur = this.currentPose();
    let dist: number;
    if (this.isFitted(cur.dist)) {
      dist = this.fitFor(cur.dir, cur.target, false).dist; // orbited or panned only: same angle, distance re-fitted for the new shape
      this.autoDist = dist;
    } else {
      dist = cur.dist * (this.sphereFit(this.camera.aspect) / this.sphereFit(prevAspect)); // zoomed or focused on a vessel: keep the same share of the heart in frame
    }
    this.applyZoomLimits();
    this.applyPose({ dir: cur.dir, dist, target: cur.target });
  }

  private applyPose(p: { dir: THREE.Vector3; dist: number; target: THREE.Vector3 }): void {
    if (this.controls?.enableDamping) {
      // drop the damping momentum left over from the last drag, or it would keep rotating the camera away from this pose
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = true;
    }
    this.camera.position.copy(p.target).addScaledVector(p.dir, p.dist);
    this.camera.lookAt(p.target);
    if (this.controls) { this.controls.target.copy(p.target); this.controls.update(); }
  }

  private currentPose(): { dir: THREE.Vector3; dist: number; target: THREE.Vector3 } {
    const target = this.controls ? this.controls.target.clone() : this.bounds.getCenter(new THREE.Vector3());
    const off = this.camera.position.clone().sub(target);
    const dist = off.length() || 1;
    return { dir: off.divideScalar(dist), dist, target };
  }

  private startTween(dir: THREE.Vector3, dist: number, target: THREE.Vector3, home = false): void {
    if (!this.renderer) return;
    const from = this.currentPose();
    if (this.reduced) { this.tween = null; this.applyPose({ dir, dist, target }); this.invalidate(); return; }
    this.tween = { home, start: -1, dur: TWEEN_MS, d0: from.dir, d1: dir.clone().normalize(), r0: from.dist, r1: dist, t0: from.target, t1: target.clone() };
    this.invalidate();
  }

  /** Turn the camera to look at a vessel from outside the heart and move the orbit centre toward it. */
  private focusOn(id: VesselId): void {
    const a = this.anchorPoint(id);
    if (!a) return;
    const outward = a.point.clone().sub(this.heartCentre);
    const dir = outward.lengthSq() > 1e-6 ? outward.normalize() : HOME_DIR.clone();
    dir.y = Math.min(0.5, Math.max(-0.5, dir.y)); // never look straight down or up at the heart
    dir.normalize();
    const target = this.heartCentre.clone().lerp(a.point, 0.45);
    const dist = Math.min(Math.max(this.currentPose().dist, 1.4), this.homePose().dist * 0.8);
    this.userMoved = true;
    this.startTween(dir, dist, target);
  }

  private stepTween(now: number): boolean {
    const t = this.tween;
    if (!t) return false;
    if (t.start < 0) t.start = now;
    const k = tweenProgress(now - t.start, t.dur, this.reduced);
    // slerp the direction, lerp the distance: a straight line between two sides of the heart would pass through it
    const q = new THREE.Quaternion().setFromUnitVectors(t.d0, t.d1);
    const qi = new THREE.Quaternion().slerp(q, k);
    const dir = t.d0.clone().applyQuaternion(qi);
    this.applyPose({ dir, dist: t.r0 + (t.r1 - t.r0) * k, target: t.t0.clone().lerp(t.t1, k) });
    if (k >= 1) { this.tween = null; return false; }
    return true;
  }

  private clampPan(): void {
    if (!this.controls) return;
    const t = this.controls.target, before = t.clone();
    const lim = this.radius * 0.6;
    t.clamp(this.bounds.getCenter(new THREE.Vector3()).subScalar(lim), this.bounds.getCenter(new THREE.Vector3()).addScalar(lim));
    this.camera.position.add(t.clone().sub(before));
  }

  private rotateBy(dAz: number, dPolar: number): void {
    const target = this.controls?.target ?? this.heartCentre;
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    s.theta += dAz;
    s.phi = Math.min(Math.PI - 0.05, Math.max(0.05, s.phi + dPolar));
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(s));
    this.camera.lookAt(target);
    this.userMoved = true;
    this.tween = null;
    this.controls?.update();
    this.invalidate();
  }

  private zoomBy(factor: number): void {
    const target = this.controls?.target ?? this.heartCentre;
    const off = this.camera.position.clone().sub(target);
    const len = Math.min(this.controls?.maxDistance ?? 5, Math.max(this.controls?.minDistance ?? 0.8, off.length() * factor));
    this.camera.position.copy(target).add(off.setLength(len));
    this.userMoved = true;
    this.tween = null;
    this.controls?.update();
    this.invalidate();
  }

  // ---- rendering ------------------------------------------------------------------------

  private invalidate(): void {
    if (this.disposed || this.raf || !this.renderer || this.contextLost) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed || !this.renderer || this.contextLost) return;
    let again = this.stepTween(now);
    const sel = this.selection.selected ? this.vessels.get(this.selection.selected) : undefined;
    if (sel) {
      if (this.pulseStart < 0) this.pulseStart = now;
      const el = now - this.pulseStart;
      sel.material.emissiveIntensity = (sel.state ? EMISSIVE.selected : 0) + (sel.state ? pulseExtra(el, this.reduced) : 0);
      again = pulseActive(el, this.reduced) || again;
    }
    if (this.controls) this.controls.update(); // damping: dispatches 'change' (and so schedules the next frame) while the camera still moves
    this.meter.tick(now);
    this.draw();
    if (again) this.invalidate();
  };

  private renderNow(): void {
    if (this.disposed || !this.renderer || this.contextLost) return;
    this.draw();
  }

  /** Keep the halo quad behind the heart, facing the camera, sized by the glow strength. */
  private updateGlowPlacement(): void {
    const g = this.glow;
    if (!g || !g.visible) return;
    const glow = overallGlow(this.overall, this.states);
    const toCam = this.camera.position.clone().sub(this.heartCentre).normalize();
    g.position.copy(this.heartCentre).addScaledVector(toCam, -this.radius);
    g.quaternion.copy(this.camera.quaternion);
    g.scale.setScalar(this.radius * glowSize(glow ? glow.probability : 0));
  }

  private draw(): void {
    if (!this.renderer) return;
    this.updateGlowPlacement();
    this.renderer.render(this.scene, this.camera);
    this.emitAnchors();
    const now = performance.now();
    if (now - this.lastLabelAt >= LABEL_MIN_MS) this.updateLabels();
    else if (!this.labelTimer) this.labelTimer = setTimeout(() => { this.labelTimer = 0; this.updateLabels(); }, LABEL_MIN_MS);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault(); // allows the browser to restore the context
    this.contextLost = true;
    this.status.webgl = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.showFallback('3D view paused: the graphics context was lost. It will come back automatically.');
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.status.webgl = true;
    this.hideFallback();
    this.resize(); // three re-creates its GPU state on restore; our scene objects are re-uploaded on the next render
    this.invalidate();
  };

  // ---- fallback message -----------------------------------------------------------------------

  private showFallback(message: string): void {
    if (!this.fallbackEl) {
      const el = document.createElement('div');
      el.setAttribute('role', 'img');
      el.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5em;padding:1em;text-align:center;font:inherit;color:inherit;box-sizing:border-box';
      this.fallbackEl = el;
      this.container.appendChild(el);
    }
    this.fallbackEl.dataset.message = message;
    this.fallbackEl.hidden = false;
    this.fallbackEl.style.display = 'flex'; // the inline display would otherwise override the hidden attribute
    if (this.canvas) this.canvas.style.visibility = 'hidden';
    this.refreshFallbackText();
  }

  private hideFallback(): void {
    if (this.fallbackEl) { this.fallbackEl.hidden = true; this.fallbackEl.style.display = 'none'; }
    if (this.canvas) this.canvas.style.visibility = '';
  }

  private refreshFallbackText(): void {
    const el = this.fallbackEl;
    if (!el || el.hidden) return;
    const summary = describeSummary(this.states);
    el.setAttribute('aria-label', `${el.dataset.message} ${summary}`);
    el.textContent = '';
    const p1 = document.createElement('p'), p2 = document.createElement('p');
    p1.textContent = el.dataset.message ?? '';
    p2.textContent = summary;
    p1.style.margin = p2.style.margin = '0';
    el.append(p1, p2);
  }

  // ---- picking ------------------------------------------------------------------------------------

  /**
   * What is under the pointer: the vessel hit by the ray through the pointer, else the visible vessel nearest to it within
   * `radiusPx` (arteries are only ~5 px wide, so a fingertip or a slightly off click still counts). Near vessels are found
   * by projecting each vessel's triangles to the screen, then confirmed visible with one ray, so a vessel behind the
   * heart is never picked. `body` is the mesh hit by the centre ray when no vessel qualifies.
   */
  private pick(clientX: number, clientY: number, radiusPx: number): { vessel: VesselId | null; body: THREE.Mesh | null } {
    if (!this.canvas || !this.model) return { vessel: null, body: null };
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { vessel: null, body: null };
    const px = clientX - r.left, py = clientY - r.top;
    const ndc = new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
    const vesselOf = (m: THREE.Object3D | undefined): VesselId | null => {
      if (!m) return null;
      for (const v of this.vessels.values()) if (v.parts.includes(m as THREE.Mesh)) return v.id;
      return null;
    };
    this.raycaster.setFromCamera(ndc, this.camera);
    const centreHit = this.raycaster.intersectObjects(this.pickables, false)[0];
    const direct = vesselOf(centreHit?.object);
    if (direct) return { vessel: direct, body: null };

    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const candidates: { id: VesselId; d: number; at: THREE.Vector3 }[] = [];
    for (const v of this.vessels.values()) {
      const { pos, idx } = v.soup;
      const n = pos.length / 3;
      const sx = new Float32Array(n), sy = new Float32Array(n), ok = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (w <= 0) continue;
        sx[i] = (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5) * r.width;
        sy[i] = ((-(m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 + 0.5) * r.height;
        ok[i] = 1;
      }
      let best = Infinity, bt = -1;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        if (!ok[a] || !ok[b] || !ok[c]) continue;
        const d = pointTriangleDistance(px, py, sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]);
        if (d < best) { best = d; bt = t; }
      }
      if (bt >= 0 && best <= radiusPx) {
        const a = idx[bt], b = idx[bt + 1], c = idx[bt + 2];
        const at = new THREE.Vector3((pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3);
        candidates.push({ id: v.id, d: best, at });
      }
    }
    candidates.sort((p, q) => p.d - q.d);
    for (const c of candidates) {
      const dir = c.at.clone().sub(this.camera.position);
      const dist = dir.length();
      this.raycaster.set(this.camera.position, dir.normalize());
      const first = this.raycaster.intersectObjects(this.pickables, false)[0];
      // visible unless something else is clearly in front (0.03 = about one artery diameter, since arteries sit partly in the surface)
      if (!first || vesselOf(first.object) === c.id || first.distance >= dist - 0.03) return { vessel: c.id, body: null };
    }
    return { vessel: null, body: (centreHit?.object as THREE.Mesh | undefined) ?? null };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) { this.multiTouch = true; return; }
    this.multiTouch = false;
    this.downAt = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
    this.container.focus({ preventScroll: true });
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || e.pointerId !== d.id || this.multiTouch) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return; // a drag rotated the view, it is not a click
    const hit = this.pick(e.clientX, e.clientY, d.touch ? PICK_RADIUS_PX.touch : PICK_RADIUS_PX.mouse);
    this.setSelection(hit.vessel, true);
  };

  private onPointerCancel = (): void => { this.downAt = null; };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons !== 0 || e.pointerType === 'touch') return;
    this.pendingHover = { x: e.clientX, y: e.clientY, touch: false };
    if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.processHover); // at most one pick per frame, only while the pointer moves
  };

  private processHover = (): void => {
    this.hoverRaf = 0;
    const p = this.pendingHover;
    this.pendingHover = null;
    if (!p || this.disposed) return;
    const hit = this.pick(p.x, p.y, PICK_RADIUS_PX.mouse);
    this.setHover(hit.vessel, hit.body && this.bodies.some((b) => b.mesh === hit.body && b.chamber) ? hit.body : null);
  };

  private onPointerLeave = (): void => {
    this.pendingHover = null;
    this.setHover(null, null);
  };

  private setHover(vessel: VesselId | null, body: THREE.Mesh | null): void {
    if (vessel === this.hoverVessel && body === this.hoverBody) return;
    this.hoverVessel = vessel;
    this.hoverBody = body;
    if (this.canvas) this.canvas.style.cursor = vessel ? 'pointer' : '';
    this.applyEmphasis();
    this.invalidate();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== this.container && e.target !== this.canvas) return; // keys typed into UI placed inside the container are not ours
    const a = keyAction(e);
    if (!a) return;
    switch (a.type) {
      case 'select': this.setSelection(a.id, true); break;
      case 'clear': this.setSelection(null, false); break;
      case 'rotate': this.rotateBy(a.dAzimuth, a.dPolar); break;
      case 'zoom': this.zoomBy(a.factor); break;
      case 'reset': this.resetView(); break;
    }
    e.preventDefault();
  };

  // ---- in-canvas labels -----------------------------------------------------------------------------------

  /** Is `p` (a point on a vessel) in view: inside the frustum, on the camera-facing side of the heart, and not behind the heart wall? */
  private pointVisible(p: THREE.Vector3, out: THREE.Vector3, ndc: THREE.Vector3): boolean {
    ndc.copy(p).project(this.camera);
    if (ndc.z >= 1 || Math.abs(ndc.x) > 0.96 || Math.abs(ndc.y) > 0.96) return false;
    const toCam = this.camera.position.clone().sub(p);
    const dist = toCam.length();
    if (out.dot(toCam.divideScalar(dist)) < 0.05) return false; // far hemisphere: cheap rejection before the ray
    this.raycaster.set(this.camera.position, p.clone().sub(this.camera.position).normalize());
    const hit = this.raycaster.intersectObjects(this.bodies.map((b) => b.mesh), false)[0];
    return !hit || hit.distance >= dist - LABEL_TOLERANCE;
  }

  /** Move each vessel's label to a visible point of the vessel (the same point while it stays visible), or hide it. Cheap when nothing changed. */
  private updateLabels(): void {
    if (this.disposed || this.labelMode === 'off' || !this.model || !this.canvas || this.contextLost) return;
    this.lastLabelAt = performance.now();
    if (!this.labels) this.labels = new LabelOverlay(this.container);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.updateMatrixWorld();
    const ndc = new THREE.Vector3();
    const toScreen = (p: THREE.Vector3) => { ndc.copy(p).project(this.camera); return { x: (ndc.x * 0.5 + 0.5) * w, y: (-ndc.y * 0.5 + 0.5) * h }; };
    const items = [];
    const camDir = new THREE.Vector3();
    for (const v of this.vessels.values()) {
      const text = labelText(v.id, v.state, this.labelMode);
      let at = -1;
      if (text && v.samples.length) {
        if (v.labelAt >= 0 && this.pointVisible(v.samples[v.labelAt].p, v.samples[v.labelAt].out, ndc)) at = v.labelAt;
        else {
          // candidates nearest the vessel's trunk first; a few ray tests at most per vessel and frame
          const order = v.samples.map((s, i) => ({ i, f: s.out.dot(camDir.copy(this.camera.position).sub(s.p).normalize()), d: s.d })).filter((c) => c.f > 0.15).sort((a, b) => a.d - b.d);
          for (const c of order.slice(0, 6)) if (this.pointVisible(v.samples[c.i].p, v.samples[c.i].out, ndc)) { at = c.i; break; }
        }
      }
      v.labelAt = at;
      const pos = at >= 0 ? toScreen(v.samples[at].p) : { x: 0, y: 0 };
      items.push({ id: v.id, text: text ?? '', color: v.state?.color ?? '#9e9ea3', selected: v.id === this.selection.selected, visible: at >= 0 && this.status.webgl, ...pos });
    }
    const obstacles: { x: number; y: number }[] = [];
    for (const v of this.vessels.values()) for (const p of v.outline) obstacles.push(toScreen(p));
    this.labels.update(items, toScreen(this.heartCentre), { w, h }, obstacles);
  }

  // ---- anchors ------------------------------------------------------------------------------------------

  /**
   * Surface point of a node on the side facing away from the heart centre (cached; model frame == world frame), and the
   * outward direction there. Visibility is judged by that direction (near hemisphere of the heart), not by the mesh's own
   * vertex normals, which are not reliable on thin tubes.
   */
  private anchorPoint(node: string): AnchorPoint | null {
    if (this.anchorCache.has(node)) return this.anchorCache.get(node)!;
    const meshes: THREE.Mesh[] = [];
    this.model?.getObjectByName(node)?.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.hull) meshes.push(o as THREE.Mesh); });
    let result: AnchorPoint | null = null;
    if (meshes.length) {
      const verts: THREE.Vector3[] = [];
      for (const mesh of meshes) {
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) verts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
      }
      const c = new THREE.Vector3();
      for (const v of verts) c.add(v);
      c.divideScalar(verts.length);
      const d = c.clone().sub(this.heartCentre);
      if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
      d.normalize();
      let best = verts[0], bestScore = -Infinity;
      const dir = new THREE.Vector3();
      for (const v of verts) {
        if (v.clone().sub(c).dot(d) < 0) continue; // outer half only
        const score = dir.copy(v).sub(this.heartCentre).normalize().dot(d);
        if (score > bestScore) { bestScore = score; best = v; }
      }
      const outward = best.clone().sub(this.heartCentre);
      result = { point: best, outward: outward.lengthSq() > 1e-8 ? outward.normalize() : d };
    }
    this.anchorCache.set(node, result);
    return result;
  }

  private emitAnchors(): void {
    if (!this.anchorSpecs.length || !this.anchorEmitter.size) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const out: ScreenAnchor[] = this.anchorSpecs.map((s) => {
      const a = this.model ? this.anchorPoint(s.node) : null;
      if (!a) {
        if (this.model && !this.warnedAnchors.has(s.node)) { this.warnedAnchors.add(s.node); console.warn(`[HeartViewer] anchor "${s.key}": no node named "${s.node}" in the model`); }
        return { key: s.key, node: s.node, x: 0, y: 0, visible: false };
      }
      const p = a.point.clone().project(this.camera);
      const facing = a.outward.dot(this.camera.position.clone().sub(a.point).normalize()) > 0.15;
      const onScreen = p.z < 1 && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05;
      return { key: s.key, node: s.node, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: facing && onScreen && this.status.webgl };
    });
    const sig = out.map((a) => `${a.key}:${a.x.toFixed(1)},${a.y.toFixed(1)},${a.visible}`).join('|');
    if (sig === this.lastAnchors) return;
    this.lastAnchors = sig;
    this.anchorEmitter.emit(out);
  }
}

/** World-space positions (flat x,y,z) of every vertex of the model's real meshes (not the outline helpers). */
function worldVertices(root: THREE.Object3D): Float32Array {
  const parts: Float32Array[] = [];
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.hull || !m.geometry?.attributes.position) return;
    const p = m.geometry.attributes.position;
    const a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; }
    parts.push(a);
  });
  const all = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of parts) { all.set(a, off); off += a.length; }
  return all;
}

/** Copy of a geometry with vertices welded by position and recomputed smooth normals, used only for the selection outline. */
function weldedForOutline(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position'); // may be interleaved: copy by component
  const flat = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { flat[i * 3] = pos.getX(i); flat[i * 3 + 1] = pos.getY(i); flat[i * 3 + 2] = pos.getZ(i); }
  g.setAttribute('position', new THREE.BufferAttribute(flat, 3));
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
  const welded = mergeVertices(g, 1e-5);
  g.dispose();
  welded.computeVertexNormals();
  return welded;
}

/** About LABEL_SAMPLES points spread over a vessel (farthest-point sampling of its vertices, deterministic), each with its direction away from the heart centre. */
function labelSamples(pos: Float32Array, centre: THREE.Vector3): { p: THREE.Vector3; out: THREE.Vector3; d: number }[] {
  const n = pos.length / 3;
  if (!n) return [];
  const stride = Math.max(1, Math.floor(n / 1500));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i += stride) pts.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  const mean = new THREE.Vector3();
  for (const p of pts) mean.add(p);
  mean.divideScalar(pts.length);
  const picked: THREE.Vector3[] = [pts.reduce((a, b) => (b.distanceToSquared(mean) < a.distanceToSquared(mean) ? b : a))]; // start at the trunk (nearest to the centroid)
  const dmin = pts.map((p) => p.distanceToSquared(picked[0]));
  while (picked.length < Math.min(LABEL_SAMPLES, pts.length)) {
    let bi = 0;
    for (let i = 1; i < pts.length; i++) if (dmin[i] > dmin[bi]) bi = i;
    picked.push(pts[bi]);
    for (let i = 0; i < pts.length; i++) dmin[i] = Math.min(dmin[i], pts[i].distanceToSquared(pts[bi]));
  }
  return picked.map((p) => ({ p, out: p.clone().sub(centre).normalize(), d: p.distanceTo(mean) }));
}

/** World-space triangle list of a vessel's parts (the model never moves, so this is computed once). */
function triangleSoup(parts: THREE.Mesh[]): { pos: Float32Array; idx: Uint32Array } {
  const pos: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of parts) {
    mesh.updateWorldMatrix(true, false);
    const p = mesh.geometry.attributes.position, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); pos.push(v.x, v.y, v.z); }
    const ix = mesh.geometry.index;
    const count = ix ? ix.count : p.count;
    for (let i = 0; i < count; i++) idx.push(base + (ix ? ix.getX(i) : i));
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

function disposeMaterials(m: THREE.Material | THREE.Material[]): void {
  for (const x of Array.isArray(m) ? m : [m]) x.dispose();
}
