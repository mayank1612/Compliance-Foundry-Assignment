/**
 * setup.ts — runs before every web test file.
 * Adds jest-dom matchers (toBeInTheDocument…) and the browser APIs jsdom lacks
 * but the UI uses (Recharts' ResponsiveContainer needs ResizeObserver).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class ResizeObserverStub {
  observe() {
    /* jsdom has no layout: nothing to observe */
  }
  unobserve() {
    /* no-op */
  }
  disconnect() {
    /* no-op */
  }
}
// jsdom has no ResizeObserver (the DOM typings assume it always exists).
if (!('ResizeObserver' in globalThis)) {
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/'); // filters live in the URL: reset between tests
});
