# ADR-0061: Database roles and append-only enforcement

- Status: proposed
- Date: 2026-09-02
- Supersedes: [ADR-0058](0058-append-only-audit-log.md) (delta: append-only gains database enforcement beside the rule of the code; the table, the writer, the two write disciplines and the no-read-surface decision stand); [ADR-0006](0006-database-postgres-drizzle.md) (delta: which role the API connects as, and three more pool options); [ADR-0007](0007-local-development-docker.md) and [ADR-0008](0008-database-migrations-and-seeding.md) (delta: the local init creates two roles, and the tooling connection is the owner's while the API's is not)

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; accepted at the head of the step that builds it.

## Context

The API connects to Postgres as the compose superuser — `.env.example` seeds `POSTGRES_USER=machxi` and hands the same role to `DATABASE_URL`, so the process that serves anonymous login attempts can `DROP TABLE`, `ALTER TYPE` and read anything. Nothing in the repository has needed that until now, because nothing depended on the database refusing the application anything.

Two things now do. [ADR-0058](0058-append-only-audit-log.md) makes `audit_events` append-only and enforces it entirely in code: the repository exposes an insert and no update path, and `packages/config-eslint/api.js` bans the table's import everywhere but `core/audit/audit.repository.ts`. That is a good rule and it stops a colleague; it does not stop a SQL injection, a `db:studio` session, a hand-written maintenance script, or a future repository written by someone who deletes a lint rule they find inconvenient. Migration `0006_audit_events.sql` creates the table with no trigger and no grant — the immutability is a sentence in a document. And the organizations record planned for D15 (ADR-0067) designs row-level security in, which a superuser or a table owner bypasses by definition: connecting as a non-owner is the precondition, and it is cheaper to establish before there are policies than after.

The pool is thin in the same direction. `packages/db/src/client.ts` passes `max`, `idle_timeout`, `connect_timeout`, `prepare` and `onnotice`; there is no `statement_timeout`, no `idle_in_transaction_session_timeout` and no `application_name`, so one pathological query holds a connection until the driver gives up and no `pg_stat_activity` row says which process owns it. `noPreparedStatements` exists as an option with no call site and no variable behind it, which means the transaction-mode pooler it was written for cannot actually be used.

## Decision

### 1. Two roles: an owner and an application

The owner role runs DDL — migrations, seeds, `drizzle-kit`, `db:reset`, the test harness's `migrateFreshDatabase`. The application role is what the API connects as: `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the tables it needs, `USAGE` on the schema and its sequences, and no DDL, no ownership, no superuser.

```
DATABASE_URL             → the application role (the API; today's default becomes machxi_app)
DATABASE_URL_OWNER       → the owner role (packages/db tooling only)
DATABASE_URL_TEST        → the application role, test database
DATABASE_URL_TEST_OWNER  → the owner role, test database
```

`packages/db/src/tooling/env.ts` is the only reader of the owner variables and requires them — no silent fallback to `DATABASE_URL`, because a fallback is how a deployment ends up migrating as its application role and never finding out. All four are in `.env.example` and in `turbo.json`'s `env` where a task reads them ([ADR-0004](0004-configuration-and-environment.md)). `docker/local/postgres/init` creates both roles and grants them, and the integration harness migrates as the owner and runs the suite as the application role — so the tests execute with exactly the privileges production has, which is the only way a missing grant is ever found by a machine.

### 2. `audit_events` is immutable in the database, twice over

```sql
REVOKE UPDATE, DELETE ON audit_events FROM machxi_app;   -- the API cannot try
CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'audit_events is append-only (ADR-0058, ADR-0061)'; END $$;
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
```

Both, not either. The grant protects the log from the API and from anything that reaches the database through it; the trigger protects it from everyone, the owner connection and a `psql` session included, which is where an accidental `DELETE FROM audit_events WHERE …` actually comes from. Neither replaces [ADR-0058](0058-append-only-audit-log.md)'s code rule — the lint ban keeps a second insert path from being written at all — and the three together are the delta this record takes on that parent.

Retention, if a deployment ever wants it, is the one sanctioned path: a deliberate migration that drops the trigger, deletes, and restores it. Recorded here so that the day someone needs it, the answer is a reviewed migration in `packages/db/migrations/` rather than a quietly loosened trigger.

### 3. The pool states its bounds and its name

`createDb` takes, and `apps/api` passes from validated config, a statement timeout, an idle-in-transaction timeout and an application name (`DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`, `DB_APPLICATION_NAME`, with defaults safe enough that a fresh clone notices nothing). They go through postgres.js's `connection` options, so every session in the pool carries them and no query has to remember. `DB_PREPARED_STATEMENTS` is threaded from `main.ts` into the `noPreparedStatements` option that has been waiting for it, which makes a transaction-mode pooler a configuration change rather than a code change.

### 4. A test that keeps the two hand-maintained lists honest

Two enumerations in this repository must list every table and have no compiler behind them: the import-ban list in `packages/config-eslint/api.js` and `TRUNCATED_TABLES` in `packages/db/src/testing.ts`. A unit test in `packages/db` diffs both against the schema's own table exports and fails naming the missing one. A new table that escapes the first is reachable from any service; one that escapes the second leaks rows between integration files — both are silent, and both are exactly the machine-checkable minutiae [ADR-0050](0050-adr-lifecycle-and-verification.md) says belongs in a test rather than in a record.

## Consequences

- The database stops trusting the application, which is the precondition for row-level security, and the audit log becomes append-only in the only place that can enforce it.
- A fork pays a one-time cost: two more connection strings, a local `docker compose down -v` (the init scripts run once, on first start), and any deployment whose migration job used `DATABASE_URL` has to be pointed at the owner variable.
- A missing grant is a runtime failure in the API and a caught failure in the integration tier — the reason the harness runs as the application role rather than as the owner.
- `statement_timeout` will eventually cancel a legitimate slow query. That is the point; the default is chosen high enough that it means "something is wrong" and the variable exists so a deployment can disagree.
- The audit table can no longer be pruned by a job, only by a migration. Retention stays the unbounded-by-default decision ADR-0058 recorded, now with one documented path out of it.

## Alternatives considered

- **The trigger alone.** Covers everyone including the owner, and leaves the API holding `DELETE` — so an injection or a stray repository still gets an error rather than a refusal, and RLS stays unreachable. Rejected as half of the answer.
- **The role alone.** Cheaper and blocks the realistic attacker, but leaves the owner connection — the one an operator uses at 3 a.m. — free to rewrite history. Rejected for the same reason.
- **Leave the superuser connection and rely on the lint rule.** Status quo; it is a rule about the code, and the code is not the only thing that reaches the database. Rejected.
- **A separate append-only schema, or logical replication to a write-once store.** Stronger, and a real answer at a scale that has a compliance auditor. Reserved, not adopted: a trigger and a grant get most of the property for two lines of SQL.
- **Discovering the two enumerations from `information_schema` instead of testing them.** Rejected for the reason `TRUNCATED_TABLES` already gives in place: a discovered list would sweep Drizzle's journal table.
