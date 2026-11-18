/**
 * pagination.ts — opaque keyset cursors and Relay-style connection assembly.
 *
 * Cursor format: base64url(JSON [sortValue, id]). Every sort value is a string or
 * a number (rank, priority, 'YYYY-MM-DD' due date, task number) — NEVER a JS Date.
 * Postgres timestamps have microsecond precision and a JS Date only milliseconds, so
 * a timestamp cursor round-tripped through Date would skip or repeat rows (a gap
 * the Task 1.3 analysis found that a schema-only review can't see). That's also why
 * "newest first" is served from the task number rather than created_at.
 */
import { apiError } from '../graphql/errors.js';

export type SortValue = string | number | null;

export interface Cursor {
  value: SortValue;
  id: string;
}

export interface Page<T> {
  rows: T[];
  hasNextPage: boolean;
}

export interface Connection<T> {
  edges: { cursor: string; node: T }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(value: SortValue, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString('base64url');
}

/** Decode a client cursor; anything malformed is BAD_USER_INPUT, never a DB error. */
export function decodeCursor(cursor: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [value, id] = parsed as unknown[];
      if (
        (typeof value === 'string' || typeof value === 'number' || value === null) &&
        typeof id === 'string' &&
        UUID.test(id)
      ) {
        return { value, id };
      }
    }
  } catch {
    // fall through to the uniform error below
  }
  throw apiError('BAD_USER_INPUT', 'Invalid cursor');
}

/**
 * Run a page query that fetched `first + 1` rows: the extra row only proves there
 * is a next page (no COUNT(*) needed) and is dropped.
 */
export function toPage<T>(rows: T[], first: number): Page<T> {
  return { rows: rows.slice(0, first), hasNextPage: rows.length > first };
}

export function toConnection<T>(page: Page<T>, cursorOf: (row: T) => string): Connection<T> {
  const edges = page.rows.map((node) => ({ cursor: cursorOf(node), node }));
  return {
    edges,
    pageInfo: { hasNextPage: page.hasNextPage, endCursor: edges.at(-1)?.cursor ?? null },
  };
}
