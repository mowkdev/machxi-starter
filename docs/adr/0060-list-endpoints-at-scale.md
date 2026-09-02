# ADR-0060: List endpoints at scale (supersedes ADR-0014 and ADR-0006 in part — deltas)

- Status: proposed
- Date: 2026-09-02

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; accepted at the head of the step that builds it.

## Context

[ADR-0014](0014-pagination-filtering-sorting.md) (pagination, filtering and sorting conventions) chose offset pagination and an allow-list per endpoint, and it holds — every list in the repository speaks one query language, and the codec in `@repo/contracts` writes it for the URL and the wire alike. What it did not do is bound the cost of the query it authorises, and a blueprint is forked into projects with tables the seed data cannot imagine.

Four things are loose. **`offset` has a floor and no ceiling** — `limit` is capped at 100 in `listQuerySchema`, `offset` carries only `.min(0)`, so `?offset=50000000` is a legal request that Postgres answers by walking fifty million rows. **Every list runs a mandatory `COUNT(*)`** over the same predicate as the page (the second query in `usersRepository.list` and its staff mirror), even where nobody is reading the number — while `Page.total` has been typed `number | null` since D1.4 and ADR-0014 §Consequences already reserved the "very large tables may switch to `total: null`" branch, which nothing has ever been able to take. **The allow-lists outrun the indexes**: the users list maps eight columns for sorting and filtering, staff its own set, and `q` searches with `ilike '%term%'` across email and both name columns, while the schema ships one non-unique index per table beyond the unique ones — `users_created_at_idx`, `staff_created_at_idx` and the two role indexes. ADR-0014 §Consequences claims "allow-listing prevents sorting/filtering on non-indexed columns"; it is the one sentence in that record the schema does not back, because nothing joins the two lists. And **two indexes the last deliverable needed were never added**: `sessions.impersonated_by_staff_id` ([ADR-0057](0057-impersonation-sessions.md)) has none although `revokeAllImpersonatedBy` filters on exactly it, and `audit_events` ([ADR-0058](0058-append-only-audit-log.md)) indexes the actor and the event but not `(acting_as_type, acting_as_id, occurred_at)` — "everything done to this customer", the question an incident asks second — nor `occurred_at` alone, which a retention job would scan.

There is also a migration hazard the current shape hides. `migrate()` applies every pending migration in one transaction, so a batch that runs `ALTER TYPE … ADD VALUE` and then uses the new value fails on a fresh database while passing on an incrementally-migrated one — green locally, red in CI and on a new deployment. The same transaction makes `CREATE INDEX CONCURRENTLY` impossible, which is the tool a large table needs.

## Decision

### 1. Bound `offset`; name keyset as the successor without adopting it

`offset` takes `.max(10_000)` in `listQuerySchema` beside `limit`'s existing ceiling. Beyond it the API answers `422` through the ordinary validation path (ADR-0011) — a bound, spelled like every other bound, with no special case in a controller.

**Cursor pagination is deliberately not adopted now.** The successor, when a list is expected to exceed a few hundred thousand rows, is **keyset pagination on `(sort key, id)`** — the tiebreaker `applyListQuery` already appends is exactly the second half of that key. It is a contract change, not an implementation detail: it touches the query language, the codec, both grids' pagers, and Postman, so it is a deliberable of its own and this record names it rather than half-building it.

### 2. `count=false`

The list-query language gains one flag: `count` (boolean, default `true`). `count=false` skips the aggregate and returns `total: null`, which the envelope has always allowed and `GridPager` has always handled — `total === null` is its open-ended branch, with no last-page jump and a range instead of a count. The codec in `@repo/contracts` learns the flag with the rest of the language, so the URL, the wire and the API's own parser stay one grammar.

The default stays `true`: an admin grid wants its page count, and an endpoint that becomes expensive opts out at the call site that knows it has.

### 3. An index for every column the allow-lists admit

Every column a repository declares `sortable` gets a btree index — composite with `id` where the sort is the pagination key, so the tiebreaker is served by the same index. Every column reachable through `q` gets a **`pg_trgm` GIN index**, the extension installed by its own migration exactly as `citext` is by `0000_citext.sql`: one place, every environment, `IF NOT EXISTS`.

The rule going forward is the point, not the backfill:

> **A column enters a `sortable`, `filterable` or searchable allow-list only with its index in the same step.**

It is checked rather than remembered. Each module's unit tier asserts its allow-lists against the schema's declared indexes — the repository's `ColumnMap` and search columns on one side, the table's index declarations on the other, read from the same `@repo/db` objects both already import. Keep it simple: a set comparison naming the columns that claim an order nothing serves, not a query planner in a test.

### 4. The missing indexes

Added with the rest: a **partial** index on `sessions (impersonated_by_staff_id) where impersonated_by_staff_id is not null` — the column is null on every ordinary session, so the partial form indexes the rows the query is about and nothing else — and on `audit_events` both `(acting_as_type, acting_as_id, occurred_at)` and `(occurred_at)`.

### 5. Migration hygiene

Two rules, and `/db-schema-change` carries them:

- **An enum `ADD VALUE` and its first use are separate migrations.** One transaction cannot add an enum label and then write it; the migration that adds the value ships alone.
- **An index on a table expected to be large is written down as blocking.** The migrator's single transaction rules out `CREATE INDEX CONCURRENTLY`, so the choice is made explicitly per index and recorded in the migration's comment. Document it now — every table in this blueprint is small — and revisit the migrator's shape when a real deployment has a table that cannot take the lock.

## Consequences

- A forked project inherits lists that stay bounded as its tables grow: no unbounded deep page, a count it can decline, and no advertised sort that turns into a sequential scan.
- `pg_trgm` becomes a required extension alongside `citext`, so the same `CREATE EXTENSION` privilege the blueprint already needs covers it.
- Write cost rises with every new index — accepted deliberately: these tables are read far more than they are written, and the alternative is an allow-list that lies.
- The allow-list/index test is one more thing a new module must write; the generators of [ADR-0063](0063-typed-resource-configs-and-generators.md) emit it, which is where a per-module discipline stops depending on memory.
- Keyset pagination stays a known, named, unbuilt successor rather than a surprise.

## Alternatives considered

- **Cursor pagination now.** The right end state, the wrong deliverable: it changes the contract, both grids, the codec and the Postman collection at once, for tables no project on this blueprint has yet filled.
- **Prefix search (`term%`) so a btree index serves `q`.** Cheap and wrong for the actual question — "find the account by part of an email" is what an operator types, and prefix matching answers it with nothing.
- **Cap `offset` and stop there.** Leaves the mandatory count and the unindexed sorts, which are the two costs that grow with the table rather than with the request.
- **A window-function count (`count(*) over()`).** Rejected once already at ADR-0014's step-9 amendment, and rejected again: it makes every page pay for the total instead of letting the caller decline it.
