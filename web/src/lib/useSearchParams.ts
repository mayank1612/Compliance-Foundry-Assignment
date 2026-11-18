/**
 * useSearchParams.ts — the URL query string as React state.
 *
 * What: read `?project=…&priority=HIGH,URGENT…` as URLSearchParams and update it.
 * Why the URL (not React state or a store) holds the board's filters and project:
 *   * a filtered board is a shareable link and survives a refresh;
 *   * the browser Back button undoes the last filter change (pushState).
 * How: useSyncExternalStore subscribes React to `location.search`, so every
 * component reading the URL re-renders together, with no context or global store.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener); // Back/Forward
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const getSnapshot = () => window.location.search;

export function useSearchParams(): [
  URLSearchParams,
  (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => void,
] {
  const search = useSyncExternalStore(subscribe, getSnapshot);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void, options: { replace?: boolean } = {}) => {
      const next = new URLSearchParams(window.location.search);
      mutate(next);
      const query = next.toString();
      if (query === window.location.search.replace(/^\?/, '')) return; // nothing changed
      const url = query ? `?${query}` : window.location.pathname;
      if (options.replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
      for (const listener of listeners) listener();
    },
    [],
  );

  return [params, update];
}
