/**
 * server.ts — `npm run dev` / `npm start`: run the GraphQL API over HTTP.
 *
 * What: opens the database (embedded PGlite unless DATABASE_URL is set), applies
 *       pending migrations when embedded (zero-setup dev), builds the app (app.ts)
 *       and listens on PORT. GraphiQL: http://localhost:4000/graphql (dev only).
 * Shutdown: Ctrl+C stops accepting requests, then closes the pool and the embedded
 *       database so PGlite flushes to disk and releases its data-directory lock.
 */
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createTokenService } from './auth/tokens.js';
import { loadEnv } from './config/env.js';
import { openDatabaseFromEnv } from './db/database.js';
import { logMigrationResults, migrateToLatest } from './db/migrator.js';
import { errorMessage } from './lib/errors.js';

const LOG = '[api]';
const env = loadEnv();
const database = await openDatabaseFromEnv(env, LOG);

if (database.embedded) logMigrationResults(await migrateToLatest(database.db), LOG);

const seeded = await database.db
  .selectFrom('organizations')
  .select((eb) => eb.fn.countAll<number>().as('count'))
  .executeTakeFirstOrThrow();
if (seeded.count === 0)
  console.warn(`${LOG} the database is empty — run \`npm run db:seed\` for demo data`);

const app = createApp({
  db: database.db,
  tokens: createTokenService(env.JWT_SECRET),
  corsOrigin: env.CORS_ORIGIN,
  devRoutes: env.NODE_ENV !== 'production',
});

// Yoga's handler returns a promise and reports its own errors; Node's listener
// signature expects void, so the promise is deliberately not awaited here.
const server = createServer((request, response) => {
  void app(request, response);
});
server.on('error', (error) => {
  console.error(`${LOG} could not start: ${errorMessage(error)}`);
  void database.close().finally(() => process.exit(1));
});
server.listen(env.PORT, () => {
  console.log(`${LOG} GraphQL API ready at http://localhost:${env.PORT}/graphql`);
  if (env.NODE_ENV !== 'production') {
    console.log(`${LOG} dev tokens for seeded users: http://localhost:${env.PORT}/dev/users`);
  }
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${LOG} ${signal} received — shutting down`);
  server.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
