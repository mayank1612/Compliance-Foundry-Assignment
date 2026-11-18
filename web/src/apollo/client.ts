/**
 * client.ts — the Apollo Client the app uses to talk to the GraphQL API.
 *
 * Auth: every request carries `Authorization: Bearer <token>` for the user chosen in
 * the "view as" switcher (session/SessionProvider.tsx). The token lives in this
 * module, not in React state, so the link reads the CURRENT value at request time.
 * Switching user calls `client.resetStore()` (see SessionProvider): the cache is
 * per user, so one user's cached board must never be shown to another.
 */
import { ApolloClient, HttpLink } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { API_BASE_URL } from '../lib/api';
import { createCache } from './cache';

let accessToken: string | null = null;

/** Called by the session when the viewer changes. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

const authLink = new SetContextLink((previous) => ({
  headers: {
    ...(previous.headers as Record<string, string> | undefined),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  },
}));

export function createApolloClient(): ApolloClient {
  return new ApolloClient({
    link: authLink.concat(new HttpLink({ uri: `${API_BASE_URL}/graphql` })),
    cache: createCache(),
  });
}
