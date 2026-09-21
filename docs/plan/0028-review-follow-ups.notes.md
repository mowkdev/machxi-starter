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
