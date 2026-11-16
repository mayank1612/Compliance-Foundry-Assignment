/**
 * env.ts — validated runtime configuration for the API.
 *
 * What: reads environment variables (optionally from `api/.env`) and validates
 *       them with zod into a typed, frozen `Env` object.
 * Why:  fail fast. A typo in DATABASE_URL should stop the process at boot with a
 *       readable message, not surface as a connection error mid-request.
 * Who:  called once by each entry point (server, migrate/reset/codegen scripts).
 *       Tests do NOT call it — they pass explicit options so they never depend on
 *       a developer's local .env.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { API_ROOT } from '../paths.js';

/** Treat `FOO=` (present but empty) the same as "not set" — a common .env pitfall. */
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // When set, the API connects to this real Postgres server (Docker, RDS, Neon…).
  // When absent, it boots the embedded PGlite database instead — the zero-setup
  // default for reviewers. Same `pg` driver either way.
  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// connection URL')
      .optional(),
  ),

  // Where embedded PGlite persists its files. Relative paths are anchored at
  // `api/` (not the shell's cwd) so `npm run dev` from any folder hits the same DB.
  PGLITE_DATA_DIR: z
    .string()
    .min(1)
    .default('.pglite')
    .transform((dir) => (isAbsolute(dir) ? dir : resolve(API_ROOT, dir))),

  // Connection-pool size for a real Postgres server. Ignored for PGlite, which is
  // pinned to 1 (see db/database.ts for why).
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

/**
 * Load and validate configuration.
 *
 * How: if `api/.env` exists it is loaded into `process.env` first (Node's built-in
 * loader — variables already set in the real environment win), then the whole
 * environment is validated. Throws with a human-readable list of problems.
 */
export function loadEnv(): Env {
  const envFile = resolve(API_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return Object.freeze(parsed.data);
}

/** For log lines: show the data dir relative to the package so logs stay short. */
export function describeDataDir(env: Env): string {
  return relative(API_ROOT, env.PGLITE_DATA_DIR) || '.';
}
