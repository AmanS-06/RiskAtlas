import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API serves /health, /meta and /predict at its root (api/main.py). The browser calls /api/* and the dev and
// preview servers strip the prefix, so no CORS is needed. VITE_API_PROXY changes the target.
const target = process.env.VITE_API_PROXY ?? 'http://localhost:8000';
const proxy = { '/api': { target, changeOrigin: false, rewrite: (p: string) => p.replace(/^\/api/, '') } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy, fs: { allow: ['..'] } },
  preview: { port: 4173, proxy },
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // the viewer track runs its own tests (web/viewer-demo)
    exclude: ['src/viewer/**', 'node_modules/**'],
    css: false,
  },
});
