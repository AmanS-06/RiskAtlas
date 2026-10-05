// AtlasViewer: the interactive heart of the new UI. Vanilla three.js, framework-free; React talks to it through the small API below.
//
// What it does that the first viewer did not: every structure of the heart can be pointed at (hover and click), a continuous heartbeat
// driven by the patient's pulse rate, the muscle tinted by the artery that supplies it (approximate territory), a holographic and a realistic
// look behind one switch, bloom on real GPUs, and screen positions of every region so the page can draw its HUD panels and leader lines.
// Pure logic lives in logic.ts (tested); materials in shaders.ts.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { applyUncertainty, easeInOutCubic, isSoftwareRenderer } from '../viewer/viewerLogic';
import {
  BEAT_SCALE,
  REGIONS,
  beatPeriod,
  beatPose,
  clampBpm,
  qualityFor,
  regionOfNode,
  shouldDowngrade,
  subsample,
  territoryWeights,
  type Quality,
  type QualityTier,
  type RegionDef,
} from './logic';
import { holoMaterial, makeShared, realMaterial, vesselMaterial, type Shared } from './shaders';

export type AtlasStyle = 'holo' | 'real';

export interface AtlasVesselState {
  probability: number;
  band: string;
  color: string;
  uncertaintyWidth?: number;
}

export interface AtlasOptions {
  container: HTMLElement;
  modelUrl: string;
  liteModelUrl: string;
  style?: AtlasStyle;
  quality?: QualityTier;
  reducedMotion?: boolean;
  /** CSS colour of the stage behind the heart (the canvas is opaque so bloom works). */
  background?: string;
  /** No render loop and no orbit controls: the caller advances time with stepManual(). Used to render the landing page video frame by frame. */
  manual?: boolean;
}

/** Screen position of a region's anchor, CSS px from the container's top-left. */
export interface RegionPoint {
  id: string;
  x: number;
  y: number;
  /** 0 (facing away) to 1 (facing the camera) */
  facing: number;
}

export interface HoverInfo {
  id: string;
  x: number;
  y: number;
}

export interface AtlasStatus {
  loaded: boolean;
  tier: QualityTier;
  software: boolean;
  renderer: string;
  triangles: number;
  fps: number | undefined;
  error: string | null;
}

type Group = 'ventricle' | 'atria' | 'aorta';
const GROUP_OF: Record<string, Group> = {
  LAD: 'ventricle',
  LCX: 'ventricle',
  RCA: 'ventricle',
  left_main: 'ventricle',
  left_ventricle: 'ventricle',
  right_ventricle: 'ventricle',
  left_atrium: 'atria',
  right_atrium: 'atria',
  pulmonary_veins: 'atria',
  superior_vena_cava: 'atria',
  ascending_aorta: 'aorta',
  pulmonary_trunk: 'aorta',
};

const ARTERIES = ['LAD', 'LCX', 'RCA'] as const;
const HOLO_COLOR: Record<string, string> = { chamber: '#38c8ff', great: '#5aa6ff', minor: '#2a8fc4', vessel: '#38c8ff' };
const REAL_COLOR: Record<string, string> = {
  left_ventricle: '#b9807c',
  right_ventricle: '#c18c87',
  left_atrium: '#c79b95',
  right_atrium: '#bf8f94',
  ascending_aorta: '#cf8f84',
  pulmonary_trunk: '#7f92bd',
  superior_vena_cava: '#7489b8',
  pulmonary_veins: '#cb94a0',
};
const NEUTRAL_VESSEL = '#9fb8cc';
const FOV = 35;
const HOME_DIR = new THREE.Vector3(0.85, 0.3, 1).normalize();
const INFLATE = 0.006;
const CLICK_SLOP = 5;
const PICK_TOLERANCE = 0.04;
const TWEEN_MS = 650;

interface RegionRuntime {
  def: RegionDef;
  meshes: THREE.Mesh[];
  holo: THREE.ShaderMaterial[];
  real: THREE.ShaderMaterial[];
  vessel: THREE.ShaderMaterial | null;
  group: Group;
  anchor: THREE.Vector3;
  outward: THREE.Vector3;
  centroid: THREE.Vector3;
  radius: number;
  live: boolean;
  highlight: number;
  dim: number;
  hasData: boolean;
}

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

function probe(): { webgl: boolean; software: boolean; renderer: string } {
  try {
    const gl = (document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { webgl: false, software: false, renderer: 'none' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl: true, software: isSoftwareRenderer(renderer), renderer };
  } catch {
    return { webgl: false, software: false, renderer: 'error' };
  }
}

/** A copy with plain float attributes (glTF files may interleave or quantise them), moved into world space. */
function plainGeometry(src: THREE.BufferGeometry, world: THREE.Matrix4): THREE.BufferGeometry {
  const pos = src.getAttribute('position');
  const position = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    position[i * 3] = pos.getX(i);
    position[i * 3 + 1] = pos.getY(i);
    position[i * 3 + 2] = pos.getZ(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  const nor = src.getAttribute('normal');
  if (nor) {
    const normal = new Float32Array(nor.count * 3);
    for (let i = 0; i < nor.count; i++) {
      normal[i * 3] = nor.getX(i);
      normal[i * 3 + 1] = nor.getY(i);
      normal[i * 3 + 2] = nor.getZ(i);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  g.applyMatrix4(world);
  return g;
}

export class AtlasViewer {
  private readonly opts: AtlasOptions;
  private readonly container: HTMLElement;
  private readonly reduced: boolean;
  private readonly env: { webgl: boolean; software: boolean; renderer: string };
  private quality: Quality;
  private style: AtlasStyle;

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
  private controls: OrbitControls | null = null;
  private readonly root = new THREE.Group();
  private readonly shared: Shared = makeShared();
  private halo: THREE.Mesh | null = null;
  private floor: THREE.Group | null = null;
  private dust: THREE.Points | null = null;

  private readonly regions = new Map<string, RegionRuntime>();
  private pickMeshes: THREE.Mesh[] = [];
  private vesselMeshes: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();

  private states: Record<string, AtlasVesselState | undefined> = {};
  private overall: { color: string; probability: number } | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  private bpm = clampBpm(null);
  private phase = 0;
  private t = 0;
  private last = 0;
  private scanning = false;
  private scanT = 0;
  private radius = 0.9;
  private homeDist = 2.8;
  private tween: { start: number; dur: number; from: Pose; to: Pose; done: () => void } | null = null;
  private focused = false;
  private interactedAt = -Infinity;
  private pivot = new THREE.Vector3();
  private backdrop: { meshes: THREE.Mesh[]; materials: THREE.ShaderMaterial[] } | null = null;
  private shift = 0;
  private shiftTarget = 0;
  private shiftApplied = Number.NaN;

  private raf = 0;
  private running = false;
  private visible = true;
  private disposed = false;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private error: string | null = null;
  private triangles = 0;
  private frameTimes: number[] = [];
  private fpsEst: number | undefined;
  private lastFpsAt = 0;
  private fpsFrames = 0;

  private pending: { x: number; y: number } | null = null;
  private down: { x: number; y: number; at: number } | null = null;
  private lastPoints = '';

  private readonly selectCbs = new Set<(id: string | null) => void>();
  private readonly hoverCbs = new Set<(h: HoverInfo | null) => void>();
  private readonly pointCbs = new Set<(p: RegionPoint[]) => void>();
  private readonly disposers: (() => void)[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private intersection: IntersectionObserver | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(opts: AtlasOptions) {
    this.opts = opts;
    this.container = opts.container;
    this.env = probe();
    this.reduced = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.quality = qualityFor(this.env.software, opts.quality);
    this.style = opts.style ?? 'holo';
    if (!this.env.webgl) {
      this.error = 'WebGL is not available in this browser.';
      return;
    }
    this.scene.background = new THREE.Color(opts.background ?? '#050b14');
    this.scene.add(this.root);
    this.scene.add(this.camera);
    this.createRenderer();
    this.buildBackdrop();
    this.attach();
  }

  // ---- public API ----------------------------------------------------------

  /** Loads the model. Never rejects: a failure is reported through getStatus().error. */
  load(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  setStyle(style: AtlasStyle): void {
    this.style = style;
    this.applyStyle();
  }

  getStyle(): AtlasStyle {
    return this.style;
  }

  /** Heart rate in beats per minute (from the pulse-rate input). Missing or silly values fall back to a resting rate. */
  setBpm(bpm: number | null | undefined): void {
    this.bpm = clampBpm(bpm);
  }

  /** Vessel states keyed by mesh name (LAD, LCX, RCA). `undefined` clears a vessel back to neutral. */
  setVessels(states: Record<string, AtlasVesselState | undefined>): void {
    this.states = { ...this.states, ...states };
    this.applyStates();
  }

  setOverall(state: { color: string; probability: number } | null): void {
    this.overall = state;
    this.applyOverall();
  }

  /** Regions that carry data. They are drawn brighter and get panels; the rest can be named but have nothing to show. */
  setLive(ids: ReadonlySet<string>): void {
    for (const r of this.regions.values()) r.live = ids.has(r.def.id);
    this.applyLive();
  }

  setTerritory(on: boolean): void {
    this.shared.terrOn.value = on ? 1 : 0;
  }

  /** A scan sweeps over the heart while the full prediction (about 2.6 s) is being computed. */
  setScanning(on: boolean): void {
    if (on && !this.scanning) this.scanT = 0;
    this.scanning = on && this.quality.scan && !this.reduced;
    if (!this.scanning) this.shared.scanAmt.value = 0;
  }

  select(id: string | null): void {
    if (id !== null && !this.regions.has(id)) {
      if (this.loaded) console.warn(`[AtlasViewer] select: unknown region "${id}" ignored`);
      this.selected = id;
      return;
    }
    if (this.selected === id) return;
    this.selected = id;
    this.applyFocus();
    if (id) this.flyTo(id);
    else if (this.focused) this.resetView();
    this.emitSelect();
  }

  getSelected(): string | null {
    return this.selected;
  }

  /** Slide the heart sideways within the canvas, as a share of its width (positive = to the left), to make room for a panel. Eased. */
  setShift(frac: number): void {
    this.shiftTarget = Math.max(-0.4, Math.min(0.4, frac));
  }

  onSelect(cb: (id: string | null) => void): () => void {
    this.selectCbs.add(cb);
    return () => this.selectCbs.delete(cb);
  }

  onHover(cb: (h: HoverInfo | null) => void): () => void {
    this.hoverCbs.add(cb);
    return () => this.hoverCbs.delete(cb);
  }

  onPoints(cb: (p: RegionPoint[]) => void): () => void {
    this.pointCbs.add(cb);
    this.lastPoints = '';
    return () => this.pointCbs.delete(cb);
  }

  /** Camera moves to face a region. Resolves when the move is finished. */
  flyTo(id: string): Promise<void> {
    const r = this.regions.get(id);
    if (!r || !this.controls) return Promise.resolve();
    const dir = r.outward.clone().multiplyScalar(0.85).add(HOME_DIR.clone().multiplyScalar(0.35)).normalize();
    const dist = r.def.kind === 'vessel' ? Math.max(1.15, Math.min(this.homeDist, r.radius * 3.2 + 0.9)) : this.homeDist * 0.92;
    const target = r.centroid.clone().multiplyScalar(0.9);
    this.focused = true;
    return this.startTween({ pos: target.clone().add(dir.multiplyScalar(dist)), target });
  }

  resetView(): Promise<void> {
    this.focused = false;
    const target = new THREE.Vector3(0, 0.05, 0);
    return this.startTween({ pos: target.clone().add(HOME_DIR.clone().multiplyScalar(this.homeDist)), target });
  }

  resize(): void {
    if (this.disposed || !this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.refit();
  }

  /** PNG data URL of the current frame (for the report). */
  snapshot(): string | null {
    if (!this.renderer || !this.canvas) return null;
    this.renderFrame();
    return this.canvas.toDataURL('image/png');
  }

  getStatus(): AtlasStatus {
    return {
      loaded: this.loaded,
      tier: this.quality.tier,
      software: this.env.software,
      renderer: this.env.renderer,
      triangles: this.triangles,
      fps: this.fpsEst,
      error: this.error,
    };
  }

  regionIds(): string[] {
    return [...this.regions.keys()];
  }

  /**
   * A translucent X-ray copy of another model (the bony thorax) drawn around the heart, in the heart's own frame. Not pickable. Used by the landing video.
   */
  async addBackdrop(url: string, color = '#bfe8ff'): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.updateWorldMatrix(true, true);
    const meshes: THREE.Mesh[] = [];
    const materials: THREE.ShaderMaterial[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = plainGeometry(m.geometry, m.matrixWorld);
      geo.translate(-this.pivot.x, -this.pivot.y, -this.pivot.z);
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      const n = geo.getAttribute('position').count;
      geo.setAttribute('aTerr', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('aCover', new THREE.BufferAttribute(new Float32Array(n), 1));
      const mat = holoMaterial(this.shared, color, 0.5);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 0;
      this.root.add(mesh);
      meshes.push(mesh);
      materials.push(mat);
    });
    this.backdrop = { meshes, materials };
  }

  /** 0 (hidden) to 1 (full) strength of the backdrop model. */
  setBackdropOpacity(a: number): void {
    if (!this.backdrop) return;
    for (const m of this.backdrop.materials) m.uniforms.uOpacity!.value = Math.max(0, Math.min(1, a));
    for (const m of this.backdrop.meshes) m.visible = a > 0.002;
  }

  /** Put the camera somewhere, at once (no tween, no controls). */
  setPose(pos: readonly [number, number, number], target: readonly [number, number, number]): void {
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.lookAt(target[0], target[1], target[2]);
    if (this.controls) this.controls.target.set(target[0], target[1], target[2]);
    this.camera.updateMatrixWorld(true);
  }

  /** Advance time by `dt` seconds and draw one frame. For manual mode, where the caller owns the clock. */
  stepManual(dt: number): void {
    if (!this.loaded || this.disposed) return;
    this.t += dt;
    this.update(dt, this.t * 1000);
    this.renderFrame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    for (const off of this.disposers.splice(0)) off();
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    for (const r of this.regions.values()) [...r.holo, ...r.real].forEach((m) => m.dispose());
    this.composer?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.canvas?.remove();
    this.selectCbs.clear();
    this.hoverCbs.clear();
    this.pointCbs.clear();
  }

  // ---- setup ---------------------------------------------------------------

  private createRenderer(): void {
    const renderer = new THREE.WebGLRenderer({ antialias: !this.composer, powerPreference: 'high-performance' });
    renderer.setClearColor(new THREE.Color(this.opts.background ?? '#050b14'), 1);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.container.appendChild(this.canvas);
    if (this.quality.bloom) {
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.7, 0.62);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 0.9;
    this.controls.maxDistance = 6;
    this.controls.autoRotateSpeed = 0.55;
    this.camera.position.copy(HOME_DIR).multiplyScalar(this.homeDist);
  }

  private buildBackdrop(): void {
    // overall-risk halo behind the heart
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#38c8ff') }, uOpacity: { value: 0.0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; void main(){ float r = length(vUv*2.0-1.0); float a = smoothstep(1.0,0.05,r); gl_FragColor = vec4(uColor, a*a*uOpacity);\n#include <colorspace_fragment>\n}',
      }),
    );
    halo.renderOrder = -2;
    this.halo = halo;
    this.scene.add(halo);

    // holographic floor: rings and ticks
    const floor = new THREE.Group();
    const ringMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#38c8ff'),
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const rad of [0.62, 0.92, 1.25]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 128; i++) pts.push(new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * rad, 0, Math.sin((i / 128) * Math.PI * 2) * rad));
      floor.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }
    const tick: THREE.Vector3[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const inner = i % 6 === 0 ? 1.12 : 1.19;
      tick.push(new THREE.Vector3(Math.cos(a) * inner, 0, Math.sin(a) * inner), new THREE.Vector3(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25));
    }
    floor.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tick), ringMat));
    floor.position.y = -0.78;
    this.floor = floor;
    this.scene.add(floor);

    if (this.quality.particles) {
      const n = 420;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 0.9 + Math.random() * 1.1;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.dust = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: new THREE.Color('#7fdcff'),
          size: 1.6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.scene.add(this.dust);
    }
    this.applyStyle();
  }

  private attach(): void {
    const c = this.canvas;
    if (!c) return;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(type, fn as EventListener);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on(c, 'pointermove', (e) => {
      if (this.down) return;
      const r = c.getBoundingClientRect();
      this.pending = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    on(c, 'pointerleave', () => {
      this.pending = null;
      this.setHover(null, 0, 0);
    });
    on(c, 'pointerdown', (e) => {
      const r = c.getBoundingClientRect();
      this.down = { x: e.clientX - r.left, y: e.clientY - r.top, at: performance.now() };
      this.interactedAt = performance.now();
      this.tween = null;
    });
    on(c, 'pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (Math.hypot(x - d.x, y - d.y) > CLICK_SLOP || performance.now() - d.at > 600) return;
      const id = this.pick(x, y);
      this.select(id);
    });
    on(c, 'wheel', () => {
      this.interactedAt = performance.now();
    });
    on(c, 'dblclick', () => {
      this.select(null);
      void this.resetView();
    });
    c.tabIndex = 0;
    c.setAttribute('role', 'application');
    c.setAttribute(
      'aria-label',
      'Interactive 3D heart. Drag to rotate, scroll to zoom, click a structure to inspect it. Arrow keys move between structures that have data, Escape clears.',
    );
    on(c, 'keydown', (e) => {
      if (e.key === 'Escape') {
        this.select(null);
        return;
      }
      if (e.key === 'r' || e.key === 'Home') {
        void this.resetView();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const live = [...this.regions.values()].filter((r) => r.live).map((r) => r.def.id);
        if (live.length === 0) return;
        const i = this.selected ? live.indexOf(this.selected) : -1;
        const next = e.key === 'ArrowRight' ? (i + 1) % live.length : (i - 1 + live.length) % live.length;
        this.select(live[next < 0 ? 0 : next] ?? null);
        e.preventDefault();
      }
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.start();
      else this.stop();
    });
    this.intersection.observe(this.container);
    const vis = () => (document.hidden ? this.stop() : this.visible && this.start());
    document.addEventListener('visibilitychange', vis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', vis));
  }

  // ---- model ---------------------------------------------------------------

  private async doLoad(): Promise<void> {
    if (!this.renderer) return;
    const urls = this.quality.lite ? [this.opts.liteModelUrl, this.opts.modelUrl] : [this.opts.modelUrl, this.opts.liteModelUrl];
    let gltf: { scene: THREE.Group } | null = null;
    for (const url of urls) {
      try {
        gltf = await new GLTFLoader().loadAsync(url);
        break;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
    }
    if (this.disposed) return;
    if (!gltf) return;
    this.error = null;
    this.build(gltf.scene);
    this.loaded = true;
    this.resize();
    this.resetViewInstant();
    this.applyStates();
    this.applyLive();
    this.applyStyle();
    this.start();
  }

  private build(scene: THREE.Group): void {
    scene.updateWorldMatrix(true, true);
    const parts: { node: string; geo: THREE.BufferGeometry }[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      parts.push({ node: m.name, geo: plainGeometry(m.geometry, m.matrixWorld) });
    });

    // pivot of the beat: the middle of the four chambers
    const box = new THREE.Box3();
    for (const p of parts) if (/^(left|right)_(atrium|ventricle)$/.test(p.node)) box.expandByObject(new THREE.Mesh(p.geo));
    const pivot = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    this.pivot.copy(pivot);
    for (const p of parts) p.geo.translate(-pivot.x, -pivot.y, -pivot.z);

    const arteryPoints: Float32Array[] = [];
    const arteryByName = new Map<string, Float32Array>();
    for (const p of parts) {
      if (p.node === 'LAD' || p.node === 'LCX' || p.node === 'RCA') {
        const pts = subsample(p.geo.getAttribute('position').array as Float32Array, 3);
        arteryByName.set(p.node, pts);
      }
    }
    for (const a of ARTERIES) arteryPoints.push(arteryByName.get(a) ?? new Float32Array(0));

    const centreOfHeart = new THREE.Vector3(0, 0, 0);
    const all = new THREE.Box3();
    for (const p of parts) {
      const def = regionOfNode(p.node);
      if (!def) continue;
      let geo = p.geo;
      const isVessel = def.kind === 'vessel';
      if (isVessel) {
        geo.deleteAttribute('uv');
        geo = mergeVertices(geo, 1e-4);
        geo.computeVertexNormals();
        const pos = geo.getAttribute('position');
        const nor = geo.getAttribute('normal');
        for (let i = 0; i < pos.count; i++)
          pos.setXYZ(i, pos.getX(i) + nor.getX(i) * INFLATE, pos.getY(i) + nor.getY(i) * INFLATE, pos.getZ(i) + nor.getZ(i) * INFLATE);
        pos.needsUpdate = true;
      } else if (!geo.getAttribute('normal')) {
        geo.computeVertexNormals();
      }
      // territory attributes on every mesh (zeros where they do not apply) so one shader serves all
      const n = geo.getAttribute('position').count;
      let weights = new Float32Array(n * 3);
      let cover = new Float32Array(n);
      if (def.id === 'left_ventricle' || def.id === 'right_ventricle') {
        const t = territoryWeights(geo.getAttribute('position').array, arteryPoints, 0.16);
        weights = Float32Array.from(t.weights);
        cover = Float32Array.from(t.cover);
      }
      geo.setAttribute('aTerr', new THREE.BufferAttribute(weights, 3));
      geo.setAttribute('aCover', new THREE.BufferAttribute(cover, 1));
      geo.computeBoundingSphere();
      all.expandByObject(new THREE.Mesh(geo));
      this.triangles += (geo.index ? geo.index.count : n) / 3;

      let rt = this.regions.get(def.id);
      if (!rt) {
        rt = {
          def,
          meshes: [],
          holo: [],
          real: [],
          vessel: null,
          group: GROUP_OF[def.id] ?? 'ventricle',
          anchor: new THREE.Vector3(),
          outward: new THREE.Vector3(0, 0, 1),
          centroid: new THREE.Vector3(),
          radius: 0.3,
          live: false,
          highlight: 0,
          dim: 1,
          hasData: false,
        };
        if (isVessel) rt.vessel = vesselMaterial(this.shared, NEUTRAL_VESSEL);
        this.regions.set(def.id, rt);
      }
      const holo = isVessel ? (rt.vessel as THREE.ShaderMaterial) : holoMaterial(this.shared, HOLO_COLOR[def.kind] ?? '#38c8ff', 0.7);
      const real = isVessel ? (rt.vessel as THREE.ShaderMaterial) : realMaterial(this.shared, REAL_COLOR[def.id] ?? '#a8403f');
      if (!isVessel) {
        rt.holo.push(holo);
        rt.real.push(real);
      }
      const mesh = new THREE.Mesh(geo, holo);
      mesh.userData.regionId = def.id;
      mesh.userData.holo = holo;
      mesh.userData.real = real;
      mesh.renderOrder = isVessel ? 1 : 2;
      this.root.add(mesh);
      rt.meshes.push(mesh);
      this.pickMeshes.push(mesh);
      if (isVessel) this.vesselMeshes.push(mesh);
    }

    // region geometry facts: centroid, size, an anchor on the surface and the way out
    for (const rt of this.regions.values()) {
      const b = new THREE.Box3();
      for (const m of rt.meshes) b.expandByObject(m);
      b.getCenter(rt.centroid);
      rt.radius = b.getSize(new THREE.Vector3()).length() / 2;
      rt.outward.copy(rt.centroid).sub(centreOfHeart);
      if (rt.outward.lengthSq() < 1e-6) rt.outward.set(0, 0, 1);
      rt.outward.normalize();
      rt.anchor.copy(this.surfaceAnchor(rt));
      if (rt.def.kind !== 'vessel') rt.hasData = false;
    }
    const sph = all.getBoundingSphere(new THREE.Sphere());
    this.radius = sph.radius;
    this.shared.near.value = this.homeDist - this.radius * 0.6;
    this.shared.far.value = this.homeDist + this.radius * 1.2;
  }

  /** A point on the region's own surface: the nearest vertex to its centre for tube-like parts, the outermost vertex along the way out for chambers. */
  private surfaceAnchor(rt: RegionRuntime): THREE.Vector3 {
    const out = new THREE.Vector3();
    const v = new THREE.Vector3();
    let best = rt.def.kind === 'chamber' ? -Infinity : Infinity;
    for (const m of rt.meshes) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (rt.def.kind === 'chamber') {
          const s = v.clone().sub(rt.centroid).dot(rt.outward);
          if (s > best) {
            best = s;
            out.copy(v);
          }
        } else {
          const d = v.distanceToSquared(rt.centroid);
          if (d < best) {
            best = d;
            out.copy(v);
          }
        }
      }
    }
    return out;
  }

  // ---- state to visuals ----------------------------------------------------

  private applyStyle(): void {
    const holo = this.style === 'holo';
    if (this.floor) this.floor.visible = holo;
    if (this.dust) this.dust.visible = holo && this.quality.particles;
    this.scene.background = new THREE.Color(holo ? (this.opts.background ?? '#050b14') : '#0a0f16');
    this.renderer?.setClearColor(this.scene.background as THREE.Color, 1);
    if (this.bloom) {
      this.bloom.strength = holo ? 0.55 : 0.28;
      this.bloom.threshold = holo ? 0.62 : 0.8;
    }
    for (const r of this.regions.values()) {
      for (const m of r.meshes) m.material = holo ? (m.userData.holo as THREE.Material) : (m.userData.real as THREE.Material);
    }
    this.applyLive();
  }

  private applyLive(): void {
    for (const r of this.regions.values()) {
      const base = r.live ? 1 : 0.5;
      for (const m of r.holo) m.uniforms.uOpacity!.value = r.def.kind === 'minor' ? 0.45 : base;
    }
  }

  private colourOf(id: string): string {
    const s = this.states[id];
    return s ? applyUncertainty(s.color, s.uncertaintyWidth) : NEUTRAL_VESSEL;
  }

  private applyStates(): void {
    for (const id of ARTERIES) {
      const r = this.regions.get(id);
      const s = this.states[id];
      const hex = this.colourOf(id);
      if (r?.vessel) {
        (r.vessel.uniforms.uColor!.value as THREE.Color).set(hex);
        r.vessel.uniforms.uGlow!.value = s ? 1.1 + 0.5 * Math.min(1, Math.max(0, s.probability)) : 0.8;
      }
      const k = ARTERIES.indexOf(id);
      (this.shared.terrCol.value[k] as THREE.Color).set(hex);
      this.shared.terrAmt.value[k] = s ? Math.min(1, Math.max(0, s.probability)) ** 0.85 : 0;
    }
    const lm = this.regions.get('left_main');
    if (lm?.vessel) {
      const a = this.states.LAD;
      const b = this.states.LCX;
      const top = a && b ? (a.probability >= b.probability ? a : b) : (a ?? b);
      (lm.vessel.uniforms.uColor!.value as THREE.Color).set(top ? applyUncertainty(top.color, top.uncertaintyWidth) : NEUTRAL_VESSEL);
    }
    for (const r of this.regions.values()) r.hasData = r.def.kind === 'vessel' && !!this.states[r.def.id];
  }

  private applyOverall(): void {
    const mat = this.halo?.material as THREE.ShaderMaterial | undefined;
    if (!mat) return;
    const o = this.overall;
    (mat.uniforms.uColor!.value as THREE.Color).set(o ? o.color : '#38c8ff');
    mat.uniforms.uOpacity!.value = o ? 0.1 + 0.32 * Math.min(1, Math.max(0, o.probability)) : 0.05;
  }

  private applyFocus(): void {
    // dimming is animated per frame toward these targets
  }

  // ---- picking -------------------------------------------------------------

  private ndc(x: number, y: number): THREE.Vector2 {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    return new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
  }

  private castFrom(x: number, y: number, meshes: THREE.Object3D[]): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    return this.raycaster.intersectObjects(meshes, false);
  }

  /** Region under a screen point. Arteries win when they are at or just behind the first surface hit, and a thin artery is found within a few pixels. */
  private pick(x: number, y: number): string | null {
    this.root.updateMatrixWorld(true);
    const hits = this.castFrom(x, y, this.pickMeshes);
    const first = hits[0];
    const regionOf = (h: THREE.Intersection) => h.object.userData.regionId as string;
    if (first) {
      const firstId = regionOf(first);
      if (this.regions.get(firstId)?.def.kind === 'vessel') return firstId;
      const artery = hits.find((h) => this.regions.get(regionOf(h))?.def.kind === 'vessel' && h.distance - first.distance < PICK_TOLERANCE);
      if (artery) return regionOf(artery);
    }
    let best: THREE.Intersection | null = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const near = this.castFrom(x + Math.cos(a) * 8, y + Math.sin(a) * 8, this.vesselMeshes)[0];
      if (near && (!best || near.distance < best.distance)) best = near;
    }
    if (best && (!first || best.distance - first.distance < PICK_TOLERANCE)) return regionOf(best);
    return first ? regionOf(first) : null;
  }

  private setHover(id: string | null, x: number, y: number): void {
    if (this.hovered === id) {
      if (id) for (const cb of this.hoverCbs) cb({ id, x, y });
      return;
    }
    this.hovered = id;
    if (this.canvas) this.canvas.style.cursor = id ? 'pointer' : '';
    for (const cb of this.hoverCbs) cb(id ? { id, x, y } : null);
  }

  // ---- camera --------------------------------------------------------------

  private refit(): void {
    const hfov = 2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * this.camera.aspect);
    const fov = Math.min((FOV * Math.PI) / 180, hfov);
    this.homeDist = Math.max(1.6, (this.radius * 1.15) / Math.tan(fov / 2));
    if (!this.focused && !this.tween && this.controls) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(this.homeDist));
    }
    this.shared.near.value = this.homeDist - this.radius * 0.6;
    this.shared.far.value = this.homeDist + this.radius * 1.2;
  }

  private resetViewInstant(): void {
    if (!this.controls) return;
    this.focused = false;
    this.controls.target.set(0, 0.05, 0);
    this.camera.position.copy(this.controls.target).add(HOME_DIR.clone().multiplyScalar(this.homeDist));
    this.controls.update();
  }

  private startTween(to: Pose): Promise<void> {
    if (!this.controls) return Promise.resolve();
    if (this.reduced) {
      this.controls.target.copy(to.target);
      this.camera.position.copy(to.pos);
      this.controls.update();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tween = {
        start: performance.now(),
        dur: TWEEN_MS,
        from: { pos: this.camera.position.clone(), target: this.controls!.target.clone() },
        to,
        done: resolve,
      };
    });
  }

  // ---- loop ----------------------------------------------------------------

  private start(): void {
    if (this.running || this.disposed || !this.loaded || document.hidden || this.opts.manual) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.fpsFrames++;
    if (now - this.lastFpsAt > 1000) {
      this.fpsEst = Math.round((this.fpsFrames * 1000) / (now - this.lastFpsAt));
      this.fpsFrames = 0;
      this.lastFpsAt = now;
      if (this.quality.bloom && this.fpsEst < 20 && shouldDowngrade(this.frameTimes, 40, 60)) this.downgrade();
    }
    this.t += dt;
    this.update(dt, now);
    this.renderFrame();
    this.emitPoints();
  };

  private update(dt: number, now: number): void {
    // heartbeat
    if (!this.reduced) this.phase = (this.phase + dt / beatPeriod(this.bpm)) % 1;
    const pose = beatPose(this.reduced ? 0.26 : this.phase);
    const sv = 1 - BEAT_SCALE.ventricle * pose.ventricle;
    const sa = 1 - BEAT_SCALE.atria * pose.atria + 0.01 * pose.ventricle;
    const so = 1 + BEAT_SCALE.aorta * pose.aorta;
    for (const r of this.regions.values()) {
      const s = r.group === 'ventricle' ? sv : r.group === 'atria' ? sa : so;
      for (const m of r.meshes) m.scale.setScalar(s);
    }
    this.shared.time.value = this.t;
    this.shared.beat.value = this.reduced ? 0 : Math.max(pose.ventricle * 0.7, pose.dub * 0.45);
    if (this.floor && this.style === 'holo') this.floor.rotation.y = this.t * 0.08;
    if (this.dust) this.dust.rotation.y = this.t * 0.03;
    if (this.halo) {
      this.halo.quaternion.copy(this.camera.quaternion);
      const m = this.halo.material as THREE.ShaderMaterial;
      const o = this.overall;
      if (o) m.uniforms.uOpacity!.value = (0.1 + 0.32 * Math.min(1, Math.max(0, o.probability))) * (0.85 + 0.3 * this.shared.beat.value);
    }

    // scan sweep while the full prediction is computed
    if (this.scanning) {
      this.scanT += dt;
      const p = (this.scanT % 1.6) / 1.6;
      this.shared.scanY.value = -0.75 + p * 1.6;
      this.shared.scanAmt.value = Math.sin(p * Math.PI);
    }

    // highlight and focus dimming, eased
    const k = 1 - Math.exp(-dt * 12);
    for (const r of this.regions.values()) {
      const selected = this.selected === r.def.id;
      const hovered = this.hovered === r.def.id;
      const pulse = selected && !this.reduced ? 0.08 * Math.sin(this.t * 5) : 0;
      const body = r.def.kind !== 'vessel'; // large surfaces would wash out at full strength
      const tHigh = selected ? (body ? 0.32 : 1) + pulse : hovered ? (body ? 0.2 : 0.55) : 0;
      r.highlight += (tHigh - r.highlight) * k;
      const tDim = this.selected && !selected ? 0.38 : 1;
      r.dim += (tDim - r.dim) * k;
      for (const m of r.holo) {
        m.uniforms.uHighlight!.value = r.highlight;
        m.uniforms.uDim!.value = r.dim;
      }
      for (const m of r.real) {
        m.uniforms.uHighlight!.value = r.highlight;
        m.uniforms.uDim!.value = r.dim;
      }
      if (r.vessel) {
        r.vessel.uniforms.uHighlight!.value = r.highlight;
        r.vessel.uniforms.uDim!.value = r.dim;
      }
    }

    // sideways shift of the whole picture, to leave room for the region panel
    if (this.shift !== this.shiftTarget) {
      this.shift += (this.shiftTarget - this.shift) * (this.reduced ? 1 : 1 - Math.exp(-dt * 7));
      if (Math.abs(this.shift - this.shiftTarget) < 0.0005) this.shift = this.shiftTarget;
    }
    if (this.shift !== this.shiftApplied) {
      this.shiftApplied = this.shift;
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      if (this.shift === 0) this.camera.clearViewOffset();
      else this.camera.setViewOffset(w, h, this.shift * w, 0, w, h);
    }

    // camera tween, auto-rotate, hover pick
    if (this.tween && this.controls) {
      const tw = this.tween;
      const p = Math.min(1, (now - tw.start) / tw.dur);
      const e = easeInOutCubic(p);
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, e);
      if (p >= 1) {
        this.tween = null;
        tw.done();
      }
    }
    if (this.controls && !this.opts.manual) {
      this.controls.autoRotate = this.style === 'holo' && !this.reduced && !this.selected && !this.tween && now - this.interactedAt > 5000;
      this.controls.update();
    }
    if (this.pending && !this.opts.manual) {
      const { x, y } = this.pending;
      this.pending = null;
      this.root.updateMatrixWorld(true);
      this.setHover(this.pick(x, y), x, y);
    }
  }

  private renderFrame(): void {
    if (!this.renderer) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private downgrade(): void {
    // the machine cannot hold bloom: drop it and lower the resolution once
    this.quality = { ...this.quality, bloom: false, maxPixelRatio: 1, particles: false };
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (this.dust) this.dust.visible = false;
    this.resize();
  }

  // ---- outputs -------------------------------------------------------------

  private emitSelect(): void {
    for (const cb of this.selectCbs) cb(this.selected);
  }

  private emitPoints(): void {
    if (this.pointCbs.size === 0) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const toCam = new THREE.Vector3();
    const world = new THREE.Vector3();
    const out: RegionPoint[] = [];
    for (const r of this.regions.values()) {
      const s = r.meshes[0]?.scale.x ?? 1;
      world.copy(r.anchor).multiplyScalar(s);
      const nor = r.outward;
      toCam.copy(this.camera.position).sub(world).normalize();
      const facing = Math.max(0, Math.min(1, nor.dot(toCam) * 1.4 + 0.3));
      const p = world.clone().project(this.camera);
      out.push({ id: r.def.id, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, facing });
    }
    const key = out.map((p) => `${p.id}:${p.x.toFixed(0)},${p.y.toFixed(0)},${p.facing.toFixed(1)}`).join('|');
    if (key === this.lastPoints) return;
    this.lastPoints = key;
    for (const cb of this.pointCbs) cb(out);
  }

  /** Region definitions present in the model, for the HUD list. */
  static regions(): readonly RegionDef[] {
    return REGIONS;
  }
}
