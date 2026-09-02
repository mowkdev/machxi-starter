---
name: db-schema-change
description: Workflow for changing the Postgres schema with Drizzle — edit schema, generate + review migration, update contracts enums, repositories, seeds and tests (ADR-0006, ADR-0008, ADR-0023). Use for any table/column/enum/index change.
---

# DB schema change — `$ARGUMENTS`

1. **Enums first** — if adding/altering an enum value, edit the `as const` array in `packages/contracts/src/enums.ts` (source for both `pgEnum` and zod).
2. **Schema** — edit `packages/db/src/schema/<aggregate>.ts` (one file per aggregate): snake_case names, `id: uuid` (v7 app-side), `createdAt/updatedAt` via `timestamps()`, explicit FKs with `onDelete`, indices next to the table, `relations()` alongside. Export from `schema/index.ts`.
3. **Generate** — `pnpm db:generate` (drizzle-kit). Never `push`. Never edit an already committed migration.
4. **Review the SQL** in `packages/db/migrations/<n>_*.sql`: destructive changes? data loss on type change? extension needs (`CREATE EXTENSION IF NOT EXISTS`) belong in a `--custom` migration — `citext` is `0000`, `pg_trgm` is `0009`. Data backfills → `pnpm db:generate -- --custom` with idempotent SQL. Two rules the migrator's single transaction makes non-negotiable (ADR-0060 §5):
   - **An enum `ADD VALUE` and its first use ship in separate migrations.** One transaction cannot add an enum label and then write it, so a batch that does both passes on an incrementally-migrated database and fails on a fresh one — green locally, red in CI and on every new deployment. The migration that adds the value ships alone.
   - **Say in the migration's comment whether an index is expected to block.** `migrate()` runs every pending migration in one transaction, which rules out `CREATE INDEX CONCURRENTLY`, so the lock is a choice made per index rather than a default nobody stated. Every table in this blueprint is small; the deployment that has one which cannot take the lock is the one that revisits the migrator's shape.
5. **Indexes are part of the allow-list, not a follow-up** (ADR-0060 §3). A column enters a `sortable`, `filterable` or searchable allow-list **only with its index in the same step**: a btree index leading with the column for sorting and filtering — composite with `id`, which `applyListQuery` appends as the tiebreaker — and a `pg_trgm` GIN index for anything `q` searches, since `ilike '%term%'` reads no btree. The per-module test (`<module>.list-indexes.test.ts`, over `uncoveredListColumns` from `@repo/db/testing`) fails when the two lists disagree, so this is checked rather than remembered. On a `citext` column the search must compare `column::text`, which is what `toSearchCondition` writes — citext's own `ILIKE` operator is in no trgm family and would ignore the index.
6. **Apply** — `pnpm db:migrate` (dev) and against the test database (its globalSetup does this; or run once manually). Both connect as the **owner** (`DATABASE_URL_OWNER` / `DATABASE_URL_TEST_OWNER`, ADR-0061 §1); the API's `DATABASE_URL` is the application role and has no DDL. A new table needs no grant — migration `0008`'s `ALTER DEFAULT PRIVILEGES` covers it. Print target DB name only.
7. **Code** — update repositories (`packages`/`apps/api`), mappers, contracts resource types, seeds (idempotent upserts), fixtures.
8. **Tests** — repository/int tests; `pnpm test:int --filter api`; seed twice → still idempotent.
9. **Docs** — if the change is architectural (new aggregate, new population concept), `/new-adr` or amend ADR-0017; note in the current deliverable plan in `docs/plan/` if scope changes.
10. Commit schema + migration + code together (`feat(db): …`).

Ask before: dropping columns/tables, `db:reset`, anything touching `sessions` semantics (ADR-0018, as carried by ADR-0057 — the actor column is 0057's).
