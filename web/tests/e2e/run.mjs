// End-to-end tests. Usage: npm run e2e            (mock mode, viewer placeholder or the real viewer if it is wired in)
//                         E2E_REAL_API=http://127.0.0.1:8000 npm run e2e   (adds the real-backend suite)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiLog, assert, axeScan, equal, launch, newPage, shotsDir, startVite, summary, test, webDir } from './lib.mjs';

const read = (p) => readFileSync(join(webDir, p), 'utf8');
const DISCLAIMER = /export const DISCLAIMER =\s*'([^']+)'/.exec(read('src/shared/constants.ts'))[1];
const example = JSON.parse(read('src/api/mock/example_prediction.json'));
const meta = JSON.parse(read('src/api/mock/meta.json'));
const SIZES = [
  [1920, 1080],
  [1440, 900],
  [1280, 720],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 568],
];

const resultsReady = async (page) => {
  await page.getByTestId('prob-CAD').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => /Full prediction/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, { timeout: 8000 });
};
const text = (page, id) => page.getByTestId(id).innerText();
// Only /api/* requests, not Vite's own /src/api/* modules.
const isApi = (url) => new URL(url).pathname.startsWith('/api/');
const noProblems = (page, what) => assert(page.problems.length === 0, `${what}: ${page.problems.join(' || ')}`);
const inViewport = async (page, loc) => {
  const b = await loc.boundingBox();
  const vp = page.viewportSize();
  return !!b && b.y >= -0.5 && b.y + b.height <= vp.height + 0.5 && b.x >= -0.5 && b.x + b.width <= vp.width + 0.5;
};

const mockServer = await startVite({ VITE_API_MOCK: '1' });
const realApi = process.env.E2E_REAL_API;
const httpServer = await startVite({ VITE_API_PROXY: realApi || 'http://127.0.0.1:9' });
const browser = await launch();
console.log(`mock dev server ${mockServer.url}\nhttp dev server ${httpServer.url}${realApi ? ` -> ${realApi}` : ' (no backend)'}`);

try {
  console.log('\nMock mode');

  await test('loads with no console errors; page title, landmarks, mock flag', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('patient-form').waitFor();
    equal(await page.title(), 'RiskAtlas');
    assert((await text(page, 'mock-chip')).includes('MOCK DATA - not a real prediction'), 'mock chip');
    for (const role of ['banner', 'main', 'complementary']) assert((await page.getByRole(role).count()) >= 1, `landmark ${role}`);
    await page.waitForTimeout(500);
    noProblems(page, 'console');
    await page.context().close();
  });

  await test('the form is built from /meta: groups, controls, units, reference hints', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('patient-form').waitFor();
    const groups = await page.locator('details.group').evaluateAll((els) => els.map((e) => e.dataset.group));
    equal(JSON.stringify(groups), JSON.stringify(meta.groups), 'groups in /meta order');
    equal(await page.locator('.field[data-feature], fieldset[data-feature]').count(), meta.features.length, 'one control per feature');
    equal(await page.getByTestId('field-bbb').evaluate((e) => e.tagName), 'SELECT');
    assert((await page.locator('[data-feature=bp]').innerText()).includes('Reference 90 to 120 mmHg'), 'reference hint');
    await page.context().close();
  });

  await test('feature-input workflow: fill form, predict, see results', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('patient-form').waitFor();
    await page.getByTestId('field-age').fill('65');
    await page.getByTestId('field-dm-yes').check({ force: true });
    await page.getByTestId('field-bp').fill('160');
    await page.getByTestId('field-bbb').selectOption('1');
    await page.getByTestId('field-bmi').fill('26.8');
    await page.getByTestId('predict-button').click();
    await resultsReady(page);
    for (const id of ['CAD', 'LAD', 'LCX', 'RCA']) assert(/^\d+%$/.test(await text(page, `prob-${id}`)), `probability ${id}`);
    assert((await page.getByTestId('missing-note').innerText()).includes('Estimated without'), 'missing note');
    assert((await text(page, 'mock-flag')).includes('MOCK DATA'), 'results flagged as mock');
    await page.screenshot({ path: join(shotsDir, 'form-workflow.png') });
    noProblems(page, 'console');
    await page.context().close();
  });

  await test('invalid input is flagged and pauses predictions; fixing it resumes', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('field-age').fill('65');
    await page.getByTestId('predict-button').click();
    await resultsReady(page);
    await page.getByTestId('field-bp').fill('9999');
    equal(await page.getByTestId('field-bp').getAttribute('aria-invalid'), 'true');
    assert(await page.getByTestId('paused-note').isVisible(), 'paused note');
    await page.getByTestId('field-bp').fill('140');
    await page.getByTestId('predict-button').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=paused-note]'));
    await page.context().close();
  });

  await test('slider drag uses the fast path, release uses the full path, results update live', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    const before = await apiLog(page);
    equal(before.join(','), 'full', 'preset commit is one full request');
    const slider = page.getByTestId('slider-bp');
    await slider.scrollIntoViewIfNeeded();
    const b = await slider.boundingBox();
    const y = b.y + b.height / 2;
    const probBefore = await text(page, 'prob-CAD');
    await page.mouse.move(b.x + b.width * 0.7, y);
    await page.mouse.down();
    for (let i = 0; i <= 10; i++) {
      await page.mouse.move(b.x + b.width * (0.7 - i * 0.06), y);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(300);
    const during = await apiLog(page);
    assert(during.slice(1).length >= 1 && during.slice(1).every((m) => m === 'fast'), `only fast requests while dragging: ${during}`);
    assert((await text(page, 'status-line')).includes('Live preview'), 'status says live preview');
    const probDuring = await text(page, 'prob-CAD');
    assert(probDuring !== probBefore, `probability moved while dragging (${probBefore} -> ${probDuring})`);
    await page.mouse.up();
    await resultsReady(page);
    const after = await apiLog(page);
    equal(after.at(-1), 'full', 'last request is the full one');
    equal(after.filter((m) => m === 'full').length, 2, 'exactly one extra full request, on release');
    assert(!(await page.getByTestId('stale-note').count()), 'explanation not stale after the full reply');
    noProblems(page, 'console');
    await page.context().close();
  });

  await test('typing in a number field previews, blur commits once; tabbing through unchanged fields sends nothing', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    const n0 = (await apiLog(page)).length;
    await page.getByTestId('field-ldl').focus();
    await page.getByTestId('field-ldl').press('Tab');
    await page.getByTestId('field-ldl').focus();
    await page.getByTestId('field-ldl').press('Shift+Tab');
    equal((await apiLog(page)).length, n0, 'no request for unchanged fields');
    await page.getByTestId('field-ldl').fill('100');
    await page.getByTestId('field-ldl').blur();
    await page.waitForTimeout(1200);
    const log = (await apiLog(page)).slice(n0);
    equal(log.filter((m) => m === 'full').length, 1, `one full request after the edit: ${log}`);
    await page.context().close();
  });

  await test('selecting a vessel in the viewer focuses the dashboard, and the vessel list selects in the viewer', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    const viewerVessel = (id) => page.locator(`[data-testid=viewer] [data-vessel=${id}]`);
    if (await viewerVessel('LCX').count()) {
      await viewerVessel('LCX').dispatchEvent('click');
      equal(await page.getByTestId('target-LCX').getAttribute('aria-pressed'), 'true', 'viewer click selects row');
      await page.getByTestId('tab-explain').click();
      assert((await page.getByTestId('explanation-panel').innerText()).includes('Left circumflex'), 'explanation shows LCX');
      await page.getByTestId('target-RCA').click();
      equal(await viewerVessel('RCA').getAttribute('stroke-width'), '15', 'viewer highlights RCA');
    } else {
      console.log('        (viewer is a real canvas: vessel click is covered by the integration check)');
      await page.getByTestId('target-RCA').click();
    }
    equal(await page.getByTestId('target-RCA').getAttribute('aria-pressed'), 'true');
    await page.getByTestId('tab-whatif').click();
    assert((await page.getByTestId('whatif-panel').innerText()).includes('Right coronary artery'), 'what-if follows the selection');
    await page.context().close();
  });

  await test('explanation, physiology and what-if show the required content', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    await page.getByTestId('tab-explain').click();
    const shap = await page.getByTestId('shap-table').innerText();
    assert(shap.includes('Typical chest pain') && shap.includes('▲') && shap.includes('▼'), 'SHAP rows with glyphs');
    assert((await text(page, 'additivity')).includes('adds up'), 'additivity line');
    await page.getByTestId('tab-physiology').click();
    const phys = await page.getByTestId('physio-table').innerText();
    assert(
      phys.includes('Blood pressure') && phys.includes('160 mmHg') && phys.includes('90 to 120 mmHg') && phys.includes('High') && phys.includes('Low'),
      'physiology rows',
    );
    await page.getByTestId('tab-whatif').click();
    equal((await text(page, 'cf-note')).replace('Note: ', '').trim(), example.output.targets.CAD.counterfactual.note, 'counterfactual note shown verbatim');
    await page.getByTestId('tab-about').click();
    assert((await text(page, 'about-panel')).includes('10.24432/C5461K'), 'dataset citation');
    await page.context().close();
  });

  await test('disclaimer is visible without scrolling and stays visible after scrolling, at every screen size; no horizontal scroll', async () => {
    for (const [w, h] of SIZES) {
      const page = await newPage(browser, { width: w, height: h });
      await page.goto(mockServer.url);
      await page.getByTestId('preset-illustrative-high').click();
      await resultsReady(page);
      const banner = page.getByTestId('disclaimer-banner');
      assert(await inViewport(page, banner), `${w}x${h}: banner in viewport at load`);
      equal((await banner.locator('p').innerText()).trim(), DISCLAIMER, `${w}x${h}: exact wording`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(100);
      assert(await inViewport(page, banner), `${w}x${h}: banner in viewport after scrolling`);
      for (const tab of ['inputs', 'explain', 'physiology', 'whatif', 'about']) {
        await page.getByTestId(`tab-${tab}`).click();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(over <= 0, `${w}x${h} tab ${tab}: horizontal overflow of ${over}px`);
      }
      assert(await page.getByTestId('disclaimer-note').count(), `${w}x${h}: results footer repeat`);
      await page.context().close();
    }
  });

  console.log('\nLayout (one screen, sticky viewer, cached label)');
  const openWithResult = async (w, h, scheme = 'light', tab = 'inputs') => {
    const page = await newPage(browser, { width: w, height: h, colorScheme: scheme });
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    if (tab !== 'inputs') await page.getByTestId(`tab-${tab}`).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId('viewer').evaluate((el) => el.dataset.ready === 'true' || new Promise((r) => setTimeout(r, 1500)));
    await page.waitForTimeout(300);
    return page;
  };
  const fits = async (page, id) => {
    const b = await page.getByTestId(id).boundingBox();
    const vp = page.viewportSize();
    const bannerBottom = (await page.getByTestId('disclaimer-banner').boundingBox()).y + (await page.getByTestId('disclaimer-banner').boundingBox()).height;
    return !!b && b.y >= bannerBottom - 0.5 && b.y + b.height <= vp.height + 0.5 && b.x >= -0.5 && b.x + b.width <= vp.width + 0.5;
  };

  await test('1920x1080 and 1440x900: the whole results card (overall CAD, LAD, LCX, RCA) and the heart are on screen without scrolling', async () => {
    for (const [w, h] of [
      [1920, 1080],
      [1440, 900],
    ]) {
      const page = await openWithResult(w, h);
      for (const id of ['target-CAD', 'target-LAD', 'target-LCX', 'target-RCA', 'results-panel', 'viewer'])
        assert(await fits(page, id), `${w}x${h}: ${id} fully inside the viewport at scroll 0 (${JSON.stringify(await page.getByTestId(id).boundingBox())})`);
      const heart = await page.getByTestId('viewer').boundingBox();
      assert(heart.height >= (h >= 1000 ? 380 : 240), `${w}x${h}: heart view is ${heart.height}px tall`);
      const stage = await page.locator('.stage').evaluate((e) => ({ client: e.clientHeight, scroll: e.scrollHeight }));
      assert(stage.scroll <= stage.client + 1, `${w}x${h}: the left column needs no inner scrolling (${JSON.stringify(stage)})`);
      equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal scroll');
      assert(await inViewport(page, page.getByTestId('disclaimer-banner')), 'disclaimer stays visible');
      noProblems(page, `${w}x${h}`);
      await page.context().close();
    }
  });

  await test('1366x768 (small laptop): heart and all four probability rows are on screen without scrolling the page', async () => {
    const page = await openWithResult(1366, 768);
    for (const id of ['target-CAD', 'target-LAD', 'target-LCX', 'target-RCA', 'viewer'])
      assert(await fits(page, id), `${id} inside the viewport (${JSON.stringify(await page.getByTestId(id).boundingBox())})`);
    await page.context().close();
  });

  await test('1920x1080: heart, overall CAD, all three vessels and the Explanation panel share one screen', async () => {
    const page = await openWithResult(1920, 1080, 'light', 'explain');
    for (const id of ['viewer', 'target-CAD', 'target-LAD', 'target-LCX', 'target-RCA', 'explanation-panel'])
      assert(await fits(page, id), `${id} inside the viewport (${JSON.stringify(await page.getByTestId(id).boundingBox())})`);
    await page.context().close();
  });

  await test('the viewer column is sticky: the heart and every probability stay in view while the form scrolls (wide screens)', async () => {
    for (const [w, h] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1024, 768],
    ]) {
      const page = await openWithResult(w, h);
      const before = await page.getByTestId('viewer').boundingBox();
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      assert(docH > h * 2, `${w}x${h}: the page is long enough to scroll (${docH}px)`);
      for (const y of [400, 1200, docH]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(150);
        const sy = await page.evaluate(() => window.scrollY);
        assert(sy > 100, `${w}x${h}: scrolled (${sy})`);
        for (const id of ['viewer', 'target-CAD', 'target-LAD', 'target-LCX', 'target-RCA']) {
          if (w < 1366 && id.startsWith('target-') && id !== 'target-CAD') continue; // narrow short windows may scroll inside the sticky column
          assert(await fits(page, id), `${w}x${h} scrollY=${sy}: ${id} still in view (${JSON.stringify(await page.getByTestId(id).boundingBox())})`);
        }
        const now = await page.getByTestId('viewer').boundingBox();
        assert(
          now.y <= before.y + 1 && now.y >= (await page.getByTestId('disclaimer-banner').boundingBox()).height - 1,
          `${w}x${h}: viewer sits just below the banner (${now.y})`,
        );
      }
      assert(await inViewport(page, page.getByTestId('disclaimer-banner')), `${w}x${h}: disclaimer visible while scrolled`);
      await page.context().close();
    }
  });

  await test('phones and tablets keep the natural stacked flow: no sticky column, no horizontal scroll, 16px gutters', async () => {
    for (const [w, h] of [
      [390, 844],
      [320, 568],
      [768, 1024],
    ]) {
      const page = await openWithResult(w, h);
      equal(await page.locator('.stage').evaluate((e) => getComputedStyle(e).position), 'static', `${w}x${h}: stage is not sticky`);
      const viewerTop = (await page.getByTestId('viewer').boundingBox()).y;
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(150);
      assert((await page.getByTestId('viewer').boundingBox()).y < viewerTop - 500, `${w}x${h}: the heart scrolls away with the page`);
      equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${w}x${h}: no horizontal scroll`);
      assert(await inViewport(page, page.getByTestId('disclaimer-banner')), `${w}x${h}: disclaimer stays visible`);
      await page.evaluate(() => window.scrollTo(0, 0));
      const left = (await page.getByTestId('results-panel').boundingBox()).x;
      assert(left >= 15.5 && left <= 16.5, `${w}x${h}: 16px gutter (${left})`);
      await page.context().close();
    }
  });

  await test('keyboard focus rings are not clipped by the sticky column, and keyboard focus scrolls clear of the banner', async () => {
    const page = await openWithResult(1440, 900);
    await page.keyboard.press('Tab'); // switches the page to keyboard modality so :focus-visible applies
    await page.getByTestId('target-LAD').focus();
    const ring = await page.getByTestId('target-LAD').evaluate((el) => {
      const s = getComputedStyle(el);
      const stage = el.closest('.stage').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        style: s.outlineStyle,
        width: parseFloat(s.outlineWidth),
        offset: parseFloat(s.outlineOffset),
        room: Math.min(r.left - stage.left, stage.right - r.right),
      };
    });
    assert(ring.style !== 'none' && ring.width >= 3, `ring: ${JSON.stringify(ring)}`);
    assert(ring.room >= ring.width + ring.offset, `the ${ring.width + ring.offset}px ring fits inside the column (${ring.room}px room)`);
    await page.getByTestId('field-bp').focus();
    const top = await page.getByTestId('field-bp').evaluate((el) => el.getBoundingClientRect().top);
    const tabs = await page.getByRole('tablist', { name: 'Dashboard sections' }).boundingBox();
    assert(top >= tabs.y + tabs.height - 1, `focused field (${top}) is below the sticky tab bar (${tabs.y + tabs.height})`);
    await page.context().close();
  });

  await test('keyboard-only flow: reach a preset, predict, select a vessel, switch tabs', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('patient-form').waitFor();
    const focusedId = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);
    const tabTo = async (id, max = 80) => {
      for (let i = 0; i < max; i++) {
        if ((await focusedId()) === id) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`could not Tab to ${id}`);
    };
    await tabTo('preset-illustrative-high');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    assert(outline.style !== 'none' && outline.width >= 2, `visible focus ring: ${JSON.stringify(outline)}`);
    await page.keyboard.press('Enter');
    await resultsReady(page);
    await tabTo('target-LAD', 200);
    await page.keyboard.press('Space');
    equal(await page.getByTestId('target-LAD').getAttribute('aria-pressed'), 'true');
    await page.getByTestId('tab-inputs').focus();
    await page.keyboard.press('ArrowRight');
    equal(await page.getByTestId('tab-explain').getAttribute('aria-selected'), 'true', 'arrow key moves to the next tab');
    assert((await focusedId()) === 'tab-explain', 'focus follows');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    await page.context().close();
  });

  await test('palette toggle swaps risk colours and keeps band labels', async () => {
    const page = await newPage(browser);
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    const seg = () =>
      page
        .locator('[data-testid=target-LAD] .risk-bar-seg')
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor);
    const a = await seg();
    await page.getByRole('button', { name: /colour-blind safe palette/i }).click();
    const b = await seg();
    assert(a !== b, `colour changed (${a} -> ${b})`);
    assert((await text(page, 'target-LAD')).includes('High risk'), 'label still present');
    await page.screenshot({ path: join(shotsDir, 'palette-safe.png') });
    await page.context().close();
  });

  await test('reduced motion is respected (no running animations or transitions)', async () => {
    const page = await newPage(browser, { reducedMotion: 'reduce' });
    await page.goto(mockServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    equal(anims, 0, 'running animations');
    await page.context().close();
  });

  console.log('\nAccessibility (axe-core, WCAG 2.2 AA + best practice)');
  for (const scheme of ['light', 'dark']) {
    await test(`axe: 0 serious/critical violations, ${scheme} theme, every tab`, async () => {
      const page = await newPage(browser, { colorScheme: scheme });
      await page.goto(mockServer.url);
      await page.getByTestId('patient-form').waitFor();
      const scans = [await axeScan(page, 'empty')];
      await page.getByTestId('preset-illustrative-high').click();
      await resultsReady(page);
      scans.push(await axeScan(page, 'inputs+results'));
      for (const tab of ['explain', 'physiology', 'whatif', 'about']) {
        await page.getByTestId(`tab-${tab}`).click();
        scans.push(await axeScan(page, tab));
      }
      await page.getByRole('button', { name: /colour-blind safe palette/i }).click();
      scans.push(await axeScan(page, 'safe palette'));
      await page.getByTestId('tab-inputs').click();
      await page.getByTestId('field-bp').fill('9999');
      scans.push(await axeScan(page, 'validation error'));
      const all = scans.flatMap((s) => s.violations.map((v) => `${s.label}: ${v.impact} ${v.id} (${v.nodes.map((n) => n.target).join('; ')})`));
      if (all.length) console.log(`        non-blocking or blocking findings (${scheme}):\n          ${all.join('\n          ')}`);
      const blocking = scans.flatMap((s) => s.blocking.map((v) => `${s.label}: ${v.id} ${JSON.stringify(v.nodes)}`));
      assert(blocking.length === 0, `serious/critical: ${blocking.join('\n')}`);
      await page.context().close();
    });
  }

  console.log('\nScreenshots');
  await test('screenshots: desktop light/dark at 1920x1080, 1440x900 and 1366x768, tablet, phone', async () => {
    const shots = [
      ['desktop-1920x1080-light', 1920, 1080, 'light', 'explain'],
      ['desktop-1920x1080-dark', 1920, 1080, 'dark', 'inputs'],
      ['desktop-1440x900-light', 1440, 900, 'light', 'inputs'],
      ['desktop-1440x900-dark', 1440, 900, 'dark', 'physiology'],
      ['desktop-1366x768-light', 1366, 768, 'light', 'explain'],
      ['desktop-1366x768-dark', 1366, 768, 'dark', 'inputs'],
      ['tablet-light', 768, 1024, 'light', 'inputs'],
      ['phone-light', 390, 844, 'light', 'inputs'],
      ['phone-dark', 390, 844, 'dark', 'inputs'],
    ];
    for (const [name, w, h, scheme, tab] of shots) {
      const page = await openWithResult(w, h, scheme, tab);
      await page.screenshot({ path: join(shotsDir, `${name}.png`) });
      await page.context().close();
    }
  });

  console.log('\nHTTP mode (browser fetch against a faked backend)');
  const fullBody = (mut) => {
    const o = JSON.parse(JSON.stringify(example.output));
    mut?.(o);
    return o;
  };
  const fastBody = () => {
    const o = fullBody();
    for (const t of Object.values(o.targets)) {
      delete t.uncertainty;
      delete t.shap;
      delete t.counterfactual;
    }
    return o;
  };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const fakeBackend = async (page, handlers = {}) => {
    const hits = [];
    await page.route(isApi, async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      hits.push(path);
      if (path === '/meta')
        return json(route, {
          ...meta,
          mock: false,
          model: { created: 'x', git_sha: 'abcdef1234567890', protocol: 'full_cv', n_patients: 303 },
          disclaimer: DISCLAIMER,
        });
      const h = handlers[path];
      if (h) return h(route, hits.filter((p) => p === path).length);
      return json(route, path === '/predict' ? fullBody() : fastBody());
    });
    return hits;
  };

  await test('a cached answer is labelled "cached", never "in 0 ms"; a fresh one shows its measured latency', async () => {
    const page = await newPage(browser);
    const reply = (route, hit, total) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Cache': hit ? 'HIT' : 'MISS', 'Access-Control-Expose-Headers': 'X-Cache' },
        body: JSON.stringify({ ...fullBody(), timing_ms: { total } }),
      });
    let hit = false; // a blur and a click may both send a request: the test, not the request count, decides when the server "has seen it before"
    await fakeBackend(page, { '/predict': (route) => reply(route, hit, hit ? 0.04 : 3812.4) });
    await page.goto(httpServer.url);
    await page.getByTestId('patient-form').waitFor();
    await page.getByTestId('field-age').fill('65');
    await page.getByTestId('predict-button').click();
    await page.waitForFunction(() => /Full prediction in 3812 ms/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''));
    hit = true;
    await page.getByTestId('predict-button').click();
    await page.waitForFunction(() => /cached/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''));
    const label = await text(page, 'status-line');
    assert(label.includes('Full prediction (cached') && !/\b0 ms/.test(label), `cached label: ${label}`);
    await page.context().close();
  });

  await test('422 shows the server message and details; the form keeps its values; next edit recovers', async () => {
    const page = await newPage(browser);
    let reject = true;
    await fakeBackend(page, {
      '/predict': (route) =>
        reject
          ? json(
              route,
              {
                error: { code: 'validation_error', message: 'Invalid request. bp: must be a number', details: [{ field: 'bp', message: 'must be a number' }] },
              },
              422,
            )
          : json(route, fullBody()),
    });
    await page.goto(httpServer.url);
    await page.getByTestId('patient-form').waitFor();
    assert(!(await page.getByTestId('mock-chip').count()), 'no mock flag in http mode');
    await page.getByTestId('field-age').fill('60');
    await page.getByTestId('predict-button').click();
    const err = page.getByTestId('api-error');
    await err.waitFor();
    const t = await err.innerText();
    assert(t.includes('Some inputs were rejected') && t.includes('must be a number'), t);
    equal(await page.getByTestId('field-age').inputValue(), '60');
    await page.screenshot({ path: join(shotsDir, 'error-422.png') });
    reject = false;
    await page.getByTestId('field-bp').fill('130');
    await page.getByTestId('field-bp').blur();
    await resultsReady(page);
    assert(!(await page.getByTestId('api-error').count()), 'error cleared after a good reply');
    await page.context().close();
  });

  await test('503 (models unavailable) is reported distinctly, with retry', async () => {
    const page = await newPage(browser);
    let down = true;
    await fakeBackend(page, {
      '/predict': (route) => (down ? json(route, { error: { code: 'models_unavailable', message: 'Models are not loaded' } }, 503) : json(route, fullBody())),
    });
    await page.goto(httpServer.url);
    await page.getByTestId('field-age').fill('60');
    await page.getByTestId('predict-button').click();
    const t = await page.getByTestId('api-error').innerText();
    assert(t.includes('Models are not available') && t.includes('Models are not loaded'), t);
    down = false;
    await page.getByTestId('retry-button').click();
    await resultsReady(page);
    await page.context().close();
  });

  await test('network down: clear message, last good result stays visible, next edit recovers', async () => {
    const page = await newPage(browser);
    let down = false;
    await fakeBackend(page, {
      '/predict': (route) => (down ? route.abort('connectionrefused') : json(route, fullBody())),
      '/predict/fast': (route) => (down ? route.abort('connectionrefused') : json(route, fastBody())),
    });
    await page.goto(httpServer.url);
    await page.getByTestId('preset-illustrative-high').click();
    await resultsReady(page);
    const before = await text(page, 'prob-CAD');
    down = true;
    await page.getByTestId('field-ldl').fill('90');
    await page.getByTestId('field-ldl').blur();
    const t = await page.getByTestId('api-error').innerText();
    assert(t.includes('Cannot reach the model server') && t.includes('last good result'), t);
    equal(await text(page, 'prob-CAD'), before, 'last result still shown');
    down = false;
    await page.getByTestId('field-ldl').fill('95');
    await page.getByTestId('field-ldl').blur();
    await page.waitForFunction(() => !document.querySelector('[data-testid=api-error]'));
    await page.context().close();
  });

  await test('backend absent at load: meta error with retry and explicit mock fallback', async () => {
    const page = await newPage(browser);
    await page.route(isApi, (route) => route.abort('connectionrefused'));
    await page.goto(httpServer.url);
    const err = page.getByTestId('meta-error');
    await err.waitFor();
    assert((await err.innerText()).includes('Cannot reach the model server'), 'message');
    await page.screenshot({ path: join(shotsDir, 'backend-absent.png') });
    await page.getByTestId('use-mock').click();
    await page.getByTestId('patient-form').waitFor();
    assert(await page.getByTestId('mock-chip').isVisible(), 'mock flag after fallback');
    await page.context().close();
  });

  await test('out-of-order replies: a slow older request never overwrites a newer one', async () => {
    const page = await newPage(browser);
    const slowFirst = (mk) => async (route, n) => {
      if (n === 1) await new Promise((r) => setTimeout(r, 1500));
      return json(route, mk(n));
    };
    // first fast request answers after 1.5 s with CAD 11%; the second answers at once with CAD 77%
    const withCad = (p) => (n) => {
      const o = fastBody();
      o.targets.CAD.probability = n === 1 ? 0.11 : p;
      return o;
    };
    await fakeBackend(page, { '/predict/fast': slowFirst(withCad(0.77)) });
    await page.goto(httpServer.url);
    const bp = page.getByTestId('field-bp');
    await bp.fill('120');
    await page.waitForTimeout(700); // past the 150 ms debounce: request 1 is in flight
    await bp.fill('150');
    await page.getByTestId('prob-CAD').waitFor();
    await page.waitForTimeout(2200);
    equal(await text(page, 'prob-CAD'), '77%', 'newest reply wins');
    await page.context().close();
  });

  await test('client timeout: a hung server yields a timeout message, not an endless spinner', async () => {
    const page = await newPage(browser);
    await fakeBackend(page, { '/predict/fast': () => new Promise(() => {}) });
    await page.goto(httpServer.url);
    await page.getByTestId('field-age').fill('50');
    const t = await page.getByTestId('api-error').innerText({ timeout: 12000 });
    assert(t.includes('too long'), t);
    await page.context().close();
  });

  if (realApi) {
    console.log(`\nReal backend (${realApi})`);
    const apiGet = async (path) => (await fetch(realApi + path)).json();

    await test('/meta from the real API drives the UI and matches the mock meta shape', async () => {
      const real = await apiGet('/meta');
      equal(real.features.length, meta.features.length, 'feature count');
      equal(JSON.stringify(real.groups), JSON.stringify(meta.groups), 'groups');
      equal(JSON.stringify(real.risk_bands), JSON.stringify(meta.risk_bands), 'bands');
      equal(JSON.stringify(real.targets), JSON.stringify(meta.targets), 'targets and cut points');
      const page = await newPage(browser);
      await page.goto(httpServer.url);
      await page.getByTestId('patient-form').waitFor();
      equal(await page.locator('.field[data-feature], fieldset[data-feature]').count(), real.features.length);
      assert(!(await page.getByTestId('mock-chip').count()), 'not flagged as mock');
      await page.context().close();
    });

    await test('real model: preset shows the real probabilities; drag uses /predict/fast, release /predict', async () => {
      const page = await newPage(browser);
      const reqs = [];
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith('/api/predict')) reqs.push({ path: u.pathname.replace('/api', ''), body: r.postData() });
      });
      await page.goto(httpServer.url);
      await page.getByTestId('preset-illustrative-high').click();
      await page.getByTestId('prob-CAD').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => /Full prediction/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, {
        timeout: 30000,
      });
      for (const [id, t] of Object.entries(example.output.targets))
        equal(await text(page, `prob-${id}`), `${Math.round(t.probability * 100)}%`, `probability ${id}`);
      assert(!(await page.getByTestId('mock-flag').count()), 'real prediction is not flagged');
      equal(JSON.stringify(reqs.map((r) => r.path)), JSON.stringify(['/predict']), 'one full request for the preset');
      const sent = JSON.parse(reqs[0].body);
      assert(
        !('features' in sent) && sent.age === 65 && !Object.keys(sent).some((k) => meta.forbidden_inputs.includes(k)),
        'flat body of canonical names, no labels',
      );
      reqs.length = 0;
      const slider = page.getByTestId('slider-bp');
      await slider.scrollIntoViewIfNeeded();
      const b = await slider.boundingBox();
      await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2);
      await page.mouse.down();
      for (let i = 0; i <= 8; i++) {
        await page.mouse.move(b.x + b.width * (0.7 - i * 0.06), b.y + b.height / 2);
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(500);
      const dragging = reqs.map((r) => r.path);
      assert(dragging.length >= 1 && dragging.every((p) => p === '/predict/fast'), `drag requests: ${dragging}`);
      await page.mouse.up();
      await page.waitForFunction(() => /Full prediction/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, {
        timeout: 30000,
      });
      equal(reqs.at(-1).path, '/predict', 'release sends the full request');
      assert((await page.getByTestId('additivity').count()) >= 1, 'additivity element');
      await page.getByTestId('tab-explain').click();
      equal(await page.getByTestId('additivity').getAttribute('data-ok'), 'true', 'real SHAP is additive');
      await page.getByTestId('tab-whatif').click();
      assert((await text(page, 'cf-note')).includes('Model-based what-if'), 'real counterfactual note shown');
      await page.screenshot({ path: join(shotsDir, 'real-backend-whatif.png') });
      noProblems(page, 'console');
      await page.context().close();
    });

    await test('real backend: repeating a request is served from the API cache and the UI says "cached" instead of "in 0 ms"', async () => {
      const page = await newPage(browser);
      const hits = [];
      page.on('response', (r) => {
        if (new URL(r.url()).pathname === '/api/predict') hits.push(r.headers()['x-cache']);
      });
      await page.goto(httpServer.url);
      await page.getByTestId('preset-illustrative-high').click();
      await page.getByTestId('prob-CAD').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => /Full prediction/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, {
        timeout: 30000,
      });
      await page.getByTestId('predict-button').click(); // identical inputs again
      await page.waitForFunction(() => /cached/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, { timeout: 30000 });
      equal(hits.at(-1), 'HIT', `X-Cache header of the repeat (${hits})`);
      const label = await text(page, 'status-line');
      assert(!/\b0 ms/.test(label), label);
      await page.screenshot({ path: join(shotsDir, 'real-backend-cached.png') });
      await page.context().close();
    });

    await test('real API error contract: leakage and validation are 422 envelopes the client maps', async () => {
      const leak = await fetch(realApi + '/predict', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ age: 50, LAD: 1 }),
      });
      equal(leak.status, 422);
      equal((await leak.json()).error.code, 'leakage');
      const bad = await fetch(realApi + '/predict/fast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dm: 7 }) });
      equal(bad.status, 422);
      equal((await bad.json()).error.code, 'validation_error');
    });

    await test('real backend: axe scan with real data (light and dark)', async () => {
      for (const scheme of ['light', 'dark']) {
        const page = await newPage(browser, { colorScheme: scheme });
        await page.goto(httpServer.url);
        await page.getByTestId('preset-illustrative-high').click();
        await page.getByTestId('prob-CAD').waitFor({ timeout: 30000 });
        await page.waitForFunction(() => /Full prediction/.test(document.querySelector('[data-testid=status-line]')?.textContent ?? ''), null, {
          timeout: 30000,
        });
        for (const tab of ['inputs', 'explain', 'physiology', 'whatif', 'about']) {
          await page.getByTestId(`tab-${tab}`).click();
          const scan = await axeScan(page, tab);
          assert(scan.blocking.length === 0, `${scheme} ${tab}: ${JSON.stringify(scan.blocking)}`);
        }
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  mockServer.stop();
  httpServer.stop();
}

const res = summary();
const failed = res.filter((r) => !r.ok);
console.log(`\n${res.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
