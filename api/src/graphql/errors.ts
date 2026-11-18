/**
 * errors.ts — the API's expected errors, as GraphQL errors with a machine code.
 *
 * What: one factory for every error a client is meant to see and handle.
 * Why:  GraphQL Yoga masks every OTHER error as "Unexpected error." (maskedErrors),
 *       so database messages — which can name another tenant's ids (critique
 *       finding SEC3) — never reach clients. Only GraphQLErrors created here pass
 *       through, each with `extensions.code` for client logic.
 */
import { GraphQLError } from 'graphql';

export type ApiErrorCode =
  | 'UNAUTHENTICATED' // no or invalid token
  | 'FORBIDDEN' // signed in, visible object, but the role doesn't allow the action
  | 'NOT_FOUND' // missing OR in another tenant — deliberately indistinguishable
  | 'BAD_USER_INPUT' // arguments fail validation
  | 'CONFLICT'; // the data changed under the client (e.g. a stale board) — refetch

export function apiError(code: ApiErrorCode, message: string, httpStatus?: number): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code, ...(httpStatus ? { http: { status: httpStatus } } : {}) },
  });
}

/** NOT_FOUND for anything the caller can't see — never reveals whether it exists. */
export const notFound = (what: string) => apiError('NOT_FOUND', `${what} not found`);
