/**
 * paths.ts — absolute locations of files the API reads or writes.
 *
 * What: one place that resolves the package root and the well-known paths under it.
 * Why:  npm scripts, tests and editors launch the API from different working
 *       directories (repo root via `-w api`, `api/` itself, Vitest workers). Paths
 *       resolved from `import.meta.dirname` are stable no matter who calls us;
 *       `process.cwd()`-relative paths are not.
 */
import { resolve } from 'node:path';

/** `api/` — this file lives in `api/src/`, so the package root is one level up. */
export const API_ROOT = resolve(import.meta.dirname, '..');

/** Numbered `.sql` migrations — the single source of truth for the database schema. */
export const MIGRATIONS_DIR = resolve(API_ROOT, 'db', 'migrations');

/** Kysely table/column types generated from the migrated schema by `npm run db:codegen`. */
export const GENERATED_DB_TYPES_FILE = resolve(API_ROOT, 'src', 'db', 'types.ts');
