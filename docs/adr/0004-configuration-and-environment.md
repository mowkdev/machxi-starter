# ADR-0004: Configuration and environment validation

- Status: accepted
- Date: 2026-08-17

## Context

Configuration must be sourced from environment variables (12-factor), shared between the API, the db tooling (`drizzle-kit`, seeds) and Docker Compose, and must fail loudly when incomplete rather than at first use deep in a request.

## Decision

- Environment variables are the only configuration source at runtime. Local development loads them from `.env` files; production injects them.
- **One typed config object per process**, built once at startup with a `zod` schema and frozen. Nothing reads `process.env` outside `core/config` — except the database tooling, which cannot use it (below).

```ts
// apps/api/src/core/config/schema.ts
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  APP_VERSION: z.string().default('0.0.0'),   // injected at build; falls back to package.json version
  GIT_SHA: z.string().optional(),
  TRUST_PROXY: z.string().default('false'),   // express 'trust proxy' value: 'false' | 'true' | number | cidr list
  DATABASE_URL: z.string().url(),            // postgres://user:pass@host:5432/db
  DB_POOL_MAX: z.coerce.number().int().default(10),
  DB_CONNECT_RETRIES: z.coerce.number().int().default(10),
  JWT_ISSUER: z.string().default('machxi-api'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),          // parsed with `ms`-style durations
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  REFRESH_ROTATION_GRACE_SEC: z.coerce.number().int().default(30),
  ARGON2_MEMORY_KIB: z.coerce.number().int().default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().default(1),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().default(300),   // per 15 min per IP
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().default(10),
  CORS_ORIGINS: z.string().transform(s => s.split(',').map(x => x.trim()).filter(Boolean)).default(''),
  FEATURE_USER_REGISTRATION: z.stringbool().default(true),      // POST /public/auth/register
  SEED_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
});
// tooling-only (not part of the api schema): DATABASE_URL_TEST (vitest globalSetup), POSTGRES_* (compose)
export type Env = z.infer<typeof envSchema>;
```

`loadConfig()` parses `process.env`, and on failure prints every offending key (never the values) and exits with code 1.

**Amended 2026-08-18 (step 6).** The one reader outside `core/config` is **`packages/db/src/tooling/env.ts`**. `drizzle.config.ts`, `src/migrate.ts`, `src/reset.ts` and `seeds/run.ts` run as CLI scripts with no API process around them, so `loadConfig()` is not available to them; this ADR previously permitted `drizzle.config.ts` and the seed runner to read the environment ad hoc, and naming a single module instead is stricter — it is what gives ADR-0008's "print the target, never the credentials" rule one implementation (`describeTarget`), and it keeps `dotenv` off the library surface, so `import '@repo/db'` reads nothing. It also enforces the constraints this schema declares for variables the API never sees: `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` are validated there (format, `min(12)`), because a seeder that bypassed `core/config` would otherwise create a super admin with a four-character password. The lint rule is `no-restricted-properties` on `process.env`, allowed in those two locations only.

**Amended 2026-08-18 (step 7):** a third, narrower exemption —
**`apps/api/test/setup/env.ts`**, the integration harness. It is outside `src/`
and is not the application: it loads `apps/api/.env.test` and derives
`DATABASE_URL` from `DATABASE_URL_TEST` so that the suite has no way to reach the
development database. The API lint rule is scoped to `apps/api/src/**`, which is
what leaves the harness outside it; the rule that matters for the deliverable is
the one in ADR-0021's definition of done — no `process.env` outside `core/config`
in `apps/api/src`.

**Amended 2026-08-18 (step 5).** Boolean variables use `z.stringbool()`, not `z.coerce.boolean()`. `z.coerce.boolean()` is `Boolean(value)`, and every environment variable is a string, so `FEATURE_USER_REGISTRATION=false` parsed to `true` — the flag could never be turned off, and only an *empty* value (`FEATURE_USER_REGISTRATION=`) produced `false`, which is the opposite of what a reader expects. `z.stringbool()` (zod 4, already pinned by `@repo/contracts` per ADR-0023) accepts `true/false`, `1/0`, `yes/no`, `on/off` and rejects anything else, so a typo fails startup instead of silently enabling the feature. The same rule applies to any boolean variable added later.

- The config object is grouped, not flat, when handed to the app:

```ts
{ env, http: { port, corsOrigins }, db: { url, poolMax }, auth: { accessSecret, accessTtl, refreshTtl }, log: { level } }
```

- **File layout**

```
.env.example            # root: documented, committed; every variable, safe defaults
.env                    # root: local, git-ignored — used by docker compose AND by the api / db tooling
apps/api/.env.test      # committed; test DB URL and dummy secrets for the vitest integration run
```

`DATABASE_URL_TEST` appears in both the root `.env` and `apps/api/.env.test`, so
precedence is fixed here (added 2026-08-18, step 5): **`apps/api/.env.test` wins for
the vitest run** — it is the file the integration `globalSetup` loads (ADR-0021), it is
committed, and it is what CI gets. The root value exists so ad-hoc tooling (`psql`, a
one-off migrate against the test DB) has the URL without loading a second file. Keep
them pointing at the same database; if they disagree, the test run follows `.env.test`.

**Amended 2026-08-18 (step 7).** `apps/api/.env.test` carries `DATABASE_URL_TEST`
and **not** `DATABASE_URL`: the test setup file derives the second from the first
and overwrites whatever the environment held. The direction is the point — a
developer whose shell exports `DATABASE_URL` for `psql`, or a CI job that exports
it for a deploy step, must not have the integration suite migrate and truncate
that database. With one URL in the file there is nothing to keep in sync, and the
only database the vitest process can reach is the test one. The file is loaded by
both the `globalSetup` process and each forked worker, because with
`pool: 'forks'` they are separate processes and inheriting a mutated
`process.env` from the parent is a vitest implementation detail, not a contract.

A single root `.env` avoids duplicating DB credentials between Docker Compose (which reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`) and the API (`DATABASE_URL`). `.env.example` shows both and how they line up:

```
POSTGRES_USER=machxi
POSTGRES_PASSWORD=machxi
POSTGRES_DB=machxi
POSTGRES_PORT=5432
DATABASE_URL=postgres://machxi:machxi@localhost:5432/machxi
DATABASE_URL_TEST=postgres://machxi:machxi@localhost:5432/machxi_test
```

- Loading: `tsx --env-file=../../.env` (Node's native `--env-file`) in the `dev` script; `drizzle.config.ts` and seed scripts load the same file with `dotenv`. No `dotenv` in production builds.
- Turbo: variables that affect build outputs are declared in `turbo.json` `env`/`globalEnv`; `.env*` are already in `build.inputs`.

**Amended 2026-08-18 (step 7), five points the schema above settled in code:**

- **`NODE_ENV` has no default.** The schema above wrote
  `.default('development')`; the implementation requires it, because every
  production guard below — and `error.debug` in the error middleware (ADR-0013)
  — branches on this one value. A default of `development` means a deployment
  that simply never sets the variable (a Dockerfile, a systemd unit, a PaaS that
  injects only secrets) silently accepts the committed signing key, accepts `*`
  as a CORS origin, and returns stack traces to clients — without anyone ever
  typing "development". The general rule this fixes: **permissive behaviour must
  be asked for explicitly; an absent or unrecognised environment is a startup
  failure.** Every env file in the repository already sets it, so nothing local
  changes.
- **Committed signing keys are enumerated, not compared one at a time.**
  `KNOWN_PUBLIC_SECRETS` holds the value in `.env.example` *and* the one in
  `apps/api/.env.test`, and production startup refuses any of them. The test key
  is 45 characters and just as public as the placeholder, and `.env.test` is the
  file someone copies when they want something that already runs. A unit test
  reads both files and asserts each value appears in the list, so a third dummy
  key cannot be added without being listed.
- **`TRUST_PROXY=true` is refused in production.** Express then takes the
  left-most `X-Forwarded-For` entry verbatim, which makes `req.ip`
  attacker-controlled — and with it the login rate limit keyed on IP+email and
  the session audit trail (ADR-0020). A hop count, a CIDR list or `loopback` is
  what a real deployment behind a load balancer wants; `.env.example` documents
  the difference.

- **Two of the constraints are cross-field, and live in `.refine()`, not in a
  field.** With `NODE_ENV=production` the schema rejects the `JWT_ACCESS_SECRET`
  committed in `.env.example` — it is 41 characters, so `min(32)` alone would let
  a signing key that is public in the repository mint access tokens for a
  deployment — and it rejects `*` in `CORS_ORIGINS` (ADR-0020). Neither can be
  expressed as a field rule, because both are only violations in one environment.
- **`SEED_SUPER_ADMIN_*` are validated here but deliberately absent from
  `AppConfig`.** The API never uses them; only the seed runner does (ADR-0008),
  which validates them again where it reads them. Parsing them here turns a
  deployment with unusable seed credentials into a startup failure, and dropping
  them from the grouped object means nothing in the request path can reach a
  credential it has no business holding — including anything that logs the
  config.
- **`turbo.json` declares no build variables, because there are none.**
  `tsdown` performs no `define` substitution, so not even `APP_VERSION` or
  `GIT_SHA` is baked into `dist/main.js` — every variable in this schema is read
  at boot by `core/config` and belongs to the deployment environment, not to
  turbo's cache key. (If a build ever *does* inject one, the `define` and the
  `build.env` entry are added together, or the declaration is a claim the build
  does not honour.) `test:int` declares `DATABASE_URL` / `DATABASE_URL_TEST`,
  which is what keeps the `turbo/no-undeclared-env-vars` lint rule satisfied for
  the test harness.
- Secrets never go into logs (ADR-0005 redaction) or ADRs.

## Consequences

- Misconfiguration is caught before the HTTP server binds.
- Type-safe access (`config.auth.accessTtl`) across the code base; tests can construct a config object directly.
- Adding a variable is a three-place change: schema, `.env.example`, deployment secret store.

## Alternatives considered

- `convict` / `env-var` / `envalid`: fine, but `zod` is already the validation library (ADR-0011) — one tool.
- Reading `process.env` ad hoc: untyped, silent defaults, hard to test.
- Per-app `.env` files only: duplicates DB credentials with Docker Compose and drifts.
