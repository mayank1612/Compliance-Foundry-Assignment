/**
 * pool.ts — the node-postgres connection pool, with our type-parsing rules.
 *
 * What: creates the `pg.Pool` that Kysely runs every query through, for both the
 *       embedded PGlite server and a real Postgres server.
 * Why:  node-postgres' default parsers have two defaults that silently corrupt data
 *       in this domain, so we override them once, here, for every connection:
 *
 *   1. DATE (`tasks.due_date`) — the default parser builds a JS `Date` at *local*
 *      midnight. On a machine in IST (UTC+5:30), `2026-11-05` became
 *      `2026-11-04T18:30:00Z`: an off-by-one-day bug in due dates, "overdue" logic
 *      and pagination cursors. A calendar date has no time zone, so we keep it as the
 *      exact 'YYYY-MM-DD' string Postgres sent.
 *
 *   2. INT8 / bigint (every `count(*)` result) — the default returns a *string*
 *      ("42"), because int8 can exceed JavaScript's safe-integer range. Counts in this
 *      app never will, so we return a `number` — but we throw instead of silently
 *      rounding if a value ever does exceed 2^53 − 1.
 *
 * Where: per-pool (`types` option), NOT via the global `pg.types.setTypeParser`, so
 *        importing this module never changes the behaviour of other `pg` users.
 */
import pg from 'pg';

/** Postgres type identifiers (OIDs from the `pg_type` catalog), e.g. DATE = 1082, INT8 = 20. */
const { builtins } = pg.types;
type TypeId = Parameters<typeof pg.types.getTypeParser>[0];
type TypeFormat = Parameters<typeof pg.types.getTypeParser>[1];
type ValueParser = (value: string) => unknown;

/**
 * Parse an int8 text value into a JS number, refusing to lose precision.
 * Who calls it: node-postgres, for every int8 column in every result row.
 */
export function parseSafeInt8(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(
      `int8 value ${value} exceeds Number.MAX_SAFE_INTEGER; select it ::text instead`,
    );
  }
  return parsed;
}

/**
 * The per-pool parser lookup. node-postgres calls `getTypeParser(oid, format)` for
 * each result column; we answer for our two OIDs and delegate everything else
 * (timestamptz → Date, json → object, …) to the library defaults.
 * Only the default *text* wire format is overridden; binary results are untouched.
 */
function getTypeParser(oid: TypeId, format?: TypeFormat): ValueParser {
  if (format !== 'binary') {
    if (oid === builtins.DATE) return (value) => value;
    if (oid === builtins.INT8) return parseSafeInt8;
  }
  // pg types its default lookup as returning `any`; every default parser does take
  // the raw text value, so narrowing to ValueParser is accurate.
  return pg.types.getTypeParser(oid, format) as ValueParser;
}

export interface PoolOptions {
  /** postgres:// URL — the embedded PGlite socket or a real server. */
  connectionString: string;
  /** Maximum concurrent connections held by this pool. */
  max: number;
}

/**
 * Create the pool. Who: `openDatabase()` (db/database.ts) — the only caller.
 */
export function createPool({ connectionString, max }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    types: { getTypeParser },
    // Shows up in pg_stat_activity on a real server — tells a DBA which service
    // owns a connection.
    application_name: 'taskboard-api',
  });

  // An idle pooled connection can die (server restart, network blip). Without a
  // listener, node-postgres re-emits that as an *unhandled* 'error' event and the
  // whole process crashes. Log it instead; the pool replaces the client on next use.
  pool.on('error', (error) => {
    console.error('[db] idle connection error (pool will reconnect):', error.message);
  });

  return pool;
}
