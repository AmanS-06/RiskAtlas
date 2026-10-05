// Prints an HTML file to an A4 PDF with headless Chromium (playwright-core, no browser download).
// Usage: node docs/build/print_pdf.mjs <input.html> <output.pdf>
// Chromium: $E2E_CHROMIUM (path to a chrome binary) or the newest chromium-* under $PLAYWRIGHT_BROWSERS_PATH
// (default /opt/pw-browsers). playwright-core comes from web/node_modules (run `npm ci` in web/ first), or set
// PLAYWRIGHT_CORE_PATH to another playwright-core install.
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'web', 'package.json'));
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

function chromiumPath() {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      const p = join(root, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found. Set E2E_CHROMIUM to a chrome executable.');
}

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node print_pdf.mjs input.html output.pdf');
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: resolve(output),
  format: 'A4',
  printBackground: true,
  margin: { top: '11mm', bottom: '12mm', left: '12mm', right: '12mm' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font-size:7px;font-family:Liberation Sans,Arial,sans-serif;color:#555;text-align:center">' +
    'RiskAtlas project documentation &nbsp;|&nbsp; page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
});
await browser.close();
console.log('wrote', output);
