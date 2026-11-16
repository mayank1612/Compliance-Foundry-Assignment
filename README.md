# Task Board: Multi-tenant Project Management (Take-Home)

A simplified Linear/Jira-style platform built for the Compliance Foundry Senior Full-Stack assessment. It has three parts:

- A PostgreSQL data model.
- A Node.js GraphQL API.
- A React + TypeScript task board.

The design documents, AI critique and RFC sit alongside the code.

> **Status:** project setup is complete. Parts 1–3 are in progress, and this README will map every deliverable once they're done.

## Quick start

Requires **Node.js ≥ 22.12** (developed on 24.12). No database install and no Docker: PostgreSQL runs embedded via [PGlite](docs/tech-stack-choice.md#3-database-runtime-postgresql-via-pglite-not-docker).

```bash
npm install
npm run setup   # create the embedded database and apply migrations
npm run check   # typecheck, lint, format, generated-types check, tests
```

To use a real PostgreSQL server instead, copy `api/.env.example` to `api/.env` and set `DATABASE_URL`.

## Repository layout

```
api/                 Node.js GraphQL API (TypeScript)
  db/migrations/     Hand-written SQL migrations, the schema's source of truth
  src/db/            Connection pool, embedded Postgres, migrator, generated types
  src/scripts/       CLI scripts: db:migrate, db:reset, db:codegen
  test/              Integration tests against real (embedded) Postgres
docs/                Design docs, critique, RFC, tech stack rationale
```

## Documents

- [Tech stack choice](docs/tech-stack-choice.md): what every tool is, why we chose it, and what we turned down.

## Assumptions

- "Organization" and "workspace" are the same tenant concept; the code and docs say "organization".
- Authentication is out of scope. Seeded users get signed development tokens, and authorization is fully enforced.
