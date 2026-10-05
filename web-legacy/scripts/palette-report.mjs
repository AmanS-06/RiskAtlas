// Prints how distinguishable the risk-band palettes are under colour-vision deficiency.
// Needs Node >= 22.18 (runs the .ts helper directly). Run: npm run palette
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { deltaE, lightness, VISIONS } from '../src/shared/color.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = parse(readFileSync(resolve(root, '..', 'config', 'risk_bands.yaml'), 'utf8')).bands.map((b) => b.color);
const css = readFileSync(resolve(root, 'src', 'shared', 'theme.css'), 'utf8');
const safe = [0, 1, 2].map((i) => new RegExp(`--safe-band-${i}:\\s*(#[0-9a-fA-F]{6})`).exec(css)[1]);

for (const [name, cols] of [
  ['config/risk_bands.yaml', config],
  ['theme.css --safe-band-*', safe],
]) {
  console.log(`\n${name}: ${cols.join(' ')}`);
  console.log('vision          dE low-mid  dE mid-high  dE low-high   L* low,mid,high');
  for (const v of VISIONS) {
    const d = [
      [0, 1],
      [1, 2],
      [0, 2],
    ].map(([i, j]) => deltaE(cols[i], cols[j], v).toFixed(1).padStart(9));
    console.log(`${v.padEnd(14)} ${d.join('   ')}   ${cols.map((c) => lightness(c, v).toFixed(0)).join(', ')}`);
  }
}
