// Frame-time check on a weaker machine than yours: Chrome's CPU is slowed down (CPU_SLOWDOWN, default 4x) and the heart is left rotating on its own.
//   npm run dev   then   CPU_SLOWDOWN=4 node tests/e2e/perf.mjs      (BASE=... to point at another server; DPR=2 to test a hi-dpi screen)
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const SLOW = Number(process.env.CPU_SLOWDOWN ?? 4);
const DPR = Number(process.env.DPR ?? 1);
const chrome = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
const cdp = await page.context().newCDPSession(page);
await page.goto(`${BASE}/?mock=1&quality=high#/app`);
await page.waitForFunction(() => document.querySelector('[data-testid=stage]')?.getAttribute('data-ready') === 'true', null, { timeout: 90000 });
await page.getByTestId('preset-illustrative-high').click();
await page.getByTestId('prob-CAD').waitFor();
await page.waitForTimeout(1500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
const measure = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const dts = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (t) => {
          dts.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            dts.shift();
            dts.sort((a, b) => a - b);
            const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
            done({ frames: dts.length, fps: (dts.length * 1000) / ms, p50: q(0.5), p95: q(0.95) });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
const early = await measure(3000);
const late = await measure(4000);
const tier = await page.evaluate(() => ({ ...window.__atlas.getStatus(), bloom: !!window.__atlas.composer, dpr: window.__atlas.renderer.getPixelRatio() }));
const f = (s) => `${s.fps.toFixed(0)} fps, p50 ${s.p50.toFixed(1)} ms, p95 ${s.p95.toFixed(1)} ms`;
console.log(`CPU ${SLOW}x slower, device pixel ratio ${DPR}`);
console.log(`first 3 s:  ${f(early)}`);
console.log(`next 4 s:   ${f(late)}   (after the viewer had time to adapt)`);
console.log(`now running: tier ${tier.tier}, bloom ${tier.bloom}, pixel ratio ${tier.dpr.toFixed(2)}, resolution scale ${tier.scale.toFixed(2)}`);
await browser.close();
