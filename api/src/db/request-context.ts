/**
 * request-context.ts — run database work AS a specific user, under row-level security.
 *
 * What: opens a transaction, drops to the unprivileged `app_user` role and records
 *       who the caller is, then runs `work` inside that transaction.
 * Why:  the connection itself is privileged (it owns the schema, or is a PGlite
 *       superuser), and privileged roles BYPASS row-level security. Every policy in
 *       0005_access_control.sql only takes effect once we have switched role and
 *       set `app.user_id`. Both are transaction-local (`SET LOCAL`,
 *       `set_config(…, true)`), so they end with the transaction — the next
 *       request on the same pooled connection starts clean (pinned by db.test.ts).
 * Who:  every GraphQL request (Part 2) and the schema tests. Migrations and seeds
 *       deliberately do NOT use it: they run as the owner.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from './types.js';

/** The role requests run as. Created in 0001_foundation.sql; owns nothing. */
export const REQUEST_ROLE = 'app_user';

/** Canonical textual UUID — checked up front so a bad id fails here, not mid-query. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param userId the authenticated user's id, or `null` for an anonymous caller —
 *               every policy then matches nothing (fail closed).
 */
export async function withUserContext<T>(
  db: Kysely<DB>,
  userId: string | null,
  work: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (userId !== null && !UUID_PATTERN.test(userId)) {
    throw new TypeError(`withUserContext: "${userId}" is not a UUID`);
  }

  return db.transaction().execute(async (trx) => {
    // sql.raw because a role name cannot be a bind parameter; REQUEST_ROLE is a
    // compile-time constant, never user input.
    await sql.raw(`SET LOCAL ROLE ${REQUEST_ROLE}`).execute(trx);
    if (userId !== null) {
      // Third argument `true` = transaction-local, like SET LOCAL.
      await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
    }
    return work(trx);
  });
}
