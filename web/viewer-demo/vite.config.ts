import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// web/src/viewer sits outside this package, so `import 'three'` there would not find this package's node_modules.
// Re-resolve three from here. When the app agent merges, web/node_modules/three resolves normally and this is not needed.
const threeFromHere = (): Plugin => ({
  name: 'three-from-viewer-demo',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!/^three(\/|$)/.test(source) || !importer || importer.startsWith(here)) return null;
    return this.resolve(source, path.join(here, 'main.ts'), { ...options, skipSelf: true });
  },
});

export default defineConfig({
  root: here,
  base: './',
  publicDir: path.resolve(here, '../public'),
  plugins: [threeFromHere()],
  server: { host: '127.0.0.1', port: 5174, fs: { allow: [path.resolve(here, '..')] } },
  preview: { host: '127.0.0.1', port: 4174 },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
