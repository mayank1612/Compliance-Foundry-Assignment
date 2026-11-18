/**
 * errors.ts — turn Apollo/network errors into something a person can act on.
 *
 * The API puts a machine code on every expected error (`extensions.code`:
 * UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, BAD_USER_INPUT, CONFLICT). The UI branches
 * on the code — never on message text.
 */
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';

export function errorCode(error: unknown): string | undefined {
  if (!CombinedGraphQLErrors.is(error)) return undefined;
  const code = error.errors[0]?.extensions?.code;
  return typeof code === 'string' ? code : undefined;
}

/** A short, user-facing explanation (the raw error stays in the console). */
export function describeError(error: unknown): string {
  if (CombinedGraphQLErrors.is(error)) {
    switch (errorCode(error)) {
      case 'UNAUTHENTICATED':
        return 'Your session is not valid. Pick a user in the header.';
      case 'FORBIDDEN':
        return error.errors[0]?.message ?? 'You are not allowed to do that.';
      case 'CONFLICT':
        return 'The board changed in the meantime. It has been reloaded.';
      default:
        return error.errors[0]?.message ?? 'The request failed.';
    }
  }
  if (ServerError.is(error)) return `The API answered with status ${error.statusCode}.`;
  return 'Cannot reach the API. Is it running? Start everything with `npm run dev`.';
}
