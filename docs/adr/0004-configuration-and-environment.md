# ADR-0004: Configuration and environment validation

- Status: accepted
- Date: 2026-08-17

## Context

Configuration must be sourced from environment variables (12-factor), shared between the API, the db tooling (`drizzle-kit`, seeds) and Docker Compose, and must fail loudly when incomplete rather than at first use deep in a request.

## Decision

- Environment variables are the only configuration source at runtime. Local development loads them from `.env` files; production injects them.
- **One typed config object per process**, built once at startup with a `zod` schema and frozen. Nothing reads `process.env` outside `core/config`.

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
  FEATURE_USER_REGISTRATION: z.coerce.boolean().default(true),  // POST /public/auth/register
  SEED_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
});
// tooling-only (not part of the api schema): DATABASE_URL_TEST (vitest globalSetup), POSTGRES_* (compose)
export type Env = z.infer<typeof envSchema>;
```

`loadConfig()` parses `process.env`, and on failure prints every offending key (never the values) and exits with code 1.

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
- Secrets never go into logs (ADR-0005 redaction) or ADRs.

## Consequences

- Misconfiguration is caught before the HTTP server binds.
- Type-safe access (`config.auth.accessTtl`) across the code base; tests can construct a config object directly.
- Adding a variable is a three-place change: schema, `.env.example`, deployment secret store.

## Alternatives considered

- `convict` / `env-var` / `envalid`: fine, but `zod` is already the validation library (ADR-0011) — one tool.
- Reading `process.env` ad hoc: untyped, silent defaults, hard to test.
- Per-app `.env` files only: duplicates DB credentials with Docker Compose and drifts.
