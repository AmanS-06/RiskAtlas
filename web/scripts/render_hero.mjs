// Renders the landing page video: web/render.html (frame-exact AtlasViewer scene, see src/render/hero.ts) is opened in headless Chrome, one frame is
// drawn and screenshotted per step, and ffmpeg encodes the frames.
//
//   1. start the dev server:   npm run dev            (port 5173)
//   2. render:                 node scripts/render_hero.mjs [--frames 300] [--fps 30] [--out public/media]
//
// Needs Google Chrome (or set CHROME) and ffmpeg on the PATH (or set FFMPEG). Output: hero.mp4 (every 6th frame is a keyframe, so it scrubs smoothly
// with the scroll bar) and hero-poster.jpg. The skeleton in the video comes from render-assets/thorax_skeleton.glb (CC BY-SA 4.0, see its LICENSE.md).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const FRAMES = Number(arg('frames', 300));
const FPS = Number(arg('fps', 30));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, arg('out', 'public/media'));
const url = arg('url', 'http://localhost:5173/render.html');
const chrome =
  process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) throw new Error('Chrome not found: set CHROME to its path');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'riskatlas-hero-'));
console.log(`frames ${FRAMES} @ ${FPS} fps -> ${out} (scratch ${tmp})`);

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer:', renderer);
  const canvas = page.locator('canvas');
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate(([f, n]) => window.__frame(f, n), [i, FRAMES]);
    await canvas.screenshot({ path: join(tmp, `f_${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (i % 25 === 0) console.log(`  frame ${i}/${FRAMES}`);
  }
} finally {
  await browser.close();
}

const input = ['-y', '-framerate', String(FPS), '-i', join(tmp, 'f_%04d.jpg')];
execFileSync(ffmpeg, [...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-g', '6', '-movflags', '+faststart', '-an', join(out, 'hero.mp4')], { stdio: 'inherit' });
execFileSync(ffmpeg, ['-y', '-i', join(tmp, 'f_0000.jpg'), '-q:v', '4', join(out, 'hero-poster.jpg')], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log('done');
