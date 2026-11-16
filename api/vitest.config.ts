/**
 * vitest.config.ts — test runner settings for the API workspace.
 *
 * Why the long timeouts: each test file boots its own PGlite database (the real
 * Postgres engine compiled to WebAssembly). Start-up takes ~1–2 s, far longer
 * than a unit test, and slower CI machines need headroom.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
