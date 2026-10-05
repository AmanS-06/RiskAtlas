// Regenerates src/app/reliability.json from the validation reports, so the UI can say how far each vessel estimate can be trusted for the
// patient in front of it. Run: npm run sync:reliability
//   overall    cross-validated ROC-AUC with its 95% interval per target (reports/performance_metrics.csv)
//   subgroups  ROC-AUC by sex and age band per target (reports/subgroups.csv, set procedure_cv)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rows = (file) => {
  const [head, ...lines] = readFileSync(resolve(root, 'reports', file), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};

const overall = {};
for (const r of rows('performance_metrics.csv')) {
  if (r.metric === 'roc_auc') overall[r.target] = { auc: Number(r.estimate), lo: Number(r.lo), hi: Number(r.hi) };
}

const subgroups = {};
for (const r of rows('subgroups.csv')) {
  if (r.set !== 'procedure_cv' || r.roc_auc === '') continue;
  ((subgroups[r.target] ??= {})[r.subgroup] ??= {})[r.level] = { n: Number(r.n), auc: Number(r.roc_auc) };
}

const out = resolve(root, 'web', 'src', 'app', 'reliability.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ overall, subgroups }, null, 1) + '\n');
console.log(`wrote ${out}`);
