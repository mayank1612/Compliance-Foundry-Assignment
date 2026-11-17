/**
 * data-dir-lock.ts — one process at a time per PGlite data directory.
 *
 * What: an exclusive lock file next to the data directory (`api/.pglite.lock`)
 *       holding the owning process id.
 * Why:  a normal Postgres server refuses to start on a data directory another
 *       server is using (postmaster.pid). PGlite has no such guard, and two
 *       processes writing the same files (say `npm run db:serve` for DBeaver plus
 *       `npm run db:migrate`) would corrupt the database. This restores the guard.
 * How:  `open(…, 'wx')` creates the file only if it does not exist — an atomic
 *       "claim". If it exists, we check whether the recorded process is still
 *       alive: alive → refuse with a clear message; dead (crash, killed terminal)
 *       → the lock is stale, so remove it and claim it.
 * Who:  startEmbeddedPostgres() for persisted databases, and db:reset before it
 *       deletes the directory. In-memory databases (tests) need no lock.
 */
import { open, readFile, unlink } from 'node:fs/promises';

/** Releases the lock. Safe to call more than once. */
export type ReleaseLock = () => Promise<void>;

/** Is a process with this id still running? (Signal 0 = existence check only.) */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireDataDirLock(dataDir: string): Promise<ReleaseLock> {
  const lockPath = `${dataDir}.lock`;

  // Two attempts: the second one only after removing a stale lock.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await unlink(lockPath).catch(() => undefined); // already gone is fine
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const ownerPid = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10);
      if (Number.isInteger(ownerPid) && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
        throw new Error(
          `The dev database (${dataDir}) is in use by process ${ownerPid} — probably ` +
            '`npm run db:serve` or the dev server. Stop it first (Ctrl+C in its terminal).',
          { cause: error }, // the EEXIST from the claim attempt
        );
      }
      // Stale: the owner is gone without cleaning up. Remove and retry once.
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error(`Could not acquire ${lockPath}; another process keeps re-creating it.`);
}
