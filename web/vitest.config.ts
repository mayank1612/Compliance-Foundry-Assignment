/**
 * vitest.config.ts — component tests run in jsdom (a simulated browser DOM).
 * setup.ts adds jest-dom matchers and the browser APIs jsdom lacks (ResizeObserver).
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
