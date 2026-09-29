# ADR-0060: List endpoints at scale (supersedes ADR-0014 in part — a delta)

- Status: superseded by [ADR-0078](0078-backend-closing-wave.md) (delta: §5's second rule — an index on a large table may be built concurrently, in a migration file marked for the runner's second lane; the enum rule and everything else stand)
- Date: 2026-09-02
- Supersedes (**landed at `D14.5`** 2026-09-03, the step that builds every section of this record): [ADR-0014](0014-pagination-filtering-sorting.md) (delta: `offset` gains a ceiling, the language gains a `count` flag, and the allow-list/index claim becomes a checked rule; every other pagination, filtering and sorting decision stands)

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; **accepted 2026-09-03 at the head of `D14.5`**, the step that builds it. Amendable in place, labelled, while D14 is `in progress` (ADR-0025 rule 2).
>
> **Amended 2026-09-03 (D14.5)**, five times, each labelled where it applies: the header's parent list, which claimed [ADR-0006](0006-database-postgres-drizzle.md) as a second parent it does not touch; §1 on the status the ordinary validation path actually answers with; §2 on what declining the count costs a grid; §3 on the operator class a `citext` column needs before a `pg_trgm` index can serve it, and on the second query path that needs the same cast; and §5 on what those two rules are to [ADR-0008](0008-database-migrations-and-seeding.md).
>
> **Amended 2026-09-03 (D14.5) — one parent, not two.** The title written by `/scope` claimed "supersedes ADR-0014 and ADR-0006 in part". ADR-0006 chose Postgres, Drizzle over postgres.js, the `@repo/db` package, snake_case casing, UUIDv7 primary keys, the executor-taking repository and the no-singleton client; **this record touches none of them** — its one sentence about indexes ("UUIDv7 … time-ordered, index-friendly") is a property of the key, not a decision about which columns are indexed. The parent list is reconciled to the one record that really moves, which is the same correction [ADR-0059](0059-ci-containers-and-deployment.md) took at `D14.3`'s head and the reading [ADR-0030](0030-csrf-bootstrap-endpoint.md) got at `D12.12`: restating a decision, or standing near one, is not making it.

> **Superseded in part 2026-09-30 by [ADR-0078](0078-backend-closing-wave.md)**, at the head of `D29.1`, the step that makes the delta true. A delta supersession under [ADR-0050](0050-adr-lifecycle-and-verification.md), on one rule: §5 said the migrator's single transaction rules out `CREATE INDEX CONCURRENTLY`, so an index on a large table is written down as blocking. The runner now has a second lane — a file whose first line is `-- migrate:concurrently` runs each statement on its own, outside any transaction, and is recorded when the last succeeds — so a concurrent build is available and the choice between it and a blocking one is still made per index and stated in the migration. §5's enum rule, §1–§4 and the session prune stand and are in force as part of 0078.

## Context

[ADR-0014](0014-pagination-filtering-sorting.md) (pagination, filtering and sorting conventions) chose offset pagination and an allow-list per endpoint, and it holds — every list in the repository speaks one query language, and the codec in `@repo/contracts` writes it for the URL and the wire alike. What it did not do is bound the cost of the query it authorises, and a blueprint is forked into projects with tables the seed data cannot imagine.

Four things are loose. **`offset` has a floor and no ceiling** — `limit` is capped at 100 in `listQuerySchema`, `offset` carries only `.min(0)`, so `?offset=50000000` is a legal request that Postgres answers by walking fifty million rows. **Every list runs a mandatory `COUNT(*)`** over the same predicate as the page (the second query in `usersRepository.list` and its staff mirror), even where nobody is reading the number — while `Page.total` has been typed `number | null` since D1.4 and ADR-0014 §Consequences already reserved the "very large tables may switch to `total: null`" branch, which nothing has ever been able to take. **The allow-lists outrun the indexes**: the users list maps eight columns for sorting and filtering, staff its own set, and `q` searches with `ilike '%term%'` across email and both name columns, while the schema ships one non-unique index per table beyond the unique ones — `users_created_at_idx`, `staff_created_at_idx` and the two role indexes. ADR-0014 §Consequences claims "allow-listing prevents sorting/filtering on non-indexed columns"; it is the one sentence in that record the schema does not back, because nothing joins the two lists. And **two indexes the last deliverable needed were never added**: `sessions.impersonated_by_staff_id` ([ADR-0057](0057-impersonation-sessions.md)) has none although `revokeAllImpersonatedBy` filters on exactly it, and `audit_events` ([ADR-0058](0058-append-only-audit-log.md)) indexes the actor and the event but not `(acting_as_type, acting_as_id, occurred_at)` — "everything done to this customer", the question an incident asks second — nor `occurred_at` alone, which a retention job would scan.

There is also a migration hazard the current shape hides. `migrate()` applies every pending migration in one transaction, so a batch that runs `ALTER TYPE … ADD VALUE` and then uses the new value fails on a fresh database while passing on an incrementally-migrated one — green locally, red in CI and on a new deployment. The same transaction makes `CREATE INDEX CONCURRENTLY` impossible, which is the tool a large table needs.

## Decision

### 1. Bound `offset`; name keyset as the successor without adopting it

`offset` takes `.max(10_000)` in `listQuerySchema` beside `limit`'s existing ceiling. Beyond it the API answers through the ordinary validation path (ADR-0011) — a bound, spelled like every other bound, with no special case in a controller.

**Amended 2026-09-03 (D14.5) — `400`, not the `422` written here.** [ADR-0013](0013-error-model.md) gives `VALIDATION_ERROR` the status `400` and every zod failure in this API has answered `400` since D1.7; `?limit=101` and `?offset=-1` both do, and they are the two bounds this one is spelled like. Naming a status the ordinary path does not use would have made the sentence contradict itself — the point of the decision is that there is no special case, and a special case is the only way `422` could have happened.

**Cursor pagination is deliberately not adopted now.** The successor, when a list is expected to exceed a few hundred thousand rows, is **keyset pagination on `(sort key, id)`** — the tiebreaker `applyListQuery` already appends is exactly the second half of that key. It is a contract change, not an implementation detail: it touches the query language, the codec, both grids' pagers, and Postman, so it is a deliberable of its own and this record names it rather than half-building it.

### 2. `count=false`

The list-query language gains one flag: `count` (boolean, default `true`). `count=false` skips the aggregate and returns `total: null`, which the envelope has always allowed and `GridPager` has always handled — `total === null` is its open-ended branch, with no last-page jump and a range instead of a count. The codec in `@repo/contracts` learns the flag with the rest of the language, so the URL, the wire and the API's own parser stay one grammar.

The default stays `true`: an admin grid wants its page count, and an endpoint that becomes expensive opts out at the call site that knows it has.

**Amended 2026-09-03 (D14.5) — declining the count also declines the stranded-offset repair.** `AppGrid`'s `isStranded` (`@repo/grid`) asks whether the requested offset is past `total`, and navigates to the last page that holds a row when it is; with `total: null` it cannot ask, so a deep link past the end shows an empty page and stays there. That is a real consequence of this flag rather than a defect in the grid — there is no last page to jump to when nobody counted, which is the same reason the pager's jump-to-last is disabled in that branch. A surface that sets `count=false` accepts it, and no surface in this repository sets the flag today.

### 3. An index for every column the allow-lists admit

Every column a repository declares `sortable` gets a btree index — composite with `id` where the sort is the pagination key, so the tiebreaker is served by the same index. Every column reachable through `q` gets a **`pg_trgm` GIN index**, the extension installed by its own migration exactly as `citext` is by `0000_citext.sql`: one place, every environment, `IF NOT EXISTS`.

**Amended 2026-09-03 (D14.5) — the search condition casts to `text`, because a `citext` column's `ILIKE` is not the one the index serves.** Measured on the PostgreSQL 16 this repository runs, not reasoned: a GIN `gin_trgm_ops` index *creates* on a `citext` column (the type is binary-coercible to `text`, so the named operator class is accepted), but `email ilike '%term%'` resolves to citext's own `~~*` operator, which is in no `pg_trgm` operator family — `EXPLAIN` shows a sequential scan even with `enable_seqscan=off`. The same index is used the moment the query says `email::text ilike '%term%'`. So `toSearchCondition` casts **every** searched column to `text`: on a `text` column the cast parses away to the bare column and the plain index still matches, and on a `citext` column it is what makes the index reachable at all. The index declarations stay on the columns themselves; it is the query that had to change. An index that cannot be used is the same lie as an allow-list without an index, which is what this record exists to end.

The cast belongs to **both** paths that reach those indexes: `q` and the `like` filter operator. `email` is `filterable` with `like` on each endpoint, so `filter[email][like]=%40acme.com` is the same query in the same place, and leaving it uncast would have fixed the search and left the filter reading the table.

The rule going forward is the point, not the backfill:

> **A column enters a `sortable`, `filterable` or searchable allow-list only with its index in the same step.**

It is checked rather than remembered. Each module's unit tier asserts its allow-lists against the schema's declared indexes — the repository's `ColumnMap` and search columns on one side, the table's index declarations on the other, read from the same `@repo/db` objects both already import. Keep it simple: a set comparison naming the columns that claim an order nothing serves, not a query planner in a test.

### 4. The missing indexes

Added with the rest: a **partial** index on `sessions (impersonated_by_staff_id) where impersonated_by_staff_id is not null` — the column is null on every ordinary session, so the partial form indexes the rows the query is about and nothing else — and on `audit_events` both `(acting_as_type, acting_as_id, occurred_at)` and `(occurred_at)`.

### 5. Migration hygiene

Two rules, and `/db-schema-change` carries them:

- **An enum `ADD VALUE` and its first use are separate migrations.** One transaction cannot add an enum label and then write it; the migration that adds the value ships alone.
- **An index on a table expected to be large is written down as blocking.** The migrator's single transaction rules out `CREATE INDEX CONCURRENTLY`, so the choice is made explicitly per index and recorded in the migration's comment. Document it now — every table in this blueprint is small — and revisit the migrator's shape when a real deployment has a table that cannot take the lock.

**Amended 2026-09-03 (D14.5) — these two rules are additive to [ADR-0008](0008-database-migrations-and-seeding.md), not a supersession of it.** 0008 decides where migrations come from, that they are committed, that they are never edited, and that hand-written SQL goes in a `--custom` migration; it says nothing about enum labels or about lock behaviour, so nothing here diverges from it — these rules fill a silence. `pg_trgm` joins `citext` as a required extension by that record's own custom-migration path rather than against it. The [ADR-0058](0058-append-only-audit-log.md) precedent: additive supersedes nothing, and 0008 keeps the two partial successors it already has.

### The session prune, batched

`packages/db/src/prune-sessions.ts` deletes every expired row in one statement and `returning`s each id to count them — every deleted id in memory, one lock for the whole set. It becomes a loop of bounded batches (`delete … where id in (select id … limit N)`, counting rows affected), so a table that has never been pruned is pruned in bounded steps rather than in one transaction that grows with the backlog. The pool options that make a runaway statement fail rather than hold a connection — `statement_timeout`, `idle_in_transaction_session_timeout`, `application_name`, and the prepared-statements switch — are ADR-0061's, beside the roles they protect.

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
