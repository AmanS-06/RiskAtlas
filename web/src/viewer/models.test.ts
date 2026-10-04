// Guards the contract between config/manifest.yaml, the VesselId type and the shipped .glb files.
// Reads the glTF JSON chunk directly, so no WebGL and no three.js are needed.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VESSEL_IDS } from './viewerLogic';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

function manifestMeshes(): string[] {
  const text = fs.readFileSync(path.join(repo, 'config/manifest.yaml'), 'utf8');
  return [...text.matchAll(/^\s+mesh:\s*([A-Za-z0-9_]+)\s*$/gm)].map((m) => m[1]).filter((n) => n !== 'null'); // CAD has mesh: null
}

function glbJson(file: string): { nodes: { name?: string; mesh?: number }[]; meshes: { primitives: { material: number }[] }[]; materials: { name?: string }[] } {
  const b = fs.readFileSync(file);
  expect(b.toString('ascii', 0, 4)).toBe('glTF');
  const len = b.readUInt32LE(12);
  expect(b.toString('ascii', 16, 20)).toBe('JSON');
  return JSON.parse(b.toString('utf8', 20, 20 + len));
}

describe('VesselId type vs manifest and models', () => {
  it('VESSEL_IDS equals the manifest mesh names', () => {
    expect([...VESSEL_IDS].sort()).toEqual(manifestMeshes().sort());
  });
  for (const f of ['heart.glb', 'heart_lite.glb']) {
    it(`${f}: every manifest mesh is a node with a mesh and its own, correspondingly named material`, () => {
      const j = glbJson(path.join(repo, 'web/public/models3d', f));
      for (const id of manifestMeshes()) {
        const nodes = j.nodes.filter((n) => n.name === id);
        expect(nodes, `node ${id}`).toHaveLength(1);
        const mesh = j.meshes[nodes[0].mesh!];
        expect(mesh.primitives).toHaveLength(1);
        expect(j.materials[mesh.primitives[0].material].name).toBe(id);
        const users = j.nodes.filter((n) => n.mesh !== undefined && j.meshes[n.mesh].primitives.some((p) => p.material === mesh.primitives[0].material));
        expect(users).toHaveLength(1);
      }
    });
  }
});
