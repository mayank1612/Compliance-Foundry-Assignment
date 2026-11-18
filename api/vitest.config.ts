/**
 * vitest.config.ts — test runner settings for the API workspace.
 *
 * Why the long timeouts: each test file boots its own PGlite database (the real
 * Postgres engine compiled to WebAssembly). Start-up takes ~1–2 s, far longer
 * than a unit test, and slower CI machines need headroom.
 *
 * Why the `graphql` alias: graphql 17's package exports list a "development" build
 * first. Vitest resolves OUR source with the "development" condition, while
 * dependencies Node loads itself (graphql-yoga) get the default build — two module
 * instances, two GraphQLError classes, so Yoga's `instanceof` check fails and it
 * masks every expected error as INTERNAL_SERVER_ERROR. Pinning `graphql` to the file
 * Node resolves keeps one instance, exactly like production (tsx/Node).
 */
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const nodeResolvedGraphql = createRequire(import.meta.url).resolve('graphql');

export default defineConfig({
  resolve: {
    alias: [{ find: /^graphql$/, replacement: nodeResolvedGraphql }],
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
