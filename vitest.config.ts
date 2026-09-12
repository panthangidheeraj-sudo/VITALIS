import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Source only. `dist/` contains compiled copies of these same tests after a
    // build, and picking both up would run everything twice.
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
