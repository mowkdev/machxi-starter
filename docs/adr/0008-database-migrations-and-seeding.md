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

| script        | purpose                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `db:generate` | diff schema → new SQL migration                                                                                                  |
| `db:migrate`  | apply pending migrations to `DATABASE_URL`; `-- --test` targets `DATABASE_URL_TEST` instead                                      |
| `db:seed`     | run seeders (below)                                                                                                              |
| `db:setup`    | `db:migrate` + `db:seed` — first-run helper                                                                                      |
| `db:reset`    | drop schemas `public` **and `drizzle`**, recreate `public`, then `db:setup` — local only, guarded by `NODE_ENV !== 'production'` |
| `db:studio`   | drizzle studio                                                                                                                   |

Turbo marks these `cache: false`.

`db:reset` has to drop the `drizzle` schema too, not only `public`: that is where
Drizzle keeps `__drizzle_migrations`. Dropping `public` alone leaves the journal
claiming every migration is applied, so the next `db:migrate` reports "up to date"
against an empty database and the failure surfaces at the first query instead.

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

- A seeder is `{ name: string; run(ctx: SeedContext): Promise<void> }` where `SeedContext = { db, hasher, log, env }`. **Amended 2026-08-18 (step 6):** `hasher` was added. It is built once by the runner from the `ARGON2_*` variables and handed to every seeder, rather than constructed per seeder — the seeded password must verify against the parameters the API uses (ADR-0018 §Password hashing), and one hasher per run is what makes that structurally true instead of a convention.
- **Idempotent by construction**: every seeder uses `insert … on conflict do nothing` / upsert on a natural key (staff/user `email`). Running `db:seed` twice is safe.
- **Super admin** is created from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` (ADR-0004). If the variables are absent the seeder logs a warning and skips — no hard-coded fallback credentials. Password is hashed with the same `PasswordHasher` the API uses (`createArgon2Hasher` from `@repo/crypto`, ADR-0018) so the algorithm never diverges. The seeder assigns the `super_admin` staff role and marks the account active.
- Seeders are ordered by filename prefix; the runner logs each seeder's outcome.
- `--dev` flag adds fixture seeders (a manager staff, a customer user with a known password) for local testing and the Postman collection; never run in production.
- Seeds are not tracked in a journal (they are idempotent), which keeps "re-seed after changing reference data" a single command.

### Environment guardrails

- `db:reset` and `--dev` seeding refuse to run when `NODE_ENV=production`.
- Every db script prints the target host/db name (never credentials) before acting. The rendering is built by parsing the URL and re-emitting `host:port/database`, not by masking the original string — a substitution-based redaction fails on the password that happens to equal the host name — and an unparsable connection string is not echoed at all.
- **Amended 2026-08-18 (step 6):** one narrow carve-out to "never credentials". The `--dev` seeders print the fixture password, which is a constant in a committed file (`seeds/dev/fixtures.ts`) behind the production refusal, so that a first run tells the developer how to sign in. **No value read from the environment is ever printed**, and that is the rule the carve-out does not touch.
- Anything read from the environment is validated where it is read, because the seed path never passes through `core/config`: `SEED_SUPER_ADMIN_EMAIL` must look like an address and `SEED_SUPER_ADMIN_PASSWORD` must meet ADR-0004's `min(12)`, or the script fails instead of seeding an unusable or weak super admin.
- A helper that resets a database for tests refuses any target whose name does not end in `_test`. **Amended 2026-08-18 (step 7):** that helper is `migrateFreshDatabase(url)` in `packages/db/src/testing.ts`, published as **`@repo/db/testing`** so this package's own suite and the API's integration `globalSetup` (ADR-0021) share one implementation instead of a copy free to drift from the committed migrations. It is a separate subpath rather than part of the package root because it is destructive and nothing that merely imports `@repo/db` should be able to reach it. It carries **both** guards — the `_test` suffix _and_ the `NODE_ENV=production` refusal that `db:reset`'s CLI wrapper has — because it exists to be called from a test harness whose URL comes from the environment, and a database called `app_test` on a production host passes the suffix check on its own. `resetSchema()` takes whatever URL it is given and the `NODE_ENV` guard lives in the CLI wrapper, so the integration suite — which calls the function directly — carries its own check; a `DATABASE_URL_TEST` copy-pasted from `DATABASE_URL` is the realistic way to drop a developer's dev schema.

**Amended 2026-08-18 (step 8).** Three additions, all in service of ADR-0021's
"tests exercise the real seed path".

- **`truncateAll(db)` joins `@repo/db/testing`.** It empties every application
  table between integration files. It carries the `NODE_ENV=production`
  refusal for the same reason `migrateFreshDatabase` does — more so, in fact:
  it takes a _DbExecutor_, so there is no URL to apply the `_test`-suffix rule
  to, and the production refusal is the only guard available. The truncated
  tables are an explicit list rather than a query over `information_schema`,
  which would also wipe Drizzle's migration journal.
- **`@repo/db/seeds` is a new subpath**, exporting `runSeeders`, `baseSeeders`
  and `devSeeders` so the API's integration suite runs the same seeders
  `pnpm db:seed` does instead of test-only inserts. It is _not_ as dangerous as
  `@repo/db/testing` — seeders are idempotent and create rather than destroy —
  but it does expose `devSeeders`, whose production refusal lives in
  `selectSeeders` (the CLI path). A caller that assembles its own list, as the
  test harness does, is responsible for not doing that in production; the
  harness passes `nodeEnv: "test"` explicitly and says so.
- **`SEED_SUPER_ADMIN_PASSWORD` is refused in production when it is one of the
  values committed to this repository** (`.env.example`, `apps/api/.env.test`),
  enforced in `tooling/env.ts` because the seed runner never passes through
  `core/config`. See ADR-0004 and ADR-0020 §Known-public secrets: the account
  this seeder creates holds `super_admin`, so a committed password reaching
  production is worse than a committed signing key, not better.
- **`db:sessions:prune`** (ADR-0018 §Cleanup) is declared in this package,
  deleting sessions expired or revoked more than 30 days ago. Unlike `db:reset`
  and `db:seed --dev` it is **not** refused in production — pruning is what a
  production database needs, and it can only remove rows that are already
  unusable.

## Consequences

- First run: `pnpm docker:up && pnpm db:setup && pnpm dev` yields a schema and a login-able super admin.
- Reference data lives in code and is versioned with the schema (roles are enums today; a roles table would get its own seeder).
- Password hashing lives in a shared place so seed and API agree.

## Alternatives considered

- Auto-migrate on API start: convenient, unsafe with multiple instances, mixes concerns.
- `drizzle-kit push` for everything: no reviewable history.
- SQL-file seeds in `docker-entrypoint-initdb.d`: run only on first container start, cannot hash passwords with the app's algorithm, not usable in deployed environments.
- Seed journal table: unnecessary while seeders are idempotent.
