# ADR-0059: Continuous integration, container images and the reference deployment

- Status: proposed
- Date: 2026-09-02
- Supersedes: [ADR-0008](0008-database-migrations-and-seeding.md) (delta: the migration runner gains a bundled entry point and a real advisory lock; every other migration and seeding decision, including "the API never auto-migrates", stands); [ADR-0004](0004-configuration-and-environment.md) and [ADR-0020](0020-security-baseline.md) (delta: `TRUST_PROXY` must be stated explicitly in production)

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; accepted at the head of the step that builds it. Deltas: ADR-0008 (the migration runner gains a bundled entry and an advisory lock), ADR-0004 and ADR-0020 (trust proxy must be stated in production), ADR-0007 (the local compose is no longer the only compose), ADR-0021 and ADR-0026 (the gate and the browser tier now also run in CI, with the same cache semantics) — the parents stand for everything else.

## Context

There is no `.github`, no `Dockerfile`, no deployment target and no record that decides one — [`README.md`](README.md) §Planned has carried "CI pipeline and deployment" since D1. The five-link gate ([ADR-0052](0052-grid-and-admin-followups.md), grown to five by [ADR-0057](0057-impersonation-sessions.md) §8) is run by a human at the end of every step, which is exactly as reliable as the human. A blueprint whose first fork has to invent its own pipeline, its own images and its own release order has not finished being a blueprint.

Four facts constrain the shape. The API already builds a deployable bundle (`apps/api/tsdown.config.ts`: one ESM `dist/main.js`, `argon2` external because it is a native addon, `pino` external so one copy exists in the process). `packages/db`'s `db:migrate` runs `tsx src/migrate.ts`, so applying a migration in production today means shipping TypeScript source and a TypeScript runtime. `migrate.ts`'s own doc comment claims `migrate()` "takes an advisory lock, so two deploy jobs starting at once do not both apply `0002`" — drizzle's postgres-js migrator takes no such lock, and the comment is the only thing standing between two release jobs and a double-applied migration. And `TRUST_PROXY` defaults to `"false"` with a production refusal of `"true"` only (`apps/api/src/core/config/schema.ts`), so a deployment behind a reverse proxy that simply never sets the variable gives every request the proxy's address: the login limiter, the refresh limiter and the audit trail's `ip` all collapse onto one key, silently, in the permissive direction.

The operator deploys to a VPS running Coolify on Ubuntu. That is an input, not a decision: everything below is platform-neutral, and the vendor lives in prose.

## Decision

### 1. One gate workflow, one nightly browser workflow

```
.github/workflows/
├── gate.yml   # push + pull_request: postgres:16 service, pnpm install --frozen-lockfile,
│              # then lint → check-types → test → size → format:check, in that order
└── e2e.yml    # schedule (nightly) + workflow_dispatch only: pnpm test:e2e
```

The gate workflow runs the documented gate and nothing else — no bespoke CI-only script, so a green pipeline and a green terminal mean the same thing. Its Postgres service is initialised the way `docker/local` initialises the developer's: the `_test` database `docker/local/postgres/init` creates, with extensions left to migration `0000` where [ADR-0007](0007-local-development-docker.md) and [ADR-0008](0008-database-migrations-and-seeding.md) put them.

The browser tier stays out. [ADR-0052](0052-grid-and-admin-followups.md) §The browser tier put `test:e2e` beside the gate and never in it because it needs a running stack and a seeded database; that decision is carried into CI rather than re-litigated by a scheduler.

### 2. `main` is protected

The gate workflow is a required status check on `main` and force-pushes are blocked. Direct pushes by the operator stay allowed: the `/step` loop commits to `main` from an interactive session, and unattended runs already work on a branch and open a PR ([ADR-0050](0050-adr-lifecycle-and-verification.md)). This is a repository setting, not a file — it is recorded here because it is the setting the starter expects, and a fork inherits it by convention.

### 3. Dependencies are proposed weekly, and CI decides

`renovate.json` at the root: minor and patch grouped into one weekly pull request, majors each on their own, lockfile maintenance on. Nothing merges because it is newer — the gate on the PR is the whole argument.

### 4. Container images, platform-neutral

A multi-stage `apps/api/Dockerfile` that installs from the frozen lockfile, runs the workspace build, and ships only the runtime closure (`pnpm deploy --filter api --prod`, or the equivalent that keeps the tsdown constraints true: `argon2`'s native binary and exactly one `pino` must be present in `node_modules`). It runs as a non-root user and declares a `HEALTHCHECK` against `/health/live` — liveness, never readiness, so a database blip does not restart a healthy process ([ADR-0016](0016-health-checks.md)).

One static image per SPA (`apps/admin/Dockerfile`, `apps/customer/Dockerfile`): build `dist/`, serve it with nginx, SPA fallback to `index.html`, and the response headers helmet sends on the API's behalf restated in the server config — the SPA is served by nginx, so nothing in `apps/api` can set them. `VITE_*` values are **build arguments**, because Vite inlines them; an image is therefore built per environment, and that is a property of the tool, not an oversight.

### 5. Migrations ship as a bundle and take a lock

`packages/db` gains a bundled `dist/migrate.js` built the way the API's bundle is built, shipped inside the API image. It takes a `pg_advisory_lock` around the migration run and releases it after, so two release jobs starting at once serialise instead of racing — which is what `migrate.ts`'s comment has claimed since D1 and what this record makes true. The API still never auto-migrates: migrating is a deploy step, and [ADR-0008](0008-database-migrations-and-seeding.md)'s reasoning for that is untouched.

### 6. `docker/prod/compose.yaml` is the reference deployment

```yaml
services:
  migrate: # the API image, command: node dist/migrate.js; restart: "no"
  api: # depends_on: { migrate: { condition: service_completed_successfully } }
  admin: # static image
  customer: # static image
# Postgres and Redis are NOT here: DATABASE_URL and REDIS_URL are injected.
```

The database and Redis are **external**, so a deployment uses its platform's managed resources and keeps their backups, upgrades and monitoring instead of re-implementing them beside a compose volume. `REDIS_URL` is the seam [ADR-0066](0066-infrastructure-seams.md) fills. No vendor file lives in the repository; `docs/deploy.md` walks the Coolify setup end to end — a compose resource pointed at the repository, its managed Postgres and Redis, the domains, the environment, `TRUST_PROXY` set for the proxy hop, and the migrate service as the release gate.

### 7. Production must state its proxy hop

The `TRUST_PROXY` refinement in the config schema refuses `"false"` in production as well as `"true"`. A production deployment states a hop count, a CIDR list or `"loopback"`; the local default stays `"false"`. This is the delta on [ADR-0004](0004-configuration-and-environment.md) and [ADR-0020](0020-security-baseline.md): both already treat `req.ip` as load-bearing, and neither makes a deployment say what it is behind.

## Consequences

- The gate becomes a fact about `main` rather than a habit of the operator, and a fork gets both halves — the pipeline and the images — on day one.
- Two more artefacts to keep honest: the API image must keep satisfying the tsdown constraints (the failure mode is a crash on the first completed request, not a build error), and every new `VITE_*` variable is a build argument in two Dockerfiles.
- Production configuration grows one required variable (`TRUST_PROXY`), and an existing deployment that never set it now fails to start — deliberately, because that is the deployment the refusal is for.
- Rolling back means rolling back the image; it does not mean rolling back a migration, which stays a forward-only, hand-written decision.
- Not decided here: image registry and tagging, secret storage, log shipping, and running the session prune on a schedule ([`README.md`](README.md) §Planned still owns that one).

## Alternatives considered

- **A named platform file** (`fly.toml`, `render.yaml`, a Coolify export). Shorter today, vendor lock a fork may not want, and unreadable as documentation. The compose file plus `docs/deploy.md` says the same thing in a form every platform accepts.
- **Three separate platform apps, each building its own Dockerfile.** The three then version-drift against one another, and migration becomes a per-app pre-deploy command with no ordering guarantee. One compose resource keeps the release atomic.
- **Postgres and Redis inside the production compose.** Forfeits managed backups, restores and upgrades to save one configuration screen. Rejected.
- **E2E on every pull request.** Forty-odd serial browser specs against a seeded stack, on every push, to catch what the nightly catches within a day. Rejected — ADR-0052 already priced it.
- **A pull-request-only flow on `main`.** Correct for a team; for one operator running `/step` it converts every step into ceremony. The protection blocks force-pushes and requires the gate, which is the part that protects the history.
- **Migrate on API boot.** Refused by [ADR-0008](0008-database-migrations-and-seeding.md) and not reopened: startup stays deterministic across replicas.
