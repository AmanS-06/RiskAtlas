// Browser smoke test and frame-time check of the workspace, in real Chrome with the machine's GPU.
//   npm run dev            (or: npm run build && npm run preview, then BASE=http://127.0.0.1:4173)
//   npm run e2e            BASE=http://127.0.0.1:5173 by default; CHROME=path to chrome if it is not in the usual place
// Runs in mock mode (no backend needed). Checks the landing page, the workspace, a prediction, the touchable heart (click a chip and a region),
// the region panel, focus mode, and measures frame times with every effect on. Screenshots go to tests/e2e/shots/.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// BASE: where the app is served. REAL=1 runs against the real API instead of the mock (BASE=http://127.0.0.1:8000 with `uvicorn api.main:app` serving web/dist).
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const MOCK = process.env.REAL ? '' : 'mock=1&';
const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const chrome =
  process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) throw new Error('Chrome not found: set CHROME');
const shots = resolve(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(shots, { recursive: true });

const failures = [];
/** axe-core scan of the page as it is now. Serious and critical findings fail the run; the rest are printed. */
async function axeScan(page, name) {
  await page.addScriptTag({ path: axeSource });
  const { violations } = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of violations) console.log(`     axe ${v.impact}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target?.join(' ') ?? ''}`);
  check(bad.length === 0, `${name}: no serious or critical accessibility violations (axe)`);
}
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  // landing
  await page.goto(`${BASE}/?${MOCK}quality=high`);
  await page.getByTestId('landing').waitFor();
  check((await page.locator('h1').count()) === 1, 'landing: one h1');
  check(await page.getByTestId('disclaimer-banner').isVisible(), 'landing: disclaimer visible');
  await page.screenshot({ path: `${shots}/landing.png` });
  await axeScan(page, 'landing');

  // workspace
  await page.getByTestId('cta-open').click();
  await page.getByTestId('stage').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=stage]')?.getAttribute('data-ready') === 'true', null, { timeout: 60000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer:', renderer);
  check(await page.getByTestId('disclaimer-banner').isVisible(), 'workspace: disclaimer visible');

  await page.getByTestId('preset-illustrative-high').click();
  await page.getByTestId('prob-CAD').waitFor();
  check(((await page.getByTestId('mock-chip').count()) === 1) === !process.env.REAL, process.env.REAL ? 'real API: no mock badge' : 'mock mode is flagged');
  check((await page.getByTestId('prob-LAD').textContent()).includes('%'), 'prediction shows per-vessel probabilities');
  await page.waitForTimeout(1500);

  // the heart is touchable: chips carry the probabilities, a click opens the region panel with real content
  const chip = page.getByTestId('chip-LAD');
  await chip.waitFor();
  check(/LAD \d+%/.test(await chip.textContent()), 'LAD chip shows its probability');
  await chip.click();
  const card = page.getByTestId('region-card');
  await card.waitFor();
  check((await card.textContent()).includes('Left anterior descending'), 'LAD panel opens');
  check(/What drives it/.test(await card.textContent()), 'LAD panel lists the drivers');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/workspace_lad.png` });
  await axeScan(page, 'workspace with a region panel open');

  await page.getByRole('button', { name: 'Left ventricle' }).click();
  await page.getByText('Findings on this structure').waitFor();
  check((await page.getByTestId('region-card').textContent()).includes('Ejection fraction'), 'left ventricle panel shows its findings');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/workspace_lv.png` });

  await page.getByRole('button', { name: 'Left atrium' }).click();
  await page.getByText('No input or output of the model is attached to this structure.').waitFor();
  check(true, 'a structure without data says so');

  // the report: a guided tour of the case, then the printed summary with a still of the 3D view per step
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed += 1;
    };
  });
  await page.getByTestId('report-open').click();
  const report = page.getByTestId('report');
  await report.waitFor();
  check((await report.getAttribute('data-step')) === 'overview', 'report opens on the overview');
  await report.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1400);
  const second = await report.getAttribute('data-step');
  check(['LAD', 'LCX', 'RCA'].includes(second ?? ''), 'report goes to the highest-risk artery next');
  check((await page.getByTestId('stage').getAttribute('data-region')) === second, 'the camera follows the report step');
  await page.screenshot({ path: `${shots}/report_step.png` });
  await page.getByTestId('report-print').click();
  await page.waitForFunction(() => window.__printed === 1, null, { timeout: 30000 });
  const imgs = await page.locator('.print-root img').count();
  check(imgs >= 3, `the printed summary has ${imgs} stills of the 3D view`);
  check(((await page.locator('.print-root').textContent()) ?? '').includes('Not for clinical use'), 'the printed summary carries the disclaimer');
  await page.getByTestId('report-exit').click();
  check((await page.getByTestId('report').count()) === 0, 'exit leaves the report');

  await page.getByTestId('viewer-enlarge').click();
  check((await page.locator('main.ws.is-focus').count()) === 1, 'focus mode hides the side panels');
  await page.keyboard.press('Escape');
  check((await page.locator('main.ws.is-focus').count()) === 0, 'Escape leaves focus mode');

  // frame times, heart idle and rotating, every effect on
  const stats = await page.evaluate(
    () =>
      new Promise((done) => {
        const dts = [];
        let last = performance.now();
        const end = last + 5000;
        const tick = (t) => {
          dts.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            dts.shift();
            dts.sort((a, b) => a - b);
            const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
            done({ frames: dts.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: dts[dts.length - 1] });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`frame time ms: p50 ${stats.p50.toFixed(1)}, p95 ${stats.p95.toFixed(1)}, p99 ${stats.p99.toFixed(1)}, max ${stats.max.toFixed(1)} over ${stats.frames} frames`);
  check(stats.p95 < 25, 'frame time p95 under 25 ms (no visible lag)');
  check(errors.length === 0, `no console or page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
