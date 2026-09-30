# D29 — Backend closing wave

- Status: **in progress** — **scoped in full 2026-09-29 by `/scope`**, from the ledger rows D23, D24, D25 and D27 folded on the operator's decision the same day (ledger §How D22 was scoped, §How D29 was scoped). **Opened 2026-09-30** on the operator's decision, the second lane under [ADR-0079](../adr/0079-parallel-lanes.md) beside D31, built on `lane/D29` in its own worktree against its own test database, `machxi_d29_test` (ledger §How D29 opened).
- Records: [ADR-0078](../adr/0078-backend-closing-wave.md) (migrations applied by hash, a key ring, deadlocks retried, the reference images hardened) — written `proposed` at scoping, accepted at the head of `D29.1` — and the parents it supersedes, [ADR-0008](../adr/0008-database-migrations-and-seeding.md), [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md), [ADR-0059](../adr/0059-ci-containers-and-deployment.md), [ADR-0060](../adr/0060-list-endpoints-at-scale.md), [ADR-0072](../adr/0072-federated-identity-google-sign-in.md) and [ADR-0073](../adr/0073-review-hardening.md), with [ADR-0067](../adr/0067-organizations.md) held by the lane from opening because step 4 moves it if the spike lands.
- Schema: yes — the one schema lane while it is open ([ADR-0079](../adr/0079-parallel-lanes.md) §3).
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0029-backend-closing-wave.notes.md`](0029-backend-closing-wave.notes.md)

## Goal

Close what is expensive to retrofit on the backend before the starter is forked. The migration runner applies by hash, so a fork can merge the starter's later migrations; the signing secret can rotate; the reference images and compose are hardened; and row-level security is proved or refuted in a box. It is the last backend deliverable before the fork, and it runs beside D31, the first pair of lanes (ledger §How D31 was scoped).

## Constraints

- No `drizzle-kit push`; committed migrations are never edited (ADR-0008 as carried). The runner change needs no change to a deployed database (ADR-0078 §1).
- `security-reviewer` reads the diffs of `D29.2` and `D29.3`, and `D29.4`'s if it lands (ADR-0018, 0072, 0067 as carried).
- A new variable is a schema entry, both `.env.example` files, the production compose, `docs/deploy.md`, and a `turbo.json` `env` entry where a task reads it (ADR-0004 as carried by 0075).
- A behaviour change updates its spec in the same diff: `auth-sessions.md`, `federated-identity.md` (ADR-0068 §1).
- Nothing inside a transaction has an effect outside the database (ADR-0078 §3).
- The spike runs in a worktree with its own install and its own database, timeboxed to one day, and decides by its tests and its blockers (ADR-0050 §Verification).
- The running stack is the operator's. A step that changes an `.env` value or a Dockerfile reports the restart it needs and does not take it (`CLAUDE.md`).
- The gate as `CLAUDE.md` §Commands defines it, at every step.

## Decisions taken at scoping (operator, 2026-09-29)

- **The runner applies by hash**, replacing Drizzle's `migrate()`.
- **Row-level security is a one-day spike**: green lands, red becomes a planned row.
- **Operations: the containers now.** The scheduler seam and the outbox stay planned on D24's row.
- **Key ring: the ring, the lock order and the retry.** The pepper and the credential epoch are declined by name.
- **Recorded, not asked:** the ring is additive (`JWT_ACCESS_SECRET_PREVIOUS`) and no variable is renamed; audit retention stands as ADR-0058 and 0061 decided it.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first; finding ids are what the step closes.

- [x] **1. Accept ADR-0078; the runner applies by hash, with a concurrent lane.** Accept 0078 at the head, where [ADR-0008](../adr/0008-database-migrations-and-seeding.md) and [ADR-0060](../adr/0060-list-endpoints-at-scale.md) move (the index rows, the topic table and the ledger's window section say so), and write its digest lines. `packages/db/src/migrate.ts` reads the journal and the applied-state table and applies every entry whose hash is absent, in journal order, under the existing lock; a marked file runs statement by statement outside the transaction. `.gitattributes` pins the migrations directory's line ending. `/db-schema-change` and `docs/forking.md` state the two lanes and how a fork merges the journal. Closes `DB-01`.
      **ADRs:** 0078 §1, 0008 as carried, 0059 §5, 0060 §5, 0061 §1.
      **Done when:** `migrate.int.test.ts` cases "an entry older than the newest applied one is still applied", "a database migrated by drizzle has nothing pending" and "a concurrent-lane file is recorded only when its last statement succeeds" green; `pnpm db:migrate` against the dev database prints up to date; `pnpm db:migrate --test` from an empty database applies every file; `docker compose -f docker/prod/compose.yaml build migrate` succeeds; `pnpm test --filter=@repo/db` green; the gate green.
- [x] **2. The key ring.** `JWT_ACCESS_SECRET_PREVIOUS` and `OIDC_TRANSACTION_SECRET` join the schema with their production refinements; the token service signs with a `kid` and verifies by it; the OIDC codec takes its own key, derived when unset. [ADR-0018](../adr/0018-authentication-sessions-and-tokens.md) and [ADR-0072](../adr/0072-federated-identity-google-sign-in.md) move at this head. `docs/deploy.md` gains the rotation procedure. Closes `SEC-01`.
      **ADRs:** 0078 §2, 0018 §Tokens as carried, 0072 §2, 0004 as carried by 0075.
      **Done when:** `auth.tokens.test.ts` cases "a token signed under the previous secret verifies", "a token naming an unknown key is refused" and "a token with no key id verifies under the current secret" green; `transaction.test.ts` case "the codec's key is not the access token's" green; `config.test.ts` case "a committed value is refused in production for every secret" green; `committed-secrets.test.ts` green; `auth.int.test.ts` green; `security-reviewer` has read the diff; `pnpm test --filter=api` green; `pnpm test:postman` exit `0`.
- [x] **3. Lock order, and the retry.** The federated exchange's locks are ordered against the sweeps; the transaction helper in `core/container.ts` retries `40P01` a bounded number of times and logs each retry. The two specs gain their scenarios.
      **ADRs:** 0078 §3, 0072 §3, 0074 §5, 0071 as carried.
      **Done when:** `federated-identity.int.test.ts` case "an exchange racing a reset ends in one outcome and no deadlock" green; `container.test.ts` cases "a deadlock victim is retried" and "a transaction that keeps losing surfaces the error" green; `security-reviewer` has read the diff; `pnpm docs:check` clean; `pnpm test --filter=api` green.
- [x] **4. Spike: row-level security, one day.** In a worktree: a request-scoped transaction, the setting placed by `requireMembership`, a policy per table in `TENANT_OWNED_TABLES` admitting the principal-scoped reads and the staff segment by an explicit setting, and the harness as the application role. Green lands here with ADR-0078 §4 amended and [ADR-0067](../adr/0067-organizations.md) moved; red writes the ledger row and the blocker. Closes or routes `SEC-07`.
      **ADRs:** 0078 §4, 0067 §5, 0061, 0019 as carried.
      **Done when:** the notes carry the spike's result and the integration tier's duration before and after; if landed, `enumerations.test.ts` case "every tenant-owned table carries a policy" green and red with one removed, `organizations.int.test.ts` case "a query that forgets its organization returns nothing" green, `security-reviewer` has read the diff and the gate is green; if not, the ledger row exists with the blocker named.
- [x] **5. The reference images, the compose, and the compiler's memory.** Both SPA Dockerfiles move to the unprivileged nginx image with a `HEALTHCHECK`, and their `nginx.conf` listens on its port; all three Dockerfiles gain a lockfile-only fetch layer before the source is copied; the production compose states limits and a log driver per service. `check-types` for a referenced project is decided by measurement and ADR-0078 §6 is amended with it; [ADR-0059](../adr/0059-ci-containers-and-deployment.md) and [ADR-0073](../adr/0073-review-hardening.md) move at this head. Closes `CI-05`, `CI-10`, `CI-11` and ADR-0073 §6's residual.
      **ADRs:** 0078 §5–§6, 0059 §4 and §6, 0073 §6 and §9, 0076 §1.
      **Done when:** `docker compose -f docker/prod/compose.yaml config` renders limits and logging on every service; `docker compose -f docker/prod/compose.yaml build` succeeds; `scripts/docs-hygiene.test.mjs` cases "the SPA images run unprivileged with a health check" and "a package's restored buildinfo cannot mask its own error" green, the second red on the tree as it stands today; `apps/admin/e2e/smoke.spec.ts` green against the built image; the notes carry `pnpm check-types --force` cold and warm before and after; the gate green.
- [ ] **6. Close-out.** `SEC-01`, `SEC-07`, `DB-01`, `CI-05`, `CI-10` and `CI-11` carry their fates in both reviews; the index's planned entry on secret management says what was taken and what was declined; the skills and rule files describe the runner; the digests regenerated; then the definition of done.
      **ADRs:** 0078, 0065 as carried.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D29.6` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm db:migrate` up to date against the dev database; `pnpm db:seed -- --dev` twice with identical output.
4. `pnpm test:e2e` green in both apps against the local compose.
5. `pnpm test:postman` exit `0` with the counts the READMEs state.
6. `docker compose -f docker/prod/compose.yaml build` succeeds, and `config` renders.
7. `pnpm audit --prod` reports no advisory.
8. `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean.

## Not in D29

The scheduler seam and the mail outbox (D24's row); the argon2 pepper and the credential epoch (ADR-0078 §7); audit retention; EdDSA; Postgres 17 or 18; D26's restatement; D16.
