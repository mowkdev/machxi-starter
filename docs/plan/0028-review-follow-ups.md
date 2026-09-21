# D28 — Review follow-ups

- Status: **in progress** — **scoped in full 2026-09-21 by `/scope`** from the findings of [`docs/reviews/2026-09-21-repo-review.md`](../reviews/2026-09-21-repo-review.md), the day it was written; **opened 2026-09-21**, the same sitting, on the operator's decision (ADR-0025 rule 5; ledger §How D28 opened).
- Records: [ADR-0074](../adr/0074-review-follow-ups.md) (review follow-ups — the gate's remaining twins, one fact per hold, digest coverage, the cap and the customer's own sessions, no client directive; deltas on ADR-0047, 0065, 0071 and 0073) — written `proposed` at scoping, **accepted 2026-09-21 at the head of `D28.1`**.
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0028-review-follow-ups.notes.md`](0028-review-follow-ups.notes.md)

## Goal

Close every finding of the 2026-09-21 review that is an hour to close, before D21's majors land: the four gaps of one shape — a control present in one place and missing from its twin (`i18n:check` outside the gate, a held `jsdom` the lockfile carries twice, two cooldowns that disagree, a record with no digest line) — and the cheap corrections around them, so the majors land on a gate that runs everything and the next fork inherits neither the gaps nor the drift. The admin unit tier's cost is measured here and decided on the numbers.

## Constraints

- A step closes a finding by citing its id and making its evidence false; a finding the step finds no longer holds is recorded as such in the notes and not "fixed" (ADR-0050 §Altitude; the review's own "how it was done").
- `security-reviewer` reads the diff of `D28.5` — the cap's count and the token supersession (ADR-0018 as carried; ADR-0073 §3; ADR-0074 §4–§5).
- A behaviour change updates the capability's spec in the same diff (ADR-0068 §1): `D28.5` touches the sessions and account-tokens specs under [`docs/specs/`](../specs/).
- No `drizzle-kit push`; the three partial indexes ship as one generated migration with the ADR-0060 §5 lock note in the file (ADR-0008 as carried by ADR-0061).
- `pnpm size` is measured at every step that touches a package's `sideEffects` or a composition, and a budget change is a diff of the budget file (ADR-0062 §4 as carried by ADR-0073 §5).
- No major is taken here; `@types/node` and `dotenv` are named on D21's row and stay there (ADR-0059 §3 as carried by ADR-0073 §7).
- The running stack is the operator's: nothing here starts, stops or restarts it; the spike step runs in a worktree (`CLAUDE.md`; ADR-0050 §Verification).
- The gate: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` — which from `D28.1` on carries `i18n:check` through `lint`'s task beside `test:scripts` and `docs:check`.

## Decisions taken at scoping (operator, 2026-09-21)

- **One record, ADR-0074, as deltas on each parent** — the D20 shape; 0073 is shipped, so its gate links, pinning rule and cap count change only by supersession.
- **The admin unit tier is measured in a timeboxed spike step inside D28** and decided on two numbers; a config change lands in the step, anything larger becomes D22's input.
- **The `"use client"` rule and directive go**; D16 reintroduces them by its own record if a Next consumer arrives.
- **D28 runs first, before D21**, so the majors land on the extended gate.
- **Routed, not taken:** `CI-10`, `CI-11`, `DB-09`, `DB-10` to D24; `FE-15` to D22; `CI-13`, `STK-11` nothing to do; `PRO-13` is the operator's worktree.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first; finding ids are what the step closes.

- [x] **1. Accept ADR-0074; the first link runs every check.** Accept 0074 at the head, where [ADR-0073](../adr/0073-review-hardening.md) moves to `superseded by` (its §6 delta true here; the index row and the ledger's window section say so). `turbo.json`: `i18n:check` joins `lint`'s `dependsOn`; `.github/workflows/e2e.yml` gains a `pnpm audit --prod` step, reported and never gating; a `scripts/docs-hygiene.test.mjs` case asserts `lint`'s `dependsOn` names every root and app check the repository defines. Closes `CI-08`, `CI-09`.
      **ADRs:** 0074 §1, 0073 §6, 0026 as carried.
      **Done when:** `turbo run lint --dry=json` lists `admin#i18n:check` and `customer#i18n:check` among `lint`'s dependencies; `scripts/docs-hygiene.test.mjs` case "the first link carries every check that can go red" green, and red with `i18n:check` removed; `e2e.yml` parses with the audit step; `pnpm check` green.
- [x] **2. One `jsdom` fact, one cooldown.** `pnpm-workspace.yaml` gains `overrides: { jsdom: "30.0.1" }` and the lockfile is refreshed so it carries one `jsdom`; `renovate.json` states `minimumReleaseAge` equal to pnpm's, and the yaml's setting gains the one-install override procedure for a security fix younger than the cooldown; D21's row names `@types/node` and `dotenv`. Closes `STK-08`, `STK-09`, `STK-10`.
      **ADRs:** 0074 §2, 0073 §7, 0059 §3.
      **Done when:** `pnpm why -r jsdom` resolves one version everywhere; `scripts/docs-hygiene.test.mjs` case "a held dependency is one fact" green (the lockfile carries one version of every package `overrides` names) and red on a lockfile with two; `pnpm test:unit --filter customer` whole green; `pnpm check` green.
- [x] **3. The digests carry every decision, and the generator refuses a record with none.** `scripts/rules-digest.mjs` gains a rule line for each decision of ADR-0073 a session must obey (§1–§4 and §8, §10 in api-and-data; §5 and §9 in frontend-and-platform; §6 and §7 in process) and for ADR-0074's, the ADR-0066 §4 line stops counting limiters, and `generate()` throws when an `accepted` record is the primary citation of no line. Closes `PRO-08`, `API-13`.
      **ADRs:** 0074 §3, 0065 (digests), 0073.
      **Done when:** `pnpm rules:digest` writes 3 of 3 then 0 of 3; `scripts/rules-digest.test.mjs` case "every accepted record is the primary citation of a line" green, and red with one record's lines removed; `pnpm docs:check` clean; `pnpm check` green.
      **Amended 2026-09-21 (D28.3).** "Primary citation" is read as the review's evidence reads it: named in a line's own `records`, as opposed to appearing only in an "as carried by" suffix. Under it four more accepted records had no line of their own — ADR-0028 (account deletion), ADR-0069 (the development rate-limit profile), ADR-0070 (impersonation in a new tab) and ADR-0072 (federated identity) — so the step writes theirs too; the done-when's case cannot be green otherwise.
- [x] **4. The prune service's predicates, its list, its floor — and the seeds' one transaction.** A generated migration adds partial indexes on `sessions.revoked_at`, `impersonation_handoffs.consumed_at` and `account_tokens.consumed_at` with its lock note; `prune-sessions.ts` exports its pruned and never-pruned table names and `packages/db/src/__tests__/enumerations.test.ts` asserts every table with an `expires_at` column is in one list; the compose `prune` loop floors `PRUNE_INTERVAL` before the loop; `REVOKE_REASONS` gains `sessionCap` and the cap's input is typed; `seeds/run.ts` wraps each seeder in a transaction and the idempotency test counts `organization_invitations`; a hygiene case asks every migration from `0011` on for its lock note. Closes `DB-07`, `DB-08`, `DB-09`, `DB-10`, `DB-12`, `SEC-11`, `SEC-12`.
      **ADRs:** 0060 §5, 0061, 0073 §3, 0057.
      **Done when:** `schema.int.test.ts` case "the prune predicates are indexed on both sides" green; `enumerations.test.ts` case "every expiring table is pruned or excluded by name" green and red on a table removed from both lists; `seeds.int.test.ts` "a second run changes nothing" counts invitations; `pnpm db:migrate` applies the migration against the dev database; `docker compose -f docker/prod/compose.yaml config` renders the floored interval; `pnpm test --filter=@repo/db` green.
      **Amended 2026-09-21 (D28.4).** Two readings, neither a change of scope. "Every migration from `0011` on" names two files that shipped without a lock note, `0011_organizations.sql` and `0012_backfill_personal_organizations.sql`. Committed migrations are never edited (ADR-0008), so the hygiene case names those two as a closed list of exemptions and holds every later file to the note. And the "Routed, not taken" line above sends `DB-09` and `DB-10` to D24, while this step, as written at scoping, closes them. The step is the later and the more specific text, so it is the one built: both close here, and the routing line is read as superseded for those two ids.
- [x] **5. The cap counts the customer's own sessions; every link is spent in one place.** `auth.repository.ts`'s cap read excludes impersonated rows from the count as well as from the doomed set — [ADR-0073](../adr/0073-review-hardening.md) §3's delta true here; `core/tokens` gains `supersedeAll(ctx, principal, tx)` and the three loops and `users.service.ts`'s `setPassword` call it; `users.lifecycle.service.ts` calls it inside the delete transaction — [ADR-0071](../adr/0071-mail-flows.md) moves at this head. The sessions and account-tokens specs gain the scenarios. Closes `SEC-09`, `API-09`, `DB-11`.
      **ADRs:** 0074 §4–§5, 0073 §3, 0071, 0057.
      **Done when:** `auth.sessions.service.test.ts` case "impersonated sessions neither count toward the cap nor are evicted by it" green; `users.service.test.ts` case "an administrative reset spends every outstanding link" green; `users.lifecycle.service.test.ts` case "deletion leaves no redeemable token" green; `mail-flows.int.test.ts` scenario for the reset; the two specs name those tests and `pnpm docs:check` is clean; `security-reviewer` has read the diff; `pnpm test --filter=api` green.
      **Amended 2026-09-21 (D28.5).** The call sites are read from ADR-0074 §5 — "every credential event" — not only from the four the review named: both password changes, the reset by mail and the staff hard delete call `supersedeAll` too. `auth.sessions.service.test.ts` did not exist; the step writes it.
- [x] **6. The API tidy.** `invitations.repository.ts` throws `internal()`; `packages/config-eslint/api.js` refuses `throw new Error` in a repository; `auth.service.ts`'s re-export block goes and `index.ts` imports from `auth.types.js`; the container stops returning the raw `hasher`; `server.test.ts` asserts Node's default values and the `headers < request` relation; the three docblocks in `rate-limit.ts` and `rate-limiters.ts` say what the code does. Closes `API-10`, `API-11`, `API-12`, `SEC-13`.
      **ADRs:** 0013, 0009, 0073 §1–§2, §4.
      **Done when:** `pnpm lint --filter api` red on a `throw new Error` placed in a repository and green on the tree; `core/__tests__/container.test.ts` surface has no `hasher`; `server.test.ts` cases "Node's own values stand when config does not set them" and "the headers timeout is shorter than the request timeout" green; `pnpm test --filter=api` green.
- [x] **7. The ceiling covers `core`; the policy is proved on the page.** `LINE_CEILING_ROOTS` gains `apps/api/src/core`; `scripts/size.mjs` refuses a built `index.html` carrying an inline `<script>`, `<style>` element or `on*=` attribute, and warns when a measurement exceeds its baseline by more than ten percent. Closes `API-08`, `SEC-10`, `CI-12`.
      **ADRs:** 0074 §6, §8; 0073 §5, §9–§10.
      **Done when:** `scripts/docs-hygiene.test.mjs` line-ceiling case covers `core` and is green; `scripts/size.test.mjs` cases "a built page with an inline script fails the link" and "a measurement ten percent over its baseline is reported" green; `pnpm size` green on the tree.
- [ ] **8. What a screen reader hears.** A door-side `spinner.tsx` in both apps passes `aria-label={t("common:loading")}` and the doors export it instead of the primitive; the three fragment landings (`auth-google`, `impersonate`, `accept-invitation`) carry `role="status"` on the pending sentence and `role="alert"` on the failed branch. Closes `FE-10`, `FE-11`.
      **ADRs:** 0046 §12, 0047, 0068 (the three SPA specs).
      **Done when:** `apps/customer/src/app/__tests__/pseudo-locale.test.tsx` case "the spinner's label is a catalogue string" green; the three landing tests assert the roles by `getByRole("status")` and `getByRole("alert")`; `pnpm i18n:check` green; `pnpm test:unit --filter customer --filter admin` green.
- [ ] **9. No client directive; five packages declare their side effects.** `"use client"` leaves the four compositions and the two skills, [ADR-0047](../adr/0047-ui-package-scope.md) moves to `superseded by` at this head; `@repo/api-client`, `@repo/i18n`, `@repo/resource`, `@repo/app-services` and `@repo/contracts` declare `sideEffects: false` and `composition.test.ts`'s `SHAKEABLE` names them; `pnpm size` measured before and after with the budget files diffed if an entry moves. Closes `FE-12` (and so `UI-02` whole), `FE-13`.
      **ADRs:** 0074 §7, 0047, 0062 §4 as carried by 0073 §5.
      **Done when:** `scripts/docs-hygiene.test.mjs` case "no client directive under `packages/ui`" green; `packages/app-kit/src/__tests__/composition.test.ts` `SHAKEABLE` case green with seven packages; `pnpm size` green with the measurement in the notes; `pnpm check` green.
- [ ] **10. The admin unit tier, measured.** _Timeboxed spike in a worktree (ADR-0050 §Verification), two hours._ `pnpm test:unit --filter admin` timed on the tree, then with `coverage.enabled` off, then with the seven source-only packages pre-bundled (`deps.optimizer` or `server.deps.inline` in `packages/config-vitest/react.ts`); if the win is a config change, it lands here with coverage behind `--coverage` and ADR-0074 amended in place, labelled; otherwise the numbers go into D22's row as its input. Closes or routes `FE-09`.
      **ADRs:** 0074 (Consequences), 0073 §6, 0062 §Consequences.
      **Done when:** the notes carry the three timings from `apps/admin/.turbo/turbo-test$colon$unit.log`; if landed, `pnpm test:unit --filter admin` twice, the second `FULL TURBO`, and `pnpm test:unit -- --coverage --filter admin` still prints a summary; `pnpm check` green.
- [ ] **11. The ledger, the notes and the fork's view.** D26's row names "the three longest rows of the index's topic table"; D21's row says "the packages' `dist-types` emission"; `0020-review-hardening.notes.md` item 4 gains a labelled correction pointing at §How D20 closed; `docs/forking.md` §2 says which process files a fork may delete and which it may not. Closes `PRO-09`, `PRO-10`, `PRO-11`, `PRO-12`.
      **ADRs:** 0065, 0068, 0025.
      **Done when:** `pnpm docs:check` clean; `pnpm test:scripts` green; `pnpm format:check` green.
- [ ] **12. Close-out.** The review re-read finding by finding: each id in `docs/reviews/2026-09-21-repo-review.md` gains its fate — `Closed at D28.<n>`, the row it was routed to, or that it is an `Info` observation with nothing to close; the digests regenerated; then the definition of done.
      **ADRs:** 0074, 0068, 0065.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D28.12` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` — with `lint` carrying `test:scripts`, `docs:check` and `i18n:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO` (ADR-0026 as carried).
3. `turbo run lint --dry=json` names both apps' `i18n:check` among `lint`'s dependencies.
4. `pnpm why -r jsdom` resolves one version; `pnpm audit --prod` reports no advisory; `pnpm outdated -r` lists behind a major only what D21's row names.
5. `pnpm rules:digest` writes nothing on a second run, and the generator's coverage case is green.
6. `pnpm db:migrate` against the dev database is up to date with the partial-index migration applied; `pnpm db:seed -- --dev` twice, identical output.
7. `pnpm test:e2e` green in both apps against the local compose, the floors unchanged from `D20.13`'s.
8. `pnpm test:postman` exit `0` with the counts the READMEs state.
9. Every finding id in the 2026-09-21 review carries `Closed at D28.<n>`, the row it was routed to, or "nothing to close".

## Not in D28

The majors (D21); the providers, the account features and the door-level suites moving into packages, and the six long test files (D22, `FE-15`); the key ring (D23); the scheduler, the outbox, resource limits, the unprivileged nginx images and the fetch-first Dockerfile layers (D24, `CI-10`, `CI-11`); row-level security (D25); the consolidation records (D26); the compiler's memory in the cache (D27); a coverage threshold; OpenAPI, compression, Postgres 17/18 and the route-file prose (`API-03`, `API-06`, `API-07`, `DB-05`, still deferred).
