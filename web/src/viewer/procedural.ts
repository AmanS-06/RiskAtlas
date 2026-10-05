// Built-in procedural heart: the last fallback when no GLB can be loaded. Original code, no third-party asset.
// Same frame and node names as heart.glb (+X patient left, +Y up, +Z anterior, ~1 unit wide), so the viewer
// treats both alike. Chambers are ellipsoids, arteries are tapered tubes snapped onto the chamber surface.
// Anatomy is schematic (textbook groove positions), not a measured model.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

interface Chamber { name: string; c: V3; r: V3; rotZ: number }
const CHAMBERS: Chamber[] = [
  { name: 'left_ventricle', c: [0.18, -0.08, 0.02], r: [0.34, 0.38, 0.33], rotZ: -0.35 },
  { name: 'right_ventricle', c: [-0.04, -0.1, 0.25], r: [0.3, 0.34, 0.22], rotZ: -0.25 },
  { name: 'right_atrium', c: [-0.31, 0.06, 0.02], r: [0.19, 0.36, 0.3], rotZ: 0 },
  { name: 'left_atrium', c: [0.0, 0.17, -0.22], r: [0.36, 0.2, 0.24], rotZ: 0 },
];

const GREAT_VESSELS: { name: string; pts: V3[]; r0: number; r1: number }[] = [
  { name: 'ascending_aorta', pts: [[-0.03, 0.16, 0.03], [-0.05, 0.34, 0.05], [-0.12, 0.5, 0.01], [-0.22, 0.58, -0.08]], r0: 0.095, r1: 0.075 },
  { name: 'pulmonary_trunk', pts: [[0.06, 0.22, 0.22], [0.06, 0.38, 0.12], [0.03, 0.5, -0.06], [-0.08, 0.52, -0.22]], r0: 0.075, r1: 0.065 },
  { name: 'superior_vena_cava', pts: [[-0.33, 0.3, -0.02], [-0.33, 0.5, -0.02], [-0.31, 0.72, -0.03]], r0: 0.06, r1: 0.06 },
];

interface Segment { r: [number, number]; pts: V3[] }
// Node name -> branches merged into that single mesh. LAD, LCX, RCA are the manifest mesh names.
const ARTERIES: Record<string, Record<string, Segment>> = {
  left_coronary_artery: {
    stem: { r: [0.026, 0.024], pts: [[0.02, 0.25, 0.03], [0.07, 0.27, 0.04], [0.13, 0.27, 0.05]] },
  },
  LAD: {
    main: { r: [0.024, 0.01], pts: [[0.13, 0.27, 0.05], [0.2, 0.22, 0.1], [0.25, 0.15, 0.2], [0.26, 0.04, 0.31], [0.25, -0.08, 0.38], [0.26, -0.22, 0.38], [0.31, -0.34, 0.28]] },
    d1: { r: [0.013, 0.006], pts: [[0.2, 0.22, 0.1], [0.3, 0.14, 0.18], [0.38, 0.02, 0.22], [0.42, -0.12, 0.18]] },
    d2: { r: [0.011, 0.005], pts: [[0.25, 0.04, 0.31], [0.34, -0.06, 0.33], [0.42, -0.2, 0.26]] },
    septal: { r: [0.008, 0.004], pts: [[0.25, 0.04, 0.31], [0.17, 0.0, 0.27], [0.12, -0.1, 0.22]] },
  },
  LCX: {
    main: { r: [0.022, 0.009], pts: [[0.13, 0.27, 0.05], [0.22, 0.22, -0.06], [0.32, 0.15, -0.16], [0.39, 0.04, -0.23], [0.38, -0.1, -0.29], [0.29, -0.22, -0.33]] },
    om1: { r: [0.012, 0.006], pts: [[0.39, 0.04, -0.23], [0.46, -0.08, -0.12], [0.48, -0.22, 0.0], [0.45, -0.34, 0.08]] },
    om2: { r: [0.01, 0.005], pts: [[0.38, -0.1, -0.29], [0.42, -0.22, -0.22], [0.4, -0.34, -0.12]] },
  },
  RCA: {
    main: { r: [0.024, 0.011], pts: [[-0.07, 0.26, 0.1], [-0.14, 0.3, 0.2], [-0.17, 0.22, 0.32], [-0.18, 0.08, 0.38], [-0.22, -0.08, 0.36], [-0.29, -0.22, 0.27], [-0.31, -0.32, 0.12], [-0.26, -0.38, -0.06], [-0.13, -0.4, -0.22]] },
    am: { r: [0.012, 0.006], pts: [[-0.29, -0.22, 0.27], [-0.18, -0.32, 0.33], [-0.02, -0.39, 0.31], [0.12, -0.42, 0.23]] },
    pda: { r: [0.014, 0.006], pts: [[-0.13, -0.4, -0.22], [-0.02, -0.43, -0.15], [0.11, -0.43, -0.06], [0.22, -0.4, 0.06]] },
    plv: { r: [0.01, 0.005], pts: [[-0.13, -0.4, -0.22], [0.0, -0.36, -0.3], [0.12, -0.3, -0.34]] },
  },
};

const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, tubular: number, radial: number): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const n = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular, p = curve.getPointAt(u), r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.set(0, 0, 0).addScaledVector(frames.normals[i], Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      nor.push(n.x, n.y, n.z);
      pos.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Project an approximate point onto the nearest chamber surface (CPU raycast), 70% of the radius proud of it. */
function snapToHeart(p: THREE.Vector3, chambers: THREE.Mesh[], radius: number): THREE.Vector3 {
  let best = chambers[0], bd = Infinity;
  for (const m of chambers) {
    const d = Math.abs(m.worldToLocal(p.clone()).length() - 1);
    if (d < bd) { bd = d; best = m; }
  }
  const dir = p.clone().sub(best.position).normalize();
  const rc = new THREE.Raycaster(p.clone().addScaledVector(dir, 0.4), dir.clone().negate(), 0, 1);
  const hit = rc.intersectObjects(chambers, false)[0];
  if (!hit || !hit.face) return p.clone();
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  return hit.point.clone().addScaledVector(n, radius * 0.7);
}

const mat = (hex: number) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });

export function buildProceduralHeart(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'heart_root';
  const chambers: THREE.Mesh[] = CHAMBERS.map((c) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat(0xbf7373));
    m.name = c.name;
    m.position.set(...c.c);
    m.scale.set(...c.r);
    m.rotation.z = c.rotZ;
    root.add(m);
    return m;
  });
  root.updateMatrixWorld(true);
  for (const g of GREAT_VESSELS) {
    const curve = new THREE.CatmullRomCurve3(g.pts.map(v3), false, 'centripetal');
    const m = new THREE.Mesh(taperedTube(curve, g.r0, g.r1, 40, 12), mat(0xb39999));
    m.name = g.name;
    root.add(m);
  }
  for (const [name, segs] of Object.entries(ARTERIES)) {
    const geoms = Object.values(segs).map((s) => {
      const pts = s.pts.map((p) => snapToHeart(v3(p), chambers, s.r[0]));
      return taperedTube(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), s.r[0], s.r[1], 48, 10);
    });
    const m = new THREE.Mesh(mergeGeometries(geoms, false), mat(0xa0a0a3));
    for (const g of geoms) g.dispose();
    m.name = name;
    root.add(m);
  }
  return root;
}
