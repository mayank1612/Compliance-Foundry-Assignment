/**
 * errors.ts — small helpers for turning thrown values into log-friendly text.
 *
 * Why: in JavaScript anything can be thrown (strings, objects, Errors), so a `catch`
 *      variable is `unknown`. Every script and the migrator need the same
 *      "message if it's an Error, otherwise a string form" logic — kept here once.
 */

/** Best-effort human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
