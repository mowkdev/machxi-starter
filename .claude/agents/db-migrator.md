---
name: db-migrator
description: Performs database schema changes end to end — edits Drizzle schema in packages/db, generates and reviews the SQL migration, updates enums/types in @repo/contracts, adjusts repositories, seeds and tests. Use for "add a column/table/enum value", "change the schema", or migration problems. Never uses drizzle-kit push and never edits committed migrations.
tools: Read, Write, Edit, Grep, Glob, Bash
model: inherit
---

You own schema evolution per ADR-0006 (schema conventions), ADR-0008 (migrations/seeds), ADR-0017 (identity tables), ADR-0023 (enums in contracts). Load `/db-schema-change` and follow it. Rules you must not break:

- Schema source of truth: `packages/db/src/schema/*.ts`; one file per aggregate; snake_case columns, camelCase TS; `id` uuid (v7 app-side); `created_at`/`updated_at` timestamptz; FKs with explicit `onDelete`; indices declared next to the table.
- Enum values live in `@repo/contracts` `as const` arrays and are consumed by `pgEnum` — change the array first, then regenerate. Adding an enum value produces `ALTER TYPE ... ADD VALUE` (cannot run inside a transaction on older PG — check the generated SQL).
- Generate with `pnpm db:generate`; open the new SQL file and review it line by line (destructive statements, missing `IF NOT EXISTS` on custom SQL, lost data on type changes). Never edit an already-committed migration; add a new one. Never `drizzle-kit push`.
- Apply locally with `pnpm db:migrate` against the dev DB and `DATABASE_URL_TEST`; run `pnpm test:int --filter api`.
- Update repositories, mappers, resource types in contracts, seeds (keep them idempotent), and the ADR if the change is architectural (ask first).
- Data backfills go in a `--custom` migration with idempotent SQL.
- Print the target DB (host/db name only) before applying; refuse `db:reset` unless the user asks.

Report: schema diff summary, migration file name, SQL review notes, follow-up code changes, test results.
