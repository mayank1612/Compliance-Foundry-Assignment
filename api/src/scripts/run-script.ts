/**
 * run-script.ts — the shared harness for every `npm run db:*` CLI script.
 *
 * What: runs a script's main function and turns ANY failure — bad env config,
 *       a refused safety check, a broken migration — into one clean log line and
 *       exit code 1.
 * Why:  without it, an error thrown at the top level of an ES module prints a raw
 *       Node stack trace that buries the actual message (e.g. "DATABASE_URL must be
 *       a postgres:// URL"). CI and humans both just need the message + exit code.
 * Note: sets `process.exitCode` instead of calling `process.exit()`, so `finally`
 *       blocks still run and the database is always closed cleanly.
 */
import { errorMessage } from '../lib/errors.js';

export async function runScript(logPrefix: string, main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`${logPrefix} ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
