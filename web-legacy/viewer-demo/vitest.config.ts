import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Unit tests live next to the code in web/src/viewer and need no browser (pure logic, no WebGL).
export default defineConfig({
  root: path.resolve(here, '..'),
  test: { include: ['src/viewer/**/*.test.ts'], environment: 'node' },
});
