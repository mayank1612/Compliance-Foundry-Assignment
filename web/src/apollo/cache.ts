/**
 * cache.ts — Apollo's normalized cache, configured for the board.
 *
 * What: one InMemoryCache instance per client (and per test).
 * How the board's lists work:
 *   * Every Task / TaskStatus is stored ONCE under `Task:<id>` / `TaskStatus:<id>`,
 *     so a card updated by a mutation re-renders everywhere it appears.
 *   * `TaskStatus.tasks` is a Relay connection: `relayStylePagination` keeps ONE list
 *     per (status, filter, order) and appends pages fetched with `after` — whether
 *     they came from the board query or a single column's "load more" query.
 *     `first`/`after` are deliberately not part of the key; filter/order are.
 */
import { InMemoryCache } from '@apollo/client';
import { relayStylePagination } from '@apollo/client/utilities';

export function createCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      TaskStatus: {
        fields: {
          tasks: relayStylePagination(['filter', 'orderBy']),
        },
      },
    },
  });
}
