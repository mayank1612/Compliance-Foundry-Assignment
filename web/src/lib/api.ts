/**
 * api.ts — where the API lives, and the one non-GraphQL call the app makes.
 *
 * In development the Vite dev server proxies /graphql and /dev to the API (same
 * origin, see vite.config.ts), so the base URL is empty. A deployed build can point
 * elsewhere with VITE_API_URL.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** A seeded user offered by the dev-only "view as" switcher. */
export interface DevUser {
  id: string;
  displayName: string;
  email: string;
  memberships: { organization: string; slug: string; role: string }[];
  token: string;
}

/**
 * GET /dev/users — the API's development stand-in for a login screen (it only
 * exists outside production). Authentication itself is out of scope for this
 * assessment; authorization is fully enforced by the API.
 */
export async function fetchDevUsers(signal?: AbortSignal): Promise<DevUser[]> {
  const response = await fetch(`${API_BASE_URL}/dev/users`, { signal: signal ?? null });
  if (!response.ok) throw new Error(`The API answered ${response.status} for /dev/users`);
  return (await response.json()) as DevUser[];
}
