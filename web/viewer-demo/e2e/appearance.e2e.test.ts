// Real-browser tests of the vessel-legibility work: neutral body, inflated arteries, in-canvas labels, hidden-vessel ghost.
// Pixel read-back from the WebGL canvas (software GL), so the numbers are what a viewer of the page actually sees.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { Browser } from 'playwright-core';
import type { PreviewServer } from 'vite';
import { countPixels, demoRoot, launch, openDemo, settle, shotDir, startServer } from './helpers';
import type { Opened } from './helpers';
import { deltaE, rgbToLab, simulateVision } from '../../src/viewer/viewerLogic';
import type { Vision } from '../../src/viewer/viewerLogic';

let browser: Browser;
let server: PreviewServer;
let url: string;
const opened: Opened[] = [];
const results: Record<string, unknown> = {};

const open = async (o: Parameters<typeof openDemo>[2] = {}) => { const x = await openDemo(browser, url, o); opened.push(x); return x; };
const noErrors = (o: Opened) => expect(o.errors, o.errors.join('\n')).toEqual([]);

beforeAll(async () => { ({ server, url } = await startServer('e2e-appearance')); browser = await launch(); fs.mkdirSync(shotDir, { recursive: true }); });
afterEach(async () => { for (const o of opened.splice(0)) await o.ctx.close().catch(() => {}); });
afterAll(async () => {
  fs.writeFileSync(`${demoRoot}/dist/e2e-appearance/results.json`, JSON.stringify(results, null, 2));
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

interface Palette { name: string; high: string; moderate: string; low: string }
// config/risk_bands.yaml (through viewer-config.generated.json) and the colour-blind-safe ramp of web/src/shared/theme.css (--safe-band-*)
const CONFIG: Palette = { name: 'config', high: '#D64545', moderate: '#E0A030', low: '#2E9E6A' };
const SAFE: Palette = { name: 'safe', high: '#8e0f35', moderate: '#e89a2e', low: '#b4e4fa' };
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

const states = (p: Palette, probs = { LAD: 0.76, LCX: 0.38, RCA: 0.1 }, bands = { LAD: 'high', LCX: 'moderate', RCA: 'low' } as const) =>
  Object.fromEntries((['LAD', 'LCX', 'RCA'] as const).map((id) => [id, { probability: probs[id], band: bands[id], color: p[bands[id]], uncertaintyWidth: 0.05 }]));

/** Median colour of the rendered pixels of each vessel colour (classified by hue) and of the neutral body, from the canvas. */
async function medianColours(page: Opened['page'], p: Palette) {
  return page.evaluate((hues) => {
    window.__viewer.resize();
    const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
    const t = document.createElement('canvas');
    t.width = c.width; t.height = c.height;
    const x = t.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, t.width, t.height).data;
    const bins: Record<string, number[][]> = { high: [[], [], []], moderate: [[], [], []], low: [[], [], []], body: [[], [], []] };
    const count: Record<string, number> = { high: 0, moderate: 0, low: 0, body: 0 };
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), ch = max - min;
      let key: string | null = null;
      if (ch <= 28 && max >= 100) key = 'body';
      else if (ch >= 35 && max >= 60) {
        const dd = max - min;
        const hh = ((max === r ? ((g - b) / dd) % 6 : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4) * 60 + 360) % 360;
        let best = 99;
        for (const k of ['high', 'moderate', 'low'] as const) { const diff = Math.min(Math.abs(hh - hues[k]), 360 - Math.abs(hh - hues[k])); if (diff < best && diff <= 22) { best = diff; key = k; } }
      }
      if (!key) continue;
      count[key]++;
      bins[key][0].push(r); bins[key][1].push(g); bins[key][2].push(b);
    }
    const med = (a: number[]) => { a.sort((u, v) => u - v); return a[Math.floor(a.length / 2)] ?? 0; };
    return Object.fromEntries(Object.keys(bins).map((k) => [k, { n: count[k], rgb: bins[k].map(med) as [number, number, number] }]));
  }, { high: hue(p.high), moderate: hue(p.moderate), low: hue(p.low) });
}

async function frontView(o: Opened, p: Palette) {
  await o.page.evaluate((st) => { window.__viewer.setOverall(null); window.__viewer.setVessels(st as never); }, states(p));
  await settle(o.page, 300);
}

describe('vessels stand out from the neutral body (pixel read-back, CIE76 delta E)', () => {
  const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
  for (const palette of [CONFIG, SAFE]) {
    it(`${palette.name} palette: three bands and the body are mutually distinguishable, light and dark theme`, async () => {
      for (const scheme of ['light', 'dark'] as const) {
        const o = await open({ query: 'lowPower=0', colorScheme: scheme, viewport: { width: 1180, height: 760 } });
        await frontView(o, palette);
        const m = await medianColours(o.page, palette);
        const table: Record<string, Record<string, number>> = {};
        for (const v of VISIONS) {
          const lab = Object.fromEntries(Object.entries(m).map(([k, x]) => [k, rgbToLab(simulateVision(x.rgb, v))]));
          table[v] = {
            'high-body': deltaE(lab.high, lab.body), 'moderate-body': deltaE(lab.moderate, lab.body), 'low-body': deltaE(lab.low, lab.body),
            'high-moderate': deltaE(lab.high, lab.moderate), 'moderate-low': deltaE(lab.moderate, lab.low), 'high-low': deltaE(lab.high, lab.low),
          };
        }
        results[`delta_e_${palette.name}_${scheme}`] = { pixels: Object.fromEntries(Object.entries(m).map(([k, x]) => [k, { n: x.n, rgb: x.rgb.map(Math.round) }])), deltaE: Object.fromEntries(Object.entries(table).map(([v, t]) => [v, Object.fromEntries(Object.entries(t).map(([k, d]) => [k, +d.toFixed(1)]))])) };
        for (const k of ['high', 'moderate', 'low'] as const) expect(m[k].n, `${palette.name}/${scheme}: ${k} pixels found`).toBeGreaterThan(120);
        expect(m.body.n).toBeGreaterThan(5000);
        // normal vision: every vessel colour is clearly different from the body and from each other
        for (const [pair, d] of Object.entries(table.normal)) expect(d, `${palette.name}/${scheme}/normal ${pair}`).toBeGreaterThan(pair.endsWith('body') ? 22 : 30);
        // colour-vision deficiency: each vessel still separates from the body (by lightness and the labels carry the identity);
        // the pairwise bands under CVD are a property of the palette, not of the viewer, and are recorded in results for docs/viewer.md
        for (const v of VISIONS.slice(1)) for (const k of ['high', 'moderate', 'low'] as const) expect(table[v][`${k}-body`], `${palette.name}/${scheme}/${v} ${k}-body`).toBeGreaterThan(15);
        if (palette.name === 'safe') for (const v of VISIONS.slice(1)) for (const pair of ['high-moderate', 'moderate-low', 'high-low']) expect(table[v][pair], `safe/${v} ${pair}`).toBeGreaterThan(12); // crimson vs orange under deuteranopia is the weakest pair (about 16)
        noErrors(o);
        await o.ctx.close();
      }
    });
  }

  it("the body separates from the app's viewer background in both themes (tokens read from web/src/shared/theme.css)", async () => {
    const css = fs.readFileSync(`${demoRoot}/../src/shared/theme.css`, 'utf8');
    const bgs = [...css.matchAll(/--viewer-bg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
    expect(bgs.length).toBeGreaterThanOrEqual(2); // light and dark
    const o = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 } });
    await frontView(o, CONFIG);
    const body = rgbToLab((await medianColours(o.page, CONFIG)).body.rgb);
    const table = bgs.map((bg) => +deltaE(body, rgbToLab(bg)).toFixed(1));
    results.body_vs_viewer_bg = Object.fromEntries(bgs.map((bg, i) => [bg, table[i]]));
    for (const d of table) expect(d).toBeGreaterThan(25);
  });

  it('the body itself is muted: no more than a trace of chroma, in every lit region', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => { window.__viewer.setOverall(null); window.__viewer.setVessels({ LAD: undefined, LCX: undefined, RCA: undefined } as never); });
    const px = await countPixels(o.page);
    expect(px.maxChroma).toBeLessThan(40); // all unscored: nothing in the canvas is saturated (the slate body itself has chroma ~32 on the 0..255 scale)
    expect(px.red + px.green + px.amber).toBeLessThan(10);
  });

  it("bodyStyle 'natural' restores the GLB's pink (red above blue); the neutral default is blue-grey (blue above red)", async () => {
    const warmth = async (query: string) => {
      const o = await open({ query });
      await o.page.evaluate(() => { window.__viewer.setOverall(null); window.__viewer.setVessels({ LAD: undefined, LCX: undefined, RCA: undefined } as never); });
      return o.page.evaluate(() => {
        window.__viewer.resize();
        const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
        const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
        const x = t.getContext('2d', { willReadFrequently: true })!; x.drawImage(c, 0, 0);
        const d = x.getImageData(0, 0, t.width, t.height).data;
        let sum = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && Math.max(d[i], d[i + 1], d[i + 2]) > 90) { sum += d[i] - d[i + 2]; n++; }
        return sum / n;
      });
    };
    const natural = await warmth('lowPower=0&body=natural'), neutral = await warmth('lowPower=0');
    results.mean_red_minus_blue = { natural, neutral };
    expect(natural).toBeGreaterThan(15);
    expect(neutral).toBeLessThan(0);
  });

  it('the overall glow does not turn the neutral body pink again (chamber tint is damped)', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => { window.__viewer.setVessels({ LAD: undefined, LCX: undefined, RCA: undefined } as never); window.__viewer.setOverall({ probability: 1, band: 'high', color: '#D64545' }); });
    const hi = await countPixels(o.page);
    expect(hi.red).toBeLessThan(40);
  });
});

describe('vessel calibre and triangle budget', () => {
  it('vesselBoost: more vessel pixels than as-modelled, none with boost 0 beyond the original, triangle count unchanged', async () => {
    const counts: Record<string, number> = {};
    const tris: Record<string, number> = {};
    for (const [name, q] of [['boost0', 'vesselBoost=0'], ['boost1', ''], ['boost2', 'boost=2']] as const) {
      const o = await open({ query: `lowPower=0&hidden=0&${name === 'boost0' ? 'boost=0' : q}`, viewport: { width: 1180, height: 760 } });
      await frontView(o, CONFIG);
      const m = await medianColours(o.page, CONFIG);
      counts[name] = m.high.n + m.moderate.n + m.low.n;
      tris[name] = (await o.page.evaluate(() => window.__viewer.getStatus())).triangles;
      await o.ctx.close();
    }
    results.vessel_pixels_by_boost = counts;
    results.triangles_by_boost = tris;
    expect(counts.boost1).toBeGreaterThan(counts.boost0 * 1.4);
    expect(counts.boost2).toBeGreaterThan(counts.boost1);
    expect(new Set(Object.values(tris)).size).toBe(1);
    expect(tris.boost1).toBe(23283); // heart.glb as shipped: the welded copies share the original triangle list
  });

  it('the lite model keeps its triangle count too', async () => {
    const o = await open({ query: 'lowPower=1' });
    expect((await o.page.evaluate(() => window.__viewer.getStatus())).triangles).toBe(6691);
  });
});

describe('in-canvas labels', () => {
  const labelState = (page: Opened['page']) =>
    page.evaluate(() => {
      const root = document.querySelector('#stage [data-viewer-labels]') as HTMLElement | null;
      const box = (document.getElementById('stage') as HTMLElement).getBoundingClientRect();
      const out: Record<string, { shown: boolean; text: string; x: number; y: number; chip: { l: number; t: number; r: number; b: number } }> = {};
      for (const el of Array.from(root?.children ?? []) as HTMLElement[]) {
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
        const chip = el.querySelector('span')!.getBoundingClientRect();
        out[el.dataset.label!] = { shown: el.style.display !== 'none', text: el.textContent ?? '', x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN, chip: { l: chip.left - box.left, t: chip.top - box.top, r: chip.right - box.left, b: chip.bottom - box.top } };
      }
      return { present: !!root, ariaHidden: root?.getAttribute('aria-hidden'), pointerEvents: root ? getComputedStyle(root).pointerEvents : null, labels: out, w: box.width, h: box.height };
    });

  const chipsOverlap = (labels: Record<string, { shown: boolean; chip: { l: number; t: number; r: number; b: number } }>) => {
    const v = Object.entries(labels).filter(([, l]) => l.shown);
    const hits: string[] = [];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) { const a = v[i][1].chip, b = v[j][1].chip; if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) hits.push(`${v[i][0]}/${v[j][0]}`); }
    return hits;
  };

  it('default: aria-hidden decorative overlay, one chip per vessel with name and percent, inside the container, not blocking the mouse', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 } });
    await frontView(o, CONFIG);
    const s = await labelState(o.page);
    expect(s.present).toBe(true);
    expect(s.ariaHidden).toBe('true');
    expect(s.pointerEvents).toBe('none');
    expect(s.labels.LAD.text).toBe('LAD 76%');
    expect(s.labels.LCX.text).toBe('LCX 38%');
    expect(s.labels.RCA.text).toBe('RCA 10%');
    for (const [id, l] of Object.entries(s.labels)) {
      if (!l.shown) continue;
      expect(l.chip.l, id).toBeGreaterThanOrEqual(0); expect(l.chip.t, id).toBeGreaterThanOrEqual(0);
      expect(l.chip.r, id).toBeLessThanOrEqual(s.w); expect(l.chip.b, id).toBeLessThanOrEqual(s.h);
    }
    expect(Object.values(s.labels).filter((l) => l.shown).length).toBeGreaterThanOrEqual(2);
    expect(chipsOverlap(s.labels)).toEqual([]);
    // the overlay adds nothing a screen reader would read twice: no label text outside aria-hidden content
    expect(await o.page.evaluate(() => Array.from(document.querySelectorAll('#stage [data-label]')).every((e) => e.closest('[aria-hidden="true"]') !== null))).toBe(true);
    noErrors(o);
  });

  it("labels:'name' shows the id only, 'off' creates no overlay; a vessel without a prediction is labelled by name", async () => {
    const name = await open({ query: 'lowPower=0&labels=name' });
    await frontView(name, CONFIG);
    expect((await labelState(name.page)).labels.LAD.text).toBe('LAD');
    const off = await open({ query: 'lowPower=0&labels=off' });
    await frontView(off, CONFIG);
    expect((await labelState(off.page)).present).toBe(false);
    const none = await open({ query: 'lowPower=0' });
    await none.page.evaluate(() => { window.__viewer.setVessels({ LCX: undefined } as never); });
    await settle(none.page, 300);
    expect((await labelState(none.page)).labels.LCX.text).toBe('LCX');
  });

  it('a visible label points at a visible part of its own vessel; it is hidden when the heart wall hides the vessel (8 views around the heart)', async () => {
    const o = await open({ query: 'lowPower=0&hidden=0', viewport: { width: 1180, height: 760 } }); // no ghost: only solid vessel pixels remain
    await frontView(o, CONFIG);
    await o.page.focus('#stage');
    const seen: Record<string, number> = { LAD: 0, LCX: 0, RCA: 0 };
    const hiddenSomewhere: Record<string, boolean> = { LAD: false, LCX: false, RCA: false };
    const log: unknown[] = [];
    for (let view = 0; view < 8; view++) {
      await settle(o.page, 300);
      const s = await labelState(o.page);
      expect(chipsOverlap(s.labels), `view ${view}: chips overlap`).toEqual([]);
      // read the canvas around each label's anchor point
      const near = await o.page.evaluate((anchors) => {
        window.__viewer.resize();
        const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
        const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
        const x = t.getContext('2d', { willReadFrequently: true })!; x.drawImage(c, 0, 0);
        const sx = c.width / c.clientWidth, sy = c.height / c.clientHeight;
        return anchors.map((a) => {
          const R = 9; const px = Math.round(a.x * sx), py = Math.round(a.y * sy);
          const d = x.getImageData(Math.max(0, px - R), Math.max(0, py - R), 2 * R + 1, 2 * R + 1).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2], ch = Math.max(r, g, b) - Math.min(r, g, b);
            if (d[i + 3] === 255 && ch >= 45) n++;
          }
          return n;
        });
      }, (['LAD', 'LCX', 'RCA'] as const).map((id) => ({ x: s.labels[id].x, y: s.labels[id].y })));
      (['LAD', 'LCX', 'RCA'] as const).forEach((id, i) => {
        if (s.labels[id].shown) { seen[id]++; expect(near[i], `view ${view}: ${id} label sits on vessel pixels`).toBeGreaterThan(2); }
        else hiddenSomewhere[id] = true;
      });
      log.push({ view, shown: (['LAD', 'LCX', 'RCA'] as const).map((id) => s.labels[id].shown), near });
      for (let k = 0; k < 6; k++) await o.page.keyboard.press('ArrowLeft'); // ~41 degrees
    }
    results.label_views = log;
    for (const id of ['LAD', 'LCX', 'RCA'] as const) { expect(seen[id], `${id} label shown in some view`).toBeGreaterThan(0); expect(hiddenSomewhere[id], `${id} label hidden in some view`).toBe(true); }
    noErrors(o);
  });

  it('labels follow the camera: rotating moves the chips, reset view brings them back', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 } });
    await frontView(o, CONFIG);
    const before = await labelState(o.page);
    await o.page.focus('#stage');
    for (let i = 0; i < 4; i++) await o.page.keyboard.press('ArrowRight');
    await settle(o.page, 300);
    const turned = await labelState(o.page);
    const moved = (['LAD', 'LCX', 'RCA'] as const).some((id) => before.labels[id].shown && turned.labels[id].shown && Math.hypot(before.labels[id].x - turned.labels[id].x, before.labels[id].y - turned.labels[id].y) > 5);
    expect(moved).toBe(true);
    await o.page.keyboard.press('0');
    await settle(o.page, 400);
    const back = await labelState(o.page);
    for (const id of ['LAD', 'LCX', 'RCA'] as const) if (before.labels[id].shown && back.labels[id].shown) expect(Math.hypot(before.labels[id].x - back.labels[id].x, before.labels[id].y - back.labels[id].y)).toBeLessThan(140); // same vessel; the label may sit on another point of it
  });

  it('labels still render with reduced motion, and the selected vessel gets an emphasised chip', async () => {
    const o = await open({ query: 'lowPower=0&reduced=1', viewport: { width: 1180, height: 760 } });
    await frontView(o, CONFIG);
    expect((await labelState(o.page)).labels.LAD.shown).toBe(true);
    await o.page.evaluate(() => window.__viewer.select('LAD'));
    await settle(o.page, 300);
    const w = await o.page.evaluate(() => (document.querySelector('#stage [data-label="LAD"] span') as HTMLElement).style.fontWeight);
    expect(Number(w)).toBeGreaterThanOrEqual(800);
  });

  it('dispose removes the overlay', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => window.__viewer.dispose());
    expect(await o.page.evaluate(() => document.querySelectorAll('#stage [data-viewer-labels]').length)).toBe(0);
  });
});

describe('hidden-vessel ghost', () => {
  it('shows arteries behind the heart wall faintly, and showHidden=false removes them; solid pixels are unchanged', async () => {
    const counts: Record<string, { solid: number; faint: number }> = {};
    for (const [name, q] of [['ghost', 'hidden=1'], ['noghost', 'hidden=0']] as const) {
      const o = await open({ query: `lowPower=0&${q}`, viewport: { width: 1180, height: 760 } });
      await frontView(o, CONFIG);
      await o.page.focus('#stage');
      for (let i = 0; i < 26; i++) await o.page.keyboard.press('ArrowLeft'); // back of the heart
      await settle(o.page, 400);
      counts[name] = await o.page.evaluate(() => {
        window.__viewer.resize();
        const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
        const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
        const x = t.getContext('2d', { willReadFrequently: true })!; x.drawImage(c, 0, 0);
        const d = x.getImageData(0, 0, t.width, t.height).data;
        let solid = 0, faint = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 250) continue;
          const ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
          if (ch >= 70) solid++; else if (ch >= 30) faint++;
        }
        return { solid, faint };
      });
      await o.ctx.close();
    }
    results.ghost_counts_back_view = counts;
    expect(counts.ghost.faint + counts.ghost.solid).toBeGreaterThan(counts.noghost.faint + counts.noghost.solid + 400);
  });
});

describe('screenshots (viewed by hand; also smoke tests that every combination renders)', () => {
  const COMBOS: [string, Record<string, number>, Record<string, 'low' | 'moderate' | 'high'>][] = [
    ['hml', { LAD: 0.76, LCX: 0.38, RCA: 0.1 }, { LAD: 'high', LCX: 'moderate', RCA: 'low' }],
    ['lhm', { LAD: 0.1, LCX: 0.7, RCA: 0.4 }, { LAD: 'low', LCX: 'high', RCA: 'moderate' }],
    ['mlh', { LAD: 0.4, LCX: 0.1, RCA: 0.8 }, { LAD: 'moderate', LCX: 'low', RCA: 'high' }],
  ];
  const stageShot = async (o: Opened, name: string, full = false) => {
    await settle(o.page, 350);
    if (full) await o.page.screenshot({ path: `${shotDir}/${name}.png` });
    else await o.page.locator('#stage').screenshot({ path: `${shotDir}/${name}.png` });
  };
  const apply = (o: Opened, p: Palette, probs: Record<string, number>, bands: Record<string, 'low' | 'moderate' | 'high'>) =>
    o.page.evaluate(([st, hi]) => { window.__viewer.setVessels(st as never); window.__viewer.setOverall({ probability: hi as number, band: 'high', color: '#D64545' }); }, [states(p, probs as never, bands as never), Math.max(...Object.values(probs))] as const);

  it('front, back, each vessel selected, the three combinations, light and dark, safe palette, phone', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 } });
    for (const [name, probs, bands] of COMBOS) { await apply(o, CONFIG, probs, bands); await stageShot(o, `combo_${name}_light`); }
    await apply(o, CONFIG, COMBOS[0][1], COMBOS[0][2]);
    await o.page.focus('#stage');
    for (let i = 0; i < 26; i++) await o.page.keyboard.press('ArrowLeft');
    await stageShot(o, 'back_hml');
    await o.page.keyboard.press('0');
    for (const [id, key] of [['LAD', '1'], ['LCX', '2'], ['RCA', '3']] as const) { await o.page.keyboard.press(key); await stageShot(o, `selected_${id}_hml`); }
    await o.page.keyboard.press('Escape'); await o.page.keyboard.press('0');
    await apply(o, SAFE, COMBOS[0][1], COMBOS[0][2]);
    await stageShot(o, 'safe_palette_hml');

    const dark = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 }, colorScheme: 'dark' });
    await dark.page.click('#theme');
    for (const [name, probs, bands] of COMBOS.slice(0, 2)) { await apply(dark, CONFIG, probs, bands); await stageShot(dark, `combo_${name}_dark`); }
    await dark.page.focus('#stage');
    await dark.page.keyboard.press('2');
    await stageShot(dark, 'selected_LCX_dark', true);

    const lite = await open({ query: 'lowPower=1', viewport: { width: 1180, height: 760 } });
    await apply(lite, CONFIG, COMBOS[0][1], COMBOS[0][2]);
    await stageShot(lite, 'lite_hml');

    const phone = await open({ query: 'lowPower=0', viewport: { width: 390, height: 844 }, hasTouch: true });
    await apply(phone, CONFIG, COMBOS[0][1], COMBOS[0][2]);
    await stageShot(phone, 'phone_hml', true);
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    noErrors(o); noErrors(dark); noErrors(lite); noErrors(phone);
  });
});
