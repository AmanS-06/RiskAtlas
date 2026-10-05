// Production smoke test: the built web app served by the API itself (single origin), real models, real Chromium.
//
//   cd web && npm run build
//   cd .. && uvicorn api.main:app --port 8071          (or scripts/serve_prod.sh, or the Docker image)
//   cd web && PROD_URL=http://127.0.0.1:8071 node tests/e2e/prod.mjs
//
// The same checks a human does after a deploy (docs/DEPLOY.md, smoke-test checklist). PROD_URL may be a public URL.
// PROD_SHOT=/some/file.png chooses where the final screenshot goes (default tests/e2e/shots/prod-case-c.png).
import { assert, equal, launch, newPage, shotsDir, summary, test } from './lib.mjs';
import { join } from 'node:path';

const url = (process.env.PROD_URL ?? '').replace(/\/+$/, '');
if (!url) {
  console.error('Set PROD_URL, for example PROD_URL=http://127.0.0.1:8071');
  process.exit(2);
}
const origin = new URL(url).origin;
const shot = process.env.PROD_SHOT ?? join(shotsDir, 'prod-case-c.png');
const text = (page, id) => page.getByTestId(id).innerText();
const fullPredictionShown = (page) =>
  page.waitForFunction(() => /Full prediction/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, { timeout: 60000 });

const browser = await launch();
try {
  await test('/api/health answers and the models are loaded (no mock)', async () => {
    const r = await fetch(`${url}/api/health`);
    equal(r.status, 200, 'status');
    const body = await r.json();
    equal(body.status, 'ok', 'health status');
    equal(body.models_loaded, true, 'models_loaded');
    equal(body.mock, false, 'mock');
  });

  await test('page loads from one origin, no MOCK banner, no console errors, 3D model served', async () => {
    const page = await newPage(browser, { width: 1440, height: 900 });
    const seen = [];
    page.on('response', (r) => seen.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '' }));
    await page.goto(url);
    await page.getByTestId('patient-form').waitFor({ timeout: 30000 });
    equal(await page.title(), 'RiskAtlas');
    equal(await page.getByTestId('mock-chip').count(), 0, 'no MOCK chip');
    equal(await page.getByText('MOCK DATA').count(), 0, 'no MOCK text anywhere');
    assert((await page.getByRole('banner').count()) >= 1 && (await page.getByRole('complementary').count()) >= 1, 'header and disclaimer landmarks');
    await page.getByTestId('viewer-status').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => /WebGL/.test(document.querySelector('[data-testid=viewer-status]')?.textContent ?? ''), null, { timeout: 30000 });
    const foreign = seen.filter((s) => new URL(s.url).origin !== origin && !s.url.startsWith('data:'));
    equal(JSON.stringify(foreign), '[]', 'every request goes to the same origin');
    const meta = seen.find((s) => new URL(s.url).pathname === '/api/meta');
    assert(meta && meta.status === 200, 'GET /api/meta answered 200');
    const glb = seen.find((s) => /\/models3d\/heart(_lite)?\.glb$/.test(s.url));
    assert(glb && glb.status === 200 && glb.type.startsWith('model/gltf-binary'), `3D model served as model/gltf-binary: ${JSON.stringify(glb)}`);
    const bad = seen.filter((s) => s.status >= 400);
    equal(JSON.stringify(bad), '[]', 'no 4xx or 5xx response');
    assert(page.problems.length === 0, `console: ${page.problems.join(' || ')}`);
    await page.context().close();
  });

  await test('illustrative case C: Predict gives overall CAD about 96 percent and the heart renders', async () => {
    const page = await newPage(browser, { width: 1440, height: 900 });
    const api = [];
    page.on('response', (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith('/api/')) api.push(`${r.request().method()} ${p} ${r.status()} cache=${r.headers()['x-cache'] ?? '-'}`);
    });
    await page.goto(url);
    await page.getByTestId('preset-illustrative-high').click();
    await page.getByTestId('prob-CAD').waitFor({ timeout: 60000 });
    await fullPredictionShown(page);
    const cad = Number.parseInt(await text(page, 'prob-CAD'), 10);
    assert(cad >= 94 && cad <= 98, `overall CAD ${cad}% is not within 94 to 98`);
    for (const id of ['LAD', 'LCX', 'RCA']) assert(/^\d+%$/.test(await text(page, `prob-${id}`)), `probability ${id}`);
    equal(await page.getByTestId('mock-flag').count(), 0, 'real prediction is not flagged as mock');
    const status = await text(page, 'viewer-status');
    assert(/WebGL/.test(status) && !/no WebGL/.test(status), `viewer status: ${status}`);
    const canvas = await page.locator('[data-testid=viewer] canvas').first().boundingBox();
    assert(canvas && canvas.width > 150 && canvas.height > 150, `heart canvas size ${JSON.stringify(canvas)}`);
    assert(
      api.some((l) => l.startsWith('POST /api/predict 200')),
      `POST /api/predict 200 in ${JSON.stringify(api)}`,
    );
    await page.waitForTimeout(1500); // let the vessel colours settle before the picture
    await page.screenshot({ path: shot });
    console.log(`        overall CAD ${cad}%, viewer "${status}", requests ${JSON.stringify(api)}\n        screenshot ${shot}`);
    assert(page.problems.length === 0, `console: ${page.problems.join(' || ')}`);
    await page.context().close();
  });

  await test('About tab shows the dataset and 3D mesh attribution (CC BY-SA 4.0) in production', async () => {
    const page = await newPage(browser, { width: 1440, height: 900 });
    await page.goto(url);
    await page.getByTestId('patient-form').waitFor({ timeout: 30000 });
    await page.getByTestId('tab-about').click();
    const panel = page.getByTestId('about-panel');
    await panel.waitFor();
    const t = await panel.innerText();
    assert(/CC BY 4\.0/.test(t) && t.includes('https://doi.org/10.24432/C5461K'), 'dataset attribution');
    assert(/CC BY-SA 4\.0/.test(t) && t.includes('ASSETS_AND_LICENSES.md'), '3D model licence pointer');
    await panel.locator('summary').click();
    const assets = await page.getByTestId('assets-text').innerText();
    assert(/Z-Anatomy/.test(assets) && /CC BY-SA/.test(assets) && assets.length > 2000, `reproduced licence page (${assets.length} characters)`);
    await page.context().close();
  });

  await test('the error envelope and the cache headers hold on the real server', async () => {
    const nope = await fetch(`${url}/api/nope`);
    equal(nope.status, 404, '/api/nope');
    assert((nope.headers.get('content-type') ?? '').startsWith('application/json'), 'JSON, not index.html');
    equal(JSON.stringify(await nope.json()), JSON.stringify({ error: { code: 'not_found', message: 'Not Found' } }), 'envelope');
    const deep = await fetch(`${url}/some/deep/link`);
    equal(deep.status, 200, 'SPA fallback');
    assert((await deep.text()).includes('<div id="root">'), 'SPA fallback body is index.html');
    equal((await fetch(`${url}/`)).headers.get('cache-control'), 'no-cache', 'index.html cache');
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(await (await fetch(`${url}/`)).text())?.[1];
    assert(asset, 'index.html names a hashed script');
    equal((await fetch(url + asset)).headers.get('cache-control'), 'public, max-age=31536000, immutable', 'hashed asset cache');
  });
} finally {
  await browser.close();
}

const res = summary();
const failed = res.filter((r) => !r.ok);
console.log(`\n${res.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
