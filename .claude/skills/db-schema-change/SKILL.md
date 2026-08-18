---
name: db-schema-change
description: Workflow for changing the Postgres schema with Drizzle — edit schema, generate + review migration, update contracts enums, repositories, seeds and tests (ADR-0006, ADR-0008, ADR-0023). Use for any table/column/enum/index change.
---

# DB schema change — `$ARGUMENTS`

1. **Enums first** — if adding/altering an enum value, edit the `as const` array in `packages/contracts/src/enums.ts` (source for both `pgEnum` and zod).
2. **Schema** — edit `packages/db/src/schema/<aggregate>.ts` (one file per aggregate): snake_case names, `id: uuid` (v7 app-side), `createdAt/updatedAt` via `timestamps()`, explicit FKs with `onDelete`, indices next to the table, `relations()` alongside. Export from `schema/index.ts`.
3. **Generate** — `pnpm db:generate` (drizzle-kit). Never `push`. Never edit an already committed migration.
4. **Review the SQL** in `packages/db/migrations/<n>_*.sql`: destructive changes? data loss on type change? `ALTER TYPE … ADD VALUE` (not transactional on older PG)? extension needs (`CREATE EXTENSION IF NOT EXISTS`) belong in a `--custom` migration. Data backfills → `pnpm db:generate -- --custom` with idempotent SQL.
5. **Apply** — `pnpm db:migrate` (dev) and against `DATABASE_URL_TEST` (test globalSetup does this; or run once manually). Print target DB name only.
6. **Code** — update repositories (`packages`/`apps/api`), mappers, contracts resource types, seeds (idempotent upserts), fixtures.
7. **Tests** — repository/int tests; `pnpm test:int --filter api`; seed twice → still idempotent.
8. **Docs** — if the change is architectural (new aggregate, new population concept), `/new-adr` or amend ADR-0017; note in the current deliverable plan in `docs/plan/` if scope changes.
9. Commit schema + migration + code together (`feat(db): …`).

Ask before: dropping columns/tables, `db:reset`, anything touching `sessions` semantics (ADR-0018).
