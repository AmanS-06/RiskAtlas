import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, deltaE, lightness, VISIONS } from './color';

// Reads theme.css itself, so a restyle that breaks contrast fails here before it ships.
const css = readFileSync(resolve(__dirname, 'theme.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = block(':root {');
const dark = block(":root[data-theme='dark']");
const darkMedia = block(":root:not([data-theme='light'])");

const TEXT_ON_BG: [string, string, number][] = [
  ['--text', '--bg', 7],
  ['--text', '--surface', 7],
  ['--text', '--surface-2', 7],
  ['--text-muted', '--surface', 4.5],
  ['--text-muted', '--surface-2', 4.5],
  ['--text-muted', '--bg', 4.5],
  ['--accent', '--surface', 4.5],
  ['--accent', '--bg', 4.5],
  ['--accent-contrast', '--accent', 4.5],
  ['--text', '--accent-soft', 4.5],
  ['--accent', '--accent-soft', 4.5],
  ['--disclaimer-text', '--disclaimer-bg', 7],
  ['--mock-text', '--mock-bg', 7],
  ['--danger', '--surface', 4.5],
  ['--danger', '--danger-soft', 4.5],
  ['--text', '--danger-soft', 4.5],
  ['--text', '--info-soft', 4.5],
  ['--shap-up', '--surface', 4.5],
  ['--shap-down', '--surface', 4.5],
  ['--status-low', '--surface', 4.5],
  ['--status-normal', '--surface', 4.5],
  ['--status-high', '--surface', 4.5],
  ['--status-missing', '--surface', 4.5],
  ['--ok', '--surface', 4.5],
  ['--viewer-text', '--viewer-bg', 7],
];

describe.each([
  ['light', light],
  ['dark (data-theme)', { ...light, ...dark }],
  ['dark (system preference)', { ...light, ...darkMedia }],
])('theme tokens: %s', (_name, t) => {
  it.each(TEXT_ON_BG)('%s on %s reaches %s:1', (fg, bg, min) => {
    expect(contrast(t[fg]!, t[bg]!), `${fg} ${t[fg]} on ${bg} ${t[bg]}`).toBeGreaterThanOrEqual(min);
  });
  it('focus ring is visible against the page and surfaces (3:1)', () => {
    for (const bg of ['--bg', '--surface', '--surface-2']) expect(contrast(t['--focus']!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it('control borders reach 3:1 against the surface', () => {
    expect(contrast(t['--border-strong']!, t['--surface']!)).toBeGreaterThanOrEqual(3);
  });
});

it('the dark blocks define the same tokens as the light block, so nothing is left unthemed', () => {
  const themed = Object.keys(dark);
  expect(Object.keys(darkMedia).sort()).toEqual(themed.sort());
  for (const k of themed) expect(k in light).toBe(true);
});

describe('colour-blind-safe alternative palette (--safe-band-*)', () => {
  const colors = [light['--safe-band-0']!, light['--safe-band-1']!, light['--safe-band-2']!];
  it.each(VISIONS)('adjacent and extreme bands differ clearly under %s vision', (v) => {
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const)
      expect(deltaE(colors[a]!, colors[b]!, v), `${v} ${a}-${b}`).toBeGreaterThanOrEqual(35);
  });
  it.each(VISIONS)('lightness falls as risk rises under %s vision (readable even in greyscale)', (v) => {
    const l = colors.map((c) => lightness(c, v));
    expect(l[0]! - l[1]!).toBeGreaterThan(10);
    expect(l[1]! - l[2]!).toBeGreaterThan(10);
  });
});
