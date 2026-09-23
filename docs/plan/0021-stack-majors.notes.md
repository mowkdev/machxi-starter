# D21 — Stack majors: build notes

The per-step build record of [D21](0021-stack-majors.md) — what was built, the amendments, the review findings and their fates, the gate's output, `pnpm outdated -r`'s major list before and after each step, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D21.1 — Vitest 5, with `@vitest/coverage-v8` 5 (2026-09-23)

**Built.** Closes the first quarter of `STK-04`.

- **The catalog's `vitest` is `^5.0.1`** and `@repo/vitest-config`'s exact `@vitest/coverage-v8` pin is `5.0.1` with it (the peer is exact, so the pair moves together, as `renovate.json`'s pin rule says). `@repo/vitest-config`'s own `vitest` peer is `^5`, and the catalog comment says so.
- **`vite` enters the catalog at `^7.3.6`.** Vitest 5 lists `vite` as a required peer (`^6.4.0 || ^7.0.0 || ^8.0.0`) rather than a dependency. Every workspace that runs Vitest now declares `vite: catalog:`: 15 of them, both apps (moved from their own `^7.3.6`), `api`, and every package including `@repo/vitest-config`. That takes it past the catalog's ten-workspace threshold. Declaring it is what keeps one copy: an undeclared peer is answered by `autoInstallPeers` with the newest release in range, which is `vite@8.3.0`. The catalog comment records the reason.
- **The Vitest 5 behaviour changes cost nothing here.** The shared configs already set `clearMocks: true` explicitly, and 5 makes that the default. Every other option they set still type-checks against 5's config types, so none was removed. No suite used a nested `vi.mock` or an unawaited async assertion: all 15 unit tiers and the integration tier passed without edits.
- **`scripts/docs-hygiene.test.mjs`**, case "a held dependency is one fact": a new `ONE_VERSION_TOOLS = ["vite", "vitest"]` list joins the `overrides` names in `heldTwice`. The case asserts that each tool resolves once, and it injects a second `vite` copy to check that the predicate reports it. `eslint` and `typescript` join this list at their steps.
- **The lockfile.** `pnpm why -r vitest` ends with "Found 1 version of vitest" (5.0.1). `pnpm why -r vite` ends with "Found 1 version of vite" (7.3.6). `@vitest/coverage-v8` also resolves to one version, 5.0.1.

**Where it was built.** In the side worktree `.claude/worktrees/d21-1`, which has its own `node_modules`, while the operator's stack kept running. This follows the `D28.2` precedent. The operator's `.env` files were copied into the worktree this time. The commit was fast-forwarded into `main`.

**Amendments.** None to any record or to the plan.

**Review: one `code-reviewer` pass over the diff, with no findings.** The reviewer confirmed these points:

- The lockfile has one entry each for `vite`, `vitest` and `coverage-v8`, and the snapshots point at each other.
- All 15 Vitest workspaces declare `vite`.
- `heldTwice` removes duplicate names.
- The injected-copy check tests the new list and not `overrides`.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` was run cold (`TURBO_FORCE=1`) and exited `0`. The links reported `lint` 21/21, `check-types` 16/16, `test` 15/15 (6m7s) and `size` 4/4, then "All matched files use Prettier code style!". `pnpm test:unit --filter admin -- --coverage` passed 60 files and 537 tests and printed the coverage summary: statements 87.94%, branches 73.05%, functions 84.69%, lines 89.37%.

- The first `pnpm check` in the fresh worktree failed three jsdom/node tiers (`@repo/i18n`, `@repo/ui`, `@repo/api-client`) with "[vitest-pool-runner]: Timeout waiting for worker to respond". No test failed; the workers never started. All three passed when run alone, and the next `pnpm check --force` exited `0` (52/52). This was a cold first start on a new `node_modules` under full parallel load, and it did not happen again. It is recorded here in case it comes back.

**`pnpm outdated -r` majors.** Before: `@eslint/js` 9→10, `@types/node` 22→26, `@vitejs/plugin-react` 5→6, `@vitest/coverage-v8` 4→5, `dotenv` 17→18, `eslint` 9→10, `typescript` 5→7, `vite` 7→8, `vitest` 4→5 (plus the `jsdom` hold). After: the same list without `vitest` and `@vitest/coverage-v8`. `vite` 7→8 now lists all 16 workspaces that declare it, and it is `D21.3`'s.

**Pending the operator.** `main`'s `node_modules` still has Vitest 4 until the operator runs `pnpm install` there. The dev servers do not load Vitest, so they need no restart. The side worktree `.claude/worktrees/d21-1` can be removed with `git worktree remove`.

## D21.2 — ESLint 10 with `@eslint/js` 10 and the plugin set (2026-09-23)

**Built.** Closes the second quarter of `STK-04`.

- **The catalog's `eslint` is `^10.11.0`** and `@repo/eslint-config`'s `@eslint/js` is `^10.0.1`. The rest of the plugin set already admits 10: `typescript-eslint` 8.70 (`^10.0.0`), `eslint-plugin-react-hooks` 7.1.1 (`^10.0.0`), `eslint-plugin-turbo` (`>6.6.0`), `eslint-config-prettier` (`>=7`), `eslint-plugin-boundaries` 7.2 (`>=6`) and the resolver, which declares `*`. `eslint-plugin-i18next` and `eslint-plugin-only-warn` declare no peer.
- **`eslint-plugin-react` is the wait.** 7.37.5 is still the latest release and declares `eslint` up to `^9.7`. `pnpm-workspace.yaml` gains a `peerDependencyRules.allowedVersions` entry, `eslint-plugin-react>eslint: "10"`, and the comment beside it names the upstream issue, jsx-eslint/eslint-plugin-react#3977. The entry is removed when a release declares 10.
- **The plugin crashed on 10, and that was fixed in the config.** The first `lint` run on 10 failed 11 of 21 tasks with `Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function` (upstream #4018, closed as a duplicate of #3977). `settings.react.version: "detect"` calls the `context.getFilename()` that ESLint 10 removed. `packages/config-eslint/react.js` now states the version as `"19"`, with the reason beside it. The plugin reads the version only to decide rules written for React before 16, and every workspace declares React 19.
- **The three rules 10 adds to `recommended`.**
  - `no-unassigned-vars` and `no-useless-assignment` found nothing.
  - `preserve-caught-error` found one site, `apps/api/src/main.ts`, where the database-unreachable `throw` has no `cause`. That is deliberate: Node prints an uncaught error's cause chain to stderr, and keeping the driver error out of stderr is the reason the sentence exists (ADR-0021 acceptance step 3). The site is disabled there with a reason, not across the config.
- **The negative fixtures had to be written.** The done-when names `packages/config-eslint`'s own tests, and there were none, nor any lint fixture anywhere in the tree. The plan's done-when is **amended in place** to say so.
  - `packages/config-eslint/rules.test.js` runs under `node --test` as the package's `test` and `test:unit`, with no new dependency. It lints a breaking snippet under a virtual path for each of these, with type information off:
    - HTTP in a service
    - a table in a controller
    - a class
    - a door outside `shared/`
    - a door slice's own package, which is allowed, and another package, which is refused
    - `no-literal-string`
    - `react/jsx-key` and `react-hooks/rules-of-hooks`
  - Two negative controls are clean: a mapper file, and a repository importing a table.
  - Reverting `react.js` to `"detect"` turns four of the cases red, which proves the fixture catches the crash.
  - `test` is now 16/16, where it was 15/15.
- **`scripts/docs-hygiene.test.mjs`.**
  - `ONE_VERSION_TOOLS` now includes `eslint`.
  - The new case "every linted workspace owns its config" asserts that every `apps/*` and `packages/*` workspace with a `lint` script has its own `eslint.config.*`. ESLint 10 looks up a file's config from that file's directory. All 17 linted workspaces already had one. The case also checks its predicate over a scratch tree.
- **The lockfile.** `pnpm why -r eslint` reports "Found 1 version of eslint", 10.11.0. `@eslint/js` also resolves to one version, 10.0.1. `jiti`, ESLint 10's optional peer, came in through `autoInstallPeers`.

**Where it was built.** In the side worktree `.claude/worktrees/d21-2`, which has its own install and copies of the operator's `.env` files, while the operator's stack kept running. The commit was fast-forwarded into `main`.

**Amendments.** The plan's `D21.2` done-when now carries an `Amended 2026-09-23 (D21.2)` note about the fixtures, the `"detect"` crash and the 16/16 count. No record was amended.

**Review: one `code-reviewer` pass, no correctness defect, two low-severity notes. Both were fixed.**

- The one negative control, the mapper file, said nothing about path scoping. A repository importing a table is now also asserted clean.
- The hygiene case's repository assertion would have passed vacuously on an empty walk. The predicate now returns the linted workspaces as well, and the case asserts that `apps/api` is among them.
- The reviewer was unsure whether the React case would catch a revert to `"detect"`. That was checked by running it before the review: the revert fails the case.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` was run cold (`TURBO_FORCE=1`) and exited `0`. The links reported `lint` 21/21, `check-types` 16/16, `test` 16/16 and `size` 4/4, then "All matched files use Prettier code style!". The gate was run cold again after the review fixes. `lint` 21/21, `check-types` 16/16, `test` 16/16 and `size` 4/4 were green. `format:check` then failed on this notes file alone, whose Markdown had not yet been formatted. It passed once Prettier had written the file.

**`pnpm outdated -r` majors.** Before: `@eslint/js` 9→10, `@types/node` 22→26, `@vitejs/plugin-react` 5→6, `dotenv` 17→18, `eslint` 9→10, `typescript` 5→7, `vite` 7→8 (plus the `jsdom` hold). After: the same list without `eslint` and `@eslint/js`.

**Pending the operator.**

- `main`'s `node_modules` still has ESLint 9 until the operator runs `pnpm install` there. The dev servers do not load ESLint, so they need no restart, but an editor's ESLint server should be reloaded after the install.
- The side worktree `.claude/worktrees/d21-2` can be removed with `git worktree remove`, like `d21-1`.
