/**
 * embedded.ts — boots PostgreSQL inside this Node process (PGlite) and exposes it
 * on a local TCP port.
 *
 * What: PGlite is the real Postgres engine compiled to WebAssembly. On its own it
 *       is called through a JS API (`pglite.query()`), which our app does not use.
 *       `PGLiteSocketServer` puts the Postgres *wire protocol* in front of it, so
 *       the standard `pg` driver — and therefore Kysely, kysely-codegen and any
 *       Postgres client (DBeaver, psql) — connects to it exactly like a normal server.
 * Why:  the application code path is identical for embedded and real Postgres.
 *       Switching to a real server is a DATABASE_URL change, not a code change.
 * When: on API/script start-up when DATABASE_URL is unset, once per test file, and
 *       for `npm run db:serve` (desktop database tools).
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { acquireDataDirLock, type ReleaseLock } from './data-dir-lock.js';

export interface EmbeddedPostgres {
  /** Connection URL for the `pg` driver, e.g. postgres://postgres:postgres@127.0.0.1:51234/postgres */
  readonly url: string;
  /** `host:port` the server listens on. */
  readonly address: string;
  /** Stop accepting connections, flush and close the database, release the lock. */
  stop(): Promise<void>;
}

export interface EmbeddedPostgresOptions {
  /**
   * Directory where PGlite persists its data files. Omit for a throw-away in-memory
   * database (what tests and type generation use: fresh, isolated, fast).
   */
  dataDir?: string | undefined;
  /** TCP port. Default 0 = any free port (tests run in parallel without collisions). */
  port?: number | undefined;
  /**
   * Concurrent client connections. Default 1, and the API must keep it at 1:
   * PGlite is ONE Postgres session, and the socket server lets every client share
   * it, interleaving their statements — one request's open transaction or
   * `SET LOCAL ROLE` would leak into another request's queries.
   * Only `db:serve` raises it, because desktop tools open several connections and
   * browse in auto-commit mode (each statement its own transaction).
   */
  maxConnections?: number | undefined;
}

export async function startEmbeddedPostgres(
  options: EmbeddedPostgresOptions = {},
): Promise<EmbeddedPostgres> {
  // A persisted database is claimed first, so a second process can never open
  // the same files (PGlite itself does not guard against it — see data-dir-lock.ts).
  const releaseLock: ReleaseLock | undefined = options.dataDir
    ? await acquireDataDirLock(options.dataDir)
    : undefined;

  try {
    // In-memory when no directory is given; otherwise the files survive restarts.
    const pglite = options.dataDir ? await PGlite.create(options.dataDir) : await PGlite.create();

    const server = new PGLiteSocketServer({
      db: pglite,
      // Loopback only: the embedded database must never be reachable from the network.
      host: '127.0.0.1',
      port: options.port ?? 0,
      maxConnections: options.maxConnections ?? 1,
    });
    await server.start();

    // After start(), getServerConn() reports the real port (even when we asked for 0).
    const address = server.getServerConn();
    // The username/password are placeholders: the socket server does not
    // authenticate, and it only listens on loopback (above).
    const url = `postgres://postgres:postgres@${address}/postgres`;

    return {
      url,
      address,
      async stop() {
        // Order matters: stop the socket first so no query arrives mid-close,
        // then let PGlite flush to disk, and only then let another process in.
        await server.stop();
        await pglite.close();
        await releaseLock?.();
      },
    };
  } catch (error) {
    // Start-up failed (e.g. port already in use): don't leave the lock behind.
    await releaseLock?.();
    throw error;
  }
}
