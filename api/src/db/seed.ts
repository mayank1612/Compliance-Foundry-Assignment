/**
 * seed.ts — deterministic demo data for the Task Board.
 *
 * What: 3 organizations, 10 users (every role, one person in two organizations with
 *       different roles), 4 projects, ~2,800 tasks with statuses, priorities,
 *       assignees, labels and due dates around today. The largest project
 *       (Website Relaunch) has 2,500 tasks — the size Part 3's RFC is about.
 * Why deterministic: a fixed PRNG seed gives every reviewer the same board, and
 *       tests can rely on the same shape at a smaller size.
 * How: runs as the schema owner (seeding is a privileged path, like migrations) in
 *      one transaction. Card ranks come from the same fractional-indexing library
 *      the API uses for moves, so seeded and moved cards share one key space.
 */
import { generateNKeysBetween } from 'fractional-indexing';
import type { Kysely, Transaction } from 'kysely';
import type { DB, OrganizationRole, TaskPriority } from './types.js';

export interface SeedOptions {
  /** Size of the big project (default 2,500; tests use far fewer). */
  largeProjectTasks?: number;
  /** "Today" for due dates, YYYY-MM-DD (default: the current UTC date). */
  today?: string;
}

export interface SeedResult {
  users: Record<string, string>; // handle → id
  organizations: Record<string, string>; // slug → id
  projects: Record<string, string>; // key → id
  tasks: number;
}

// ---------------------------------------------------------------------------
// Fixed demo content
// ---------------------------------------------------------------------------

const USERS = [
  ['alice', 'Alice Johnson'],
  ['bob', 'Bob Smith'],
  ['carol', 'Carol Diaz'],
  ['dan', 'Dan Lee'],
  ['erin', 'Erin Walsh'],
  ['frank', 'Frank Moore'],
  ['grace', 'Grace Kim'],
  ['heidi', 'Heidi Park'],
  ['ivan', 'Ivan Petrov'],
  ['judy', 'Judy Chen'],
] as const;

type Handle = (typeof USERS)[number][0];

const ORGANIZATIONS: {
  slug: string;
  name: string;
  timezone: string;
  members: [Handle, OrganizationRole][];
}[] = [
  {
    slug: 'acme',
    name: 'Acme Corp',
    timezone: 'Asia/Kolkata',
    members: [
      ['alice', 'owner'],
      ['bob', 'admin'],
      ['carol', 'member'],
      ['dan', 'member'],
      ['grace', 'member'], // also an admin at Globex: roles are per organization
      ['erin', 'viewer'],
    ],
  },
  {
    slug: 'globex',
    name: 'Globex',
    timezone: 'America/New_York',
    members: [
      ['frank', 'owner'],
      ['grace', 'admin'],
      ['heidi', 'viewer'],
    ],
  },
  {
    slug: 'initech',
    name: 'Initech',
    timezone: 'Europe/London',
    members: [
      ['ivan', 'owner'],
      ['judy', 'member'],
    ],
  },
];

const PROJECTS = [
  { org: 'acme', key: 'WEB', name: 'Website Relaunch', size: 'large' },
  { org: 'acme', key: 'MOB', name: 'Mobile App', size: 150 },
  { org: 'globex', key: 'OPS', name: 'Operations', size: 120 },
  { org: 'initech', key: 'TPS', name: 'TPS Reports', size: 60 },
] as const;

const LABELS = [
  ['bug', '#ef4444'],
  ['feature', '#3b82f6'],
  ['chore', '#6b7280'],
  ['design', '#a855f7'],
  ['infra', '#14b8a6'],
  ['customer', '#f59e0b'],
] as const;

const VERBS = [
  'Fix',
  'Implement',
  'Design',
  'Refactor',
  'Write tests for',
  'Investigate',
  'Update',
  'Document',
  'Optimize',
  'Review',
];
const SUBJECTS = [
  'login flow',
  'pricing page',
  'checkout API',
  'search indexing',
  'onboarding emails',
  'dark mode',
  'CSV export',
  'audit log',
  'SSO integration',
  'rate limiting',
  'image uploads',
  'mobile navigation',
  'billing webhooks',
  'permissions UI',
  'error tracking',
  'caching layer',
  'release notes',
  'accessibility audit',
];

/** Status position (0 Backlog … 4 Canceled) with realistic weights for a mature project. */
const STATUS_WEIGHTS: [number, number][] = [
  [0, 18],
  [1, 18],
  [2, 14],
  [3, 42],
  [4, 8],
];
const PRIORITY_WEIGHTS: [TaskPriority, number][] = [
  ['none', 15],
  ['low', 25],
  ['medium', 30],
  ['high', 20],
  ['urgent', 10],
];

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, seedable PRNG — same seed, same demo data. */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lookups the seed itself guarantees (ids it just inserted); fail loudly if not. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`seed invariant broken: missing ${what}`);
  return value;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export async function seedDemoData(db: Kysely<DB>, options: SeedOptions = {}): Promise<SeedResult> {
  const largeSize = options.largeProjectTasks ?? 2500;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const random = prng(20261118);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const weighted = <T>(entries: readonly [T, number][]): T => {
    let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [value, weight] of entries) if ((roll -= weight) < 0) return value;
    return required(entries.at(-1), 'weighted entries')[0]; // floating-point edge: last entry
  };

  return db.transaction().execute(async (trx: Transaction<DB>) => {
    const users: Record<string, string> = {};
    for (const [handle, displayName] of USERS) {
      const row = await trx
        .insertInto('users')
        .values({ email: `${handle}@example.test`, displayName })
        .returning('id')
        .executeTakeFirstOrThrow();
      users[handle] = row.id;
    }

    const organizations: Record<string, string> = {};
    const workers: Record<string, string[]> = {}; // members who can be assigned / create tasks
    for (const org of ORGANIZATIONS) {
      const { id } = await trx
        .insertInto('organizations')
        .values({ name: org.name, slug: org.slug })
        .returning('id')
        .executeTakeFirstOrThrow();
      organizations[org.slug] = id;
      await trx
        .updateTable('organizationSettings')
        .set({ timezone: org.timezone })
        .where('organizationId', '=', id)
        .execute();
      await trx
        .insertInto('organizationMembers')
        .values(
          org.members.map(([handle, role]) => ({
            organizationId: id,
            userId: required(users[handle], `user ${handle}`),
            role,
          })),
        )
        .execute();
      workers[org.slug] = org.members
        .filter(([, role]) => role !== 'viewer')
        .map(([handle]) => required(users[handle], `user ${handle}`));
      await trx
        .insertInto('labels')
        .values(LABELS.map(([name, color]) => ({ organizationId: id, name, color })))
        .execute();
    }

    const projects: Record<string, string> = {};
    let taskCount = 0;
    for (const project of PROJECTS) {
      const organizationId = required(organizations[project.org], `organization ${project.org}`);
      const people = required(workers[project.org], `members of ${project.org}`);
      const { id: projectId } = await trx
        .insertInto('projects')
        .values({
          organizationId,
          key: project.key,
          name: project.name,
          createdBy: people[0] ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      projects[project.key] = projectId;

      // Default statuses come from the projects trigger, in position order.
      const statuses = await trx
        .selectFrom('taskStatuses')
        .select(['id', 'position'])
        .where('projectId', '=', projectId)
        .orderBy('position')
        .execute();
      const labels = await trx
        .selectFrom('labels')
        .select('id')
        .where('organizationId', '=', organizationId)
        .execute();

      // Decide every task first, so each column can get evenly spaced rank keys.
      const size = project.size === 'large' ? largeSize : project.size;
      const planned = Array.from({ length: size }, () => {
        const position = weighted(STATUS_WEIGHTS);
        const open = position < 3;
        const hasDue = random() < (open ? 0.75 : 0.5);
        return {
          position,
          title: `${pick(VERBS)} ${pick(SUBJECTS)}`,
          priority: weighted(PRIORITY_WEIGHTS),
          assigneeId: random() < 0.85 ? pick(people) : null,
          createdBy: pick(people),
          dueDate: hasDue
            ? addDays(today, open ? Math.floor(random() * 67) - 21 : -Math.floor(random() * 90))
            : null,
          labelIds: labels.filter(() => random() < 0.18).map((label) => label.id),
        };
      });

      const rankQueues = new Map<number, string[]>();
      for (const status of statuses) {
        const count = planned.filter((task) => task.position === status.position).length;
        rankQueues.set(status.position, generateNKeysBetween(null, null, count));
      }

      // Insert in chunks (one statement per 500 rows); triggers assign numbers,
      // copy the status category, stamp completed_at and record "created" history.
      for (let start = 0; start < planned.length; start += 500) {
        const chunk = planned.slice(start, start + 500);
        const inserted = await trx
          .insertInto('tasks')
          .values(
            chunk.map((task) => ({
              organizationId,
              projectId,
              title: task.title,
              statusId: required(statuses[task.position], `status ${task.position}`).id,
              priority: task.priority,
              assigneeId: task.assigneeId,
              createdBy: task.createdBy,
              dueDate: task.dueDate,
              rank: required(rankQueues.get(task.position)?.shift(), 'rank key'), // one per task
            })),
          )
          .returning('id') // Postgres returns rows in VALUES order
          .execute();
        const links = inserted.flatMap((row, index) =>
          (chunk[index]?.labelIds ?? []).map((labelId) => ({
            organizationId,
            taskId: row.id,
            labelId,
          })),
        );
        if (links.length > 0) await trx.insertInto('taskLabels').values(links).execute();
      }
      taskCount += planned.length;
    }

    return { users, organizations, projects, tasks: taskCount };
  });
}
