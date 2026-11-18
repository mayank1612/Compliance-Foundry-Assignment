/**
 * SessionProvider.tsx — who the app is acting as.
 *
 * What: loads the seeded users from the API's dev-only /dev/users route and
 *       provides the current one plus `switchUser()` (the "view as" picker that
 *       stands in for a login screen — authentication is out of scope).
 * Why it resets the Apollo cache on switch: everything cached was filtered by the
 *       previous user's permissions. `resetStore()` empties it and refetches the
 *       visible queries with the new token, so one user's board can never flash up
 *       for another.
 */
import { useApolloClient } from '@apollo/client/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setAccessToken } from '../apollo/client';
import { fetchDevUsers, type DevUser } from '../lib/api';
import { readStored, writeStored } from '../lib/storage';
import { SessionContext, type SessionValue } from './session-context';

const STORAGE_KEY = 'taskboard.viewAs';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; users: DevUser[] }
  | { status: 'error'; message: string };

/** The remembered user if they still exist, else a member (not an owner) for a typical view. */
function initialUser(users: DevUser[]): DevUser | undefined {
  const remembered = readStored(STORAGE_KEY);
  return (
    users.find((user) => user.id === remembered) ??
    users.find((user) => user.memberships.some((m) => m.role === 'member')) ??
    users[0]
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useApolloClient();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchDevUsers(controller.signal).then(
      (users) => {
        const user = initialUser(users);
        // Set the token BEFORE any query renders (children mount only when ready).
        setAccessToken(user?.token ?? null);
        setCurrentId(user?.id ?? null);
        setState({ status: 'ready', users });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({
          status: 'error',
          message: 'Cannot reach the API. Start it (and the web app) with `npm run dev`.',
        });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const switchUser = useCallback(
    async (userId: string) => {
      if (state.status !== 'ready') return;
      const user = state.users.find((candidate) => candidate.id === userId);
      if (!user) return;
      setAccessToken(user.token);
      writeStored(STORAGE_KEY, user.id);
      setCurrentId(user.id);
      try {
        await client.resetStore(); // drop the previous user's data, refetch as the new one
      } catch {
        // A query in flight during the reset rejects; the refetch it triggers is what matters.
      }
    },
    [client, state],
  );

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo<SessionValue>(() => {
    const users = state.status === 'ready' ? state.users : [];
    return {
      status: state.status,
      error: state.status === 'error' ? state.message : null,
      users,
      currentUser: users.find((user) => user.id === currentId) ?? null,
      switchUser,
      retry,
    };
  }, [state, currentId, switchUser, retry]);

  return <SessionContext value={value}>{children}</SessionContext>;
}
