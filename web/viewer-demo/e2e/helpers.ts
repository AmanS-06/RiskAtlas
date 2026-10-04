// Shared plumbing for the browser tests: build + serve the demo, launch Chromium under software GL, page helpers.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const demoRoot = path.resolve(here, '..');
export const shotDir = path.join(demoRoot, 'dist', 'e2e-screenshots'); // gitignored; curated copies live in web/viewer-demo/screenshots/

export function chromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const direct = path.join(base, 'chromium');
  if (fs.existsSync(direct)) return direct;
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  if (!dir) throw new Error(`no Chromium under ${base}; set CHROMIUM_PATH`);
  return path.join(base, dir, 'chrome-linux', 'chrome');
}

/** WebGL2 through ANGLE/SwiftShader: works with no GPU. */
export const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

export async function startServer(outName = 'e2e'): Promise<{ server: PreviewServer; url: string }> {
  const outDir = path.join(demoRoot, 'dist', outName); // dist/ is gitignored; one folder per test file, since the build empties it
  await build({ configFile: path.join(demoRoot, 'vite.config.ts'), logLevel: 'warn', build: { outDir } });
  const server = await preview({ configFile: path.join(demoRoot, 'vite.config.ts'), logLevel: 'warn', build: { outDir }, preview: { port: 4174, strictPort: false, host: '127.0.0.1' } });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('preview server has no url');
  return { server, url };
}

export function launch(extraArgs: string[] = []): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath(), args: [...SOFTWARE_GL_ARGS, ...extraArgs] });
}

/** Counters and listener bookkeeping installed before any page script runs. */
const INSTRUMENT = `
  window.__clears = 0; window.__rafCalls = 0; window.__live = []; window.__sel = [];
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const o = C.prototype.clear; C.prototype.clear = function (...a) { window.__clears++; return o.apply(this, a); };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__rafCalls++; return raf(cb); };
  const cap = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const same = (l, t, type, fn, c) => l.target === t && l.type === type && l.fn === fn && l.capture === c;
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    const c = cap(o);
    if (fn && !window.__live.some((l) => same(l, this, type, fn, c))) window.__live.push({ target: this, type, fn, capture: c });
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    const c = cap(o), i = window.__live.findIndex((l) => same(l, this, type, fn, c));
    if (i >= 0) window.__live.splice(i, 1);
    return rem.call(this, type, fn, o);
  };
`;

export interface PageOpts { query?: string; viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark'; hasTouch?: boolean; initScript?: string; waitLoaded?: boolean; setup?: (page: Page) => Promise<void> }

export interface Opened { page: Page; ctx: BrowserContext; logs: string[]; errors: string[] }

export async function openDemo(browser: Browser, baseUrl: string, o: PageOpts = {}): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: o.viewport ?? { width: 1100, height: 760 }, colorScheme: o.colorScheme ?? 'light', hasTouch: o.hasTouch ?? false });
  const page = await ctx.newPage();
  const logs: string[] = [], errors: string[] = [];
  page.on('console', (m) => { logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(INSTRUMENT);
  if (o.initScript) await page.addInitScript(o.initScript);
  if (o.setup) await o.setup(page);
  await page.goto(`${baseUrl}?${o.query ?? ''}`);
  await page.waitForFunction(() => !!window.__viewer);
  if (o.waitLoaded !== false) await page.waitForFunction(() => window.__viewer.getStatus().loaded || window.__viewer.getStatus().usingFallback !== 'none' || !window.__viewer.getStatus().webgl, null, { timeout: 30_000 });
  await page.evaluate(() => { window.__sel = []; window.__viewer.onSelect((id) => window.__sel.push(id)); });
  return { page, ctx, logs, errors };
}

/** Wait until the anchor screen positions stop changing (camera tween and damping finished). */
export async function settle(page: Page, quietMs = 250, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  let last = '', since = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const sig = await page.evaluate(() => JSON.stringify((window.__anchors ?? []).map((a) => [Math.round(a.x * 2), Math.round(a.y * 2), a.visible])) + window.__clears);
    if (sig !== last) { last = sig; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
    await page.waitForTimeout(60);
  }
  throw new Error('view did not settle');
}

export interface Pixels { red: number; green: number; amber: number; dark: number; white: number; maxChroma: number; opaque: number; any: number; alphaSum: number; haloMean: [number, number, number]; width: number; height: number }

/** Render synchronously and classify the canvas pixels (read back in the same task, before the buffer is presented). */
export function countPixels(page: Page): Promise<Pixels> {
  return page.evaluate(() => {
    window.__viewer.resize();
    const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
    const t = document.createElement('canvas');
    t.width = c.width; t.height = c.height;
    const x = t.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, t.width, t.height).data;
    const out = { red: 0, green: 0, amber: 0, dark: 0, white: 0, maxChroma: 0, opaque: 0, any: 0, alphaSum: 0, haloMean: [0, 0, 0] as [number, number, number], width: t.width, height: t.height };
    let halo = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a > 0) { out.any++; out.alphaSum += a; }
      if (a > 10 && a < 250) { halo++; out.haloMean[0] += r; out.haloMean[1] += g; out.haloMean[2] += b; }
      if (a < 250) continue;
      if (r <= 40 && g <= 40 && b <= 40) out.dark++;
      if (r >= 250 && g >= 250 && b >= 250) out.white++;
      out.opaque++;
      out.maxChroma = Math.max(out.maxChroma, Math.max(r, g, b) - Math.min(r, g, b));
      if (r >= 170 && g <= 120 && b <= 120) out.red++;
      else if (g - r >= 40 && g >= 110 && b <= 150) out.green++;
      else if (r >= 190 && g >= 130 && g <= 200 && b <= 100) out.amber++;
    }
    if (halo) out.haloMean = out.haloMean.map((v) => v / halo) as [number, number, number];
    return out;
  });
}

export async function stageBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await page.locator('#stage').boundingBox();
  if (!b) throw new Error('no #stage');
  return b;
}

export async function anchor(page: Page, key: string): Promise<{ x: number; y: number; visible: boolean }> {
  const a = await page.evaluate((k) => (window.__anchors ?? []).find((s) => s.key === k), key);
  if (!a) throw new Error(`no anchor ${key}`);
  return a;
}

/** A tiny valid .glb with one triangle mesh per node name, for model-validation tests. */
export function glbWithNodes(names: string[]): Buffer {
  const pos = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: names.map((_, i) => i) }],
    nodes: names.map((name) => ({ name, mesh: 0 })), meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }],
  };
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + pos.length, 8);
  const ch = (len: number, type: string) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'ascii'); return b; };
  return Buffer.concat([head, ch(j.length, 'JSON'), j, ch(pos.length, 'BIN\0'), pos]);
}
