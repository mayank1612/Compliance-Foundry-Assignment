/**
 * session-context.ts — the session context object and its hook.
 * (Kept apart from SessionProvider.tsx so that file exports only a component,
 * which React Fast Refresh needs to hot-reload it without losing state.)
 */
import { createContext, use } from 'react';
import type { DevUser } from '../lib/api';

export interface SessionValue {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  users: DevUser[];
  currentUser: DevUser | null;
  switchUser: (userId: string) => Promise<void>;
  retry: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
