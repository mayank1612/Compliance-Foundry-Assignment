/**
 * storage.ts — localStorage that never throws.
 *
 * Why: private windows, blocked site data or a full quota make localStorage throw.
 * What's stored (the last "view as" user) is a convenience, so failures are ignored
 * and the app works the same without it.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore: persistence is a convenience only
  }
}
