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
