/**
 * db.test.ts — proves the database foundation behaves the way the rest of the app
 * (and the docs) assume.
 *
 * What: integration tests against a real, fresh, in-memory PGlite database reached
 *       through the same pg driver + Kysely stack the API uses.
 * Why:  each test pins one decision that, if it silently regressed, would corrupt
 *       data (date/count parsing), break tenant isolation (RLS on a superuser
 *       session) or leave the schema half-migrated.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/database.js';
import { migrateToLatest, SqlFileMigrationProvider } from '../src/db/migrator.js';

describe('embedded Postgres through the pg driver', () => {
  let database: Database;
  beforeAll(async () => {
    database = await openDatabase(); // fresh in-memory PGlite for this block
  });
  afterAll(async () => {
    await database.close();
  });

  it('is real PostgreSQL 18, not an emulation', async () => {
    const { rows } = await sql<{ version: string }>`select version()`.execute(database.db);
    expect(rows[0]?.version).toMatch(/^PostgreSQL 18\./);
  });

  it('returns DATE as the exact YYYY-MM-DD string, with no time-zone shift', async () => {
    // Regression guard for the IST bug: the pg default turned this into 2026-11-04T18:30Z.
    // Also shows CamelCasePlugin renaming result keys (due_date → dueDate), even for raw SQL.
    const { rows } = await sql<{ dueDate: unknown }>`select date '2026-11-05' as due_date`.execute(
      database.db,
    );
    expect(rows[0]?.dueDate).toBe('2026-11-05');
  });

  it('returns count(*) (int8) as a number, not a string', async () => {
    const { rows } = await sql<{ total: unknown }>`
      select count(*) as total from generate_series(1, 3)`.execute(database.db);
    expect(rows[0]?.total).toBe(3);
  });

  it('refuses to silently round int8 values beyond 2^53 − 1, and the connection survives', async () => {
    await expect(sql`select 9007199254740993::int8 as big`.execute(database.db)).rejects.toThrow(
      RangeError,
    );
    // The single PGlite connection must still be usable afterwards.
    const { rows } = await sql<{ ok: number }>`select 1 as ok`.execute(database.db);
    expect(rows[0]?.ok).toBe(1);
  });
});

describe('row-level security on embedded Postgres', () => {
  let database: Database;

  beforeAll(async () => {
    database = await openDatabase();
    // A minimal stand-in for the real tenant policies designed in Part 1.
    // `nullif(…, '')`: once a custom setting has been used in a session, Postgres
    // reports it as '' (not NULL) after the transaction ends — and ''::int throws.
    // nullif turns that into NULL, so "no tenant set" matches no rows (fails closed).
    await sql
      .raw(
        `
        create role rls_probe_app nologin;
        create table rls_probe (organization_id int not null, title text not null);
        alter table rls_probe enable row level security;
        create policy tenant_isolation on rls_probe
          using (organization_id = nullif(current_setting('app.organization_id', true), '')::int);
        grant select on rls_probe to rls_probe_app;
        insert into rls_probe values (1, 'Acme task'), (2, 'Globex task');
      `,
      )
      .execute(database.db);
  });
  afterAll(async () => {
    await database.close();
  });

  /**
   * Mirrors what each GraphQL request will do: one transaction, drop superuser
   * rights with SET LOCAL ROLE, set the tenant as a transaction-local setting, query.
   */
  const titlesVisibleTo = (organizationId: number | null) =>
    database.db.transaction().execute(async (trx) => {
      await sql`set local role rls_probe_app`.execute(trx);
      if (organizationId !== null) {
        await sql`select set_config('app.organization_id', ${String(organizationId)}, true)`.execute(
          trx,
        );
      }
      const { rows } = await sql<{ title: string }>`
        select title from rls_probe order by title`.execute(trx);
      return rows.map((row) => row.title);
    });

  it('is bypassed by the default superuser — the reason requests must drop privileges', async () => {
    const { rows } = await sql<{ title: string }>`select title from rls_probe`.execute(database.db);
    expect(rows).toHaveLength(2);
  });

  it('shows each tenant only its own rows after SET LOCAL ROLE', async () => {
    expect(await titlesVisibleTo(1)).toEqual(['Acme task']);
    expect(await titlesVisibleTo(2)).toEqual(['Globex task']);
  });

  it('fails closed (no rows) when no tenant is set, even after an earlier request set one', async () => {
    await titlesVisibleTo(1);
    expect(await titlesVisibleTo(null)).toEqual([]);
  });

  it('does not leak the role or tenant into the next transaction on the shared session', async () => {
    await titlesVisibleTo(1);
    const { rows } = await sql<{ currentUser: string; tenant: string | null }>`
      select current_user, current_setting('app.organization_id', true) as tenant`.execute(
      database.db,
    );
    expect(rows[0]?.currentUser).toBe('postgres');
    expect(rows[0]?.tenant ?? '').toBe(''); // '' or NULL — either way, no tenant
  });
});

describe('SQL migration runner', () => {
  const tempDirs: string[] = [];

  /** Write a throw-away migrations folder so these tests never touch db/migrations. */
  async function migrationsDir(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'taskboard-migrations-'));
    tempDirs.push(dir);
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(dir, name), contents);
    }
    return dir;
  }

  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('applies multi-statement files in name order, exactly once', async () => {
    const database = await openDatabase();
    try {
      const dir = await migrationsDir({
        '0001_create_projects.sql': `
          -- comments and several statements in one file are fine
          create table projects (id int primary key, name text not null);
          insert into projects values (1, 'Website relaunch');`,
        '0002_add_archived_flag.sql': `
          alter table projects add column archived boolean not null default false;`,
      });

      const results = await migrateToLatest(database.db, dir);
      expect(results.map(({ migrationName, status }) => [migrationName, status])).toEqual([
        ['0001_create_projects', 'Success'],
        ['0002_add_archived_flag', 'Success'],
      ]);

      const { rows } = await sql<{ name: string; archived: boolean }>`
        select name, archived from projects`.execute(database.db);
      expect(rows).toEqual([{ name: 'Website relaunch', archived: false }]);

      // Re-running is a no-op: both files are recorded as applied.
      expect(await migrateToLatest(database.db, dir)).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it('rolls back the whole pending batch when one migration fails', async () => {
    const database = await openDatabase();
    try {
      const dir = await migrationsDir({
        '0001_create_labels.sql': 'create table labels (id int primary key);',
        '0002_broken.sql': 'alter table no_such_table add column x int;',
      });

      await expect(migrateToLatest(database.db, dir)).rejects.toThrow(/0002_broken/);

      // 0001 succeeded on its own, but must not survive 0002's failure.
      const { rows } = await sql<{ found: string | null }>`
        select to_regclass('public.labels')::text as found`.execute(database.db);
      expect(rows[0]?.found).toBeNull();
    } finally {
      await database.close();
    }
  });

  it('rejects file names that would sort ambiguously', async () => {
    const dir = await migrationsDir({ '1_init.sql': 'select 1;' });
    await expect(new SqlFileMigrationProvider(dir).getMigrations()).rejects.toThrow(
      /Invalid migration file name/,
    );
  });
});
