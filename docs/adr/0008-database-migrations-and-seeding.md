# ADR-0008: Database migrations, setup and seeding

- Status: accepted
- Date: 2026-08-17

## Context

We need a repeatable way to (a) bring an empty Postgres to the current schema, (b) seed initial data — at minimum one super admin staff account and reference data such as roles — and (c) do both in local dev, CI and deployed environments. Seeding must be idempotent, must not bake credentials into the repo, and must be clearly separated from application code.

## Decision

### Migrations

- Schema source of truth is `packages/db/src/schema` (ADR-0006). Migrations are generated with `drizzle-kit generate` into `packages/db/migrations/` and **committed**.
- Migrations are applied programmatically with Drizzle's `migrate()` from a small script `packages/db/src/migrate.ts` (not `drizzle-kit push`, which is for prototyping and is disallowed outside a developer's scratch DB).
- Drizzle's migration journal table (`__drizzle_migrations`) is the applied-state record.
- Migration `0000` is a custom migration containing `CREATE EXTENSION IF NOT EXISTS citext;` (requires a role with `CREATE` on the database — true for the compose superuser and for CI; in managed environments the extension is pre-created by the DBA and the statement is a no-op).
- Migration files are edited never; a wrong migration is fixed by a new one. Hand-written SQL (data backfills, complex indexes) goes in a `drizzle-kit generate --custom` migration.
- Scripts (in `packages/db/package.json`, aliased at root via Turbo):

| script | purpose |
|---|---|
| `db:generate` | diff schema → new SQL migration |
| `db:migrate` | apply pending migrations to `DATABASE_URL` |
| `db:seed` | run seeders (below) |
| `db:setup` | `db:migrate` + `db:seed` — first-run helper |
| `db:reset` | drop & recreate schema `public`, then `db:setup` — local only, guarded by `NODE_ENV !== 'production'` |
| `db:studio` | drizzle studio |

Turbo marks these `cache: false`.

- The API does **not** auto-migrate on boot. Migrations are an explicit deploy step (or CI job). The API only verifies connectivity (ADR-0003). This keeps startup deterministic and avoids concurrent-migration races across replicas.

### Seeding

```
packages/db/seeds/
├── run.ts              # runner: parse args, open db, run seeders in order, close
├── seeders/
│   └── 001-super-admin.ts   # roles are Postgres enums (ADR-0017), so no role reference rows to seed in v1
└── dev/                     # optional dev-only fixtures, run with --dev
    ├── 101-dev-staff.ts     # manager + editor staff with known passwords
    └── 102-dev-users.ts     # a few customer users with known passwords
```

- A seeder is `{ name: string; run(ctx: SeedContext): Promise<void> }` where `SeedContext = { db, log, env }`.
- **Idempotent by construction**: every seeder uses `insert … on conflict do nothing` / upsert on a natural key (staff/user `email`). Running `db:seed` twice is safe.
- **Super admin** is created from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` (ADR-0004). If the variables are absent the seeder logs a warning and skips — no hard-coded fallback credentials. Password is hashed with the same `PasswordHasher` the API uses (`createArgon2Hasher` from `@repo/crypto`, ADR-0018) so the algorithm never diverges. The seeder assigns the `super_admin` staff role and marks the account active.
- Seeders are ordered by filename prefix; the runner logs each seeder's outcome.
- `--dev` flag adds fixture seeders (a manager staff, a customer user with a known password) for local testing and the Postman collection; never run in production.
- Seeds are not tracked in a journal (they are idempotent), which keeps "re-seed after changing reference data" a single command.

### Environment guardrails

- `db:reset` and `--dev` seeding refuse to run when `NODE_ENV=production`.
- Every db script prints the target host/db name (never credentials) before acting.

## Consequences

- First run: `pnpm docker:up && pnpm db:setup && pnpm dev` yields a schema and a login-able super admin.
- Reference data lives in code and is versioned with the schema (roles are enums today; a roles table would get its own seeder).
- Password hashing lives in a shared place so seed and API agree.

## Alternatives considered

- Auto-migrate on API start: convenient, unsafe with multiple instances, mixes concerns.
- `drizzle-kit push` for everything: no reviewable history.
- SQL-file seeds in `docker-entrypoint-initdb.d`: run only on first container start, cannot hash passwords with the app's algorithm, not usable in deployed environments.
- Seed journal table: unnecessary while seeders are idempotent.
