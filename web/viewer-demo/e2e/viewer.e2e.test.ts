// Real-browser tests: headless Chromium, WebGL2 via SwiftShader (no GPU), against the production build of the demo.
// Run: npm run test:e2e   (builds the demo, serves it, launches /opt/pw-browsers Chromium through playwright-core)
//
// Tests whose name starts with "TIMING" depend on machine speed (shared VM). They use generous floors, retry twice,
// and print the measured numbers; every other test is deterministic.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import type { PreviewServer } from 'vite';
import { anchor, chromiumPath, countPixels, demoRoot, glbWithNodes, launch, opaqueBox, openDemo, settle, shotDir, sizeStage, stageBox, startServer } from './helpers';
import type { Opened } from './helpers';

let browser: Browser;
let server: PreviewServer;
let url: string;
const opened: Opened[] = [];
const results: Record<string, unknown> = {}; // measured numbers, written to dist/e2e/results.json (console output of passing tests is hidden by vitest)
const record = (k: string, v: unknown) => { results[k] = v; };

async function open(o: Parameters<typeof openDemo>[2] = {}): Promise<Opened> {
  const x = await openDemo(browser, url, o);
  opened.push(x);
  return x;
}

beforeAll(async () => {
  ({ server, url } = await startServer());
  browser = await launch();
  fs.mkdirSync(shotDir, { recursive: true });
});

afterEach(async () => {
  for (const o of opened.splice(0)) await o.ctx.close().catch(() => {}); // one page at a time keeps the timing tests honest
});

afterAll(async () => {
  fs.writeFileSync(`${demoRoot}/dist/e2e/results.json`, JSON.stringify(results, null, 2));
  for (const o of opened) await o.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

const setSliders = (page: Opened['page'], v: Record<string, number>) =>
  page.evaluate((vals) => {
    for (const [id, p] of Object.entries(vals)) {
      const el = document.getElementById(`s-${id}`) as HTMLInputElement;
      el.value = String(Math.round(p * 100));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, v);

const noErrors = (o: Opened) => expect(o.errors, o.errors.join('\n')).toEqual([]);

describe('environment and loading', () => {
  it('has a WebGL2 context on software GL, and the viewer draws with it', async () => {
    const o = await open({ query: 'lowPower=0' });
    const info = await o.page.evaluate(() => {
      const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null; // returns the viewer's own context
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: gl instanceof WebGL2RenderingContext, renderer: dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'n/a', aa: gl?.getContextAttributes()?.antialias };
    });
    console.log('GL info:', JSON.stringify(info));
    record('gl_info', info);
    expect(info.webgl2).toBe(true);
    expect(info.renderer).toMatch(/SwiftShader/i);
    expect(info.aa, 'antialiasing must be off on software GL even when lowPower=false').toBe(false);
    noErrors(o);
  });

  it('loads heart.glb (standard): status, triangles, vessel nodes', async () => {
    const o = await open({ query: 'lowPower=0' });
    const st = await o.page.evaluate(() => window.__viewer.getStatus());
    expect(st).toMatchObject({ loaded: true, usingFallback: 'none', webgl: true, triangles: 23283 });
    noErrors(o);
  });

  it('lowPower=1 prefers heart_lite.glb; default on software GL auto-selects it', async () => {
    const a = await open({ query: 'lowPower=1' });
    expect(await a.page.evaluate(() => window.__viewer.getStatus())).toMatchObject({ loaded: true, usingFallback: 'lite', triangles: 6691 });
    const b = await open({});
    expect(await b.page.evaluate(() => window.__viewer.getStatus())).toMatchObject({ loaded: true, usingFallback: 'lite', triangles: 6691 });
    noErrors(a); noErrors(b);
  });

  it('falls back standard -> lite when the standard model is missing, logging why', async () => {
    const o = await open({ query: 'lowPower=0&model=models3d/nope.glb' });
    expect(await o.page.evaluate(() => window.__viewer.getStatus())).toMatchObject({ loaded: true, usingFallback: 'lite' });
    expect(o.logs.some((l) => l.startsWith('error:') && /nope\.glb/.test(l) && /next fallback/.test(l))).toBe(true);
  });

  it('falls back to the built-in procedural heart when no GLB loads, and it is fully usable', async () => {
    const o = await open({ query: 'lowPower=0&model=models3d/nope1.glb&lite=models3d/nope2.glb' });
    const st = await o.page.evaluate(() => window.__viewer.getStatus());
    expect(st).toMatchObject({ loaded: true, usingFallback: 'procedural', webgl: true });
    expect(st.triangles).toBeGreaterThan(5000);
    await o.page.evaluate(() => window.__viewer.select('RCA'));
    await settle(o.page);
    expect(await o.page.evaluate(() => window.__sel)).toEqual(['RCA']);
    expect((await anchor(o.page, 'RCA')).visible).toBe(true);
    await (await o.page.locator('#stage')).screenshot({ path: `${shotDir}/procedural_fallback_selected_RCA.png` });
    noErrors(o);
  });

  it('procedural fallback also when only a standard url exists and it fails', async () => {
    const o = await open({ query: 'lowPower=0&model=models3d/nope1.glb&lite=none' });
    expect((await o.page.evaluate(() => window.__viewer.getStatus())).usingFallback).toBe('procedural');
  });

  it('rejects a GLB without the manifest mesh names, with a clear error, and falls back', async () => {
    const o = await open({
      query: 'lowPower=0&model=models3d/missing_rca.glb',
      setup: (page) => page.route('**/models3d/missing_rca.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: glbWithNodes(['LAD', 'LCX', 'left_ventricle']) })),
    });
    expect(await o.page.evaluate(() => window.__viewer.getStatus())).toMatchObject({ loaded: true, usingFallback: 'lite' });
    const err = o.logs.find((l) => l.startsWith('error:') && /RCA/.test(l));
    expect(err, o.logs.join('\n')).toBeTruthy();
    expect(err).toMatch(/manifest/);
  });
});

describe('colour coding', () => {
  it('setVessels recolours the rendered arteries live, for all three bands (pixel read-back)', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => {
      window.__viewer.setOverall(null);
      window.__viewer.setVessels({ LAD: { probability: 0.9, band: 'high', color: '#D64545' }, LCX: { probability: 0.9, band: 'high', color: '#D64545' }, RCA: { probability: 0.9, band: 'high', color: '#D64545' } });
    });
    const high = await countPixels(o.page);
    await o.page.evaluate(() => window.__viewer.setVessels({ LAD: { probability: 0.1, band: 'low', color: '#2E9E6A' }, LCX: { probability: 0.1, band: 'low', color: '#2E9E6A' }, RCA: { probability: 0.1, band: 'low', color: '#2E9E6A' } }));
    const low = await countPixels(o.page);
    await o.page.evaluate(() => window.__viewer.setVessels({ LAD: { probability: 0.4, band: 'moderate', color: '#E0A030' }, LCX: { probability: 0.4, band: 'moderate', color: '#E0A030' }, RCA: { probability: 0.4, band: 'moderate', color: '#E0A030' } }));
    const mod = await countPixels(o.page);
    record('band_pixels_high_low_moderate', [high, low, mod].map((p) => ({ red: p.red, green: p.green, amber: p.amber })));
    console.log('pixel classes high/low/moderate', JSON.stringify([high, low, mod].map((p) => ({ red: p.red, green: p.green, amber: p.amber }))));
    expect(high.red).toBeGreaterThan(150);
    expect(high.green).toBeLessThan(20);
    expect(low.green).toBeGreaterThan(150);
    expect(low.red).toBeLessThan(20);
    expect(mod.amber).toBeGreaterThan(150);
    expect(mod.red + mod.green).toBeLessThan(20);
    // one vessel at a time: only that vessel's pixels change
    await o.page.evaluate(() => window.__viewer.setVessels({ LAD: { probability: 0.9, band: 'high', color: '#D64545' } }));
    const oneRed = await countPixels(o.page);
    expect(oneRed.red).toBeGreaterThan(30);
    expect(oneRed.red).toBeLessThan(mod.amber);
    expect(oneRed.amber).toBeGreaterThan(30);
    noErrors(o);
  });

  it('a vessel cleared with undefined goes back to neutral grey', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => { window.__viewer.setOverall(null); window.__viewer.setVessels({ LAD: { probability: 0.9, band: 'high', color: '#D64545' }, LCX: undefined, RCA: undefined }); });
    expect((await countPixels(o.page)).red).toBeGreaterThan(30);
    await o.page.evaluate(() => window.__viewer.setVessels({ LAD: undefined }));
    expect((await countPixels(o.page)).red).toBe(0);
  });

  it('wider uncertainty desaturates the vessel colour', async () => {
    const o = await open({ query: 'lowPower=0' });
    const chroma = async (w: number) => {
      await o.page.evaluate((width) => {
        window.__viewer.setOverall(null);
        const s = { probability: 0.9, band: 'high' as const, color: '#D64545', uncertaintyWidth: width };
        window.__viewer.setVessels({ LAD: s, LCX: s, RCA: s });
      }, w);
      return countPixels(o.page);
    };
    const crisp = await chroma(0.02), mid = await chroma(0.2), wide = await chroma(0.5);
    console.log('max chroma / red pixels by width', [crisp, mid, wide].map((p) => [p.maxChroma, p.red]));
    expect(crisp.red).toBeGreaterThan(150);
    expect(mid.red).toBeLessThan(crisp.red);
    expect(wide.red).toBe(0);
    expect(wide.maxChroma).toBeLessThan(crisp.maxChroma - 40);
  });

  it('overall glow: halo appears with setOverall, grows with probability, is removed with null, and takes the strongest vessel colour', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => window.__viewer.setOverall(null));
    const none = await countPixels(o.page);
    await o.page.evaluate(() => window.__viewer.setOverall({ probability: 0.2, band: 'low', color: '#2E9E6A' }));
    const weak = await countPixels(o.page);
    await o.page.evaluate(() => window.__viewer.setOverall({ probability: 0.95, band: 'high', color: '#D64545' }));
    const strong = await countPixels(o.page);
    await o.page.evaluate(() => window.__viewer.setOverall(null));
    const gone = await countPixels(o.page);
    console.log('halo alpha sums none/weak/strong/gone', none.alphaSum, weak.alphaSum, strong.alphaSum, gone.alphaSum);
    const inc = (p: { alphaSum: number }) => p.alphaSum - none.alphaSum; // alpha added by the halo (the opaque heart is in the baseline)
    expect(inc(weak)).toBeGreaterThan(1_000_000);
    expect(inc(strong)).toBeGreaterThan(inc(weak) * 1.3);
    expect(gone.alphaSum).toBe(none.alphaSum);
    expect(strong.haloMean[0]).toBeGreaterThan(strong.haloMean[1] + 40); // red halo
    // inconsistent input (vessel stronger than overall): the halo follows the vessel, so it is never weaker than it
    await o.page.evaluate(() => {
      window.__viewer.setVessels({ LAD: { probability: 0.9, band: 'high', color: '#D64545' } });
      window.__viewer.setOverall({ probability: 0.2, band: 'low', color: '#2E9E6A' });
    });
    const lifted = await countPixels(o.page);
    expect(lifted.haloMean[0]).toBeGreaterThan(lifted.haloMean[1] + 40);
    expect(inc(lifted)).toBeGreaterThan(inc(weak) * 1.3);
    noErrors(o);
  });
});

describe('interaction', () => {
  it('click selects each vessel with real mouse events; background click clears; drag does not select', async () => {
    const o = await open({ query: 'lowPower=0' });
    const box = await stageBox(o.page);
    for (const id of ['LAD', 'LCX', 'RCA'] as const) {
      await o.page.evaluate((v) => { window.__viewer.select(v); }, id); // bring the vessel into view...
      await settle(o.page);
      await o.page.evaluate(() => window.__viewer.select(null)); // ...then clear, and click it for real
      await settle(o.page);
      const a = await anchor(o.page, id);
      expect(a.visible, `${id} anchor should face the camera after focusing`).toBe(true);
      await o.page.evaluate(() => { window.__sel = []; });
      await o.page.mouse.click(box.x + a.x, box.y + a.y);
      await settle(o.page);
      expect(await o.page.evaluate(() => window.__sel), `click on ${id}`).toEqual([id]);
    }
    await o.page.evaluate(() => { window.__sel = []; });
    await o.page.mouse.click(box.x + 12, box.y + 12);
    expect(await o.page.evaluate(() => window.__sel)).toEqual([null]);
    // a drag that starts on a vessel rotates the view and selects nothing
    const a = await anchor(o.page, 'RCA');
    await o.page.evaluate(() => { window.__sel = []; });
    await o.page.mouse.move(box.x + a.x, box.y + a.y);
    await o.page.mouse.down();
    await o.page.mouse.move(box.x + a.x + 70, box.y + a.y + 20, { steps: 6 });
    await o.page.mouse.up();
    await settle(o.page);
    expect(await o.page.evaluate(() => window.__sel)).toEqual([]);
    noErrors(o);
  });

  it('a touch tap selects a vessel', async () => {
    const o = await open({ query: 'lowPower=0', hasTouch: true });
    const box = await stageBox(o.page);
    await o.page.evaluate(() => { window.__viewer.select('LAD'); });
    await settle(o.page);
    await o.page.evaluate(() => { window.__viewer.select(null); window.__sel = []; });
    await settle(o.page);
    const a = await anchor(o.page, 'LAD');
    await o.page.touchscreen.tap(box.x + a.x, box.y + a.y);
    await settle(o.page);
    expect(await o.page.evaluate(() => window.__sel)).toEqual(['LAD']);
    noErrors(o);
  });

  it('hovering a vessel shows a pointer cursor and an outline; leaving removes both', async () => {
    const o = await open({ query: 'lowPower=0' });
    const box = await stageBox(o.page);
    await o.page.evaluate(() => { window.__viewer.select('LAD'); });
    await settle(o.page);
    await o.page.evaluate(() => window.__viewer.select(null));
    await settle(o.page);
    const before = await countPixels(o.page);
    const a = await anchor(o.page, 'LAD');
    await o.page.mouse.move(box.x + 5, box.y + 5);
    await o.page.mouse.move(box.x + a.x, box.y + a.y, { steps: 3 });
    await o.page.waitForTimeout(250);
    expect(await o.page.evaluate(() => (document.querySelector('#stage canvas') as HTMLElement).style.cursor)).toBe('pointer');
    const hover = await countPixels(o.page);
    expect(hover.white).toBeGreaterThan(before.white + 20);
    await o.page.mouse.move(box.x + 5, box.y + 5);
    await o.page.waitForTimeout(250);
    expect(await o.page.evaluate(() => (document.querySelector('#stage canvas') as HTMLElement).style.cursor)).toBe('');
    noErrors(o);
  });

  it('the selected vessel is distinct beyond colour: outline pixels appear, other vessels unchanged', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => { window.__viewer.setOverall(null); window.__viewer.select('LAD'); });
    await settle(o.page);
    await o.page.evaluate(() => window.__viewer.select(null));
    await settle(o.page);
    const plain = await countPixels(o.page);
    await o.page.evaluate(() => window.__viewer.select('LAD'));
    await settle(o.page);
    const sel = await countPixels(o.page);
    console.log('outline pixels dark/white plain -> selected', plain.dark, plain.white, '->', sel.dark, sel.white);
    record('outline_pixels', { plain: [plain.dark, plain.white], selected: [sel.dark, sel.white] });
    expect(sel.dark).toBeGreaterThan(plain.dark + 100);
    expect(sel.white).toBeGreaterThan(plain.white + 100);
    await o.page.evaluate(() => window.__viewer.select(null));
    await settle(o.page);
    const back = await countPixels(o.page);
    expect(back.dark).toBeLessThan(plain.dark + 30);
  });

  it('keyboard: 1/2/3 select, Escape clears, arrows rotate, +/- zoom, 0 resets', async () => {
    const o = await open({ query: 'lowPower=0&reduced=1' });
    await settle(o.page);
    const initial = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    await o.page.focus('#stage');
    const sel = () => o.page.evaluate(() => window.__sel.slice());
    await o.page.keyboard.press('1');
    await o.page.keyboard.press('2');
    await o.page.keyboard.press('3');
    await o.page.keyboard.press('Escape');
    expect(await sel()).toEqual(['LAD', 'LCX', 'RCA', null]);
    const maxd = (p: number[][], q: number[][]) => Math.max(...p.map((a, i) => Math.hypot(a[0] - q[i][0], a[1] - q[i][1])));
    await o.page.keyboard.press('0'); // selecting moved the camera; 0 returns to the start pose
    await settle(o.page);
    const home2 = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    expect(maxd(home2, initial), '0 resets to the initial view').toBeLessThan(1);
    await o.page.keyboard.press('ArrowLeft');
    await o.page.keyboard.press('ArrowLeft');
    await settle(o.page);
    const rotated = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    expect(maxd(rotated, home2), 'ArrowLeft x2 moves the anchors').toBeGreaterThan(10);
    await o.page.keyboard.press('0');
    await settle(o.page);
    expect(maxd(await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y])), home2), '0 resets the view').toBeLessThan(1);
    const spread = (p: number[][]) => Math.hypot(p[0][0] - p[2][0], p[0][1] - p[2][1]);
    await o.page.keyboard.press('+');
    await o.page.keyboard.press('+');
    await settle(o.page);
    const zin = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    expect(spread(zin)).toBeGreaterThan(spread(home2) * 1.2);
    await o.page.keyboard.press('-');
    await o.page.keyboard.press('-');
    await o.page.keyboard.press('-');
    await o.page.keyboard.press('-');
    await settle(o.page);
    expect(spread(await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y])))).toBeLessThan(spread(home2));
    await o.page.keyboard.press('ArrowUp');
    await o.page.keyboard.press('ArrowDown');
    await o.page.keyboard.press('a'); // unrelated key: ignored, not prevented
    noErrors(o);
  });

  it('keys typed in UI inside the container, or with Ctrl, do not trigger the viewer', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'inner';
      document.getElementById('stage')!.appendChild(i);
    });
    await o.page.focus('#inner');
    await o.page.keyboard.press('1');
    await o.page.focus('#stage');
    await o.page.keyboard.press('Control+2');
    expect(await o.page.evaluate(() => window.__sel)).toEqual([]);
  });

  it('wheel zoom and drag rotate move the view; resetView() returns to the start', async () => {
    const o = await open({ query: 'lowPower=0' });
    await settle(o.page);
    const box = await stageBox(o.page);
    const start = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    await o.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await o.page.mouse.wheel(0, -600);
    await settle(o.page);
    const zoomed = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    const spread = (p: number[][]) => Math.hypot(p[0][0] - p[2][0], p[0][1] - p[2][1]);
    expect(spread(zoomed)).toBeGreaterThan(spread(start) * 1.1);
    await o.page.mouse.down();
    await o.page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 });
    await o.page.mouse.up();
    await settle(o.page);
    await o.page.evaluate(() => window.__viewer.resetView());
    await settle(o.page);
    const after = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    const maxd = Math.max(...after.map((a, i) => Math.hypot(a[0] - start[i][0], a[1] - start[i][1])));
    expect(maxd).toBeLessThan(1.5);
    noErrors(o);
  });

  it('anchors: unknown nodes report visible=false; known nodes move with the camera; unsubscribe stops callbacks', async () => {
    const o = await open({ query: 'lowPower=0' });
    const r = await o.page.evaluate(async () => {
      const v = window.__viewer;
      const seen: { key: string; visible: boolean; x: number; y: number }[][] = [];
      const off = v.onAnchors((a) => seen.push(a.map((s) => ({ key: s.key, visible: s.visible, x: s.x, y: s.y }))));
      v.setAnchors([{ key: 'ef_tte', node: 'left_ventricle' }, { key: 'nope', node: 'no_such_node' }, { key: 'bp', node: 'ascending_aorta' }]);
      const first = seen[seen.length - 1];
      v.resize();
      off();
      const n = seen.length;
      v.setAnchors([{ key: 'ef_tte', node: 'right_atrium' }]);
      return { first, extra: seen.length - n };
    });
    const byKey = Object.fromEntries(r.first.map((a) => [a.key, a]));
    expect(byKey.nope.visible).toBe(false);
    expect(byKey.ef_tte.x).toBeGreaterThan(0);
    expect(byKey.bp.y).toBeLessThan(byKey.ef_tte.y); // aorta is above the left ventricle on screen
    expect(r.extra).toBe(0);
    expect(o.logs.some((l) => /no node named "no_such_node"/.test(l))).toBe(true);
  });
});

describe('rendering policy', () => {
  it('renders on demand: an idle viewer draws no frames and schedules no rAF; a state change draws a few then stops', async () => {
    const o = await open({ query: 'lowPower=0' });
    await settle(o.page, 500);
    const idle0 = await o.page.evaluate(() => [window.__clears, window.__rafCalls]);
    await o.page.waitForTimeout(1500);
    const idle1 = await o.page.evaluate(() => [window.__clears, window.__rafCalls]);
    expect(idle1[0] - idle0[0], 'frames while idle').toBe(0);
    expect(idle1[1] - idle0[1], 'rAF requests while idle').toBe(0);
    await o.page.evaluate(() => window.__viewer.setVessels({ LAD: { probability: 0.3, band: 'moderate', color: '#E0A030' } }));
    await o.page.waitForTimeout(400);
    const a = await o.page.evaluate(() => window.__clears);
    expect(a - idle1[0]).toBeGreaterThanOrEqual(1);
    expect(a - idle1[0]).toBeLessThanOrEqual(3);
    await o.page.waitForTimeout(800);
    expect(await o.page.evaluate(() => window.__clears)).toBe(a);
    noErrors(o);
  });

  it('reducedMotion: camera focus is instant and there is no damping tail', async () => {
    const o = await open({ query: 'lowPower=0&reduced=1' });
    await settle(o.page, 500);
    await o.page.evaluate(() => window.__viewer.select('RCA'));
    await o.page.waitForTimeout(120);
    const quick = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    await settle(o.page);
    const final = await o.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    expect(Math.max(...quick.map((a, i) => Math.hypot(a[0] - final[i][0], a[1] - final[i][1])))).toBeLessThan(1);
    const box = await stageBox(o.page);
    await o.page.mouse.move(box.x + 300, box.y + 250);
    await o.page.mouse.down();
    await o.page.mouse.move(box.x + 400, box.y + 280, { steps: 5 });
    await o.page.mouse.up();
    await o.page.waitForTimeout(100);
    const c0 = await o.page.evaluate(() => window.__clears);
    await o.page.waitForTimeout(800);
    expect((await o.page.evaluate(() => window.__clears)) - c0, 'frames after releasing the drag').toBeLessThanOrEqual(1);
    // contrast: the animated focus takes visible time without reduced motion
    const n = await open({ query: 'lowPower=0&reduced=0' });
    await settle(n.page, 500);
    const s0 = await n.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    await n.page.evaluate(() => window.__viewer.select('RCA'));
    await n.page.waitForTimeout(150);
    const s1 = await n.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    await settle(n.page);
    const s2 = await n.page.evaluate(() => window.__anchors!.map((a) => [a.x, a.y]));
    const dist = (p: number[][], q: number[][]) => Math.max(...p.map((a, i) => Math.hypot(a[0] - q[i][0], a[1] - q[i][1])));
    expect(dist(s1, s2), 'mid-tween position differs from the final one').toBeGreaterThan(3);
    expect(dist(s0, s2)).toBeGreaterThan(10);
  });

  it('caps the drawing buffer on big screens (pixel budget) and renders at pixel ratio 1 in low power', async () => {
    const big = () => { const s = document.getElementById('stage')!; s.style.height = '1300px'; s.style.width = '2200px'; window.__viewer.resize(); };
    const o = await open({ query: 'lowPower=1', viewport: { width: 2560, height: 1440 } });
    await o.page.evaluate(big);
    const px = await o.page.evaluate(() => {
      const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
      return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, dpr: window.devicePixelRatio };
    });
    console.log('2560x1440 viewport, low power, canvas', JSON.stringify(px));
    record('canvas_cap_lowpower', px);
    expect(px.w * px.h).toBeLessThanOrEqual(800_000 * 1.01);
    expect(px.cssW).toBeGreaterThan(px.w); // CSS size unchanged, buffer smaller, scaled up by the browser
    const hi = await open({ query: 'lowPower=0', viewport: { width: 2560, height: 1440 } });
    await hi.page.evaluate(big);
    const px2 = await hi.page.evaluate(() => { const c = document.querySelector('#stage canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
    expect(px2.w * px2.h).toBeLessThanOrEqual(1_800_000 * 1.01);
  });

  it('resizes with its container (ResizeObserver) and stays inside it', async () => {
    const o = await open({ query: 'lowPower=0' });
    const before = await o.page.evaluate(() => (document.querySelector('#stage canvas') as HTMLCanvasElement).clientWidth);
    await o.page.setViewportSize({ width: 600, height: 800 });
    await o.page.waitForTimeout(400);
    const after = await o.page.evaluate(() => { const c = document.querySelector('#stage canvas') as HTMLCanvasElement; const s = document.getElementById('stage')!; return { w: c.clientWidth, h: c.clientHeight, sw: s.clientWidth, sh: s.clientHeight, ratio: c.width / c.height }; });
    expect(after.w).toBe(after.sw);
    expect(after.h).toBe(after.sh);
    expect(after.w).toBeLessThan(before);
    expect(Math.abs(after.ratio - after.sw / after.sh)).toBeLessThan(0.02);
    noErrors(o);
  });
});

describe('camera framing', () => {
  // canvas shapes: the sticky column at 1920x1030 and 1920x890, a laptop, the shortest column, a tall box, a phone, a very wide strip
  const SHAPES: [number, number][] = [[813, 569], [813, 429], [660, 349], [624, 200], [400, 500], [286, 318], [300, 600], [1200, 400]];

  it('the heart fills 80-95 percent of the limiting dimension at the home view, measured on the rendered pixels, for every box shape', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1300, height: 900 } });
    await settle(o.page);
    for (const [w, h] of SHAPES) {
      await sizeStage(o.page, w, h);
      const b = await opaqueBox(o.page);
      record(`framing_${w}x${h}`, { limiting: +b.limiting.toFixed(3), fx: +b.fx.toFixed(3), fy: +b.fy.toFixed(3) });
      expect(b.limiting, `${w}x${h}`).toBeGreaterThanOrEqual(0.8);
      expect(b.limiting, `${w}x${h}`).toBeLessThanOrEqual(0.95);
      expect(b.fx, `${w}x${h} width`).toBeLessThanOrEqual(0.95);
      expect(b.fy, `${w}x${h} height`).toBeLessThanOrEqual(0.95);
      expect(b.x0, `${w}x${h} left edge`).toBeGreaterThan(0);
      expect(b.y0, `${w}x${h} top edge`).toBeGreaterThan(0);
      expect(b.x1, `${w}x${h} right edge`).toBeLessThan(b.w - 1);
      expect(b.y1, `${w}x${h} bottom edge`).toBeLessThan(b.h - 1);
      // the camera maths agrees with what was actually drawn
      const f = await o.page.evaluate(() => window.__viewer.getFraming());
      expect(Math.abs(f.silhouette!.y1 - f.silhouette!.y0 - (b.y1 - b.y0 + 1) * (f.height / b.h))).toBeLessThan(0.02 * f.height + 3);
    }
    noErrors(o);
  });

  it('labels stay inside the canvas at every box shape (home view, and a selected vessel)', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1300, height: 900 } });
    for (const sel of [null, 'LAD']) {
      for (const [w, h] of SHAPES) {
        await sizeStage(o.page, w, h);
        await o.page.evaluate((s) => window.__viewer.select(s as 'LAD' | null), sel);
        await settle(o.page);
        const chips = await o.page.evaluate(() => {
          const st = document.getElementById('stage')!.getBoundingClientRect();
          return [...document.querySelectorAll('[data-viewer-labels] [data-label]')].filter((r) => (r as HTMLElement).style.display !== 'none')
            .map((r) => { const c = r.querySelector('span')!.getBoundingClientRect(); return { id: (r as HTMLElement).dataset.label, l: c.left - st.left, t: c.top - st.top, r: st.right - c.right, b: st.bottom - c.bottom }; });
        });
        expect(chips.length, `${w}x${h} ${sel}`).toBe(3);
        for (const c of chips) for (const k of ['l', 't', 'r', 'b'] as const) expect(c[k], `${w}x${h} ${sel} ${c.id} ${k}`).toBeGreaterThanOrEqual(-0.5);
      }
    }
    noErrors(o);
  });

  it('re-fits on resize (keeping the orbit angle), refits on resetView, keeps a deliberate zoom, and the zoom range stays usable', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1300, height: 900 } });
    const get = () => o.page.evaluate(() => window.__viewer.getFraming());
    const angle = (a: { direction: number[] }, b: { direction: number[] }) => (Math.acos(Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2])) * 180) / Math.PI;
    await sizeStage(o.page, 813, 500);
    const home = await get();
    expect(home.fitted).toBe(true);
    // shape changes: the distance follows the limiting dimension (a narrow box needs a larger distance), and the heart stays at the fill
    await sizeStage(o.page, 300, 600);
    const narrow = await get();
    expect(narrow.distance).toBeGreaterThan(home.distance * 1.4);
    expect(narrow.fitted).toBe(true);
    const nb = await opaqueBox(o.page);
    expect(nb.limiting).toBeGreaterThanOrEqual(0.8);
    await sizeStage(o.page, 813, 500);
    expect(Math.abs((await get()).distance - home.distance)).toBeLessThan(0.01);
    // orbit (arrow keys), then resize: same angle
    await o.page.focus('#stage');
    for (let i = 0; i < 5; i++) await o.page.keyboard.press('ArrowRight');
    await settle(o.page);
    const orbited = await get();
    expect(angle(orbited, home)).toBeGreaterThan(8);
    await sizeStage(o.page, 300, 600);
    const orbitedNarrow = await get();
    expect(angle(orbitedNarrow, orbited)).toBeLessThan(0.3);
    expect(orbitedNarrow.fitted).toBe(true);
    expect(orbitedNarrow.distance).toBeGreaterThan(orbited.distance * 1.3);
    const sil = orbitedNarrow.silhouette!;
    expect(Math.max(sil.x1 - sil.x0, 0) / orbitedNarrow.width).toBeGreaterThan(0.6);
    expect(sil.x0).toBeGreaterThanOrEqual(-0.5); expect(sil.x1).toBeLessThanOrEqual(orbitedNarrow.width + 0.5);
    // reset view: home again for the current box
    await o.page.evaluate(() => window.__viewer.resetView());
    await settle(o.page);
    const reset = await get();
    expect(reset.fitted).toBe(true);
    expect(angle(reset, home)).toBeLessThan(0.3);
    expect((await opaqueBox(o.page)).limiting).toBeGreaterThanOrEqual(0.8);
    // a deliberate zoom is kept (same share of the box), not snapped back to the fit
    await sizeStage(o.page, 813, 500);
    await o.page.keyboard.press('0'); await settle(o.page);
    for (let i = 0; i < 4; i++) await o.page.keyboard.press('+');
    await settle(o.page);
    const zoomed = await get();
    expect(zoomed.fitted).toBe(false);
    await sizeStage(o.page, 660, 349);
    const zoomed2 = await get();
    expect(zoomed2.fitted).toBe(false);
    expect(Math.abs(zoomed2.distance - zoomed.distance) / zoomed.distance).toBeLessThan(0.02);
    // zoom range
    await sizeStage(o.page, 813, 500);
    await o.page.keyboard.press('0'); await settle(o.page);
    const fit = (await get()).autoDistance;
    for (let i = 0; i < 50; i++) await o.page.keyboard.press('-');
    await settle(o.page);
    expect((await get()).distance).toBeGreaterThanOrEqual(fit * 2);
    for (let i = 0; i < 100; i++) await o.page.keyboard.press('+');
    await settle(o.page);
    expect((await get()).distance).toBeLessThanOrEqual(fit * 0.5);
    noErrors(o);
  });

  it('resize keeps rendering on demand: a few frames for the resize, then none while idle', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1300, height: 900 } });
    await settle(o.page, 500);
    await sizeStage(o.page, 500, 420);
    await o.page.waitForTimeout(600);
    const a = await o.page.evaluate(() => [window.__clears, window.__rafCalls]);
    await o.page.waitForTimeout(1500);
    const b = await o.page.evaluate(() => [window.__clears, window.__rafCalls]);
    expect(b[0] - a[0], 'frames while idle after a resize').toBe(0);
    expect(b[1] - a[1], 'rAF requests while idle after a resize').toBe(0);
    noErrors(o);
  });

  it('the fill option sets the share (default 0.88, 0.7 gives a smaller heart, out-of-range values are clamped)', async () => {
    const shares: Record<string, number> = {};
    for (const q of ['lowPower=0', 'lowPower=0&fill=0.7', 'lowPower=0&fill=5', 'lowPower=0&fill=0.01']) {
      const o = await open({ query: q, viewport: { width: 1300, height: 900 } });
      await sizeStage(o.page, 813, 500);
      shares[q] = (await opaqueBox(o.page)).limiting;
      noErrors(o);
    }
    expect(shares['lowPower=0']).toBeGreaterThan(0.85);
    expect(shares['lowPower=0&fill=0.7']).toBeGreaterThan(0.66);
    expect(shares['lowPower=0&fill=0.7']).toBeLessThan(0.74);
    expect(shares['lowPower=0&fill=5']).toBeLessThan(0.99); // clamped to 0.98
    expect(shares['lowPower=0&fill=0.01']).toBeGreaterThan(0.45); // clamped to 0.5
    expect(shares['lowPower=0&fill=0.01']).toBeLessThan(0.56);
  });
});

describe('accessibility', () => {
  it('container is an application with a label; selections are announced in an aria-live region the class creates', async () => {
    const o = await open({ query: 'lowPower=0' });
    const attrs = await o.page.evaluate(() => {
      const s = document.getElementById('stage')!;
      const live = s.querySelector('[aria-live]');
      return { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), tabindex: s.getAttribute('tabindex'), live: live?.getAttribute('aria-live'), liveRole: live?.getAttribute('role'), canvasHidden: s.querySelector('canvas')?.getAttribute('aria-hidden') };
    });
    expect(attrs).toMatchObject({ role: 'application', tabindex: '0', live: 'polite', liveRole: 'status', canvasHidden: 'true' });
    expect(attrs.label).toMatch(/LAD, LCX and RCA/);
    expect(attrs.label).toMatch(/Escape/);
    const live = () => o.page.evaluate(() => (document.querySelector('#stage [aria-live]') as HTMLElement).textContent!.replace(/ /g, ' ').trim());
    await o.page.focus('#stage');
    await o.page.keyboard.press('1');
    expect(await live()).toBe('LAD selected. high risk, probability 76 percent.');
    await o.page.keyboard.press('3');
    expect(await live()).toBe('RCA selected. low risk, probability 10 percent.');
    await o.page.keyboard.press('Escape');
    expect(await live()).toBe('Selection cleared.');
    // keyboard focus is reachable by Tab and the browser focus ring is not suppressed
    await o.page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await o.page.keyboard.press('Tab');
    const focused = await o.page.evaluate(() => document.activeElement?.id);
    expect(['stage', 'unc', 's-LAD'].includes(focused ?? '')).toBe(true);
    noErrors(o);
  });
});

describe('robustness', () => {
  const stub = `(() => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(String(t)) ? null : o.call(this, t, ...a); }; })();`;

  it('WebGL unavailable (getContext stubbed to null): no crash, status.webgl=false, accessible fallback, keyboard and announcements still work', async () => {
    const o = await open({ initScript: stub });
    const st = await o.page.evaluate(() => window.__viewer.getStatus());
    expect(st).toMatchObject({ loaded: false, usingFallback: 'none', webgl: false, triangles: 0 });
    const dom = await o.page.evaluate(() => {
      const s = document.getElementById('stage')!;
      const fb = s.querySelector('[role=img]') as HTMLElement | null;
      return { canvas: !!s.querySelector('canvas'), fbText: fb?.textContent ?? null, fbLabel: fb?.getAttribute('aria-label') ?? null, hidden: fb ? fb.hidden || getComputedStyle(fb).display === 'none' : true };
    });
    expect(dom.canvas).toBe(false);
    expect(dom.hidden).toBe(false);
    expect(dom.fbText).toMatch(/3D view unavailable/);
    expect(dom.fbText).toMatch(/LAD: high risk \(76%\)/); // demo set the sliders: the fallback summarises the predictions in text
    await o.page.focus('#stage');
    await o.page.keyboard.press('2');
    expect(await o.page.evaluate(() => window.__sel)).toEqual(['LCX']);
    expect(await o.page.evaluate(() => (document.querySelector('#stage [aria-live]') as HTMLElement).textContent)).toMatch(/LCX selected/);
    await o.page.evaluate(() => { window.__viewer.setVessels({ RCA: { probability: 0.95, band: 'high', color: '#D64545' } }); window.__viewer.resetView(); window.__viewer.resize(); window.__viewer.setAnchors([{ key: 'a', node: 'LAD' }]); });
    expect(await o.page.evaluate(() => document.getElementById('stage')!.textContent)).toMatch(/RCA: high risk \(95%\)/);
    await o.page.evaluate(() => window.__viewer.dispose());
    expect(o.errors).toEqual([]);
  });

  it('WebGL disabled at browser level (--disable-3d-apis, no software GL): same graceful behaviour', async () => {
    const b = await chromium.launch({ executablePath: chromiumPath(), args: ['--disable-gpu', '--disable-3d-apis', '--disable-software-rasterizer', '--no-sandbox'] });
    try {
      const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !!window.__viewer);
      await page.waitForTimeout(800);
      const hasGL = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl'));
      const st = await page.evaluate(() => window.__viewer.getStatus());
      console.log('browser-level WebGL disabled: canvas getContext ->', hasGL, 'status', JSON.stringify(st));
      expect(st.webgl).toBe(hasGL);
      if (!hasGL) expect(await page.evaluate(() => document.getElementById('stage')!.textContent)).toMatch(/3D view unavailable/);
      expect(errors).toEqual([]);
    } finally {
      await b.close();
    }
  });

  it('context loss: fallback message while lost, rendering resumes after restore (pixels back)', async () => {
    const o = await open({ query: 'lowPower=0' });
    await o.page.evaluate(() => { window.__viewer.setOverall(null); window.__viewer.setVessels({ LAD: { probability: 0.9, band: 'high', color: '#D64545' } }); });
    const ok0 = await countPixels(o.page);
    expect(ok0.red).toBeGreaterThan(30);
    await o.page.evaluate(() => {
      const gl = (document.querySelector('#stage canvas') as HTMLCanvasElement).getContext('webgl2')!;
      (window as unknown as { __lose: WEBGL_lose_context }).__lose = gl.getExtension('WEBGL_lose_context')!;
      (window as unknown as { __lose: WEBGL_lose_context }).__lose.loseContext();
    });
    await o.page.waitForFunction(() => !window.__viewer.getStatus().webgl);
    const lost = await o.page.evaluate(() => { const fb = document.querySelector('#stage [role=img]') as HTMLElement; return { hidden: fb.hidden || getComputedStyle(fb).display === 'none', text: fb.textContent, canvasVis: (document.querySelector('#stage canvas') as HTMLElement).style.visibility, loaded: window.__viewer.getStatus().loaded }; });
    expect(lost.hidden).toBe(false);
    expect(lost.text).toMatch(/graphics context was lost/);
    expect(lost.canvasVis).toBe('hidden');
    expect(lost.loaded, 'the model stays loaded in memory').toBe(true);
    await o.page.evaluate(() => window.__viewer.setVessels({ LAD: { probability: 0.1, band: 'low', color: '#2E9E6A' } })); // state changes while lost must not throw
    await o.page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
    await o.page.waitForFunction(() => window.__viewer.getStatus().webgl, null, { timeout: 10_000 });
    const back = await countPixels(o.page);
    console.log('after restore: green pixels', back.green, 'red', back.red);
    expect(back.green, 'the state set during the loss is drawn after restore').toBeGreaterThan(30);
    expect(back.red).toBe(0);
    expect(await o.page.evaluate(() => getComputedStyle(document.querySelector('#stage [role=img]') as HTMLElement).display), 'fallback message really hidden (computed style)').toBe('none');
    expect(await o.page.evaluate(() => (document.querySelector('#stage canvas') as HTMLElement).style.visibility)).toBe('');
    noErrors(o);
  });

  it('dispose leaks nothing: listeners, DOM, attributes, rAF, GL context; 12 create/dispose cycles raise no context warnings', async () => {
    const o = await open({ query: 'lowPower=0' });
    const r = await o.page.evaluate(async () => {
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const mk = () => {
        const el = document.createElement('div');
        el.style.cssText = 'width:420px;height:320px';
        el.setAttribute('aria-label', 'mine');
        document.body.appendChild(el);
        return el;
      };
      const before = window.__live.length;
      const el = mk();
      const v = new window.__HeartViewer({ container: el, modelUrl: 'models3d/heart.glb', liteModelUrl: 'models3d/heart_lite.glb', lowPower: false });
      await v.load();
      v.setVessels({ LAD: { probability: 0.8, band: 'high', color: '#D64545' } });
      v.setOverall({ probability: 0.9, band: 'high', color: '#D64545' });
      v.select('LAD');
      v.onSelect(() => {});
      v.onAnchors(() => {});
      v.setAnchors([{ key: 'x', node: 'LAD' }]);
      await wait(700);
      const during = window.__live.length - before;
      const canvas = el.querySelector('canvas') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
      v.dispose();
      v.dispose(); // idempotent
      v.select('RCA'); v.setVessels({}); v.resize(); // no-ops after dispose, no throw
      const clears = window.__clears, raf = window.__rafCalls;
      await wait(500);
      const out = {
        during,
        leftover: window.__live.slice(before).map((l) => `${(l.target as Element).tagName ?? 'target'}:${l.type}`),
        children: el.childElementCount,
        role: el.getAttribute('role'), label: el.getAttribute('aria-label'), tabindex: el.getAttribute('tabindex'), position: el.style.position,
        lost: gl.isContextLost(),
        framesAfter: window.__clears - clears, rafAfter: window.__rafCalls - raf,
        status: v.getStatus(),
      };
      el.remove();
      for (let i = 0; i < 12; i++) {
        const e2 = mk();
        const v2 = new window.__HeartViewer({ container: e2, modelUrl: 'models3d/heart_lite.glb', lowPower: true });
        await v2.load();
        v2.dispose();
        e2.remove();
      }
      return out;
    });
    console.log('dispose check', JSON.stringify(r));
    record('dispose_check', r);
    expect(r.during, 'listeners were attached while alive').toBeGreaterThan(5);
    expect(r.leftover).toEqual([]);
    expect(r.children).toBe(0);
    expect(r).toMatchObject({ role: null, label: 'mine', tabindex: null, position: '', lost: true, framesAfter: 0, rafAfter: 0 });
    expect(r.status).toEqual({ loaded: false, usingFallback: 'none', webgl: false, triangles: 0 }); // no stale fps either
    expect(o.logs.filter((l) => /too many active webgl contexts|context lost.*oldest/i.test(l))).toEqual([]);
    noErrors(o);
  });
});

describe('screenshots (viewed by hand; also smoke tests that every state renders)', () => {
  const shot = async (o: Opened, name: string, full = false) => {
    await settle(o.page, 300);
    if (full) await o.page.screenshot({ path: `${shotDir}/${name}.png` });
    else await o.page.locator('#stage').screenshot({ path: `${shotDir}/${name}.png` });
  };

  it('front, back, selected, the three bands, uncertainty, lite, dark theme, phone', async () => {
    const o = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 } });
    await shot(o, 'front_standard');
    await o.page.focus('#stage');
    for (let i = 0; i < 26; i++) await o.page.keyboard.press('ArrowLeft'); // ~180 degrees
    await shot(o, 'back_standard');
    await o.page.keyboard.press('0');
    for (const [id, key] of [['LAD', '1'], ['LCX', '2'], ['RCA', '3']] as const) {
      await o.page.keyboard.press(key);
      await shot(o, `selected_${id}`);
    }
    await o.page.keyboard.press('Escape');
    await o.page.keyboard.press('0');
    for (const [name, p] of [['low', { LAD: 0.1, LCX: 0.1, RCA: 0.1 }], ['moderate', { LAD: 0.4, LCX: 0.4, RCA: 0.4 }], ['high', { LAD: 0.9, LCX: 0.9, RCA: 0.9 }]] as const) {
      await setSliders(o.page, p);
      await shot(o, `bands_all_${name}`);
    }
    await setSliders(o.page, { LAD: 0.9, LCX: 0.9, RCA: 0.9 });
    await o.page.evaluate(() => { const u = document.getElementById('unc') as HTMLInputElement; u.value = '0.4'; u.dispatchEvent(new Event('input', { bubbles: true })); });
    await shot(o, 'uncertainty_wide_high');
    noErrors(o);

    const lite = await open({ query: 'lowPower=1', viewport: { width: 1180, height: 760 } });
    await lite.page.evaluate(() => window.__viewer.select('LAD'));
    await shot(lite, 'lite_lowpower_selected_LAD');

    const dark = await open({ query: 'lowPower=0', viewport: { width: 1180, height: 760 }, colorScheme: 'dark' });
    await dark.page.click('#theme');
    await dark.page.focus('#stage');
    await dark.page.keyboard.press('2');
    await shot(dark, 'dark_theme_selected_LCX', true);

    const phone = await open({ query: 'lowPower=0', viewport: { width: 390, height: 844 }, hasTouch: true });
    await shot(phone, 'phone', true);
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

describe('performance (measured on this machine: shared 4-vCPU VM, software GL)', () => {
  // TIMING: depends on machine speed. Floors are deliberately low (they catch a broken render loop, not a slow VM).
  const orbitFps = async (query: string, viewport: { width: number; height: number }) => {
    const o = await open({ query, viewport });
    const box = await stageBox(o.page);
    await settle(o.page, 400);
    await o.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await o.page.mouse.down();
    await o.page.waitForTimeout(500);
    const c0 = await o.page.evaluate(() => window.__clears), t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < 3500) { i++; await o.page.mouse.move(box.x + box.width / 2 + 140 * Math.sin(i / 8), box.y + box.height / 2 + 50 * Math.cos(i / 8)); }
    const fps = ((await o.page.evaluate(() => window.__clears)) - c0) / ((Date.now() - t0) / 1000);
    const meter = await o.page.evaluate(() => window.__viewer.getStatus().fps);
    await o.page.mouse.up();
    return { fps, meter };
  };

  for (const [name, query, vp, floor] of [
    ['TIMING 1280x800 default (auto low power: lite model)', '', { width: 1280, height: 800 }, 8],
    ['TIMING 1280x800 lowPower with the standard model', 'lowPower=1&lite=none', { width: 1280, height: 800 }, 8],
    ['TIMING 1280x800 full quality (standard materials, halo)', 'lowPower=0', { width: 1280, height: 800 }, 4],
    ['TIMING 1920x1080 default (auto low power)', '', { width: 1920, height: 1080 }, 5],
    ['TIMING 390x844 phone default', '', { width: 390, height: 844 }, 8],
  ] as [string, string, { width: number; height: number }, number][]) {
    it(name, { retry: 2 }, async () => {
      const r = await orbitFps(query, vp);
      console.log(`${name}: ${r.fps.toFixed(1)} fps (frames drawn per second while orbiting), getStatus().fps=${r.meter?.toFixed(1)}`);
      record(name, { fps: +r.fps.toFixed(1), statusFps: r.meter && +r.meter.toFixed(1) });
      expect(r.fps).toBeGreaterThan(floor);
      expect(r.meter).toBeDefined();
    });
  }

  it('TIMING load time to first interactive frame (page load -> status.loaded), both models', { retry: 2 }, async () => {
    const t: Record<string, number> = {};
    for (const [k, q] of [['standard', 'lowPower=0'], ['lite', 'lowPower=1']] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`${url}?${q}`);
      await page.waitForFunction(() => !!window.__viewer && window.__viewer.getStatus().loaded, null, { timeout: 30_000 });
      t[k] = Date.now() - t0;
      await ctx.close();
    }
    console.log('load ms (localhost, includes page + JS bundle):', JSON.stringify(t));
    record('load_ms', t);
    expect(t.standard).toBeLessThan(10_000);
    expect(t.lite).toBeLessThan(10_000);
  });
});
