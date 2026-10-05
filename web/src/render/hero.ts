// Frame-exact renderer for the landing page video. Dev only: web/render.html is not part of the production build.
// Driven by scripts/render_hero.mjs, which calls window.__frame(i, n) and screenshots the page after each call.
//
// The story the video tells, start to end: the bony thorax turns slowly, the camera dollies in between the ribs, the ribs fall away, and the three
// coronary arteries light up one after another in their risk colours on a beating heart.

import { AtlasViewer } from '../atlas/AtlasViewer';

const FPS = 30;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (t: number) => t * t * (3 - 2 * t);

type Key = { u: number; yaw: number; pitch: number; dist: number; ty: number };
const KEYS: Key[] = [
  { u: 0.0, yaw: 18, pitch: 7, dist: 7.4, ty: 0.25 },
  { u: 0.38, yaw: 52, pitch: 5, dist: 6.2, ty: 0.2 },
  { u: 0.62, yaw: 40, pitch: 9, dist: 3.7, ty: 0.08 },
  { u: 1.0, yaw: 28, pitch: 13, dist: 2.75, ty: 0.05 },
];

function pose(u: number): { pos: [number, number, number]; target: [number, number, number] } {
  let i = 0;
  while (i < KEYS.length - 2 && u > KEYS[i + 1]!.u) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = ease(clamp01((u - a.u) / (b.u - a.u)));
  const yaw = (lerp(a.yaw, b.yaw, t) * Math.PI) / 180;
  const pitch = (lerp(a.pitch, b.pitch, t) * Math.PI) / 180;
  const dist = lerp(a.dist, b.dist, t);
  const ty = lerp(a.ty, b.ty, t);
  return {
    pos: [Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist],
    target: [0, ty, 0],
  };
}

const RED = '#e04b4b';
const AMBER = '#e8a830';
const GREEN = '#3bb77e';
const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a) as [number, number, number];
  const [r2, g2, b2] = p(b) as [number, number, number];
  const c = (x: number, y: number) => Math.round(lerp(x, y, t)).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
};

declare global {
  interface Window {
    __ready?: boolean;
    __frame?: (i: number, n: number) => void;
  }
}

const viewer = new AtlasViewer({
  container: document.getElementById('c')!,
  modelUrl: '/models3d/heart.glb',
  liteModelUrl: '/models3d/heart_lite.glb',
  style: 'holo',
  quality: 'high',
  reducedMotion: false,
  manual: true,
  background: '#050b14',
});
await viewer.load();
await viewer.addBackdrop('/render-assets/thorax_skeleton.glb');
viewer.setBpm(64);
viewer.setLive(new Set(['LAD', 'LCX', 'RCA']));
viewer.resize();
let last = -1;

window.__frame = (i, n) => {
  const u = n <= 1 ? 0 : i / (n - 1);
  const dt = i === 0 || last < 0 ? 0 : 1 / FPS;
  last = i;
  const p = pose(u);
  viewer.setPose(p.pos, p.target);
  // ribs fall away as the camera arrives, never fully (a ghost of the body stays)
  viewer.setBackdropOpacity(u < 0.45 ? lerp(1, 0.85, u / 0.45) : lerp(0.85, 0.1, ease(clamp01((u - 0.45) / 0.3))));
  const ignite = (from: number, to: number) => ease(clamp01((u - from) / (to - from)));
  const neutral = '#9fb8cc';
  const lad = ignite(0.7, 0.78);
  const lcx = ignite(0.76, 0.84);
  const rca = ignite(0.82, 0.9);
  viewer.setVessels({
    LAD: { probability: 0.76 * lad + 0.1, band: 'high', color: mix(neutral, RED, lad) },
    LCX: { probability: 0.52 * lcx + 0.1, band: 'moderate', color: mix(neutral, AMBER, lcx) },
    RCA: { probability: 0.18 * rca + 0.1, band: 'low', color: mix(neutral, GREEN, rca) },
  });
  viewer.setOverall(u > 0.88 ? { color: RED, probability: 0.6 * ease(clamp01((u - 0.88) / 0.12)) } : null);
  viewer.stepManual(dt);
};
window.__ready = true;
