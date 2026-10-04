import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Real-browser tests: headless Chromium under software GL, driven by playwright-core (see e2e/).
export default defineConfig({
  root: here,
  test: { include: ['e2e/**/*.e2e.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false },
});
