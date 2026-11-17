/**
 * data-dir-lock.test.ts — the guard that stops two processes from opening the same
 * PGlite data directory (PGlite itself has none; two writers would corrupt it).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acquireDataDirLock } from '../src/db/data-dir-lock.js';

describe('PGlite data-directory lock', () => {
  let workDir: string;
  let dataDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'taskboard-lock-'));
    dataDir = join(workDir, '.pglite');
  });
  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('records the owning process id while held', async () => {
    const release = await acquireDataDirLock(dataDir);
    expect(await readFile(`${dataDir}.lock`, 'utf8')).toBe(String(process.pid));
    await release();
    await expect(readFile(`${dataDir}.lock`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a second claim while a live process holds it', async () => {
    // Simulate another live process: the parent of this test runner is alive.
    await writeFile(`${dataDir}.lock`, String(process.ppid));
    await expect(acquireDataDirLock(dataDir)).rejects.toThrow(/in use by process/);
    await rm(`${dataDir}.lock`);
  });

  it('takes over a stale lock left by a process that no longer exists', async () => {
    // Far above any real PID on Windows/Linux/macOS, so this "owner" is certainly dead.
    await writeFile(`${dataDir}.lock`, '2147483646');
    const release = await acquireDataDirLock(dataDir);
    expect(await readFile(`${dataDir}.lock`, 'utf8')).toBe(String(process.pid));
    await release();
  });
});
