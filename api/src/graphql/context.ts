/**
 * context.ts — what every resolver receives as its third argument.
 *
 * Two stages:
 *   1. RequestContext — built by Yoga's context factory from the HTTP request
 *      (app.ts): just who is calling.
 *   2. GraphQLContext — completed by the transaction plugin (transaction-plugin.ts)
 *      right before execution: the operation's own database transaction, already
 *      running as `app_user` under row-level security, plus DataLoaders bound to it.
 *
 * There is deliberately NO other database handle in the context: resolvers can only
 * reach Postgres through `ctx.db`, so every query is subject to row-level security
 * (the "RLS is opt-in" gap from the Task 1.3 analysis).
 */
import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { apiError } from './errors.js';
import type { Loaders } from './loaders.js';

export interface RequestContext {
  /** Authenticated user id from the access token, or null for an anonymous caller. */
  viewerId: string | null;
}

export interface GraphQLContext extends RequestContext {
  /** This operation's transaction (role app_user, app.user_id = viewerId). */
  db: Transaction<DB>;
  /** Per-operation batching + caching (never shared across requests or users). */
  loaders: Loaders;
}

/** The authenticated user's id, or UNAUTHENTICATED. */
export function requireViewer(ctx: RequestContext): string {
  if (!ctx.viewerId) throw apiError('UNAUTHENTICATED', 'Sign in required', 401);
  return ctx.viewerId;
}
