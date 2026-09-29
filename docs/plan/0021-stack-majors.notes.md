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

## D21.3 — Vite 8, with `@vitejs/plugin-react` 6 (2026-09-27)

**Built.** Closes the third quarter of `STK-04` and the Vite half of `FE-02`'s future.

- **The catalog's `vite` is `^8.3.0`**, and both apps' `@vitejs/plugin-react` is `^6.1.1`. `pnpm why -r vite` resolves one version, 8.3.0. `@tailwindcss/vite` 4.3.3 and `@tanstack/router-plugin` already declare a Vite 8 peer.
- **The vendor chunks are Rolldown `codeSplitting` groups.** Rolldown 1.2 deprecates both `manualChunks` and `advancedChunks`. Both `vite.config.ts` files move `build.rollupOptions` to `build.rolldownOptions` and declare one group per vendor group, ranked in `VENDOR_GROUPS` order. The ranking keeps `react` in the React chunk. A single group with a `name` function let the groups race, and `react` landed in the query chunk. Each vendor chunk holds the same packages it held under Vite 7.
- **`chunkFileNames` recognises a vendor chunk by the modules it holds.** Rolldown named `@repo/ui`'s `table.tsx` chunk `table`, and a test on the name alone sent it to `assets/vendor/`.
- **The `entry` row prices the module script plus every non-vendor chunk `dist/index.html` preloads.** Rolldown moves the modules the entry shares with lazy routes into common chunks that the page preloads. The entry file alone fell from 156 kB to 38 kB gzipped in the admin app, and from 104 kB to 38 kB in the customer app, while nothing left the first paint. On a Rollup build, which preloaded only vendor chunks, the two definitions give the same number. `scripts/size.mjs` gains `initialAppChunks`, and `scripts/size.test.mjs` a case for it. **Operator decision:** this is the same rule measured a new way, so no record is amended and ADR-0062 is untouched. The plan's dated amendment is the trace.
- **Both budget files are re-baselined** against a cold Vite 7 build of the same tree, with every ceiling set about 5% over its measurement, inside ADR-0073 §5's 15% cap. Most ceilings went down. The admin `entry` went up, 169000 to 175000, and the customer `entry` went from 113000 to 114000. The numbers and reasons are in each `size-budget.json`'s notes.
- **`optimizeDeps`.** Neither app set any options, so only the esbuild-era comment in each `vite.config.ts` changed.

**Where it was built.** In the side worktree `.claude/worktrees/d21-3`, which has its own install and copies of the operator's `.env` files, while the operator's stack kept running. The commit was fast-forwarded into `main`. `apps/*/src/app/routeTree.gen.ts` showed as modified after the builds. Those files are line-ending noise and were left out of the commit.

**Amendments.** The plan's `D21.3` entry carries an `Amended 2026-09-23 (D21.3)` note covering `codeSplitting`, `chunkFileNames`, the `entry` file set, `optimizeDeps` and the e2e run. No record was amended.

**Review: one `code-reviewer` pass, no defect in today's output, four findings.**

- **The `entry` row failed open on a preload link its pattern could not read.** Fixed. `initialAppChunks` now counts every `<link>` that mentions `modulepreload` and refuses the page when the count differs from the links it read. A new assertion covers an unquoted `rel`. One case is still open: `build.modulePreload: false` would drop the links altogether, and the row would measure the entry file alone. Neither app sets it.
- **The test's reversed-attribute link was hidden by the dedupe.** Fixed. There is now a separate assertion with only that link.
- **The plan amendment said the test "proves" the Rollup equivalence.** Fixed. The amendment now states why the numbers match and what the test pins.
- **The customer budget note said the entry file fell to "about a quarter".** It fell to about a third, 37.7 kB gzipped against 104 kB. Fixed.

**Gate.** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` was run cold (`TURBO_FORCE=1`, `TURBO_CONCURRENCY=2` because memory was short) and every command exited `0`. The results were `lint` 21/21, `check-types` 16/16, `test` 16/16 and `size` 4/4, then "All matched files use Prettier code style!". The previous attempt's gate was killed during `pnpm test` when the machine ran out of memory. The gate was run cold again after the review fixes, and every command exited `0` with the same counts.

- Vite 8 prints a forward-compatibility warning on every build. `configLoader: 'native'` will not support `import "./app-version"` without a file extension (`vite.config.ts:8`). The build still passes. The import can take its extension when Vite makes the native loader the default.

**`pnpm outdated -r` majors.** Before: `@types/node` 22→26, `@vitejs/plugin-react` 5→6, `dotenv` 17→18, `typescript` 5→7, `vite` 7→8. After: `@types/node` 22→26, `dotenv` 17→18, `typescript` 5→7. `@types/node` and `dotenv` are `D21.4`'s.

**Pending the operator. The step's box stays unticked.**

- The amended done-when ticks `D21.3` only when `pnpm test:e2e` passes against dev servers restarted on Vite 8, and only the operator can restart them. First run `pnpm install` in `main`, then restart the admin (3001) and customer (3002) dev servers, then run `pnpm test:e2e`. When it passes, tick the box.
- The side worktree `.claude/worktrees/d21-3` can then be removed with `git worktree remove`.

## D21.4 — `@types/node` at the floor, and `dotenv` 18 (2026-09-28)

**Built.** Closes `STK-10`.

- **`@types/node` is `^24.19.0`**, both in the catalog and as a new `overrides` hold. Without the hold, `autoInstallPeers` answered the optional peers of `@inquirer/*` and `msw` with a second copy at 22.20.3, and Vitest resolved twice. The lockfile now carries one `@types/node`, and `renovate.json`'s register gives the reason with `allowedVersions: "<25"`.
- **`@repo/db` no longer depends on `dotenv`** (operator decision, option B; see the plan's `Amended 2026-09-28 (D21.4)`). `tooling/env.ts` loads the root `.env` with `process.loadEnvFile` behind `existsSync`. `env.test.ts` proves that the environment wins over the file and that a missing file does nothing. `dotenv` ^18.0.4 remains only as the API's dev dependency. The one other copy in the lockfile is `dotenv@16.0.3`, and it comes from `eslint-plugin-turbo`.
- **New `scripts/docs-hygiene.test.mjs` case: "the API image's dist/ carries no dotenv".** It builds every bundle that `apps/api/Dockerfile` copies into `/out/dist` into a scratch directory and scans what would ship. Built the same way from `main`, `@repo/db`'s shared chunk has 21 `DOTENV_` hits, so on `main` this case is red.

**Review: one `security-reviewer` pass, 0 High, 1 Medium, 3 Low.**

- **Medium: "`//#test:scripts` declares no inputs, so the case can replay a cached green."** Refuted by measurement. `turbo run //#test:scripts --dry=json` hashes 1405 inputs, and 1170 of them are under `apps/` and `packages/`. The root task already hashes the workspaces. No change.
- **Low: the require regex missed rolldown's `__require("dotenv")`, and `DOTENV_` matched dotenv 18 only through `DOTENV_CONFIG_`.** Fixed. The predicate now accepts `__require` and `` `DOTENV_${…}` ``, with a self-test for each.
- **Low: the scan read only the top level of `outDir`.** Fixed. It is now recursive.
- **Low: ADR-0004 §Loading still says the seed scripts load `.env` "with `dotenv`".** Its step-6 amendment also credits "the library surface" with keeping dotenv out of production. ADR-0004 is closed, so it cannot be edited in place. Routed to the operator: a delta at `D21.7` or later, or accept the gap. The rule itself, "No `dotenv` in production builds", is true again. **Closed by ADR-0075** (2026-09-29).

**Gate** (`TURBO_FORCE=1`, `TURBO_CONCURRENCY=2`, in the side worktree `.claude/worktrees/d21-4`, re-run cold on 2026-09-29 after the review fixes, with the operator's root `.env` copied in):

| Check          | Result |
| -------------- | ------ |
| `lint`         | 21/21  |
| `check-types`  | 16/16  |
| `test`         | 16/16  |
| `size`         | 4/4    |
| `format:check` | clean  |

The earlier run's only failure was `@repo/db`'s integration tier, "DATABASE_URL_TEST_OWNER is not set", because the worktree had no root `.env` and a deny rule stops this session from copying the operator's.

**`pnpm outdated -r` majors.** Before: `@types/node` 22→26, `dotenv` 17→18, `typescript` 5→7. After: `@types/node` 24→26 (the floor, as the register records) and `typescript` 5→7.

**Pending the operator.**

- Run `pnpm install` in `main`. Nothing the dev servers load changes.
- ~~Decide ADR-0004's stale "with `dotenv`" wording (the last review finding above).~~ Closed by ADR-0075 (2026-09-29).
- The side worktree `.claude/worktrees/d21-4` can be removed with `git worktree remove`.

## D21.5 — TypeScript 6.0 (2026-09-29)

- **`typescript` is `6.0.3`**, exact, in the catalog. `renovate.json`'s pin rule notes that the version lives once, in the catalog, and moves with the rule. The lockfile carries one `typescript`. `scripts/docs-hygiene.test.mjs`'s `ONE_VERSION_TOOLS` now names `typescript` beside `eslint`, `vite` and `vitest`, so "a held dependency is one fact" asserts it.
- **No deprecated option was in the tree.** No preset or workspace `tsconfig` sets `baseUrl`, `moduleResolution: node10`/`classic`, a `target` below ES2015, `outFile`, `downlevelIteration`, or `esModuleInterop: false`. `paths` in both apps already stood without `baseUrl`. The flip alone was green, `check-types --force` 16/16 with no diagnostic.
- **The flipped defaults are stated in `@repo/typescript-config`.** `base.json` now carries `types: []`, `noUncheckedSideEffectImports: true` and `libReplacement: false`, and `strict` was already there. A probe confirmed `types` really defaults to `[]` on 6.0.3: a lone `process.env` fails with TS2591. The tree stayed green only because every Node program imports a `node:` module. `node.json` now names `types: ["node"]`. `packages/config-vitest` is the one `node.json` workspace that does not declare `@types/node`, and its two factories use no Node global, so its `tsconfig.json` narrows `types` back to `[]` and no dependency is added. `DOM.Iterable` leaves `lib` in `react-library.json`, `vite.json` and `nextjs.json`, because 6.0 merged it into `DOM` and its lib file is now an empty stub. `rootDir`'s new default, the tsconfig's own directory, changes nothing: every composite package already had its root there, and a preset cannot state it because a path resolves against the file that sets it.
- **Peers.** `typescript-eslint` 8.70.0 declares `>=4.8.4 <6.1.0`, `tsdown` 0.23.0 declares `^6`, and `drizzle-kit` declares no `typescript` peer. Nothing moved beside the compiler.

**Done-when.** `pnpm check-types --force` 16/16 with no deprecation diagnostic. `pnpm lint --force` 21/21. The type-aware rules still run: a probe `f();` in `apps/api/src` drew `@typescript-eslint/no-floating-promises`. `pnpm build --filter api` green. `pnpm test:unit` 16/16 twice, the second 16 cached, `FULL TURBO`.

**Review: one `code-reviewer` pass, no correctness finding.**

- **Note: `base.json`'s comment overstated what `types: []` achieves.** Node's globals still reach every react-library and SPA program through `vitest.config.ts`'s imports, as they did on 5.9. Fixed by rewording the comment.
- **Note: `typescript-eslint`'s peer caps at `<6.1.0`.** The Renovate pull request that proposes 6.1 will fail that peer until `typescript-eslint` widens it. The pull request's own gate will show this, so it is logged here and nothing changes now.

**Gate** (`TURBO_FORCE=1`, `TURBO_CONCURRENCY=2`, side worktree `.claude/worktrees/d21-4`):

| Check          | Result |
| -------------- | ------ |
| `lint`         | 21/21  |
| `check-types`  | 16/16  |
| `test`         | 16/16  |
| `size`         | 4/4    |
| `format:check` | clean  |

**`pnpm outdated -r` majors.** Before: `@types/node` 24→26 (the floor) and `typescript` 5→7. After: `@types/node` 24→26 (the floor) and `typescript` 6→7, which is `D21.6`'s spike.

**Pending the operator.** Run `pnpm install` in `main` after the fast-forward. The dev servers do not type-check, so nothing they load changes.

## D21.6 — TypeScript 7, a timeboxed spike (2026-09-29)

**Outcome: green inside the box, landed.** ADR-0076 was written and accepted at the step's head. [ADR-0062](../adr/0062-frontend-build-and-shared-composition.md) (§3) and [ADR-0073](../adr/0073-review-hardening.md) (§7) moved to `superseded by`. The spike took well under its one-day box. Closes the fourth quarter of `STK-04`.

**Where it ran.** The measurements ran in a throwaway worktree, `.claude/worktrees/d21-6-spike`, with its own install. The landing and the gate ran in `.claude/worktrees/d21-4`, which has the operator's root `.env`. Its lockfile came out byte-identical to the spike's.

**Timings.** `TURBO_CONCURRENCY=2` on one machine with 16 logical cores. "Cold" means every `*.tsbuildinfo` and `dist-types/` was removed first. "Warm" is a second `--force` run with the buildinfo in place.

| Measurement                                       | 6.0.3 | 7.0.2 |
| ------------------------------------------------- | ----- | ----- |
| `pnpm check-types --force`, cold                  | 49.8s | 15.3s |
| `pnpm check-types --force`, warm                  | 4.6s  | 5.0s  |
| one `tsc -b` over a solution file of all 16, cold | 40.0s | 6.7s  |
| the same, nothing to do                           | 0.32s | 0.27s |

The warm turbo rows measure process start-up, not compilation.

**Diagnostic diff: none.** Both compilers report zero diagnostics on the tree. Three probes behaved the same on both:

- A deliberate `TS2322` in `apps/admin/src` is reported by both.
- A lone `process.env` under `types: []` fails with `TS2591` on both. The same line inside `packages/config-vitest` passes on both, because `vitest.config.ts`'s imports bring Node's globals into that program.
- Declarations are still emitted when there are errors. The only difference is the exit code: `2` on 7, `1` on 6.0. Both fail turbo.

**Emit diff.** 24 of 302 `.d.ts` files differ. The differences are:

- union members, and some inferred object members, in a different order;
- `typeof X`, with an added import, where 6.0 inlined the signature (`@repo/form`'s and `@repo/grid`'s registries, `@repo/db`'s prune table);
- the source's quote style kept in `@repo/db`'s `_shared.d.ts`;
- `& unknown` on one generic constraint.

All of these are type-equivalent. Every consumer's `tsc -b` reads the emit of the compiler it runs. The linter resolves packages to source through `exports`.

**D27's input, measured.** The `D20.12` two-command experiment on `@repo/logger` gives the same result on 7 as on 6.0: with the restored marker it exits `0`, and with the marker removed it reports the error. A composite package's buildinfo still lands in `dist-types/`, and an app's still lands in `tsconfig.tsbuildinfo`. The ledger's D27 row carried "decided together or not at all". It now has an `Amended 2026-09-29 (D21.6)` note: the residual is the same on 7, so D27 decides it on 7.

**Built.**

- The catalog's `typescript` is `7.0.2`, exact.
- `@repo/eslint-config` declares `typescript` as `npm:typescript@6.0.3`, so `typescript-eslint` 8.70 (peer `<6.1.0`) resolves 6.0 there. Type-aware rules still run: a probe `f();` in `apps/api/src` drew `@typescript-eslint/no-floating-promises`. The boundary rules gave the same result on 6.0 and 7 against a probe `shared → pages` import in `apps/admin`.
- `pnpm-workspace.yaml`'s `peerDependencyRules` admits `@typescript-eslint/{parser,project-service,tsconfig-utils,typescript-estree}>typescript: "7"`, because of an instance that nothing loads. `eslint-plugin-boundaries` in the apps reaches the parser through `eslint-module-utils`' optional peer. Under flat config that module parses with the parser object it is handed, and `context.parserPath` is unset. `pnpm peers check` is clean.
- `renovate.json` has a new rule capping the alias below 6.1, scoped by `matchFileNames`. The pin rule's description now names both versions.
- `scripts/docs-hygiene.test.mjs`: `typescript` leaves `ONE_VERSION_TOOLS`, and a new case, "the compiler is two facts: the catalog's, and the linter's beside it", asserts the pair and self-tests each refusal.
- `scripts/rules-digest.mjs` gains the line "The compiler" (0076), and `docs/rules/*` is regenerated. On a second run it wrote 0 of 3.
- The API's build, and `@repo/db`'s bundles, are `tsdown` with `dts` off, so no compiler runs behind them. `tsdown` 0.23 and `rolldown-plugin-dts` both admit 7.

**Amendments.** The plan's done-when now carries `Amended 2026-09-29 (D21.6)`. "Two names each at one version" cannot hold, because an alias installs `typescript` itself and `typescript-eslint` resolves the name `typescript`. So the landed form is one name, two versions, each declared once. It is the one exception to §Constraints' single-`typescript` line.

**Review: one `adr-reviewer` pass, verdict "conforms with minor fixes", five findings.**

- **Major: 0076 called the alias a "hold", which is ADR-0074 §2's word for an `overrides` fact.** Fixed. ADR-0076 §2 now calls it an exact pin under §7 whose Renovate rule caps proposals, and says why 0074 §2 does not apply: the alias binds one manifest's resolution, and the name stays at 7 elsewhere. `renovate.json`'s rule says the same.
- **Major: the ledger's D27 row still stated a coupling the step had resolved.** Fixed with the labelled amendment above.
- **Minor: no D21.6 notes entry.** This entry is it. The reviewer read the tree before the notes were written, which the step writes last.
- **Minor: the hygiene self-test matched `/not/`, which three messages contain.** Fixed. It now matches `/the lockfile resolves typescript/`.
- **Minor: the digest generator appends "and ADR-0076" to every line citing 0062 or 0073, not only §3 and §7.** Logged, not fixed. The generator carries citations per record rather than per section, and 0074 was over-attributed the same way. Fixing it means a section-level carriage rule, which is an ADR-0065 change and not D21's.

**Gate** (`TURBO_FORCE=1`, `TURBO_CONCURRENCY=2`, `.claude/worktrees/d21-4`):

| Check          | Result        |
| -------------- | ------------- |
| `lint`         | 21/21 (1m17s) |
| `check-types`  | 16/16 (14.5s) |
| `test`         | 16/16 (7m27s) |
| `size`         | 4/4           |
| `format:check` | clean         |

The review fixes after the gate touched only records, `renovate.json` and the hygiene test's regex. `pnpm lint` (which carries `test:scripts` and `docs:check`) and `pnpm format:check` were re-run cold after them.

**`pnpm outdated -r` majors.** Before: `@types/node` 24→26 (the floor) and `typescript` 6→7. After: `@types/node` 24→26 (the floor) and `typescript` 6.0.3→7.0.2 for `@repo/eslint-config` alone. That second one is ADR-0076's alias, and it waits for the first `typescript-eslint` whose peer admits 7.

**Pending the operator.**

- Run `pnpm install` in `main` after the fast-forward. The dev servers do not type-check, so nothing they load changes.
- The throwaway worktree `.claude/worktrees/d21-6-spike` and its branch are removed at this step.

## D21.7 — Close-out (2026-09-29)

**Where it ran.** In `.claude/worktrees/d21-4`, fast-forwarded to `main` at `8a4981c` first, with its own install and the operator's root `.env`.

**`pnpm outdated -r` read against the goal: two majors, each taken or routed by name.**

| Dependency    | Installed → latest | Where                              | Fate                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@types/node` | 24.19.0 → 26.6.3   | 13 workspaces, through the catalog | **Taken at the floor** (`D21.4`). 24 is the runtime floor's major (ADR-0073 §4); the reason is the register's `@types/node` rule in `renovate.json`, the hold is `pnpm-workspace.yaml`'s `overrides` entry, and both move with the floor.                                                                                 |
| `typescript`  | 6.0.3 → 7.0.2      | `@repo/eslint-config` alone        | **Routed to the first `typescript-eslint` release whose peer admits 7** (ADR-0076). It is the linter's alias, not the compiler; every `tsc -b` runs 7.0.2. The route is written three times and moves as one: `renovate.json`'s alias rule, the four `@typescript-eslint/*>typescript` peer entries and the alias itself. |

Every other row is a minor or a patch for Renovate's weekly group. `jsdom` 30.0.1 → 30.1.1 is the register's standing hold, not a major.

**The carried items, each routed by name.**

- **`eslint-plugin-react` admitted to ESLint 10** by `peerDependencyRules` (`D21.2`). This waits on jsx-eslint/eslint-plugin-react#3977. The entry's comment names the issue and says that the entry, and `react.js`'s stated React major, go with the first release whose peer names 10.
- **`typescript-eslint`'s `<6.1.0` peer cap** (`D21.5`'s review note) is now the same wait as the alias above. `renovate.json`'s alias rule caps proposals below 6.1, so the pull request that fails on it cannot open.
- **Vite 8's warning on `import "./app-version"` without an extension** (`D21.3`) is routed to the Vite release that makes `configLoader: 'native'` the default. That release's Renovate major is its own pull request, and the build fails there rather than warning. The fix is one extension in each `vite.config.ts`, taken in that pull request.
- **The digest generator carries a delta per record, not per section** (`D21.6`'s review). This is routed to D26, Record consolidation. The ledger row now names it, because a section-level carriage rule is a delta on ADR-0065 §5 and restating the chains is where the over-attribution shows.

**The pins and the catalog agree with the lockfile.**

- The catalog's `eslint` ^10.11.0, `typescript` 7.0.2, `vite` ^8.3.0 and `vitest` ^5.0.1 match the lockfile's `catalogs.default` entry by entry.
- `@types/node` ^24.19.0 is written by the `overrides` entry into every importer's specifier, and resolves 24.19.0 there.
- The pin rule's exact names resolve at the versions the manifests state: `express` 5.2.1, `@types/express` 5.0.6, `typescript` 7.0.2 plus the 6.0.3 alias, and `@vitest/coverage-v8` 5.0.1.
- The two `overrides` entries (`@types/node`, `jsdom` 30.0.1) and the register's `allowedVersions` (`<25` and `30.0.1`) state the same versions.

**Digests.** `pnpm rules:digest` wrote 0 of 3, and 0 of 3 again on a second run. D21.6 had already written ADR-0076's line.

**Budgets re-baselined, no ceiling moved.** Two cold builds of this tree agree to the byte. Against `D21.3`'s baselines:

- admin: `js` 374107 → 374046 and `entry` 167068 → 167019.
- customer: `js` 316230 → 316214 and `entry` 108460 → 108440.
- `css` and every vendor chunk are unchanged to the byte.

No app source and no runtime package moved after `D21.3`. The one input under the apps that did is `D21.5`'s `@repo/typescript-config` presets, which Vite 8's transform reads. The cause was not isolated further. Both `size-budget.json` files carry the note, and `baseline` now says `D21.7`, 2026-09-29. So definition-of-done item 5 holds on this commit.

**Definition of done, item by item.**

1. **The gate, cold** (`TURBO_FORCE=1`, `TURBO_CONCURRENCY=2`), before the budget and journal edits:

   | Check          | Result        |
   | -------------- | ------------- |
   | `lint`         | 21/21 (1m50s) |
   | `check-types`  | 16/16 (6.4s)  |
   | `test`         | 16/16 (6m50s) |
   | `size`         | 4/4 (18.2s)   |
   | `format:check` | clean         |

   After the edits, the links those files reach were re-run cold (see §Gate after the edits).

2. `pnpm test:unit` 16/16, then 16/16 again with 16 cached, `FULL TURBO` (97ms).
3. `pnpm outdated -r` gives the two majors above, each named. `pnpm audit --prod` reports "No known vulnerabilities found".
4. `pnpm why -r` finds 1 version each of `vite` (8.3.0), `vitest` (5.0.1) and `eslint` (10.11.0). It finds 2 of `typescript`: 7.0.2, and 6.0.3 behind `@repo/eslint-config` alone. This is the form `D21.6`'s amendment set, and item 4 now carries an `Amended 2026-09-29 (D21.7)` note that says so. The hygiene cases "a held dependency is one fact" and "the compiler is two facts" were green in `lint`'s `test:scripts`.
5. `pnpm size` green, and both baselines equal this commit's measurement (above).
6. **`pnpm test:e2e`: pending the operator.** It runs over the dev servers, which belong to the operator. They need `pnpm install` in `main` and a restart first. Nothing here ran it.
7. `pnpm test:postman` exited `0` against the running API: 212 requests, 424 test scripts, 647 assertions, 0 failed. The READMEs state 646. The extra assertion is the one `D20.11` recorded, which runs only where a Google client is configured, as it is on this machine. `D28`'s close-out accepted the same reading.
8. `docker compose -f docker/prod/compose.yaml build` succeeded, with `VITE_ADMIN_API_URL` and `VITE_CUSTOMER_API_URL` set to `http://localhost:4000`. Without them, `D20.8`'s guard refuses the SPA stage, as designed; that was the first attempt here. `docker image inspect` gives the API image as 87.4 MB, the size `D20` recorded. The admin image is 96.4 MB and the customer image is 96.2 MB. The TypeScript 7 native binaries do not reach the image: `/app/node_modules` is 46 MB of runtime packages.
9. `pnpm rules:digest` wrote nothing on its second run. `pnpm docs:check` passed inside `lint`.

**Gate after the edits.** The edits touched the two budget files, the plan, the ledger and this file. The links those reach were re-run cold: `pnpm lint` 21/21 (1m47s; it carries `test:scripts`, with `size.test.mjs`'s headroom case over the committed budgets, and `docs:check`), `pnpm size` 4/4, and `pnpm format:check` clean. No code moved, so `check-types` and `test` stand from the run above.

**Amendments.** Definition-of-done item 4 now carries `Amended 2026-09-29 (D21.7)`. It pointed at "two names", which `D21.6` had already shown cannot hold, and `/ship` reruns the definition of done against this text. No record was amended.

**Review: one `code-reviewer` pass, three findings and one query.**

- **The step was ticked while item 6 was open.** Fixed: the box stays unticked, following `D21.3`'s precedent. It is ticked when `pnpm test:e2e` is green.
- **The budget note said each ceiling sat further inside the cap.** It is the reverse: the baselines went down and the ceilings stayed, so each ceiling now sits a few bytes further above its baseline, 4.8% to 5.1% against a 15% cap. Fixed in both files.
- **Definition-of-done item 4 still said "two names".** Fixed by the amendment above.
- **Query: is 647 against the READMEs' 646 the stated count?** Yes. `D20.11` recorded the Google-client assertion, `D28`'s close-out accepted it, and item 7 above now says so.

**`pnpm outdated -r` majors.** Before: `@types/node` 24→26 (the floor) and `typescript` 6.0.3→7.0.2 for `@repo/eslint-config` alone (ADR-0076's alias). After: the same two, each named in the table above. The close-out moved no dependency.

**Pending the operator. The step's box stays unticked.**

- Run `pnpm install` in `main` after the fast-forward, then restart the admin (3001) and customer (3002) dev servers and the API. Then run `pnpm test:e2e`, which is definition-of-done item 6, with the floors from `D20.13`. When it is green, tick step 7, and D21 is ready for `/ship`.
- `.claude/worktrees/d21-4` can be removed with `git worktree remove` once the operator has no further use for it.
