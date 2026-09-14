# ADR-0073: Review hardening — per-principal budgets, session caps, budget headroom, pinning and the gate's links (supersedes ADR-0003, 0006, 0018, 0020, 0026, 0059, 0062 and 0071 in part — deltas)

- Status: proposed
- Date: 2026-09-14
- Supersedes: [ADR-0003](0003-api-runtime-express-typescript.md) (delta: the runtime floor moves to Node 24, and the server states its request, header and keep-alive timeouts); [ADR-0006](0006-database-postgres-drizzle.md) as carried by [ADR-0061](0061-database-roles-and-append-only-enforcement.md) (delta: `updated_at` is written by the column's `$onUpdate`, the repositories no longer having to remember); [ADR-0018](0018-authentication-sessions-and-tokens.md) as carried by [ADR-0057](0057-impersonation-sessions.md), [0064](0064-brand-seams.md) and [0071](0071-mail-flows.md) (delta: a principal holds at most `AUTH_MAX_SESSIONS_PER_PRINCIPAL` live sessions — login revokes the oldest beyond it); [ADR-0020](0020-security-baseline.md) as carried by [ADR-0059](0059-ci-containers-and-deployment.md), [0066](0066-infrastructure-seams.md) and [0069](0069-development-rate-limit-profile.md) (deltas: a fifth limiter category keyed on the principal for the routes that spend an argon2 operation under a session; a limiter key that cannot degrade to one shared bucket; a Content-Security-Policy on the SPA images); [ADR-0026](0026-task-graph-caching-and-serialisation.md) as carried by [ADR-0052](0052-grid-and-admin-followups.md) (delta: `pnpm check` and the gate's first link run the repo-level script tests and `docs:check`); [ADR-0059](0059-ci-containers-and-deployment.md) (deltas: §3 gains the pinning rule, the catalog and the digest-pinned actions and images; §6's reference deployment gains a `prune` service); [ADR-0062](0062-frontend-build-and-shared-composition.md) (delta: §4's ceilings are bounded by a headroom over a committed baseline, and the entry is lazy below the route where a catalogue or the grid is not on the first paint); [ADR-0071](0071-mail-flows.md) as carried by [ADR-0072](0072-federated-identity-google-sign-in.md) (delta: the "an `active` user has a proven address" invariant of §3 becomes a database constraint). Every parent stands for everything not named here.

> Written 2026-09-14 by `/scope` for D20 ([`docs/plan/0020-review-hardening.md`](../plan/0020-review-hardening.md)), from the findings of [`docs/reviews/2026-09-13-repo-review.md`](../reviews/2026-09-13-repo-review.md) — writing is not opening, opening is not accepting. `proposed` at writing; accepted at the head of `D20.1`. Each parent moves to `superseded by` at the step that makes its delta true (the `D10.5` precedent); the plan names which.

## Context

The review of 2026-09-13 read the repository at `28fa5d6` and found no defect that is exploitable in the reference deployment. What it found is a set of accepted single-instance assumptions and drifts that are each an hour or a step to close, and that a fork would otherwise inherit: the argon2 pool budgeted per address only, a limiter key that becomes one bucket under a wrong proxy hop, sessions that grow until an operator remembers a CLI, bundle ceilings a few percent above measurement with nothing bounding a raise, four exact pins nobody can explain, `updated_at` and the proven-address invariant kept only by the code that remembers them, and a gate that does not run the two checks that were red. Several of these are decisions the records already reserved a place for — [ADR-0020](0020-security-baseline.md) §Residual risks names the per-principal budget, the ADR index's planned list names the prune's scheduler — and none of them needs a new mechanism. This record makes the decisions in one place so that D20 is a build and not a debate, and each is a delta small enough for a fork to drop on its own.

## Decision

### 1. A per-principal budget on the routes that spend a hash under a session

A fifth limiter category beside ADR-0020's four: **keyed on `ctx.principal.id`** (the impersonation limiter's shape), mounted on `POST /user/profile/change-password`, `DELETE /user/profile`, `DELETE /user/profile/identities/:provider`, `POST /admin/staff/:id/password` and `POST /admin/users/:id/password`, with `RATE_LIMIT_PRINCIPAL_HASH_MAX` (default `10`) per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW` (default `15m`). It closes two things at once: the pool the review names (a few authenticated clients can no longer make the hash limiter shed login for everyone) and the oracle on the administrative reset (an actor guessing their own password is bounded by their own budget, not by the global one). The `429` carries the standard shape and the standard headers; the limiter shares the store of ADR-0066 §4.

### 2. A limiter key never degrades to one shared bucket

When the context middleware has no validated address — `req.ip` was not an address under a mis-stated `TRUST_PROXY` — the limiter keys on **`req.socket.remoteAddress`** and the context logs one `warn` per process naming the configuration, rather than keying every caller on `""`. The fallback address is still not written to `sessions.ip`; only the key uses it.

### 3. Sessions: a cap per principal, and a prune the deployment runs

Login and the federated exchange revoke the principal's oldest live sessions beyond **`AUTH_MAX_SESSIONS_PER_PRINCIPAL`** (default `10`, `0` meaning uncapped) inside the mint's transaction, with `revoked_reason = 'session_cap'`. Impersonated sessions count against the impersonated user and are never the ones revoked (they end on their own clock, ADR-0057). The reference deployment gains a **`prune` service**: the API image with the `db:sessions:prune` entry as its command, `restart: unless-stopped` with a sleep-loop interval of `PRUNE_INTERVAL` (default `24h`), documented in `docs/deploy.md` beside `migrate`. An in-process scheduler stays a later row's decision (ADR-0066's seam shape); this record only guarantees that a production database stops growing by default.

### 4. Server timeouts, and the runtime floor

`server.ts` sets `requestTimeout`, `headersTimeout` and `keepAliveTimeout` from `HTTP_REQUEST_TIMEOUT` (default `30s`), `HTTP_HEADERS_TIMEOUT` (default `10s`) and `HTTP_KEEP_ALIVE_TIMEOUT` (default `65s`, above a typical proxy's `60s`), beside the drain deadline. The runtime floor moves to **Node 24** in `.nvmrc`, `engines`, both workflows and the three Dockerfiles together, and the package manager to **pnpm 12**; the API image's `pnpm deploy` flag is re-verified on that version.

### 5. Bundle ceilings are bounded by headroom over a committed baseline

`size-budget.json` keeps its shape (ADR-0062 §4) and gains a rule `scripts/size.mjs` enforces: **every ceiling is at most 15% over its baseline**, and every baseline is re-measured in the diff that raises a ceiling. A raise is therefore always a diff that shows both numbers, and a baseline cannot go stale without the script saying so. Below the route split, the **`lv` catalogue is loaded through the i18next backend already in place** and **`@repo/grid` is a dynamic import behind the list pages**, so the entry ceiling falls rather than the js ceiling rising.

### 6. The gate runs everything that can go red

`pnpm check` and the gate's first link (`pnpm lint`) gain **`pnpm test:scripts`** and **`pnpm docs:check`**, both seconds. The shared Vitest configs report **`coverage` as a `text-summary`** with no threshold; a floor per package is a later decision taken on a number rather than on hope. Postman stays nightly beside the browser tier, where the stack exists.

### 7. Pinning, catalogs, digests, images

`renovate.json` and the manifests follow one stated rule: **exact for the runtime framework and the compiler (`express`, `typescript`), caret for everything else** — so `tsdown` is unpinned. The versions ten or more workspaces declare move into a **`catalog:`** in `pnpm-workspace.yaml`. GitHub Actions are **pinned by digest** (`helpers:pinGitHubActionDigests`) and the four base images gain a named Renovate rule. Runtime-reachable advisories are closed by taking `nodemailer` to its current major and `qs` to `6.16`; a `pnpm audit --prod` that reports nothing reachable is the check.

### 8. Two invariants move into the database

`timestamps()` gains **`.$onUpdate(() => new Date())`** on `updated_at`, so a repository that forgets the column can no longer ship a stale one; repositories that set it explicitly keep working. A migration adds **`CHECK (status <> 'active' OR email_verified_at IS NOT NULL)`** to `users`, preceded by a backfill assertion that fails the migration if a row violates it — the invariant ADR-0071 §3 and ADR-0072 §1 lean on becomes a database error rather than a review finding.

### 9. A Content-Security-Policy on the SPA images

Both `nginx.conf` files send `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' <API origin>; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. `'unsafe-inline'` on styles is Tailwind's price and is stated; scripts are the injection the policy exists to stop. The API origin is a build argument beside `VITE_API_URL`, since nginx cannot read Vite's.

### 10. The composition root is wired per module

`core/container.ts` becomes ordering only: `createRateLimiters(config, store)` returns the named set, and each module exports one `wire<Module>(deps)` returning its repositories, services and controllers. ADR-0009's layering is unchanged; what moves is where a fork's merge conflict lands.

## Consequences

- Six new environment keys (`RATE_LIMIT_PRINCIPAL_HASH_MAX`, `RATE_LIMIT_PRINCIPAL_HASH_WINDOW`, `AUTH_MAX_SESSIONS_PER_PRINCIPAL`, `HTTP_REQUEST_TIMEOUT`, `HTTP_HEADERS_TIMEOUT`, `HTTP_KEEP_ALIVE_TIMEOUT`) enter ADR-0004's schema, `.env.example`, `apps/api/.env.test`, `docker/prod/.env.example` and `docs/deploy.md`; `PRUNE_INTERVAL` enters the compose file and the deploy guide only.
- A person with more than ten devices signs out of the oldest at the eleventh login; the number is a default, and the sentence lands in `auth-sessions.md`.
- The CSP breaks the first inline `<script>` a build step ever emits, loudly, which is the point; nonces are the answer then.
- The catalog moves version truth to one file; a workspace that needs to diverge names the version directly, which is visible.
- The container split touches every module once; it is behaviour-preserving and the integration tier is the proof.
- What this record does not decide, by design: the key ring (SEC-01), row-level security (SEC-07), the in-process scheduler and an outbox (DB-02, API-05), the shared composition's second wave (FE-01) and the record consolidation (PRO-02) — each is a planned ledger row of its own.

## Alternatives considered

- **One record per decision** — ten short records; cleaner topic rows, ten more links in the chains PRO-02 already names. One record with ten deltas is the D19 shape and reads as one wave.
- **A hard cap that refuses the eleventh login** — punishes the person for a stolen device; revoking the oldest is what every consumer platform does.
- **`CREATE INDEX CONCURRENTLY` lane and RLS here** — both are migration-runner decisions with their own preconditions; they belong to the RLS row.
- **A coverage threshold now** — a number chosen before it is measured is a number that gets edited on the first red run.
- **Refusing the request when the limiter has no address** — safer in theory, and it turns one mis-set variable into a total outage; a warning and the socket address keep the service up while saying what is wrong.
