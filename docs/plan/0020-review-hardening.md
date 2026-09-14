# D20 — Review hardening

- Status: **planned** — **scoped in full 2026-09-14 by `/scope`** from the findings of [`docs/reviews/2026-09-13-repo-review.md`](../reviews/2026-09-13-repo-review.md), the day after the review, with no row in progress. Opening is the operator's decision (ADR-0025 rule 5). The plan below is what `/step` executes; every step cites the finding ids it closes, and a step closes a finding by making its evidence false. Built before D16, whose row says "built last".
- Records: [ADR-0073](../adr/0073-review-hardening.md) (review hardening — per-principal budgets, the limiter key, session caps and the prune service, timeouts and the runtime floor, budget headroom, the gate's links, pinning, two database invariants, the SPA policy, the composition root; deltas on ADR-0003, 0006, 0018, 0020, 0026, 0059, 0062 and 0071) — written `proposed` at scoping and accepted at `D20.1`'s head; its parents move at the step that makes each delta true, and the steps name which. A step whose record is still `proposed` is gated.
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0020-review-hardening.notes.md`](0020-review-hardening.notes.md)

## Goal

Close every finding of the 2026-09-13 review that is an hour or a step to close, so the next fork inherits none of them: the runtime advisories and the unexplained pins, the gate that did not run the two checks that were red, the per-principal budget the security baseline has named as missing since D1, sessions that only a CLI prunes, bundle ceilings nothing bounds, two invariants the database can hold, a policy on the SPA images, the composition root and the four thousand-line files, the lazy entry, and the Postman and spec gaps. ADR-0073 decides all of it. The deliverable-sized findings are routed to planned rows D21–D26 and are not here.

## Constraints

- A step closes a finding by citing its id and making its evidence false; a finding the step finds no longer holds is recorded as such in the notes and not "fixed" (ADR-0050 §Altitude; the review's own "how it was done").
- `security-reviewer` reads the diffs of `D20.4`, `D20.5` and `D20.8` — limiters, sessions, the migration and the policy header (ADR-0020; ADR-0073 §1–§3, §8–§9).
- Behaviour-preserving splits (`D20.6`, `D20.7`, `D20.10`) add no behaviour and remove no test; the integration and package tiers green before and after are the proof (ADR-0021; ADR-0073 §10).
- New env keys enter ADR-0004's schema, `.env.example`, `apps/api/.env.test`, `docker/prod/.env.example`, `docker/prod/compose.yaml` and [`docs/deploy.md`](../deploy.md) (ADR-0059 §6); a new limiter number enters `docker/prod/.env.example` as ADR-0069 states.
- A behaviour change updates the capability's spec in the same diff (ADR-0068 §1); an SPA spec arrives at `D20.11` because that step names it (`.claude/rules/frontend.md`).
- `pnpm size` is measured at every SPA step and a raise is a diff of the budget file showing the baseline beside the ceiling (ADR-0062 §4 as carried by ADR-0073 §5).
- Majors beyond the trivial ones (ESLint 10, Vite 8, Vitest 5, TypeScript 7) are **not** taken here; they are D21's, one step each (ADR-0059 §3).
- No `drizzle-kit push`; the `CHECK` constraint ships as a generated migration with its backfill assertion in the same file (ADR-0008 as carried by ADR-0061; ADR-0060 §5).
- The running stack is the operator's: nothing here starts, stops or restarts it; a step that needs a restart says so in the notes (`CLAUDE.md`).
- The gate: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` — which from `D20.1` on includes `pnpm test:scripts` and `pnpm docs:check` through `lint`'s task.

## Decisions taken at scoping (operator, 2026-09-14)

- **One wave, everything step-sized; the L findings become planned rows.** FE-01 (D22), SEC-01 (D23), DB-02's scheduler with API-05's outbox (D24), SEC-07 with DB-01 (D25), PRO-02 (D26), and the big four majors (D21).
- **One record, ADR-0073, as deltas on each parent** — the D19 shape.
- **All four refactors ride here**: the container split (API-01), the service splits (API-02), the lazy entry (FE-03), the client and grid splits (FE-05).
- **`CLAUDE.md` is trimmed under 6 KB**, not the budget raised.
- **A soft session cap on login plus a prune service in the reference deployment**; the in-process scheduler stays D24's.
- **Coverage is reported, not gated**; one spec per SPA wire-crossing flow; Node 24 and pnpm 12 together.
- **Row order after D20:** D21 stack majors, D22 shared composition, D23 key ring, D24 operations, D25 row-level security, D26 record consolidation.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first; finding ids are what the step closes.

- [ ] **1. Accept ADR-0073; the gate runs everything.** Accept 0073 at the head, where [ADR-0026](../adr/0026-task-graph-caching-and-serialisation.md) moves to its second successor delta and the ADR index's record row and topic rows are updated. `CLAUDE.md` trimmed under 6 KB (the Commands block to the gate line and the six commands a session needs, the Repo map to one line per top-level directory); `pnpm test:scripts` and `pnpm docs:check` added to `pnpm check` and to `gate.yml`'s first link; `coverage: { provider: "v8", reporter: ["text-summary"] }` in both shared Vitest configs with `@vitest/coverage-v8` where it is needed; the four stale `apps/web` claims corrected — the two skills' `"use client"` sentence deleted, the comments in `packages/ui/src/hooks/use-mobile.ts` and `compositions/banner.tsx` reworded to name D16 as future. Closes **CI-01, CI-02, PRO-01, UI-02, PRO-04**.
      **ADRs:** 0073 (§6), 0026, 0052, 0021, 0047, 0065.
      **Done when:** `pnpm test:scripts` green, its `CLAUDE.md` test passing on the trimmed file; `pnpm check` runs `test:scripts` and `docs:check` (the Turbo graph lists both tasks under `lint`); `gate.yml` invokes them in the first link; `pnpm test:unit --filter @repo/contracts` prints a coverage summary; `scripts/docs-hygiene.test.mjs` gains a test asserting no file under `.claude/` or `packages/ui/src` states `apps/web` as present; gate green.
- [ ] **2. Runtime advisories, pins, catalog, digests.** `nodemailer` to its current major and `qs` to `6.16` with the lockfile refreshed; `tsdown` unpinned and updated; `globals`, `@types/supertest` and `vitest` to `4.1.x` taken; the pinning rule stated in `renovate.json`'s descriptions and the shared versions moved to `catalog:` in `pnpm-workspace.yaml`; `helpers:pinGitHubActionDigests` extended and both workflows' actions pinned by digest; a Renovate rule naming the four base images. Closes **STK-01, STK-02, STK-03, STK-04 (the trivial half), STK-07, SEC-06, CI-03, CI-04**; [ADR-0059](../adr/0059-ci-containers-and-deployment.md) moves to `superseded by` (delta: §3) at this head.
      **ADRs:** 0073 (§7), 0059 §3, 0066 §1, 0002.
      **Done when:** `pnpm audit --prod` reports no advisory; `pnpm install --frozen-lockfile` clean; `pnpm build --filter api` green and `apps/api/test/mail-flows.int.test.ts` green on the new `nodemailer`; `scripts/docs-hygiene.test.mjs` gains a test asserting every `uses:` in `.github/workflows/*.yml` carries a 40-hex digest; `pnpm outdated -r` lists no direct dependency behind a minor; gate green.
- [ ] **3. Node 24 and pnpm 12.** `.nvmrc`, `engines`, `packageManager`, both workflows and the three Dockerfiles moved together; `pnpm deploy --legacy` in `apps/api/Dockerfile` re-verified on pnpm 12 and the flag kept or dropped with its reason in the Dockerfile; `argon2` prebuilds confirmed by the image build. Closes **STK-05, STK-06**; [ADR-0003](../adr/0003-api-runtime-express-typescript.md) moves to `superseded by` (delta: the floor) at this head.
      **ADRs:** 0073 (§4), 0003, 0059 §4.
      **Done when:** `docker compose -f docker/prod/compose.yaml build` succeeds for all three images and `docker run --rm machxi/api:local node --version` prints a `v24`; gate green on Node 24 locally and in `gate.yml`; `pnpm test:scripts` green.
- [ ] **4. The API's budgets, key, timeouts and cap.** `createPrincipalRateLimiter` on `ctx.principal.id` mounted on the five routes with its two env keys; the limiter key falling back to `req.socket.remoteAddress` with one `warn` per process; `requestTimeout`, `headersTimeout` and `keepAliveTimeout` from three env keys beside the drain; `AUTH_MAX_SESSIONS_PER_PRINCIPAL` enforced inside login's and the federated exchange's mint with `revoked_reason = 'session_cap'`, impersonated sessions never chosen; `docs/specs/auth-sessions.md` gains the cap's requirement and `users-and-profile.md` and `staff.md` the `429`; Postman gains the `429` on `change-password` after the budget. Closes **SEC-02, SEC-03, SEC-05 (the cap half), API-04**; [ADR-0020](../adr/0020-security-baseline.md) and [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md) move to `superseded by` at this head.
      **ADRs:** 0073 (§1–§4), 0020, 0018, 0057 §1, 0066 §4, 0069, 0004, 0013.
      **Done when:** `apps/api/test/rate-limit.int.test.ts` asserts that the eleventh `change-password` from one principal in the window answers `429 RATE_LIMITED` while another principal on the same address answers normally, and that `POST /admin/users/:id/password` with a wrong actor password answers `403` ten times and `429` on the eleventh; `core/middleware/__tests__/rate-limit.test.ts` asserts that a request with no validated address keys on the socket address and never on `""`, and that one warning is logged per process; `server.test.ts` asserts the three timeouts are set from config; `auth-sessions.int.test.ts` asserts an eleventh login leaves ten live sessions with the oldest revoked as `session_cap`, that an impersonated session is counted and never revoked by the cap, and that `0` disables it; `docs/specs/auth-sessions.md` requirement "A person holds a bounded number of sessions" with those scenarios; `pnpm test:postman` green with the counts in both READMEs; gate green.
- [ ] **5. Two invariants in the database, and the prune service.** `timestamps()` gains `$onUpdate`; a generated migration adds the `users` `CHECK` with a `DO $$ … $$` assertion before it that raises on a violating row; the `prune` service in `docker/prod/compose.yaml` on the API image with `PRUNE_INTERVAL`, and `docs/deploy.md` documenting it beside `migrate`. Closes **DB-03, DB-04, DB-02 (the deployment half)**; [ADR-0006](../adr/0006-database-postgres-drizzle.md) and [ADR-0071](../adr/0071-mail-flows.md) move to `superseded by` at this head, and 0059 gains its §6 delta.
      **ADRs:** 0073 (§3, §8), 0006, 0008, 0060 §5, 0061, 0071 §3, 0059 §6.
      **Done when:** `packages/db/src/__tests__/schema.int.test.ts` asserts an `UPDATE` that names no `updated_at` still moves it, and that inserting an `active` user with a null `email_verified_at` is refused by a named constraint; `migrations.int.test.ts` asserts the migration fails on a seeded violating row and passes on a clean one; `seeds.int.test.ts` green twice; `docker compose -f docker/prod/compose.yaml config` lists `prune` with the API image and the command; `pnpm docs:check` clean with the deploy guide's new section; gate green.
- [ ] **6. The composition root, wired per module.** `createRateLimiters(config, store)` in `core/middleware`; one `wire<Module>(deps)` per module in `modules/<feature>/index.ts` returning `{ repositories, services, controllers }`; `buildContainer` reduced to construction order and the returned shape unchanged. Closes **API-01**.
      **ADRs:** 0073 (§10), 0009, 0011, 0066 §4.
      **Done when:** `core/__tests__/container.test.ts` asserts `buildContainer` returns the same set of controller and limiter names as before the split (the list committed in the test); `pnpm test:int --filter api` green with no test changed; `packages/config-eslint/api.js` refuses `express` and schema tables in a `wire*` file as it does in a service; gate green.
- [ ] **7. The four thousand-line files.** `auth.mail-flows.service.ts` (verification, recovery, email change) behind the same `createAuthService` deps; `users.lifecycle.ts` for the personal-organization glue; `packages/api-client/src/{transport,session}.ts` and `flows/*.ts`; `packages/grid/src/app-grid/{header,body,state}.ts` hooks with `app-grid.tsx` composing them. Unit tests move with the code they test. Closes **API-02, FE-05**.
      **ADRs:** 0073 (§10), 0009, 0071, 0072, 0051, 0052.
      **Done when:** `pnpm test --filter api --filter @repo/api-client --filter @repo/grid` green with no assertion changed; `apps/admin` and `apps/customer` door tests green untouched; no source file under `apps/api/src/modules`, `packages/api-client/src` or `packages/grid/src` over a thousand lines, asserted by a new `scripts/docs-hygiene.test.mjs` case with the list of the files it reads; gate green.
- [ ] **8. The SPA images and the motion rule.** The Content-Security-Policy in both `nginx.conf` files with the API origin as a build argument; `@media (prefers-reduced-motion: reduce)` in `packages/ui`'s `globals.css` zeroing animation and transition durations. Closes **SEC-04, FE-06**; 0020 gains its CSP delta at this head.
      **ADRs:** 0073 (§9), 0020, 0059 §4, 0047, 0054.
      **Done when:** `scripts/docs-hygiene.test.mjs` gains a test asserting both `nginx.conf` files send the policy with `script-src 'self'` and `frame-ancestors 'none'`; `docker compose -f docker/prod/compose.yaml build admin customer` succeeds; `apps/admin/e2e/smoke.spec.ts` asserts the header on the built image when run against it (the nightly's job); a `packages/ui` test asserts the reduced-motion rule is present in the emitted CSS; gate green.
- [ ] **9. Budget headroom, and the lazy entry.** `scripts/size.mjs` enforces every ceiling ≤ baseline × 1.15 and re-baselines only through the budget file's diff; the `lv` catalogue loaded through `resourcesToBackend` in both apps; `@repo/grid` a dynamic import behind the list pages in the admin app; both budget files re-baselined with the entry ceiling lowered to the new measurement plus headroom. Closes **FE-02, FE-03**; [ADR-0062](../adr/0062-frontend-build-and-shared-composition.md) moves to `superseded by` (delta: §4) at this head.
      **ADRs:** 0073 (§5), 0062 §4, 0046 §3, 0052.
      **Done when:** `scripts/size.test.mjs` asserts a ceiling more than 15% over its baseline fails and one within passes; `pnpm size` green in both apps with the entry ceiling below its D18 number and the baseline `measuredAt` today; an admin `pseudo-locale.test.tsx` case asserts a `lv` sentence renders after the switch (the lazy catalogue resolved); an admin list-page test asserts the grid chunk is requested only on the list route; gate green.
- [ ] **10. FE-04's half that is cheap: the harness moves.** The MSW `envelope` and `list-query` handlers and `test/render.tsx` into `@repo/app-kit/testing`, both apps importing them; the door-level grid and form suites stay where they are (D22 decides them with the second wave). Closes the harness third of **FE-04**; records the rest as D22's.
      **ADRs:** 0062 §1, 0036 as carried by 0052, 0051.
      **Done when:** both apps' test suites green with `test/msw/handlers/{envelope,list-query}.ts` deleted from each app; `packages/app-kit` carries the two files and their tests; gate green.
- [ ] **11. Postman and the SPA specs.** The three routes with no request — invitation decline, the Google callback as a negative navigation proving the `302`, the exchange with a spent token; three SPA specs in `docs/specs/` in the WHEN/THEN shape naming the tests that prove them — the Google landing (`apps/customer`), the invitation link, the impersonation entry — and `docs/specs/README.md` listing them. Closes **PRO-03, PRO-05**.
      **ADRs:** 0021, 0068 §1, 0072 §2, 0071 §5, 0057 §2, 0070.
      **Done when:** `pnpm test:postman` green with the three requests and the counts in both READMEs; `pnpm docs:check` reports the three specs clean and every test each names present in the tree; gate green.
- [ ] **12. Close-out.** The review re-read finding by finding: each id in `docs/reviews/2026-09-13-repo-review.md` that a step closed gains a one-line `Closed at D20.<n>` suffix, each routed one names its row; the browser tier's window floors re-measured (the cap and the limiter add no browser-tier request); the digests regenerated; then the definition of done.
      **ADRs:** 0073, 0069, 0068, 0065.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D20.12` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO` (ADR-0026 as carried).
3. `pnpm test:scripts` and `pnpm docs:check` green, as part of `pnpm check` and on their own.
4. `pnpm audit --prod` reports no advisory; `pnpm outdated -r` lists no direct dependency behind a minor and only D21's four behind a major.
5. `pnpm test:postman` exit `0`, with the request and assertion counts `README.md` and `docs/postman/README.md` state.
6. `pnpm test:e2e` green in both apps against the local compose, the floors unchanged from D19's.
7. `pnpm rules:digest` writes nothing on a second run.
8. `docker compose -f docker/prod/compose.yaml build` succeeds on Node 24 images; `config` lists the `prune` service.
9. `pnpm db:seed -- --dev` twice against the dev database, identical output; `pnpm db:migrate` applies the `CHECK` migration against the dev database with no violating row.
10. **Operator, browser:** sign in eleven times from one browser profile and see the first session gone from the sessions list; run `change-password` with a wrong current password eleven times and read the rate-limit sentence; open the admin app's list route and see the grid chunk load in the network panel; switch to `lv` and see the catalogue chunk load; open the built customer image and read the policy header in the response.
11. Every finding id in the review carries `Closed at D20.<n>` or the row it was routed to.

## Not in D20

ESLint 10, Vite 8, Vitest 5 and TypeScript 7 (D21); the providers, the account features and the door-level suites moving into packages (D22); the key ring and a separate OIDC secret (D23); the in-process scheduler, the outbox and audit retention (D24); row-level security and the concurrent-index lane (D25); the three consolidation records (D26); OpenAPI generation (API-06); response compression (API-07); Postgres 17/18 (DB-05); a coverage threshold; the route-file prose (API-03, ongoing).
