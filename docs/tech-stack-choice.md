# Tech Stack Choice

This document records every technology used in the submission: what it is, why we picked it, and what we turned down. The samples use this project's own domain (organizations → projects → tasks) so each tool is shown doing real work.

## 1. Constraints that drove the choices

1. **The spec fixes three things.** A Node.js GraphQL API, a React + TypeScript UI, and PostgreSQL as the data model.
2. **The reviewer has to be able to run it.** "Include a `package.json` so we can run your code" means `npm install` should be close to the only step. Every extra prerequisite (Docker, a local Postgres, a CLI) is a chance for the review to stall.
3. **What gets graded is SQL and API design.** Tasks 1.1–1.3 assess Postgres modelling (constraints, indexes, tenant isolation). Task 2.1 assesses hand-written resolvers and design decisions. The tools should make that work visible, not generate it.
4. **4–5 hour timebox.** We prefer well-documented, stable tools and a small surface over feature-rich frameworks.

## 2. Summary

| Layer                  | Choice                                    | Turned down                                              |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Database runtime       | **PostgreSQL 18 via PGlite** (embedded)   | Docker Compose Postgres, `embedded-postgres`, SQLite     |
| Schema & migrations    | **Hand-written `.sql` files**             | ORM-generated migrations                                 |
| Query layer            | **Kysely**                                | Drizzle, Sequelize, Prisma, raw `pg`                     |
| GraphQL server         | **GraphQL Yoga, SDL-first**               | PostGraphile, Hasura, Apollo Server, code-first (Pothos) |
| Type generation        | **GraphQL Code Generator**                | Hand-written types                                       |
| N+1 protection         | **DataLoader** (one per request)          | Per-field queries, global cache                          |
| Auth (demo scope)      | **jose** (JWT)                            | jsonwebtoken, sessions                                   |
| Input/env validation   | **zod 4**                                 | Hand-rolled checks                                       |
| Frontend build         | **Vite + React 19 + TypeScript**          | Next.js, Create React App                                |
| GraphQL client         | **Apollo Client 4**                       | TanStack Query + graphql-request, urql                   |
| UI state               | **URL params + React hooks**              | Redux, Zustand                                           |
| Styling / DnD / charts | **Tailwind 4 / dnd-kit / Recharts 3**     | CSS modules, MUI / react-beautiful-dnd / Chart.js, visx  |
| Testing                | **Vitest + React Testing Library**        | Jest                                                     |
| Repo tooling           | **npm workspaces, ESLint, Prettier, tsx** | pnpm/Turborepo, Nx                                       |

---

## 3. Database runtime: PostgreSQL via PGlite (not Docker)

**What PGlite is:** the real PostgreSQL engine compiled to WebAssembly and published as an npm package, so a full Postgres database runs inside the Node.js process with no server to install.

**What WebAssembly is:** WebAssembly (Wasm) is a compact, portable binary instruction format, and a W3C standard since 2019. It runs in a sandboxed virtual machine built into every modern browser and into Node.js (inside V8). Code written in C, C++ or Rust is compiled to a `.wasm` file once. That same file then runs at near-native speed on any OS and CPU. PGlite uses this: Postgres's C source is compiled to Wasm with the Emscripten toolchain. The npm package therefore holds one binary that runs identically on Windows, macOS and Linux, with no per-platform downloads and no native build step.

### Why PGlite instead of Docker

|                        | PGlite                                                                            | Docker Compose Postgres                                              |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Reviewer prerequisites | None beyond Node                                                                  | Docker Desktop installed **and running**, port 5432 free, image pull |
| Engine fidelity        | Real Postgres 18: same planner, partial indexes, CHECKs, RLS, `FILTER` aggregates | Real Postgres                                                        |
| Test isolation         | A fresh database per test file, in-process                                        | Shared server; needs reset scripts or Testcontainers                 |
| CI                     | Runs on a plain Node runner                                                       | Needs a service container                                            |
| Concurrency realism    | ✗ single connection                                                               | ✓                                                                    |

- **It's real Postgres, not a stand-in.** SQLite or an in-memory mock would let us "run" the 1.1 DDL without validating it. PGlite runs the actual SQL, including Postgres-only features that the critique in 1.3 depends on.
- **Production stays one config change away.** The app does **not** call PGlite directly. PGlite is exposed through `@electric-sql/pglite-socket`, which speaks the Postgres wire protocol, and the app connects with the standard `pg` driver. Setting `DATABASE_URL` to a real Postgres (Docker, RDS, Neon) switches over with no code change.
- **Verified, not assumed.** A spike first ran our pagination, aggregation, transaction and RLS queries on PGlite 0.5.x through `pg` + Kysely. The same guarantees are now pinned by tests in `api/test/db.test.ts`.

### Trade-offs we accept, and how we handle them

- **One connection only.** PGlite is a single Postgres _session_. The socket server could accept several clients, but they would share that one session, so one request's open transaction or `SET LOCAL ROLE` would leak into another's queries. We therefore cap both the socket server and the pool at one connection, and queries run one at a time. That's fine for a demo and for tests, but **PGlite timings must not be quoted as production performance** (relevant to the Part 3 RFC).
- **The default user is a superuser, and superusers bypass row-level security.** Each request transaction switches to a non-privileged role (`SET LOCAL ROLE app_user`) before querying, which also matches how production should run.
- **Newer, smaller ecosystem than the official Docker image.** If a PGlite issue blocks us, the `DATABASE_URL` path is the fallback.

```ts
// Condensed from api/src/db/embedded.ts + database.ts.
// WHERE: dev server, CLI scripts, each test file. WHEN: start-up, if DATABASE_URL is unset.
// WHAT: boots an embedded Postgres and exposes it on a local TCP port, so the rest of
// the app talks to it exactly like a real Postgres server (via the standard `pg` driver).
const pglite = await PGlite.create(dataDir); // dataDir omitted → in-memory (tests)
const server = new PGLiteSocketServer({
  db: pglite,
  host: '127.0.0.1', // loopback only — never reachable from the network
  port: 0, // OS picks a free port, so parallel test files never collide
  maxConnections: 1, // one session → one connection (see trade-offs above)
});
await server.start();

const pool = createPool({
  connectionString: `postgres://postgres:postgres@${server.getServerConn()}/postgres`,
  max: 1,
});
const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
  plugins: [new CamelCasePlugin()],
});
```

---

## 4. Schema & query layer: hand-written SQL migrations + Kysely (not Drizzle)

**What Kysely is:** a type-safe SQL query builder for TypeScript. You write queries that read like SQL (`selectFrom('tasks').where(...)`), and the compiler checks table and column names and infers the shape of each result row. It isn't an ORM: there are no model classes, no lazy loading and no hidden queries. One builder chain compiles to exactly one SQL statement.

**How the pieces fit:**

1. The schema lives in numbered, commented `.sql` migration files. They are the single source of truth.
2. Kysely's built-in `Migrator` applies them in order, keeping a tracking table and a lock.
3. TypeScript row types are generated from the migrated database (`kysely-codegen`), so the types can't drift from the SQL. `npm run db:codegen -- --verify` fails the check if someone forgets to regenerate.
4. Kysely's `CamelCasePlugin` keeps SQL in `snake_case` (`due_date`) while TypeScript sees `camelCase` (`dueDate`), so rows map straight onto GraphQL fields. Identifiers written inside raw `sql` template text are not converted, so they stay `snake_case`.

### Why Kysely over Drizzle

1. **The graded deliverable is SQL.** Task 1.1 asks for `CREATE TABLE` statements, and 1.2 and 1.3 analyse Postgres-specific features: partial indexes, CHECK constraints, row-level security. With Kysely, the reviewer reads hand-written, commented SQL, which also satisfies the project rule that all code carries detailed comments. With Drizzle, the SQL the reviewer reads is generated and has no comments; the commented version lives in a TypeScript file.
2. **Our hardest queries are where Kysely is strongest.** We ran the same two queries side by side in a spike:
   - **Row-tuple cursor comparison:** Kysely has `refTuple`/`tuple`. Drizzle needs a raw `sql` fragment.
   - **`FILTER` aggregates:** Kysely has `filterWhere`. Drizzle needs a raw `sql` fragment plus `.mapWith(Number)`.
3. **The schema v1 → v2 plan for 1.3 is cleanest in SQL.** The fixes we make after the critique become one new migration file, and that file _is_ the changelog.

**When we'd pick Drizzle instead:** if the team preferred to define the schema in TypeScript and have migrations generated, Drizzle would be a good choice. It returns correct types by default and gives a model-style schema that Sequelize users would recognise. The costs: the 1.1 deliverable becomes generated SQL, and we'd stay on stable 0.45 rather than the 1.0 beta.

**A known Kysely + `pg` cost, fixed once:** node-postgres turns `DATE` columns into JavaScript `Date` objects at _local_ midnight. On an IST machine, `2026-11-05` came back as `2026-11-04T18:30Z`, an off-by-one-day bug for due dates and cursors. It also returns `bigint` counts as strings. Two type parsers registered at pool creation fix both: `DATE` stays a string, and `count(*)` becomes a number. This is `pg` driver behaviour, so the same fix also protects production Postgres.

### Other options considered

- **Sequelize** is Compliance Foundry's production ORM, and our spike confirmed it works on PGlite (transactions, RLS, Umzug running `.sql` files). We didn't choose it because:
  - It's model-first. Its models would duplicate the hand-written DDL, giving us two sources of truth.
  - In v6, result types come from the model, not from the query. `attributes: ['id']` is still typed as the whole model.
  - Our tuple-cursor and `FILTER` queries would fall back to `sequelize.literal`, which isn't type-checked.

  Team fit is preserved anyway: data access sits behind small repository modules, so swapping the query builder wouldn't touch the schema, resolvers or UI.

- **Prisma** has its own schema language and a generated client. RLS needs a per-request transaction wrapper, and tuple cursors need raw SQL.
- **Raw `pg`** offers full control but no type safety for dynamic filter composition.

```ts
// repositories/tasks.ts — WHO: called by the `tasks` resolver. WHAT: one page of a
// project's tasks, newest first, using keyset (cursor) pagination.
// WHY keyset instead of OFFSET: OFFSET scans and discards every skipped row (slow at
// page 80 of a 2,000-task project) and shifts when tasks are inserted mid-scroll.
let q = db
  .selectFrom('tasks')
  .select(['id', 'title', 'priority', 'status_id', 'due_date', 'created_at'])
  .where('project_id', '=', projectId)
  .where('deleted_at', 'is', null);

// Filters are optional — Kysely lets us add WHERE clauses conditionally, still type-checked.
if (filter.priorities?.length) q = q.where('priority', 'in', filter.priorities);

// Cursor = (created_at, id) of the last row the client saw. The row-tuple comparison
// compiles to `(created_at, id) < ($1, $2)`, which a composite index can serve directly.
if (after) {
  q = q.where((eb) =>
    eb(eb.refTuple('created_at', 'id'), '<', eb.tuple(after.createdAt, after.id)),
  );
}

// Fetch one extra row: if it exists, there is a next page (hasNextPage) — no COUNT needed.
const rows = await q
  .orderBy('created_at', 'desc')
  .orderBy('id', 'desc')
  .limit(first + 1)
  .execute();
```

---

## 5. GraphQL server: GraphQL Yoga, SDL-first (not PostGraphile)

**What Yoga is:** a spec-compliant GraphQL HTTP server from The Guild. It's built on the standard Fetch API (`Request`/`Response`), runs on Node's `http` module, and is extended with Envelop plugins (depth limits, cost limits, persisted operations).

### Why not PostGraphile

PostGraphile is a **database-first** generator. It introspects a Postgres schema and generates a complete GraphQL API: tables become types, foreign keys become relations, SQL functions become queries and mutations, and authorisation is delegated to Postgres roles and RLS. It's an excellent tool. The author has used it professionally, and teams invested in Postgres use it for exactly that reason. **This task, however, doesn't call for a database-first generator:**

1. **The spec grades hand-written resolvers.** Task 2.1 asks for "resolver implementation (minimum 80 lines of meaningful logic)" plus an explanation of design decisions. PostGraphile generates the resolvers, which would leave little of our own logic to assess. The custom pieces (the summary/aggregation query, filter semantics) would turn into plugins or SQL functions.
2. **We want an API shaped around the product, not the tables.** A generated schema mirrors the table layout. We want a contract designed first (`tasks(filter, first, after)`, `taskSummary`) and kept separate from storage, so that the schema evolution described in 1.2 doesn't break clients.
3. **We want authorisation in two explicit layers.** PostGraphile relies on RLS alone. We do explicit, unit-tested authorisation checks in the API and keep RLS as a second safety net.
4. **N+1 and batching are part of the assessment.** Task 1.3 asks about N+1 risks in resolvers. PostGraphile compiles each request into a single SQL statement, which hides the very design problem we are asked to reason about.

**Where the PostGraphile experience still shows:** we borrow its pattern of passing the authenticated user into Postgres as a transaction-local setting (`set_config('app.user_id', …, true)`), so RLS policies can read the current user. The same reasoning rules out **Hasura**.

**Why not Apollo Server 5:** the two are close. We chose Yoga because:

- It masks unexpected errors by default; Apollo Server returns raw messages unless you add a `formatError` hook.
- It's built on standard Fetch.
- Security plugins drop in via Envelop.

Apollo Server would work just as well with Apollo Client, because client and server choices are independent.

**Why SDL-first rather than code-first (Pothos, Nexus):** the deliverable is "GraphQL type definitions". A plain `.graphql` file is the contract that the API, the web client and the reviewer all read, and codegen turns it into types.

```ts
// server.ts — WHAT: the HTTP entry point. WHEN: once at startup.
// HOW: Yoga parses/validates each request against the SDL, builds a per-request
// context (who is calling + fresh DataLoaders), then runs our resolvers.
import { createServer } from 'node:http';
import { createSchema, createYoga } from 'graphql-yoga';

const yoga = createYoga({
  schema: createSchema({
    typeDefs, // loaded from schema.graphql — the single API contract
    resolvers: {
      Query: {
        // WHO can call it: any member of the project's organization (checked first, always).
        taskSummary: async (_parent, { projectId }, ctx) => {
          await ctx.authz.assertCanViewProject(projectId); // throws FORBIDDEN otherwise
          return ctx.repos.tasks.summary(projectId); // one SQL query with FILTER aggregates
        },
      },
    },
  }),
  context: ({ request }) => buildContext(request), // verifies the JWT, creates DataLoaders
});

createServer(yoga).listen(4000);
```

---

## 6. Supporting API libraries

### GraphQL Code Generator: types from the schema

**What:** a CLI that reads `schema.graphql` (and the client's queries) and writes TypeScript types.
**Why:** resolver arguments and return values are type-checked on the server, and `useQuery` results are typed in the client. If the schema and the code drift apart, compilation fails before anything runs.

```ts
// codegen.ts — WHEN: `npm run codegen` (and before build). One schema, two outputs.
const config: CodegenConfig = {
  schema: 'api/src/schema.graphql',
  generates: {
    // Server: typed resolver signatures; `mappers` says "a GraphQL Task is backed by a TaskRow".
    'api/src/generated/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        contextType: '../context#GraphQLContext',
        mappers: { Task: '../db/types#TaskRow' },
      },
    },
    // Client: typed `graphql()` documents for every query in the web app.
    'web/src/gql/': { preset: 'client', documents: 'web/src/**/*.tsx' },
  },
};
```

### DataLoader: preventing N+1 queries

**What:** a small utility that collects every `.load(id)` call made during the same tick and resolves them with one batched query.
**Why:** a board showing 50 tasks resolves `assignee` 50 times. Without batching that's 50 `SELECT`s; with DataLoader it's one `WHERE id = ANY(...)`.
**Security note:** loaders are created **per request**, so the cache can never serve one user's data to another user or tenant.

```ts
// context.ts — WHAT: batches user lookups for Task.assignee. WHEN: created per request.
const userById = new DataLoader<string, UserRow | null>(async (ids) => {
  const rows = await db.selectFrom('users').selectAll().where('id', 'in', ids).execute();
  const byId = new Map(rows.map((u) => [u.id, u]));
  return ids.map((id) => byId.get(id) ?? null); // contract: results in the SAME order as ids
});

// Task.assignee resolver — 50 cards → 50 .load() calls → 1 SQL query.
const assignee = (task: TaskRow, _: unknown, ctx: GraphQLContext) =>
  task.assignee_id ? ctx.loaders.userById.load(task.assignee_id) : null;
```

### jose: identifying the caller (demo-scope auth)

**What:** a dependency-free, typed implementation of JWT/JOSE built on the Web Crypto API.
**Why:** login is out of scope (an agreed assumption), but authorisation needs a verifiable caller identity to demonstrate tenant isolation.

- Seeded users get tokens from a dev-only endpoint that drives the UI's "view as user" switcher.
- The token carries **only the user id** (`sub`). Organization roles are read from the database on every request, so a role change takes effect immediately and a token can't escalate privileges.
- Moving to a real identity provider later is a configuration change: `createRemoteJWKSet` with RS256.

Over `jsonwebtoken`, jose is actively maintained, ESM-native, promise-based and covers the full JOSE standards.

```ts
const secret = new TextEncoder().encode(env.JWT_SECRET);

// Dev-only: mint a token for a seeded user (e.g. a viewer in "Acme") for the UI switcher.
const token = await new SignJWT({})
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(userId)
  .setExpirationTime('8h')
  .sign(secret);

// Every request: verify signature + expiry; pin the algorithm so a forged "alg" is rejected.
const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
```

### zod 4: validating untrusted input

**What:** schema-based runtime validation for TypeScript: parse unknown input and get back typed, validated data.
**Why:** GraphQL checks _types_, not business rules. zod enforces page-size caps (so nobody can request `first: 100000`), `dueFrom ≤ dueTo` and well-formed cursors. It also validates environment variables at boot, so a misconfigured server fails immediately instead of mid-request.

```ts
// Applied in the `tasks` resolver before any SQL runs.
const TaskQueryArgs = z
  .object({
    first: z.number().int().min(1).max(100).default(25), // hard cap protects the database
    dueFrom: z.iso.date().optional(), // 'YYYY-MM-DD' strings only
    dueTo: z.iso.date().optional(),
  })
  .refine((a) => !a.dueFrom || !a.dueTo || a.dueFrom <= a.dueTo, {
    message: 'dueFrom must be on or before dueTo',
  });
```

---

## 7. Frontend

### Vite + React 19 + TypeScript

**What:** Vite is a dev server and bundler with near-instant startup and hot module reload.
**Why not Next.js:** the board is an authenticated single-page app with no SEO or server-rendering needs, and the spec already gives us a separate Node API. Next.js would add routing and server-component concepts that don't serve the task. Create React App is deprecated.

### Apollo Client 4: talking to the API

**What:** a GraphQL client for React with a **normalized cache**. Every object is stored once under `__typename:id`, so updating a task updates every component that shows it.
**Why:** two board features map directly onto Apollo features:

- **Per-column cursor pagination:** `fetchMore` plus the `relayStylePagination` cache policy append each "load more" page to the right column.
- **Optimistic drag-and-drop:** `optimisticResponse` moves the card instantly, and Apollo rolls it back automatically if the server rejects the change. Moving a card _between_ two cached lists still needs a small `update` function; the normalized cache updates fields, not list membership.

**Why not TanStack Query + graphql-request:** simpler and smaller, but it has no normalized cache, so every cross-column move means editing each column's cache entry by hand. **urql** with Graphcache is comparable but has a smaller community.

```ts
// One board column. WHAT: first page of tasks for a status; `loadMore` fetches the next.
const { data, loading, error, fetchMore } = useQuery(COLUMN_TASKS, {
  variables: { projectId, statusId, first: 25 },
});
const loadMore = () => fetchMore({ variables: { after: data?.tasks.pageInfo.endCursor } }); // appended by the cache policy

// Drag-and-drop drop handler. The card moves before the server answers;
// on error Apollo discards the optimistic layer and the card snaps back.
const [updateTaskStatus] = useMutation(UPDATE_TASK_STATUS);
updateTaskStatus({
  variables: { taskId, statusId: targetStatusId },
  optimisticResponse: {
    updateTaskStatus: { __typename: 'Task', id: taskId, statusId: targetStatusId },
  },
});
```

### State management: no global store

| Kind of state                                | Lives in                  | Why                                                                                                       |
| -------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Server data (tasks, summary)                 | Apollo cache              | Already normalised, deduplicated and refetchable; copying it into Redux would create two sources of truth |
| Filters (status, assignee, priority, dates)  | URL search params         | Shareable links, working back button, survives refresh                                                    |
| Ephemeral UI (drag in progress, open panels) | `useState` / `useReducer` | Local to one component tree                                                                               |

With no client-only state shared across the app, Redux or Zustand would add ceremony without solving a problem.

### Tailwind 4, dnd-kit, Recharts 3

- **Tailwind CSS:** utility classes with a consistent design scale, which is fast to build with and leaves no stylesheet sprawl. MUI and other component libraries are heavier and look generic.
- **dnd-kit:** drag-and-drop with accessibility built in (keyboard dragging, screen-reader announcements). `react-beautiful-dnd`, the old default, is deprecated.
- **Recharts:** charts written as declarative React components (SVG), enough for the priority and status charts. Chart.js is imperative and canvas-based; visx is lower-level and would take more code for the same result.

```tsx
// PriorityChart.tsx — WHAT: donut of task counts per priority, fed by the taskSummary query.
<ResponsiveContainer width="100%" height={240}>
  <PieChart>
    <Pie data={summary.byPriority} dataKey="count" nameKey="priority" innerRadius={60} />
    <Tooltip />
  </PieChart>
</ResponsiveContainer>
```

---

## 8. Testing & tooling

- **Vitest:** a Jest-compatible test runner that handles TypeScript and ESM natively, with no Babel or ts-jest setup.
  - **API tests** send real GraphQL operations through Yoga to a fresh PGlite database, so the SQL, RLS, authorisation and resolvers are tested together.
  - **UI tests** use React Testing Library with Apollo's `MockedProvider` to check loading, error and empty states the way a user sees them.
- **npm workspaces:** `api/` and `web/` share one install and one lockfile. pnpm or Turborepo would be another prerequisite for the reviewer, and two packages don't need a build orchestrator.
- **tsx:** runs TypeScript directly in Node, with watch mode, during development.
- **ESLint + Prettier + TypeScript `strict`:** a single `npm run check` runs typecheck, lint and tests, and the CI workflow runs it too.

```ts
// api/test/authz.test.ts — the tenant-isolation guarantee, tested end to end.
it("rejects reading another organization's project", async () => {
  const res = await gql(asUser('member@globex.test'), TASKS_QUERY, { projectId: acmeProjectId });
  expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
});
```

## 9. Versions

Versions are pinned after checking peer dependencies, choosing the newest version every dependency accepts. Exact versions live in the lockfile.

| Package    | Pinned                           | Why not newer                                                                                                                                                                   |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | **6.0.x**                        | TypeScript 7 (the new native compiler) is out, but `typescript-eslint` 8.73 supports only `<6.1`. Type-aware linting is worth more than compiler speed in a codebase this size. |
| Node.js    | **≥ 22.12** (developed on 24.12) | Uses only APIs available since 22 (`process.loadEnvFile`, `import.meta.dirname`).                                                                                               |
| Kysely     | **0.29.x**                       | Latest. Note that since 0.29 the migrator is imported from `kysely/migration`.                                                                                                  |
| `graphql`  | decided in Part 2                | 17.x is out; GraphQL Yoga and codegen peer ranges will be checked when the server is added.                                                                                     |

## 10. What would change for production

| Today (submission)                    | At production scale                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| PGlite, one connection                | Managed Postgres 18 + PgBouncer; `DATABASE_URL` switch, no code change           |
| Dev JWT minted for seeded users       | External identity provider; jose verifying RS256 via JWKS                        |
| Single API process                    | Horizontally scaled stateless API (per-request DataLoaders already make it safe) |
| No query cost limits beyond page caps | Envelop depth/cost limits + persisted operations                                 |
