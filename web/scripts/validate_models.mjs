// Re-validate web/public/models3d/*.glb: valid glTF (Khronos validator), manifest mesh names present as nodes,
// one private material per artery, triangle counts equal to the verified source, sizes within budget.
// Exit code 1 on any failure.  Run: npm run validate   (from web/scripts)

import { NodeIO } from '@gltf-transform/core';
import validator from 'gltf-validator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, VESSEL_PARTS, LEFT_MAIN, manifestMeshNames } from './build_viewer_models.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.resolve(here, '../public/models3d');
const MAX_BYTES = { heart: 700_000, heart_lite: 300_000 };
const MAX_TRIS = 100_000; // team standard keeps the whole scene well under ~150k

const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const triCount = (node) => node.getMesh().listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0);
const io = new NodeIO();
const summary = {};

for (const [key, src] of Object.entries(SOURCES)) {
  const file = path.join(modelDir, src.out);
  console.log(`\n${src.out}`);
  const bytes = fs.readFileSync(file);
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: src.out });
  check(report.issues.numErrors === 0, `glTF validator: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings, ${report.issues.numInfos} infos`);
  check(bytes.length <= MAX_BYTES[key], `size ${bytes.length} B <= ${MAX_BYTES[key]} B`);

  const doc = await io.read(file);
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const names = nodes.map((n) => n.getName());
  check(new Set(names).size === names.length, 'node names are unique');

  const sourceDoc = await io.read(path.join(here, 'source', src.file));
  const srcByName = new Map(sourceDoc.getRoot().listNodes().map((n) => [n.getName(), n]));

  for (const mesh of manifestMeshNames()) {
    const node = nodes.find((n) => n.getName() === mesh);
    check(!!node && !!node.getMesh(), `manifest mesh ${mesh} is a node with a mesh`);
    if (!node) continue;
    const prims = node.getMesh().listPrimitives();
    check(prims.length === 1, `${mesh}: single primitive`);
    const mat = prims[0].getMaterial();
    check(mat && mat.getName() === mesh, `${mesh}: material named ${mesh}`);
    const users = nodes.filter((n) => n.getMesh() && n.getMesh().listPrimitives().some((p) => p.getMaterial() === mat));
    check(users.length === 1, `${mesh}: material used by this node only (${users.map((u) => u.getName())})`);
    const expected = VESSEL_PARTS[mesh].reduce((a, p) => a + triCount(srcByName.get(p)), 0);
    check(triCount(node) === expected, `${mesh}: ${triCount(node)} triangles == sum of source parts ${expected}`);
    check(['POSITION', 'NORMAL'].every((a) => prims[0].getAttribute(a)), `${mesh}: has POSITION and NORMAL`);
  }
  const vesselMaterials = manifestMeshNames().map((m) => nodes.find((n) => n.getName() === m)?.getMesh().listPrimitives()[0].getMaterial());
  check(new Set(vesselMaterials).size === vesselMaterials.length, 'one distinct material per artery');

  const consumed = new Set(Object.values(VESSEL_PARTS).flat());
  const expectedOthers = [...srcByName.keys()].filter((n) => !consumed.has(n));
  check(expectedOthers.every((n) => names.includes(n)), `all ${expectedOthers.length} other source nodes keep their descriptive names`);
  check(names.includes(LEFT_MAIN), `${LEFT_MAIN} present`);
  check(!names.some((n) => consumed.has(n)), 'merged source node names are gone (no duplicate vessel geometry)');

  const total = nodes.reduce((a, n) => a + (n.getMesh() ? triCount(n) : 0), 0);
  const srcTotal = [...srcByName.values()].reduce((a, n) => a + (n.getMesh() ? triCount(n) : 0), 0);
  check(total === srcTotal, `total triangles ${total} == source ${srcTotal}`);
  check(total <= MAX_TRIS, `total triangles ${total} <= ${MAX_TRIS}`);
  check(root.listMaterials().length === root.listMeshes().length, `materials (${root.listMaterials().length}) == meshes (${root.listMeshes().length}), no orphans`);
  check(/CC BY-SA 4\.0/.test(root.getAsset().copyright ?? ''), 'asset.copyright carries the licence');
  summary[src.out] = { bytes: bytes.length, triangles: total, nodes: nodes.length, draw_calls: root.listMeshes().length, warnings: report.issues.numWarnings };
}

console.log('\nsummary', JSON.stringify(summary, null, 1));
for (const f of ['LICENSE-models.md', 'licence/svitylo-data-1.1.0-LICENSES.md', 'licence/svitylo-data-1.1.0-ATTRIBUTION.md']) {
  if (!fs.existsSync(path.join(modelDir, f))) failures.push(`missing ${f} next to the models`);
}
if (failures.length) { console.log(`\n${failures.length} FAILURE(S)`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
