import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No `base` override — Render serves this at its own root domain, not a
// subpath, so the default '/' is correct. Build output goes to `dist/`,
// which `server.mjs` serves in production.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
