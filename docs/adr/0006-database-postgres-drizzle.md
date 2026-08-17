# ADR-0006: PostgreSQL with Drizzle ORM in a shared `@repo/db` package

- Status: accepted
- Date: 2026-08-17

## Context

We need a relational store for identities, sessions and future domain data; typed access from TypeScript; SQL migrations we can read and review; and a seeding path (ADR-0008). The schema will be shared by the API and by tooling (migrations, seeds), and its types will be useful to other apps in the monorepo.

## Decision

### Engine and driver

- **PostgreSQL 16** (pinned major in Docker, ADR-0007).
- **Drizzle ORM** with the `postgres` (postgres.js) driver, `drizzle-kit` for migration generation.

### Package

```
packages/db/
├── src/
│   ├── schema/
│   │   ├── index.ts            # re-exports all tables & relations
│   │   ├── _shared.ts          # column helpers: id(), timestamps(), enums
│   │   ├── staff.ts            # staff, staff_roles (ADR-0017)
│   │   ├── users.ts            # users, user_roles (ADR-0017)
│   │   └── sessions.ts         # sessions (ADR-0018)
│   ├── client.ts               # createDb(url, opts) -> { db, sql, close() }
│   ├── types.ts                # InferSelectModel/InferInsertModel aliases
│   └── index.ts
├── migrations/                 # drizzle-kit output (SQL + meta), committed
├── seeds/                      # seed runner + seed files (ADR-0008)
├── drizzle.config.ts
└── package.json                # scripts: db:generate, db:migrate, db:seed, db:studio, db:reset
```

- `@repo/db` exports: `createDb`, `Db` type, `schema` namespace, and `Transaction` type. It does not export a singleton; the API creates its client at startup with the validated config (ADR-0004) and passes it down (ADR-0009).
- `createDb` returns a health probe `ping(): Promise<void>` (`SELECT 1`) used by startup (ADR-0003) and readiness (ADR-0016).

### Schema conventions

- Table and column names `snake_case`; TS properties `camelCase` (Drizzle `casing: 'snake_case'` in config).
- Primary keys: `id uuid` generated app-side as **UUIDv7** (`crypto.randomUUID` is v4; use `uuidv7` package) — time-ordered, index-friendly, safe to expose.
- Every table has `created_at timestamptz not null default now()` and `updated_at timestamptz not null default now()`; `updated_at` is set by the repository on write (no triggers, keeps schema portable).
- Soft delete only where the domain needs it (`deleted_at timestamptz null`); not applied by default.
- Enums are Postgres enums via `pgEnum`, mirrored as TS string unions in `@repo/contracts` so clients don't depend on `@repo/db`.
- Foreign keys always declared; `on delete` chosen explicitly per relation.
- Indices are declared in the schema file next to the table.
- One schema file per aggregate; `relations()` declared alongside tables.

### Transactions

- Repositories accept an optional `tx` (Drizzle transaction) so services can compose multiple repository calls atomically: `db.transaction(async tx => { ... })`. The `Db | Transaction` union is typed as `DbExecutor`.

### Connectivity as a hard dependency

The API refuses to start if the database is unreachable (ADR-0003). Pool size from `DB_POOL_MAX`; connection string from `DATABASE_URL`.

## Consequences

- Schema is TypeScript, migrations are plain SQL: reviewable, diff-able, no runtime schema engine.
- Types flow to the API for free; other apps can import `@repo/contracts` for wire types without pulling in the ORM.
- Drizzle's query builder is close to SQL; complex reporting queries can drop to `sql` template without leaving the type system.
- Team must run `db:generate` after schema edits and commit the migration (enforced by a CI check later).

## Alternatives considered

- **Prisma**: excellent DX and tooling, but its own query engine, generated client, and less control over SQL; migration drift handling and `prisma generate` add friction in a monorepo.
- **Kysely + hand-written migrations**: maximal control, but no schema-as-source-of-truth; more boilerplate for a starter.
- **TypeORM / MikroORM**: decorator/entity based, heavier, weaker type inference.
- **`pg` driver instead of `postgres.js`**: both are supported by Drizzle; postgres.js is faster and has a simpler API; switch is a one-file change in `client.ts` if ever needed.
