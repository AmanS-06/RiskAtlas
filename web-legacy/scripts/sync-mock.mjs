// Regenerates the client-side mock data from the repo's config and reports. Run: npm run sync:mock
//   src/api/mock/example_prediction.json  copy of reports/example_prediction.json
//   src/api/mock/meta.json                GET /meta as the API builds it (api/service.py build_meta), from config/
// Mock mode is for working without a backend. Nothing in it is a real prediction.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = resolve(root, 'web', 'src', 'api', 'mock');
const yaml = (file) => parse(readFileSync(resolve(root, 'config', file), 'utf8'));
mkdirSync(out, { recursive: true });

copyFileSync(resolve(root, 'reports', 'example_prediction.json'), resolve(out, 'example_prediction.json'));

const DEFAULTS = { label: null, type: 'binary', unit: null, range: null, group: 'symptoms', mutable: false, anchor: null, use: true, map: null };
const modelMeta = JSON.parse(readFileSync(resolve(root, 'models', 'metadata.json'), 'utf8'));
const example = JSON.parse(readFileSync(resolve(out, 'example_prediction.json'), 'utf8')).output;
const stats = modelMeta.feature_stats ?? {};

const allowed = (spec, st) => {
  if (spec.map) return [...new Set(Object.values(spec.map).map(Number))].sort((a, b) => a - b);
  if (spec.type === 'binary') return [0, 1];
  if (spec.type === 'categorical' && st) return Array.from({ length: st.max - st.min + 1 }, (_, i) => st.min + i);
  return null;
};

const feats = yaml('features.yaml')
  .map((r) => ({ ...DEFAULTS, ...r }))
  .filter((f) => f.use)
  .map((f) => ({
    name: f.name,
    label: f.label ?? f.name,
    type: f.type,
    unit: f.unit,
    range: f.range,
    group: f.group,
    mutable: f.mutable,
    anchor: f.anchor,
    map: f.map,
    allowed: allowed(f, stats[f.name]),
    stats: stats[f.name] ?? null,
  }));

const manifest = yaml('manifest.yaml');
const targets = Object.entries(manifest.targets).map(([id, spec]) => {
  const ops = modelMeta.targets?.[id] ?? example.targets?.[id] ?? {};
  return {
    id,
    label: spec.label ?? id,
    kind: spec.mesh ? 'vessel' : 'overall',
    mesh: spec.mesh ?? null,
    conditional_on: spec.conditional_on ?? null,
    threshold: ops.threshold ?? null,
    rule_out: ops.rule_out ?? null,
    rule_in: ops.rule_in ?? null,
    family: ops.family ?? null,
    prevalence: ops.prevalence ?? null,
  };
});

const meta = {
  features: feats,
  groups: [...new Set(feats.map((f) => f.group))],
  targets,
  risk_bands: yaml('risk_bands.yaml').bands.map((b) => ({ id: b.id, label: b.label ?? b.id, color: b.color })),
  uncertainty_interval: yaml('ml.yaml').uncertainty.interval,
  forbidden_inputs: manifest.forbidden_features ?? [],
  model: null,
  disclaimer: 'MOCK DATA - not a real prediction.',
  mock: true,
  api_version: 'mock',
};
writeFileSync(resolve(out, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`mock data written: ${feats.length} features, ${targets.length} targets, ${meta.risk_bands.length} bands`);
