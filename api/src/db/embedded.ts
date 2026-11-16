/**
 * embedded.ts — boots PostgreSQL inside this Node process (PGlite) and exposes it
 * on a local TCP port.
 *
 * What: PGlite is the real Postgres engine compiled to WebAssembly. On its own it
 *       is called through a JS API (`pglite.query()`), which our app does not use.
 *       `PGLiteSocketServer` puts the Postgres *wire protocol* in front of it, so
 *       the standard `pg` driver — and therefore Kysely, kysely-codegen and any
 *       Postgres client — connects to it exactly like a normal server.
 * Why:  the application code path is identical for embedded and real Postgres.
 *       Switching to a real server is a DATABASE_URL change, not a code change.
 * When: on API/script start-up when DATABASE_URL is unset, and once per test file.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export interface EmbeddedPostgres {
  /** Connection URL for the `pg` driver, e.g. postgres://postgres:postgres@127.0.0.1:51234/postgres */
  readonly url: string;
  /** Stop accepting connections, then flush and close the database. */
  stop(): Promise<void>;
}

export interface EmbeddedPostgresOptions {
  /**
   * Directory where PGlite persists its data files. Omit for a throw-away in-memory
   * database (what tests and type generation use: fresh, isolated, fast).
   */
  dataDir?: string | undefined;
}

export async function startEmbeddedPostgres(
  options: EmbeddedPostgresOptions = {},
): Promise<EmbeddedPostgres> {
  // In-memory when no directory is given; otherwise the files survive restarts.
  const pglite = options.dataDir ? await PGlite.create(options.dataDir) : await PGlite.create();

  const server = new PGLiteSocketServer({
    db: pglite,
    // Loopback only: the embedded database must never be reachable from the network.
    host: '127.0.0.1',
    // 0 = let the OS pick a free port, so parallel test files never collide.
    // After start(), getServerConn() reports the real port.
    port: 0,
    // PGlite is ONE Postgres session. The socket server would let several clients
    // share that session, interleaving their statements — one request's open
    // transaction or `SET LOCAL ROLE` would then leak into another request's
    // queries. One connection at a time keeps transactions isolated.
    maxConnections: 1,
  });
  await server.start();

  // The username/password are placeholders: the socket server does not
  // authenticate, and it only listens on loopback (above).
  const url = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;

  return {
    url,
    async stop() {
      // Order matters: stop the socket first so no query arrives mid-close.
      await server.stop();
      await pglite.close();
    },
  };
}
