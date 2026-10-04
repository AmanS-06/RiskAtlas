// Build web/public/models3d/heart.glb and heart_lite.glb from the verified Z-Anatomy extraction in ./source.
//
// What it changes (nothing else is touched, no hand-edited binary):
//   - merges each coronary artery's source structures into ONE mesh node named exactly like the manifest
//     mesh (LAD, LCX, RCA) with ONE material of the same name, so the viewer recolours an artery as a unit
//   - gives the unscored left main stem a neutral material (the extraction coloured it red)
//   - gives every vessel node neutral grey, so nothing in the file looks like a risk colour
//   - writes licence information into the glTF asset block and copies the upstream licence files alongside
//
// Mesh names come from config/manifest.yaml; the source-structure grouping below is the only asset-specific
// knowledge. Run: npm install && npm run models   (from web/scripts)

import { NodeIO } from '@gltf-transform/core';
import { parse } from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const outDir = path.join(repo, 'web/public/models3d');

export const SOURCES = {
  heart: { file: 'zanatomy_heart_standard.glb', sha256: 'cdb91627e81af3054f51239d04fa914a43a0d6757834594305caa1d488ec8805', out: 'heart.glb' },
  heart_lite: { file: 'zanatomy_heart_economy.glb', sha256: '649fb9d7f70f64aeb53fdeb49dbca2962e6e81ae8388f829b5dbf818b22e3ba4', out: 'heart_lite.glb' },
};

// Which Z-Anatomy structures make up each manifest vessel (names as in the source GLB nodes).
export const VESSEL_PARTS = {
  LAD: ['anterior_interventricular_artery', 'septal_branches_of_anterior_interventricular_artery'],
  LCX: ['circumflex_artery_of_heart'],
  RCA: ['right_coronary_artery', 'right_inferolateral_branch_of_right_coronary_artery'],
};
export const LEFT_MAIN = 'left_coronary_artery'; // short stem shared by LAD and LCX: kept neutral, never scored
export const NEUTRAL = [0.62, 0.62, 0.64, 1];

export const COPYRIGHT =
  'Derived from Z-Anatomy (CC BY-SA 4.0), based on BodyParts3D (c) The Database Center for Life Science (CC BY-SA 2.1 Japan). ' +
  'This file is distributed under CC BY-SA 4.0. See ASSETS_AND_LICENSES.md and LICENSE-models.md.';

export function manifestMeshNames() {
  const m = parse(fs.readFileSync(path.join(repo, 'config/manifest.yaml'), 'utf8'));
  return Object.values(m.targets).map((t) => t.mesh).filter(Boolean);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function identity(node) {
  const t = node.getTranslation(), r = node.getRotation(), s = node.getScale();
  return t.every((v) => v === 0) && r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 1 && s.every((v) => v === 1);
}

function mergeNodes(doc, buffer, parts, name, material) {
  let nv = 0, ni = 0;
  for (const n of parts) {
    if (!identity(n)) throw new Error(`${n.getName()} has a node transform; merging would be wrong`);
    const prims = n.getMesh().listPrimitives();
    if (prims.length !== 1) throw new Error(`${n.getName()} has ${prims.length} primitives, expected 1`);
    nv += prims[0].getAttribute('POSITION').getCount();
    ni += prims[0].getIndices().getCount();
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const idx = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const n of parts) {
    const p = n.getMesh().listPrimitives()[0];
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), I = p.getIndices();
    pos.set(P.getArray(), vo * 3); nor.set(N.getArray(), vo * 3);
    const ia = I.getArray();
    for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo;
    vo += P.getCount(); io += ia.length;
  }
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor))
    .setIndices(acc('SCALAR', idx)).setMaterial(material);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
}

export async function build(key) {
  const src = SOURCES[key];
  const srcPath = path.join(here, 'source', src.file);
  const digest = sha256(srcPath);
  if (digest !== src.sha256) throw new Error(`${src.file}: sha256 ${digest} does not match the verified extraction ${src.sha256}`);

  const meshNames = manifestMeshNames();
  if ([...meshNames].sort().join() !== Object.keys(VESSEL_PARTS).sort().join()) {
    throw new Error(`manifest meshes [${meshNames}] differ from VESSEL_PARTS [${Object.keys(VESSEL_PARTS)}]: add the new vessel's source structures to build_viewer_models.mjs`);
  }

  const io = new NodeIO();
  const doc = await io.read(srcPath);
  const root = doc.getRoot();
  const heartRoot = root.listNodes().find((n) => n.getName() === 'heart_root');
  const buffer = root.listBuffers()[0];
  const byName = new Map(heartRoot.listChildren().map((n) => [n.getName(), n]));

  const order = [];
  const consumed = new Set();
  const leftMain = byName.get(LEFT_MAIN);
  leftMain.getMesh().listPrimitives()[0].getMaterial().setBaseColorFactor(NEUTRAL).setName(LEFT_MAIN);
  leftMain.setExtras({ ...leftMain.getExtras(), note: 'left main stem, shared by LAD and LCX, never scored' });
  order.push(leftMain); consumed.add(LEFT_MAIN);

  for (const [id, partNames] of Object.entries(VESSEL_PARTS)) {
    const parts = partNames.map((p) => {
      const n = byName.get(p);
      if (!n) throw new Error(`source node ${p} missing for ${id}`);
      return n;
    });
    const material = doc.createMaterial(id).setBaseColorFactor(NEUTRAL).setRoughnessFactor(0.5).setMetallicFactor(0).setDoubleSided(true);
    const node = mergeNodes(doc, buffer, parts, id, material);
    node.setExtras({ vessel: id, sourceStructures: partNames });
    order.push(node);
    for (const p of parts) {
      consumed.add(p.getName());
      const m = p.getMesh();
      const mat = m.listPrimitives()[0].getMaterial();
      for (const prim of m.listPrimitives()) {
        for (const a of [prim.getAttribute('POSITION'), prim.getAttribute('NORMAL'), prim.getIndices()]) a.dispose();
      }
      m.dispose(); mat.dispose(); p.dispose();
    }
  }
  for (const n of heartRoot.listChildren()) if (!consumed.has(n.getName())) order.push(n);
  for (const n of heartRoot.listChildren()) heartRoot.removeChild(n);
  for (const n of order) heartRoot.addChild(n);

  root.getAsset().generator = 'riskatlas web/scripts/build_viewer_models.mjs (from Z-Anatomy extraction)';
  root.getAsset().copyright = COPYRIGHT;
  root.getAsset().extras = { sourceFile: src.file, sourceSha256: src.sha256 };

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, src.out);
  await io.write(out, doc);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const key of Object.keys(SOURCES)) {
    const out = await build(key);
    console.log(`wrote ${path.relative(repo, out)} ${fs.statSync(out).size} bytes sha256 ${sha256(out).slice(0, 16)}`);
  }
  const licDst = path.join(outDir, 'licence');
  fs.mkdirSync(licDst, { recursive: true });
  // the atlas viewer package.json (a code licence we do not use) stays in source/ only
  for (const f of fs.readdirSync(path.join(here, 'source/licence')).filter((n) => n.startsWith('svitylo-data'))) fs.copyFileSync(path.join(here, 'source/licence', f), path.join(licDst, f));
  console.log('copied upstream licence files to', path.relative(repo, licDst));
}
