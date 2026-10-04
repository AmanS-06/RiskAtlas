// Tiny end-to-end harness: real headless Chromium (playwright-core, no downloads) against a Vite dev server.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const shotsDir = join(webDir, 'tests', 'e2e', 'shots');
mkdirSync(shotsDir, { recursive: true });

export function chromiumPath() {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const d of readdirSync(root)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort()
      .reverse()) {
      const p = join(root, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found. Set E2E_CHROMIUM to a chrome executable.');
}

export const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

/** Starts `vite` (dev server) on a free port. Returns {url, stop}. */
export async function startVite(env = {}) {
  const port = await freePort();
  const bin = join(webDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [bin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: webDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    if (log.includes('Local:')) break;
    if (child.exitCode !== null) throw new Error(`vite exited early:\n${log}`);
    if (Date.now() - t0 > 30000) throw new Error(`vite did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop: () => child.kill('SIGTERM') };
}

export async function launch() {
  return chromium.launch({
    executablePath: chromiumPath(),
    args: [
      '--no-sandbox',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
}

/** A page that records page errors and console errors, and installs the mock API log. */
export async function newPage(browser, { width = 1440, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', hasTouch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, hasTouch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.problems.push(`console.error: ${m.text()}`);
  });
  await page.addInitScript(() => {
    window.__riskatlasApiLog = [];
  });
  return page;
}

export const apiLog = (page) => page.evaluate(() => window.__riskatlasApiLog.map((e) => e.mode));

export async function injectAxe(page) {
  await page.addScriptTag({ path: join(webDir, 'node_modules', 'axe-core', 'axe.min.js') });
}

export async function axeScan(page, label) {
  await injectAxe(page);
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' | ') })),
    }));
  });
  return { label, violations: res, blocking: res.filter((v) => v.impact === 'serious' || v.impact === 'critical') };
}

const results = [];
export async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  PASS  ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.stack || e) });
    console.log(
      `  FAIL  ${name}\n        ${String(e?.message || e)
        .split('\n')
        .join('\n        ')}`,
    );
  }
}
export const summary = () => results;

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
export function equal(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
