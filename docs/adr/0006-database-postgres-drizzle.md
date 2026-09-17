# ADR-0006: PostgreSQL with Drizzle ORM in a shared `@repo/db` package

- Status: superseded by [ADR-0061](0061-database-roles-and-append-only-enforcement.md) and [ADR-0073](0073-review-hardening.md) (deltas: which role the API connects as, and four more client options; and `updated_at` is stamped by the column's `$onUpdate` rather than by the repository that remembers it)
- Date: 2026-08-17

> **Superseded in part 2026-09-03 by [ADR-0061](0061-database-roles-and-append-only-enforcement.md)**, at the head of `D14.4`. A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md), and a narrow one: this record chose Postgres 16, Drizzle over postgres.js, the `@repo/db` package, snake_case casing, UUIDv7 primary keys, the executor-taking repository and the no-singleton client — **all of that stands and is in force**. 0061 §1 changes one fact about the connection: the API connects as an **application role** with table privileges and no DDL, while migrations, seeds and `drizzle-kit` connect as an **owner role** through `DATABASE_URL_OWNER`. 0061 §3 adds four options to the `createDb` this record designed — `statement_timeout`, `idle_in_transaction_session_timeout`, `application_name` and the `DB_PREPARED_STATEMENTS` variable behind the `noPreparedStatements` option that had none. Read 0061 §1 and §3 for the connection; read this record for everything else about the store.
>
> **Superseded in part a second time 2026-09-17, at the head of `D20.5`.** [ADR-0073](0073-review-hardening.md) §8 changes one line of this record's `timestamps()` helper and nothing else: `updated_at` gains `.$onUpdate(() => new Date())`, so a repository that forgets the column can no longer ship a stale one. **This is not the trigger this record declined.** `$onUpdate` runs in the driver, so the schema stays portable and the mutation stays visible in the statement — the two properties §Schema conventions gives as the reason for writing the column by hand — and a repository that sets `updated_at` explicitly still wins, which is why none of the existing writes moved. What changes is that omitting it is no longer a silent bug; the 2026-09-13 review's `DB-03` is what the hand-written rule cost. **Everything else here stands and is in force**: Postgres 16, Drizzle over postgres.js, the `@repo/db` package, snake_case casing, UUIDv7 primary keys, the executor-taking repository and the no-singleton client. Read 0073 §8 for the stamp; read this record for the store.

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
