// Colour-vision-deficiency check of config/risk_bands.yaml: simulates protan / deutan / tritan vision
// (Machado et al. 2009, severity 1.0, applied in linear sRGB) and prints CIE76 delta E between the bands.
// Delta E below roughly 20 between two bands means they are hard to tell apart by colour alone.
// Run: npm run cvd   (from web/scripts)

import { parse } from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bands = parse(fs.readFileSync(path.join(repo, 'config/risk_bands.yaml'), 'utf8')).bands;

const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => { c = Math.min(1, Math.max(0, c)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };
const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lab = (rgb) => {
  const xyz = mul([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]], rgb.map(toLinear));
  const white = [0.95047, 1, 1.08883];
  const f = xyz.map((x, i) => { const t = x / white[i]; return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116; });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
};
const simulate = (rgb, kind) => (kind === 'normal' ? rgb : mul(MACHADO[kind], rgb.map(toLinear)).map(toSrgb));
const dE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

const pairs = [[0, 1], [1, 2], [0, 2]];
console.log(['vision', ...pairs.map(([a, b]) => `${bands[a].id}-${bands[b].id}`)].join('\t'));
for (const kind of ['normal', ...Object.keys(MACHADO)]) {
  console.log([kind, ...pairs.map(([a, b]) => dE(simulate(hex(bands[a].color), kind), simulate(hex(bands[b].color), kind)).toFixed(1))].join('\t'));
}
