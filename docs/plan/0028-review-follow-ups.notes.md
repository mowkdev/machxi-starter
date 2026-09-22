# D28 — Review follow-ups: build notes

The per-step build record of [D28](0028-review-follow-ups.md) — what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D28.1 — Accept ADR-0074; the first link runs every check (2026-09-21)

**Built.** Closes `CI-08` and `CI-09`.

- **ADR-0074 accepted at the head.** Its status is `accepted`, and its blockquote now records the date. [ADR-0073](../adr/0073-review-hardening.md) moved to `superseded by` 0074, and its status line lists all five deltas. Only §6's delta (plus §7's audit) is true at this step. The rest become true at the steps that build them, which is how D20 moved 0059. In the index, 0073's row moved to `superseded by … (deltas)` with a `D28.1` entry, and 0074's row moved to `accepted` with the acceptance recorded. Two topic-table rows now read "0073 as carried by 0074": the task graph and CI. The ledger's §The window paragraph now uses the past tense ("accepted 2026-09-21 … moved"), and the plan's Records line records the date. 0047, 0065 and 0071 have not moved; each moves at its own step.
- **`turbo.json`**: `lint`'s `dependsOn` gains `i18n:check`, a same-package task, beside `//#test:scripts` and `//#docs:check`. `turbo run lint --dry=json` shows `admin#lint` depending on `admin#i18n:check` and `customer#lint` depending on `customer#i18n:check`.
- **`.github/workflows/e2e.yml`**: an "Audit the runtime dependencies" step after install. It runs `pnpm audit --prod` with `continue-on-error: true`, and emits a `::warning::` annotation when it finds advisories. Both workflows parse with `js-yaml`.
- **`scripts/docs-hygiene.test.mjs`**: a new case, "the first link carries every check that can go red", which uses a pure `missingFirstLinkChecks` predicate. The gate is parsed from `CLAUDE.md`, and the gate's own links are excluded. A check means one of these:
  - a root script that is not a `turbo run` launcher and is either named `*:check` or runs `node --test`; the first link must name it as `//#<name>`;
  - a workspace script named `*:check`; the first link must name it by its bare task name, or as `<pkg>#<name>` when that workspace has no `lint` script to carry it.

  The case also calls the predicate on a copy with `i18n:check` removed and another with `//#docs:check` removed, and asserts that each copy reports the missing check. It went red against the real `turbo.json` with `i18n:check` removed (`actual: [ 'i18n:check' ]`), and green again once restored.

- **The prose that describes the first link**: `CLAUDE.md` Commands (still under 6 KB, at 6017 bytes), `README.md` §Commands and §The gate, and `gate.yml`'s header comment. The root `check` script drops its separate `i18n:check`, because `lint` now carries it.
- **`packages/config-eslint/index.js`: `coverage/` is ignored as a directory.** This is not in the plan. It is a race that the new dependency exposed. `admin#lint` now starts after `admin#i18n:check`, and that timing put it inside the window where `admin#test:unit` creates and deletes `apps/admin/coverage`. eslint's directory walk then failed with `ENOENT: scandir …\apps\admin\coverage`, and the second `pnpm check` went red on `admin#lint`. An ignored directory is never entered. I checked this with a probe file inside `coverage/`: eslint reported it as ignored.
- **Digests**: `pnpm rules:digest` wrote 0 of 3. No digest line cites 0073 as a primary record; the coverage is D28.3's work.

**Amendments.** None to ADR-0074 or the plan.

**Review: one `adr-reviewer` pass over the diff, which conforms. Three minor findings, all fixed.**

- **[minor, fixed]** The predicate treated a bare `*:check` as covered even in a workspace with no `lint` script, where turbo would never schedule it. Such a workspace is now required as `<pkg>#<name>`.
- **[minor, fixed]** The root `check` script still listed `i18n:check`, while `CLAUDE.md` and `README.md` said `lint` carries it. I dropped it from the script.
- **[minor, fixed]** The audit reported only inside a green job's step log. It now also emits a `::warning::` annotation on the run's page.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`. Each link reported: `lint` 21/21, `check-types` 16/16, `test` 15/15, `size` 4/4, and "All matched files use Prettier code style!".

- After the review fixes, which touched only the hygiene test, `e2e.yml` and the root `check` script: `pnpm check` exited `0` (52/52), `pnpm lint` was FULL TURBO (21/21), `format:check` was clean, and the hygiene file passed 27 tests with 0 failures.
- The first `pnpm check` of the step failed once on `@repo/form#test:unit` under load. It passed alone (7/7) and on every run after, so I am recording it as flaky under contention, not a regression.

**Pending the operator.** The audit step runs only on the nightly or dispatched e2e workflow. Its first real run, and whether the annotation shows up on the run page, can be seen only on GitHub. No dev server's sources changed, so nothing needs a restart.

## D28.2 — One `jsdom` fact, one cooldown (2026-09-21)

**Built.** Closes `STK-08`, `STK-09` and `STK-10`.

- **`pnpm-workspace.yaml` holds `jsdom` once**: `overrides: { jsdom: 30.0.1 }`, with a comment saying why an override and not the pins (`autoInstallPeers` answered vitest's open `jsdom` peer with the held release in the seven workspaces that never declared it). The lockfile was refreshed by `pnpm install`: its only change is the override block, vitest's snapshot re-keyed on `jsdom@30.0.1`, and `jsdom@30.1.0` with its two `@asamuzakjp` dependencies gone. `pnpm why -r jsdom` ends "Found 1 version of jsdom".
- **One cooldown for both tools**: `renovate.json` gains `"minimumReleaseAge": "1 day"` beside pnpm's `1440`. The pnpm setting's comment now carries the one-install procedure for a security fix younger than the cooldown — `pnpm add <pkg>@<version> --config.minimum-release-age=0` or `pnpm update <pkg> …`, the package always named — and says that Renovate's vulnerability-alert pull requests clear the cooldown by default, so such a branch is finished by that procedure. `pnpm config get minimumReleaseAge --config.minimum-release-age=0` prints `0` (the flag is honoured by pnpm 12.4.2).
- **Renovate's `jsdom` rule states the same version as the override**: `allowedVersions` `"<30.1.0"` → `"30.0.1"` (review finding 3), and its register note names the override as the hold and says to lift both together.
- **`scripts/docs-hygiene.test.mjs`**: case "a held dependency is one fact", over pure helpers `overrideNames` (quoted, scoped, `@selector` and `parent>child` keys) and `lockfileVersions` (reads the **last** YAML document's `packages:` — pnpm 12 writes its own install as a first document with a `packages:` of its own). Green on the tree; red on the pre-step lockfile (`actual: 2, expected: 1`); the case also injects a second copy and asserts `heldTwice` reports it.
- **D21's ledger row** names `@types/node` 26 and `dotenv` 18.

**Where it was built.** The lockfile refresh ran in a side worktree (`.claude/worktrees/d28-2`, its own `node_modules`) while the operator's stack kept running, per the operator's rule for installs; the commit was fast-forwarded into `main`. The operator's `.env` files could not be copied into it (permission denied), so the worktree ran on the committed `.env.example` files — the README's quick-start setup — against the running Postgres.

**Amendments.** None to ADR-0074 or the plan.

**Review: one `code-reviewer` pass, three findings, all fixed.**

- **[fixed]** The comment claimed Renovate never proposes what pnpm refuses; Renovate's vulnerability alerts clear `minimumReleaseAge` by default. The comment now names that exception and routes it to the manual procedure (STK-09's "a `vulnerabilityAlerts` PR hits the same wall" is answered by the procedure, not removed).
- **[fixed]** "`pnpm update` with the same flag" would re-resolve the whole workspace without the cooldown; the procedure now always names the package.
- **[fixed]** `allowedVersions: "<30.1.0"` let Renovate propose a `30.0.x` the exact override would install back to `30.0.1`; the rule now states `30.0.1`.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`: `lint` 21/21, `check-types` 16/16, `test` 15/15 (6m36s), `size` 4/4, then `format:check` red on three files' Prettier layout. After `prettier --write` (whitespace only) and the review fixes (comments, `renovate.json`'s `allowedVersions`, none of them read by `test` or `size`): `pnpm lint` and `pnpm format:check` green. `pnpm check` exit `0` (52/52). `pnpm test:unit --filter customer --force`: 32 files, 284 tests passed.

**Pending the operator.** `main`'s `node_modules` still holds `jsdom@30.1.0` until the next `pnpm install` there, which the operator runs at their convenience (nothing the dev servers load changes, so no restart is needed for it). The side worktree `.claude/worktrees/d28-2` can be removed with `git worktree remove`.

## D28.3 — The digests carry every decision, and the generator refuses a record with none (2026-09-21)

**Built.** Closes `PRO-08` and `API-13`.

- **`scripts/rules-digest.mjs` gains its lines.** ADR-0073's decisions now have lines of their own. In api-and-data: the per-principal hash budget (§1), limiter keys (§2), the session cap and the prune (§3, with ADR-0074 §4's count), server timeouts and the runtime floor (§4), invariants in the database (§8), and the composition root and line ceiling (§10, with ADR-0074 §8). In frontend-and-platform: budget headroom (§5) and the content policy (§9, with ADR-0074 §6). In process: the first link runs every check (§6, with ADR-0074 §1 and the nightly audit) and pinning, holds and the cooldown (§7, with ADR-0074 §2). ADR-0074 is also named in its own right on the new credential-events line (§5, with ADR-0071), on "Generated versus written UI" (§7, no client directive) and on "The digests" (§3). Some of ADR-0074's decisions are built at later D28 steps. They are stated here as the rule in force, because the record is accepted.
- **ADR-0066's line stops counting limiters** (`API-13`). It now reads "every rate limiter shares one store", and "All four seams are inert".
- **The generator refuses.** `uncitedRecords(areas, records)` returns the accepted records (`/^accepted\b/`) that no line names in its own `records`. `generate()` throws on a non-empty result before it formats or writes anything, and it now takes `areas` so the refusal can be tested. The file header states the rule.
- **`scripts/rules-digest.test.mjs`** adds two cases:
  - "every accepted record is the primary citation of a line". It is green on the tree. With one accepted record stripped from every line, the same case gets exactly `[id]` back and `generate` rejects naming that record.
  - "a record cited only as a carrier is not cited as its own".
- **`.claude/skills/new-adr/SKILL.md` step 5**: accepting a record means writing its rule lines, because the generator refuses otherwise.
- `pnpm rules:digest` wrote **3 of 3**, then **0 of 3**. After the review fixes it wrote 2 of 3, then 0 of 3.

**Amendments.** The plan's step 3 is amended in place, labelled. "Primary citation" is taken to mean that a line names the record in its own `records`, not only in an "as carried by" suffix, which is how the review's evidence reads it. Under that reading, four more accepted records had no line: ADR-0028, 0069, 0070 and 0072. Their lines are written here: account deletion, the development rate-limit profile, impersonation in a new tab together with the exchange that ends what it replaces, and federated identity. No record changed.

**Review: one `adr-reviewer` pass over the diff, which conforms. Three minor findings, all fixed.**

- **[minor, fixed]** The ADR-0070 line had the order wrong. The opener is disowned after the mint and before navigation, not before the mint.
- **[minor, fixed]** ADR-0070 §4's exchange rule is an API rule, but it was only in frontend-and-platform. It now has its own api-and-data line.
- **[minor, fixed, partly]** "before the first accept" had no source in ADR-0073 §4. The line now says "beside the drain deadline". The reviewer's optional point stays as the plan placed it: the runtime floor sits in api-and-data (§4 in api-and-data), not in process.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`. The links reported: `lint` 21/21, `check-types` 16/16, `test` 15/15, `size` 4/4, and "All matched files use Prettier code style!". After the review fixes, which touched only digest text: `pnpm check` exited `0` (52/52), the script tests passed 49/49, and `format:check` was clean.

**Pending the operator.** Nothing. No running server's sources changed.

## D28.4 — The prune service's predicates, its list, its floor — and the seeds' one transaction (2026-09-21)

**Built.** Closes `DB-07`, `DB-08`, `DB-09`, `DB-10`, `DB-12`, `SEC-11`, `SEC-12`.

- **`DB-07`.** Migration `0018_prune_predicate_indexes.sql` was generated by drizzle-kit and adds three partial btrees: `sessions (revoked_at)` and `(consumed_at)` on `impersonation_handoffs` and `account_tokens`, each `where … is not null`. The file opens with its ADR-0060 §5 lock note. Each build is a plain `CREATE INDEX` holding `SHARE` on the old API's tables, and a large `sessions` table means a maintenance window. The schema files declare the indexes. `schema.test.ts` expects them. `schema.int.test.ts` case "the prune predicates are indexed on both sides" asserts each expiry index and its partial twin from `pg_indexes`. `pnpm db:migrate` applied the migration to the dev database, and `pg_indexes` there lists all three.
- **`DB-08`.** `prune-sessions.ts` exports `SWEEPS`. `main` iterates it, so the list and the behaviour are one fact, and the output line is unchanged in shape. The file also exports `PRUNED_TABLES` and `NEVER_PRUNED_TABLES`, the latter being `organization_invitations` with its reason. `enumerations.test.ts` case "every expiring table is pruned or excluded by name" finds tables by a column matching `/expires_?at$/i`, which catches `sessions.refreshTokenExpiresAt`. It is green, and its built-in negative case reports `sessions` by name when that table is removed from both lists.
- **`DB-09`.** `runSeeders` wraps each seeder in `db.transaction` and hands the seeder the transaction. `SeedContext.db` and `ensurePersonalOrganizations` now take a `DbExecutor`. The unit case "runs each seeder inside a transaction of its own" proves each seeder received the handle.
- **`DB-10`.** `seeds.int.test.ts`'s idempotency case is renamed "a second run changes nothing". It counts `organization_invitations` and asserts that count is non-zero before the second run.
- **`DB-12`.** `scripts/docs-hygiene.test.mjs` case "every migration from 0011 on opens with its lock note". It checks the leading `--` block for lock or block wording, and carries a predicate self-test.
- **`SEC-11`.** The prod compose `prune` command reads `PRUNE_INTERVAL` once into seconds before the loop. It accepts whole numbers with an optional `s`, `m`, `h` or `d`, and floors them at 60 seconds. Anything else is a day: empty, a phrase, a fraction, a leading zero, or ten or more digits. The inner `|| sleep 86400` is gone, since the value is always an integer. I checked it by hand under dash (`node:24-bookworm-slim`, the image's base) and busybox with these inputs: `''`, `0`, `0s`, `1`, `59`, `900`, `15m`, `6h`, `24h`, `1d`, `1 day`, `daily`, `1.5h`, `08m`, `00` and `106751991167301d`. `docker compose -f docker/prod/compose.yaml config` renders the floored command. `docs/deploy.md` and `docker/prod/.env.example` state the accepted forms.
- **`SEC-12`.** `REVOKE_REASONS.sessionCap` replaces the literal. `RevokeBeyondCapInput.reason` is `RevokeReason`.

**Amendments.** The plan's step 4 is amended in place, labelled, with two readings:

- `0011` and `0012` shipped without a lock note and are never edited, so the hygiene case exempts them by name as a closed list.
- The scoping decisions route `DB-09` and `DB-10` to D24, but the step closes them. The step was built, and the routing line is read as superseded for those two ids.

No record changed.

**Review: one `code-reviewer` pass. Nothing breaking; two low findings, both fixed.**

- **[low, fixed]** A digit run long enough to overflow the shell's arithmetic could wrap negative and land on the one-minute floor. Ten or more digits now fall back to a day.
- **[low, fixed]** The expiry detector read only the TypeScript key. It is now `/expires_?at$/i`, so an explicitly named `expires_at` column is caught too.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`: `lint` 21/21, `check-types` 16/16, `test` 15/15 (`@repo/db` 6+6 files, 103 unit and 113 integration tests), `size` 4/4, and "All matched files use Prettier code style!". After the review fixes, which touched only the compose command, one regex and comments, `pnpm check` passed 52/52, `format:check` was clean, and `docker compose … config` rendered the new branch.

**Pending the operator.** Nothing needs a restart. `0018` is already applied to the dev database, and the API reads nothing new.

## D28.5 — The cap counts the customer's own sessions; every link is spent in one place (2026-09-21)

**Built.** This step closes `SEC-09`, `API-09` and `DB-11`. [ADR-0071](../adr/0071-mail-flows.md) moved to `superseded by` [ADR-0074](../adr/0074-review-follow-ups.md) at this head, and ADR-0073 §3's delta is now true. The index rows, the topic table (mail flows, sessions, account deletion) and the ledger's window section record both.

- **`SEC-09`.** `revokeOldestBeyondCap` now filters out rows with `impersonated_by_staff_id` in the query itself, so they are neither counted nor candidates for eviction. The harness fake mirrors the change.
  - New file `auth.sessions.service.test.ts`, case "impersonated sessions neither count toward the cap nor are evicted by it".
  - The integration case in `auth-sessions.int.test.ts` is rewritten as "is neither counted toward the cap nor the one revoked": one impersonated session, three ordinary sessions, a cap of two, and exactly one revocation (the oldest ordinary session). The old rule would have revoked two.
- **`API-09`, `DB-11`.**
  - `core/tokens` gains `supersedeAll(ctx, principal, tx)`. It runs every `TOKEN_PURPOSES` entry on the caller's transaction, with `reset_password` swept first, and logs one line when anything was spent.
  - Callers:
    - users: `setPassword`, `setEmail`, `changePassword`, and both deletion paths (`remove`, `deleteProfile`, in `users.lifecycle.service.ts`)
    - staff: `setPassword`, `setEmail`, `changePassword`, `remove`
    - `resetPassword`, the reset by mail
  - Lock order: every sweep runs **before** the account row is written or locked, which is the order a consume takes. The `federated_login` supersede stays **after** the lock in the two resets, and deletion gains the same second sweep, because the Google callback mints behind that lock.
  - Tests:
    - `tokens.test.ts`, case "spends every purpose of the principal, on the caller's transaction"
    - `users.service.test.ts`, case "an administrative reset spends every outstanding link"
    - `users.lifecycle.service.test.ts`, case "deletion leaves no redeemable token", covering both actors
    - `mail-flows.int.test.ts`, case "an administrative reset spends every outstanding link": live `change_email` and `reset_password` links both answer `401` after the reset, and no row of the account is redeemable
- **Specs.** `auth-sessions.md`: the cap requirement now counts only the account's own sessions, and its impersonation scenario is rewritten. `mail-flows.md`: new requirement "A credential event spends every outstanding link", with two scenarios. Both name the tests above. `docs/rules/api-and-data.md` was regenerated for 0071's new status (`rules:digest` wrote 1 of 3).

**Amendments.** The plan's step 5 is amended in place, labelled. Its call-site list is read from ADR-0074 §5, and the unit file the done-when named is created. No record text was amended.

**Review: one `security-reviewer` pass.** It found no link that survives a credential event. It made four findings, all about lock order:

- **[medium, fixed]** Deletion wrote the account row before sweeping, which inverts against every consume and can deadlock. It now sweeps first and sweeps `federated_login` again after the write.
- **[low, fixed]** `supersedeAll` inside the reset by mail could deadlock with a concurrent sweep through a `verify_email` row. `reset_password`, the row the reset already holds, is now swept first.
- **[low, fixed; predates the step]** Staff `setPassword`, staff `setEmail` and users `setEmail` wrote before sweeping. All three now sweep before the write.
- **[low, not taken; predates the step]** The `federated_login` re-sweep after the lock inverts against the exchange, which consumes its token and then writes the account. The abort is harmless and the window is sixty seconds. The fix would be for the exchange to take `lockAccount` before consuming. Logged for the next step that touches the federated exchange.
- **Residuals, for a future record:**
  - A mint that takes no lock, such as `requestEmailChange`, can commit after a credential event that has already swept. A per-account credential epoch refused at consume would close this whatever the lock order.
  - Nothing retries SQLSTATE `40P01`.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`, both before the review fixes and after them:

- `lint` 21/21, `check-types` 16/16, `test` 15/15, `size` 4/4
- API: 48 unit files (784 tests) and 28 integration files (823 tests)
- Prettier: "All matched files use Prettier code style!"

**Pending the operator.**

- The running API on 4000 still serves the old code until it next reloads. The cap and the sweeps change behaviour only; there is no migration and no new variable.
- Separate from this step: `D28.3` did not move [ADR-0065](../adr/0065-starter-lifecycle.md) to `superseded by` for its §5 digest delta, which is true since that step. The ledger's window section still lists it as pending.

## D28.6 — The API tidy (2026-09-21)

**Built.** This step closes `API-10`, `API-11`, `API-12` and `SEC-13`. There is no behaviour change and no spec edit.

- **`API-10`.** `invitations.repository.ts` now throws `internal(new Error(…))` for its "cannot happen" branch.
  - `packages/config-eslint/api.js` has a new block for `src/**/*.repository.ts` that refuses `throw new Error(…)` and `throw Error(…)`. A wrapped `internal(new Error(…))` is not affected.
  - The block restates the `src/**/*.ts` selectors (functional style, raw response, fake provider). A later flat-config block's `no-restricted-syntax` replaces an earlier one's rather than merging with it.
  - Proved by hand: a temporary `zz-probe.repository.ts` with a bare `throw new Error` is reported by the rule. With `--max-warnings 0`, that makes `pnpm lint --filter api` red. The file was then deleted, and the tree lints green.
- **`API-11`.** The re-export block in `auth.service.ts` is removed. `index.ts` now imports the constants and input types from `auth.types.js`, and only `createAuthService` and `AuthService` from `auth.service.js`.
- **`API-12`.**
  - The container no longer returns the raw `hasher`. `container.test.ts` has a new case, "exposes no raw hasher on its surface".
  - The review's evidence ("nothing reads the hasher") was partly false. 43 integration call sites read `container.hasher`. They are now served by a hasher in the test harness (`test/support/app.ts`), built from the same `config.auth.argon2`, and `support/seed.ts` and the 24 integration files are repointed to it. Nothing in `src/` read it.
  - `server.test.ts`: "Node's own values stand when config does not set them" compares against a bare `createServer()` value for value. "the headers timeout is shorter than the request timeout" holds for both the configured defaults and Node's own.
- **`SEC-13`.** The docblocks in `rate-limit.ts` (the mail-source limiter's fallback, the principal-hash limiter) and `rate-limiters.ts` (`principalHash`) now say what the code does:
  - `ipKey` falls back to the socket's remote address with one warning per process (ADR-0073 §2), so there is no shared bucket.
  - The mount roster lives in the specs and the integration tier, not as a count in a comment.

**Amendments.** None to the plan or to any record.

**Review: one `code-reviewer` pass** (in the first attempt at this step). It found no correctness bugs. It made one comment-only finding, **[fixed]**: the `rate-limit.ts` docblock still described the old `ipKey` fallback.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`:

- `lint` 21/21, `check-types` 16/16, `test` 15/15, `size` 4/4
- API: 48 unit files (786 tests) and 28 integration files (823 tests)
- Prettier: "All matched files use Prettier code style!"

The first run was killed partway through `pnpm test` for low memory. This retry ran the gate whole.

**Pending the operator.** The running API on 4000 serves the old code until it next reloads. Nothing changes its behaviour; there is no migration and no new variable.

## D28.7 — The ceiling covers `core`; the policy is proved on the page (2026-09-21)

**Built.** This step closes `API-08`, `SEC-10` and `CI-12`. It changes only the gate's scripts, so there is no product behaviour change and no spec edit.

- **`API-08`.** `LINE_CEILING_ROOTS` in `scripts/docs-hygiene.test.mjs` now includes `apps/api/src/core`, as ADR-0074 §8 decides.
  - The largest file under `core` is `core/config/schema.ts` at 908 lines, so the case is green on the tree.
  - The case's existing `files.length > 0` assertion now covers the new root too, so a renamed directory fails the case instead of passing it with nothing read.
  - The digest line D28.3 wrote already said "the API's modules and `core` among them". It is now true.
- **`SEC-10`.** `scripts/size.mjs` gains a pure `inlinePageViolations(html)`, run inside `check` right after `measure` has proved `dist/index.html` exists. It refuses three things, as ADR-0074 §6 decides:
  - an inline `<script>`, meaning one with no `src` or one with a body;
  - any `<style>` element;
  - any `on*=` attribute.
  - Each offence gets its own sentence, plus a paragraph naming the policy and the production-only failure.
  - Both built pages pass as they stand.
  - `scripts/size.test.mjs` case "a built page with an inline script fails the link" has seven offending pages, each producing exactly one violation. It also runs `check` over a whole fixture app twice: the clean page is `ok`, and a page with an inline script throws the refusal.
- **`CI-12`.** `DRIFT_PERCENT = 10` and a pure `driftWarnings(baseline, rows)` cover the totals and, through a `chunk` flag on the chunk rows, `baseline.chunks`.
  - A row measuring more than 10% over its baseline prints a `size: warning — …` line under the table. The comparison is strict and uses integer arithmetic.
  - The warning never fails the link: the ceiling is still the gate.
  - Case "a measurement ten percent over its baseline is reported" covers the pure function, including that exactly 10% is not reported and that a row with no baseline is left to `headroomViolations`. It then runs `check` over a fixture whose `js` baseline is 12% stale: the link is `ok`, with exactly one warning. A fresh baseline prints none.
  - The script's header no longer claims that "a baseline cannot go stale without this script saying so" on the strength of the headroom rule alone.
- **Digest.** The "Budget headroom" line in `scripts/rules-digest.mjs` now states the drift warning. `pnpm rules:digest` wrote 1 of 3 digests, then 0 of 3.

**Amendments.** None to the plan or to any record. ADR-0074 §6 and §8 are this record's own decisions. ADR-0073 moved to `superseded by` at D28.1, so no status changes here.

**Review: one `code-reviewer` pass.** It found no correctness bugs. It made three low-severity notes and one comment correction:

1. **[fixed]** The handler regex ran over quoted attribute values, so `content="Sign on=now"` was refused. It also missed a handler after a `/` separator, as in `<img/onerror=…>`. The quoted values are now blanked before matching, and `[\s/]` may come before the name. Both cases are pinned in the test.
2. **[fixed]** A commented-out `<script>` in the source `index.html`, which Vite keeps, would have been refused. Comments are now dropped first, and a test pins this.
3. **[not taken]** The check does not look for `javascript:` URLs. ADR-0074 §6 names three forms, and a bundler emits none of this kind. This is logged here, not built.
4. **[fixed]** A test comment said "refused before any budget is read". It now says "before any budget rule runs".

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`, after the review fixes:

- `lint` 21/21, `check-types` 16/16, `test` 15/15, `size` 4/4
- API: 786 unit and 823 integration tests passed
- Prettier: "All matched files use Prettier code style!"
- `pnpm size` on the tree: admin js 371.4 / 389.6 kB, entry 157.1 / 165.0 kB; customer js 320.0 / 335.9 kB, entry 105.1 / 110.4 kB, all `ok`, and no drift warning.

**Pending the operator.** Nothing. The running stack serves no script here.

## D28.8 — What a screen reader hears (2026-09-21)

**Built.**

- **`FE-10`.** Each app now has a `shared/ui/spinner.tsx` that renders the `@repo/ui` primitive with `aria-label={t("common:loading.label")}`. The primitive itself is unchanged and stays byte-identical.
  - Both doors export this spinner in place of the primitive.
  - The admin's `confirm-dialog.tsx`, which imported the primitive directly, now imports `./spinner`.
  - `loading.label` is in both apps' `en` and `lv` catalogues ("Loading", "Notiek ielāde").
  - The one other place the English name reached a screen was the submit button in `@repo/form`'s `AppFormActions`. It now takes `form:actions.pending` from the package's own catalogue.
  - `pseudo-locale.test.tsx` case "the spinner's label is a catalogue string" renders the door's spinner under the lens and asserts that its name is accented. A second case asserts the English accessible name "Loading". Exporting the primitive again turns the first case red.
- **`FE-11`.** The sentence on each of the three fragment landings is now a live region:
  - A pending or waiting sentence is `role="status"`.
  - A failure is `role="alert"`.
  - On `auth-google` and `impersonate` the node is keyed on its role. A failure therefore arrives as a new node, instead of a role being rewritten in place.
  - On `accept-invitation`, the pending sentence's spinner is `aria-hidden`, so there is one status rather than a status nested in a status. The failed check is one alert holding both the screen's sentence and the code's sentence. The code's sentence is a plain paragraph, not a `FieldError`, because a `FieldError` would carry its own nested `role="alert"`.
  - Each landing suite gains a "what a screen reader hears" describe that asserts the roles with `findByRole("status")` and `findByRole("alert")`. The pending case holds the request open with a pass-through handler.
  - The three `spa-*.md` specs gain a "What a screen reader hears" scenario. Their requirements' `Proved by:` already named these suites.
  - `impersonation-exchange.test.tsx`'s "overwrites a real customer session" case now waits for home before reading the banner's `status`, because the landing's own sentence is a status too.

**Amendments.** One labelled amendment to the plan's step 8, recording three readings:

- the key is `common:loading.label`, because `common:loading` is already a group;
- `@repo/form` takes the fix from its own namespace;
- the nested-status and one-alert choices on the invitation screen.

No record changed.

**Review: one `code-reviewer` pass.** No confirmed defects, and three low-severity findings:

1. **[logged]** No test sees `@repo/form`'s new spinner label, because its English value is the primitive's "Loading". Adding one would mean a pending-submit render under the lens or in `lv`. The done-when does not ask for it, and it waits for D22, when the form suites move into the package.
2. **[logged, uncertain]** Moving from pending to an offer, and from retry back to pending, on the invitation screen may be silent in some screen readers. The status node mounts and unmounts rather than persisting, and the offer sentence is not a live region. The spec promises the roles, and it holds. A persistent status wrapper would close this and is left for a later a11y pass.
3. **[fixed]** The three pending cases asserted `toHaveTextContent(/.+/)`. They now match the pending sentence itself.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`:

- `lint` 21/21, `check-types` 16/16, `test` 15/15 cold, `size` 4/4
- customer 296 tests, admin 537, `@repo/form` 7, API 786 unit and 823 integration
- Prettier: "All matched files use Prettier code style!"
- `pnpm size`: customer js 320.5 / 335.9 kB, entry 105.1 / 110.4 kB; admin js 371.5 / 389.6 kB, entry 157.1 / 165.0 kB, all `ok`.

Finding 3's fix touched only three test files. After it, those three suites were re-run green (41 tests) and `prettier --check` was clean.

**Pending the operator.** Hearing the landings through a real screen reader. The roles are proved in jsdom, and how NVDA or VoiceOver announces them is a browser-only observation.

## D28.9 — No client directive; five packages declare their side effects (2026-09-21)

**Built.** Closes `FE-12` (and with it `UI-02` whole) and `FE-13`.

- `"use client"` left the four compositions (`app-shell`, `banner`, `page-actions`, `record-surface`) and `ui-strings.tsx`, which carried it under the same withdrawn rule. `banner.tsx`'s docblock now says why there is none. Both skills (`ui-component`, `frontend-conventions`) state the rule the other way round: a composition carries no client directive, and a consumer that needs one reintroduces it by its own record.
- [ADR-0047](../adr/0047-ui-package-scope.md) moved to `superseded by` ADR-0074 at this head (the §7 delta). Its index row, the topic table ("UI package scope" now reads 0047 as carried by 0074), the ledger's window paragraph and the regenerated `frontend-and-platform.md` digest say so.
- `scripts/docs-hygiene.test.mjs` gains "no client directive under `packages/ui`". It walks `packages/ui/src` minus the CLI-generated `components/` and `hooks/`, and it proves in the same case that it catches both quote styles and ignores the phrase in prose. It went red (`packages/ui/src/compositions/banner.tsx:1`) with the directive put back, then green again after the file was restored.
- `@repo/api-client`, `@repo/i18n`, `@repo/resource` and `@repo/app-services` declare `"sideEffects": false`. `@repo/contracts` declares `["./src/locales/source.ts"]`, because that module installs the keyed custom-message map with `z.config` on evaluation. `composition.test.ts`'s `SHAKEABLE` is now a map of seven packages to their exact declarations, `form` and `grid` included, so 1 + 7 cases.
- No lockfile change: `sideEffects` is not a resolution fact.

**`pnpm size`, gzipped bytes, measured with `--force` before and after the manifests changed:**

| app      | js before → after | entry before → after |
| -------- | ----------------- | -------------------- |
| admin    | 380460 → 381718   | 160910 → 159941      |
| customer | 328149 → 328261   | 107627 → 106429      |

- css was unchanged in both apps (admin 14911, customer 14075), and so were the vendor chunks.
- The entries fell by about 1 kB each. `js` rose slightly because a few shared modules moved out of the entry into lazy chunks, where they are counted once per chunk.
- No row moved by as much as 1%, so the budget files are not touched.

**Amendments.** One labelled amendment to the plan's step 9, recording two readings:

- "Under `packages/ui`" means its hand-written half. The generated primitives carry the CLI's directive and stay byte-identical to it (ADR-0047 §What-code, untouched by the delta).
- Contracts declares the one side-effectful file rather than `false`.

**Review: one `code-reviewer` pass.** It found no defects. It confirmed the following:

- **The five declarations are honest.** Contracts' `source.ts:149` is the only top-level call outside the tests. i18next's init runs inside `createI18n`, and no side-effect-only import exists.
- **The contracts pattern matches**, proved by two scratchpad builds. The API's tsdown/Rolldown bundle (which bundles `@repo/*`) and the customer's Vite bundle both keep the `z.config` install.
- **The hygiene case cannot pass vacuously.**

One low-value note, **[logged]**: the "are the seven this test names" case counts its own constant and so cannot fail for an outside reason. It stays as the done-when's explicit statement of the seven. A check that the composition roots import no barrel package missing from the map would be the stronger form, and it is left for D22's composition work.

**Loose ends observed, not taken here:**

- [ADR-0048](../adr/0048-app-shell-and-record-surfaces.md) (frozen, not a parent of 0074) still restates "Stateful compositions carry `"use client"`" in its §1 and its tree annotations. 0047 was the rule's source, and 0048 now narrates a withdrawn rule. That is for the operator: either a labelled widening of 0074's parent list while the window is open, or D26's consolidation.
- [ADR-0065](../adr/0065-starter-lifecycle.md)'s status line still names only 0068. The ledger's window paragraph still says 0065 "moves at the step that makes its delta true", but D28.3 built that delta (the generator's refusal) without flipping it. Step 12's close-out, or the operator, should flip it.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited `0`:

- `lint` 21/21 (`test:scripts` 53 tests), `check-types` 16/16, `test` 15/15, `size` 4/4
- admin 60 files, customer 32, API 48 unit and 28 integration files
- Prettier: "All matched files use Prettier code style!"
- `pnpm size`: admin js 372.8 / 389.6 kB, entry 156.2 / 165.0 kB; customer js 320.6 / 335.9 kB, entry 103.9 / 110.4 kB, all `ok`.

`pnpm check` also passed, 52/52.

**Pending the operator.** Nothing is browser-only. The running dev servers pick up the manifest change through Vite's dependency scan on the next reload, and no restart is needed to observe it.

## D28.10 — The admin unit tier, measured (2026-09-22)

**Built.** A timeboxed spike, run in a side worktree (`.claude/worktrees/d28-10`, its own `node_modules` from `pnpm install --frozen-lockfile`) while the operator's stack kept running; it took about an hour of its two. Coverage off landed, so `FE-09` closes here for its config half; pre-bundling did not, and its numbers are D22's input. Closes `FE-09` (with the residual routed).

**The timings**, each read from `apps/admin/.turbo/turbo-test$colon$unit.log` after `pnpm turbo run test:unit --filter admin --force`, 60 files and 537 tests every time, on one otherwise idle machine:

| run                                                               | Duration | transform | import  | tests   | environment |
| ----------------------------------------------------------------- | -------- | --------- | ------- | ------- | ----------- |
| the tree (v8 coverage on)                                         | 127.12s  | 82.93s    | 476.46s | 755.90s | 274.63s     |
| the tree, again                                                   | 125.36s  | 36.51s    | 447.74s | 786.25s | 289.37s     |
| `coverage.enabled: false`                                         | 92.34s   | 36.66s    | 398.89s | 531.79s | 275.91s     |
| `coverage.enabled: false`, again                                  | 92.73s   | 34.50s    | 390.51s | 529.40s | 271.81s     |
| coverage off + the seven packages pre-bundled (widest form tried) | 150.46s  | 33.70s    | 304.78s | 843.70s | 280.63s     |

The review's 215s is the same tier under the whole gate's load (the log `main` held before this step, 23:10 on 2026-09-21); the ratio, not the absolute, is what this step decides on.

- **Coverage: about 27% of the link.** `packages/config-vitest/react.ts` sets `coverage.enabled: false`, with provider and reporter still written out, so `pnpm test:unit --filter admin -- --coverage` prints the same `text-summary` (87.94% statements, 89.38% lines — identical to the pre-step log). Its docblock carries the numbers. `node.ts` is unchanged: the node suites were not the bill and were not measured.
- **Pre-bundling: not a config change.** `test.deps.optimizer.client` over the seven source-only packages alone put a second copy of the router and React into the bundle: 38 of 60 files red (`Cannot read properties of null (reading 'isServer')` from `useMatches`), and `app-form-surface.test.tsx` ran past ten minutes on timeouts before the run was stopped. Adding React, `react-dom`, the JSX runtimes, the router, Query, Table, i18next, react-i18next, react-hook-form and Testing Library to the include, and `esbuildOptions.jsx: "automatic"` (without it every file failed `React is not defined`), left 44 of 537 tests red on the `@repo/ui` and Radix instances outside the bundle — `@repo/ui`'s wildcard subpath exports cannot be listed in an include — at 150.46s. Import time falls (≈ 395s → 305s), which is the re-transformation being real; but getting there means bundling the whole React graph, which is the suites moving into their packages, D22's row. `server.deps.inline` changes nothing: linked workspace packages resolve outside `node_modules` and are already transformed.
- **ADR-0074** amended in place, labelled (Consequences, and the header's delta list on ADR-0073 §6). The process digest's line for the first link says where coverage is collected; `pnpm rules:digest` wrote 1 of 3.
- **D22's ledger row** carries the pre-bundling numbers as its input.

**Amendments.** The plan's step 10: the done-when's `pnpm test:unit -- --coverage --filter admin` hands `--filter` to every workspace's Vitest (all fifteen fail `Unknown option --filter`); it is read as `pnpm test:unit --filter admin -- --coverage`. ADR-0074, as above.

**Done-when.** `pnpm test:unit --filter admin --force` 85.46s, green, no coverage line; again: `Cached: 1 cached, 1 total … FULL TURBO`. `pnpm test:unit --filter admin -- --coverage`: 537 passed, `Coverage summary` printed.

**Found on the way, not taken here — a cache lie.** `pnpm test:unit --filter admin` right after `react.ts` changed answered `FULL TURBO` and replayed the old log, coverage and all. `turbo run test:unit --filter admin --dry=json` shows why: `admin#test:unit` has `dependencies: []` and its 301 inputs are admin's own files — `test:unit` declares `dependsOn: []`, so no workspace package's source (not `@repo/vitest-config`, not `@repo/grid`, whose code admin's suite exercises) reaches the hash. A package change can replay a green app suite from `pnpm check` and `pnpm test:unit`; `pnpm test` is uncached and the gate is therefore unaffected. The mechanism (a `^`-dependency on a transit task, or `inputs` naming the packages) is a decision on ADR-0026 as carried, so it is for the operator: a labelled widening of 0074 while the window is open, or D27's row, which is already about what the cache may decide.

**Review: one `adr-reviewer` pass, four findings.**

- **[fixed]** ADR-0073's `Status:` delta list did not name the new §6 delta that 0074's header now lists; it does.
- **[fixed]** `node.ts`'s docblock cited 0073 §6 alone and gave the opposite rationale to `react.ts`'s; it now cites 0073 as carried by 0074 and says why the two differ.
- **[fixed]** `react.ts` named its consumers too narrowly (`@repo/api-client` and `@repo/i18n` use it without rendering); it now says every workspace that imports it.
- **[logged]** The cache lie above has no durable home. Routing it — D27's row, or a labelled widening of 0074 at D28.11 — is the operator's decision, not this diff's.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`: `lint` 21/21, `check-types` 16/16, `test` 15/15 (admin 60 files, customer 32, API 48 unit and 28 integration), `size` 4/4 all `ok`, then `format:check` red on this notes file's table layout only; after `prettier --write` (whitespace) "All matched files use Prettier code style!". `pnpm check` exit `0`, 52/52. After the review's fixes (a status line and two docblocks): `pnpm lint`, `pnpm check-types --filter @repo/vitest-config` and `pnpm format:check` green.

**Pending the operator.** Nothing is browser-only and nothing running reads the changed config. The spike worktree `.claude/worktrees/d28-10` was removed with its branch.
