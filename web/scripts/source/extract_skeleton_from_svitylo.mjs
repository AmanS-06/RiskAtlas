// Extract the bony thorax (ribs, costal cartilages, sternum, thoracic and nearby vertebrae, clavicles, scapulae) from the Svitylo / Z-Anatomy chunked GLBs
// into one standalone GLB, in the SAME coordinate frame as the heart (extract_heart_from_svitylo.mjs): recentred on the middle of the four chambers and
// scaled so the chamber box is one unit wide. The skeleton therefore lines up with web/public/models3d/heart.glb without any manual placement.
//
// Used only to render the landing page video (web/scripts/render_hero.mjs); the skeleton is never shipped to the browser.
// Usage: node extract_skeleton_from_svitylo.mjs <releaseDir> <economy|standard> <out.glb>
// Source: Z-Anatomy (CC BY-SA 4.0) over BodyParts3D (CC BY-SA 2.1 Japan), via @authorod/svitylo-3d-anatomy-data 1.1.0. See web/public/models3d/LICENSE-models.md.
import { NodeIO, Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';

await MeshoptDecoder.ready;
const [base, quality, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const man = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'));
const byId = Object.fromEntries(man.structures.map((s) => [s.id, s]));

const CHAMBERS = ['left_atrium', 'left_ventricle', 'right_atrium', 'right_ventricle'].map((n) => `cardiovascular.${n}`);
const BONE = /(_rib_[lr]$)|(body_of_sternum$)|(manubrium_of_sternum$)|(xiphoid_process$)|(vertebra_t\d+$)|(vertebra_[cl][1-7]$)|(clavicle_[lr]$)|(scapula_[lr]$)|(costal_cartilage_of_\w+_rib_[lr]$)|(skeletal\.sacrum$)/;
const bones = man.structures.filter((s) => s.id.startsWith('skeletal.') && s.meshes && BONE.test(s.id)).map((s) => s.id);
const kindOf = (id) =>
  /costal_cartilage/.test(id) ? 'cartilage' : /_rib_/.test(id) ? 'rib' : /sternum|xiphoid/.test(id) ? 'sternum' : /vertebra|sacrum/.test(id) ? 'spine' : 'shoulder';

const want = new Map(); // mesh index -> structure id
for (const id of [...CHAMBERS, ...bones]) {
  const s = byId[id];
  if (!s || !s.meshes) throw new Error('missing ' + id);
  want.set(s.meshes[0], id);
}
const chunkOf = (mi) => man.chunks.find((c) => c.meshStart <= mi && mi < c.meshStart + c.meshCount);
const chunks = new Map();
for (const mi of want.keys()) {
  const c = chunkOf(mi);
  (chunks.get(c.id) || chunks.set(c.id, { c, ms: [] }).get(c.id)).ms.push(mi);
}

const parts = [];
for (const { c, ms } of chunks.values()) {
  const doc = await io.read(`${base}/${c.files[quality].path}`);
  const node = doc.getRoot().listNodes()[0];
  const S = node.getScale();
  const T = node.getTranslation();
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const I = prim.getAttribute('_ID').getArray();
  const ia = prim.getIndices().getArray();
  for (const mi of ms) {
    const remap = new Map();
    const pos = [];
    const nrm = [];
    const idx = [];
    for (let t = 0; t < ia.length; t += 3) {
      if (I[ia[t] * 2] !== mi) continue;
      for (let k = 0; k < 3; k++) {
        const v = ia[t + k];
        let r = remap.get(v);
        if (r === undefined) {
          r = pos.length / 3;
          remap.set(v, r);
          for (let a = 0; a < 3; a++) pos.push((P[v * 3 + a] / 32767) * S[a] + T[a]);
          for (let a = 0; a < 3; a++) nrm.push(N[v * 3 + a] / 32767);
        }
        idx.push(r);
      }
    }
    parts.push({ id: want.get(mi), pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx) });
  }
}

// the same recentring and scale as the heart extraction: the box of the four chambers
const ch = parts.filter((p) => CHAMBERS.includes(p.id));
const mn = [1e9, 1e9, 1e9];
const mx = [-1e9, -1e9, -1e9];
for (const p of ch) for (let i = 0; i < p.pos.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p.pos[i + a]); mx[a] = Math.max(mx[a], p.pos[i + a]); }
const ctr = mn.map((m, a) => (m + mx[a]) / 2);
const sc = 1 / Math.max(...mx.map((m, a) => m - mn[a]));
console.log('centre (m)', ctr.map((x) => x.toFixed(4)), 'scale', sc.toFixed(3));

const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene('thorax');
doc.getRoot().getAsset().generator = 'extract_skeleton_from_svitylo.mjs (Svitylo data 1.1.0: Z-Anatomy / BodyParts3D, CC BY-SA 4.0)';
const root = doc.createNode('thorax_root').setExtras({ sourceCentre_m: ctr, scaleToUnit: sc, frameOf: 'heart.glb', coordinates: '+Y up, +Z anterior, +X patient left' });
scene.addChild(root);
let tris = 0;
for (const p of parts) {
  if (CHAMBERS.includes(p.id)) continue;
  for (let i = 0; i < p.pos.length; i += 3) for (let a = 0; a < 3; a++) p.pos[i + a] = (p.pos[i + a] - ctr[a]) * sc;
  const name = p.id.replace('skeletal.', '');
  const mat = doc.createMaterial(name).setBaseColorFactor([0.86, 0.9, 0.95, 1]).setRoughnessFactor(0.7).setMetallicFactor(0).setDoubleSided(true);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(p.nrm).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(p.idx).setBuffer(buf))
    .setMaterial(mat);
  root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setExtras({ structureId: p.id, kind: kindOf(p.id) }));
  tris += p.idx.length / 3;
}
await io.write(out, doc);
console.log('bones', parts.length - ch.length, 'triangles', tris, 'bytes', fs.statSync(out).size);
