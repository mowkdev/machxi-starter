# D21 — Stack majors

- Status: **in progress** — **scoped in full 2026-09-23 by `/scope`**, from the row inserted 2026-09-14 (ledger §How D20–D26 were inserted) and the two reviews' stack findings (`STK-04`, `STK-10`); **opened 2026-09-23**, the same sitting, on the operator's decision (ADR-0025 rule 5; ledger §How D21 opened).
- Records: none written at scoping. The majors build what [ADR-0059](../adr/0059-ci-containers-and-deployment.md) §3 as carried by [ADR-0073](../adr/0073-review-hardening.md) §7 and [ADR-0074](../adr/0074-review-follow-ups.md) §2 already decide — one pull request per major, the exact pins registered with their reasons, one fact per hold. A step that finds a rule wrong writes the delta record at its head; the TypeScript 7 spike is the one step expected to.
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0021-stack-majors.notes.md`](0021-stack-majors.notes.md)

## Goal

Take the queued majors one step each, in the order the first review set, on a gate that now runs every check: Vitest 5, ESLint 10, Vite 8 with `@vitejs/plugin-react` 6, the two runtime-adjacent majors `@types/node` to the floor's own 24 and `dotenv` 18, then TypeScript 6.0 as the bridge release and TypeScript 7 as a timeboxed spike — so the tree stops carrying a major behind on every tool it builds with, and the next fork starts on current majors with the reasons for any hold written down.

## Constraints

- One major per step, one pull request each, reverted on its own (ADR-0059 §3 as carried by ADR-0073 §7). A step that cannot go green inside its box records the blocker in the notes and moves the major to §Not taken rather than widening the box.
- Exact pins stay exact and registered: `typescript` moves in the catalog and in `renovate.json`'s pin rule together; a new hold is one `overrides` fact with its reason beside it (ADR-0074 §2). A peer a plugin has not yet declared is satisfied by an `overrides` or `peerDependencyRules` entry that names the plugin and the release it waits for — never by a second copy of the tool in the lockfile.
- Every step ends with one version of `vite`, `vitest`, `eslint` and `typescript` in the lockfile — the `D28.2` hygiene case extended to name them (ADR-0074 §2).
- A bundle measurement that moves is a diff of the budget file with the baseline beside the ceiling, and the ceilings stay inside the headroom rule; the built page's policy check stays green (ADR-0062 §4 as carried by ADR-0073 §5; ADR-0074 §6).
- The gate as `CLAUDE.md` §Commands defines it, cold at every step, and `pnpm test:e2e` at `D21.3` because a bundler change is what the browser tier exists to catch (ADR-0021).
- The TypeScript 7 spike runs in a worktree with its own install, timeboxed to one day, and decides by its numbers and its blockers, not by prose (ADR-0050 §Verification); the running stack is the operator's and nothing here restarts it (`CLAUDE.md`).
- Dependency installs happen in a side worktree while the operator's stack runs, then fast-forward into `main` (the `D28.2` precedent).

## Decisions taken at scoping (operator, 2026-09-23)

- **TypeScript 6.0 as a step, TypeScript 7 as the spike.** 6.0 is the bridge release that turns the removed options into errors and is inside `typescript-eslint`'s range; 7 has no JavaScript API, so a spike proves `tsc -b` on 7 with 6.0 kept beside it for the tooling that needs the API. Green inside the box lands with a record; red becomes a planned row with the blocker named.
- **Order:** Vitest 5 first, so test breakage is read apart from bundler breakage; ESLint 10; Vite 8 with its plugin; the two small majors; TypeScript 6.0; the TypeScript 7 spike; close-out.
- **No record at scoping.** The steps build rules already in force; the spike writes one if it lands.

## Steps

Each step: implement, gate green, one bounded diff review (`code-reviewer`; `adr-reviewer` where a record is written), commit (ADR-0050). Each step's notes carry `pnpm outdated -r`'s major list before and after.

- [x] **1. Vitest 5, with `@vitest/coverage-v8` 5 in the same diff.** The catalog's `vitest` moves to `^5` and the exact `@vitest/coverage-v8` pin with it; `vite` becomes Vitest's peer, so it enters the catalog and every workspace that runs Vitest resolves the one version the apps use — never an auto-installed second copy; `clearMocks` now defaults on, `vi.mock` is top-level only and an unawaited async assertion fails, so the suites that relied on any of the three are fixed where they stand; the shared configs drop nothing they still need and lose any option 5 removed. Closes the first quarter of `STK-04`.
      **ADRs:** 0073 §6–§7, 0074 §1–§2, 0021, 0026 as carried.
      **Done when:** `pnpm why -r vitest` and `pnpm why -r vite` each resolve one version; `scripts/docs-hygiene.test.mjs` case "a held dependency is one fact" names `vite` and `vitest` and is green; `pnpm test:unit --filter admin -- --coverage` prints a summary; the gate green cold, `test` 15/15.
- [x] **2. ESLint 10 with `@eslint/js` 10 and the plugin set.** The catalog's `eslint` moves to `^10`; `eslint-plugin-react` declares no 10 peer yet, so the step either takes a release that does or names the wait in a `peerDependencyRules` entry with the upstream issue — one `eslint` in the lockfile either way; the three rules 10 adds to `recommended` (`no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`) are fixed in the source or disabled in `@repo/eslint-config` with the reason beside each; config lookup now starts from each linted file, which every workspace's own `eslint.config.js` already satisfies — a hygiene case asserts every workspace with a `lint` script has one. Closes the second quarter of `STK-04`.
      **ADRs:** 0073 §7, 0074 §2, 0009 (the layering rules lint carries), 0046 §9.
      **Done when:** `pnpm why -r eslint` resolves one version; `scripts/docs-hygiene.test.mjs` case "every linted workspace owns its config" green; `pnpm lint --force` 21/21 with the layering, door and i18n rules still refusing their negative fixtures (`packages/config-eslint`'s own tests green); the gate green cold.
      **Amended 2026-09-23 (D21.2).** `packages/config-eslint` had no tests and no negative fixtures anywhere in the tree, so the step writes them: `packages/config-eslint/rules.test.js` (`node --test`, as the package's `test` and `test:unit`) lints a breaking snippet per rule — the API layering, the functional style, a door and its own slice, `no-literal-string`, and `eslint-plugin-react` and `react-hooks` answering on 10 — which makes `test` 16/16 from here. `eslint-plugin-react` 7.37.5 crashes on ESLint 10 under `settings.react.version: "detect"` (upstream #4018, the wait #3977), so `react.js` states the React major instead.
- [ ] **3. Vite 8 with `@vitejs/plugin-react` 6.** Both apps' `vite.config.ts` move `build.rollupOptions` to `build.rolldownOptions` and the vendor chunking to the shape Rolldown keeps (the function form of `manualChunks`, or `advancedChunks` if the function form no longer yields ADR-0062 §4's chunks); the `esbuild`-era `optimizeDeps` comment and options go; the default browser target moved to Baseline 2026, so both budget files are re-baselined by diff with every ceiling inside the headroom rule; `@tailwindcss/vite` and `@tanstack/router-plugin` at releases that declare a Vite 8 peer; the size link's built-page policy check stays green. Closes the third quarter of `STK-04` and the Vite half of `FE-02`'s future.
      **ADRs:** 0062 §4 as carried by 0073 §5, 0074 §6, 0073 §9.
      **Done when:** `pnpm why -r vite` resolves one version; `pnpm size --force` green with the measurement in the notes and the budget diff in the commit; `apps/admin/src/app/__tests__/grid-chunk.test.ts` and `apps/admin/e2e/smoke.spec.ts` green; `pnpm test:e2e` green in both apps with the floors unchanged; the gate green cold.
- [ ] **4. `@types/node` at the floor, and `dotenv` 18.** The catalog's `@types/node` to `^24` — the types major tracks the Node major, so 24 describes the floor ADR-0073 §4 states and 26 describes APIs the floor does not have; `pnpm outdated` listing 26 from then on is the floor working, and the pinning register says so beside the catalog entry; `dotenv` to `^18` in `@repo/db` and the API's dev dependency, with `packages/db/src/tooling/env.ts` still the only loader and the API's production bundle still free of it. Closes `STK-10`.
      **ADRs:** 0073 §4, 0004, 0074 §2.
      **Done when:** `pnpm check-types --force` 16/16 on `@types/node` 24; `pnpm test --filter=@repo/db` green; `scripts/docs-hygiene.test.mjs`'s bundle case (the API image's `dist/` carries no `dotenv`) green, or the case written if none exists; the gate green cold.
- [ ] **5. TypeScript 6.0.** The catalog's exact `typescript` to `6.0.x` and `renovate.json`'s pin rule with it; every option 6.0 deprecates is gone from the `@repo/typescript-config` presets and the workspace `tsconfig`s before the flip (`baseUrl`, `moduleResolution: node10`, `target` below `es2015`, and the rest 6.0 names); `typescript-eslint`, `tsdown`, `drizzle-kit` and Vitest at releases whose peer admits 6.0; `strict` is already on everywhere, and any default 6.0 flips is stated in the presets rather than inherited silently.
      **ADRs:** 0073 §7 (the pin's reason), 0062 §3 (`tsc -b` and the emit), 0074 §2.
      **Done when:** `pnpm check-types --force` 16/16 with no deprecation diagnostic; `pnpm lint --force` green (type-aware rules still running); `pnpm build --filter api` green; `pnpm test:unit` twice, the second `FULL TURBO`; the gate green cold.
- [ ] **6. TypeScript 7, a timeboxed spike.** _One day, in a worktree with its own install (ADR-0050 §Verification)._ `typescript@7` as the compiler behind `check-types` and the API's build, 6.0 kept beside it under an alias for `typescript-eslint`, Vitest's typecheck and the editor; `tsc -b` timed cold and warm on the tree against 6.0's numbers; every diagnostic that differs between the two compilers listed. **Green inside the box:** it lands here with ADR-0075 written at this head — a delta on ADR-0062 §3 for what `tsc -b` emits and on ADR-0073 §7 for the two pins and their reasons — and the pin rule names both packages. **Red or out of time:** the notes carry the timings and the blockers, `typescript` stays at 6.0, and the ledger gains a planned row "TypeScript 7" naming what it waits for. Closes or routes the fourth quarter of `STK-04`.
      **ADRs:** 0073 §7, 0062 §3, 0050 §Verification, 0026 as carried by 0074 §9.
      **Done when:** the notes carry the cold and warm `pnpm check-types --force` timings on 6.0 and on 7 and the diagnostic diff; if landed, `pnpm why -r typescript` shows the two names each at one version, ADR-0075 `accepted` with its index row, and the gate green cold; if not, the ledger row exists and `pnpm outdated -r` lists `typescript` 7 as the one major behind with the row named beside it in the notes.
- [ ] **7. Close-out.** `pnpm outdated -r` read against D21's goal: every major taken or routed by name; `renovate.json`'s pin rule and `pnpm-workspace.yaml`'s catalog agree with the lockfile; the digests regenerated; then the definition of done.
      **ADRs:** 0073 §7, 0074 §2–§3, 0065.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D21.7` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO` (ADR-0026 as carried).
3. `pnpm outdated -r` lists no direct dependency behind a major except `@types/node` at the floor's major (its reason in the pinning register) and what D21's notes route by name; `pnpm audit --prod` reports no advisory.
4. `pnpm why -r` resolves one version each of `vite`, `vitest`, `eslint` and `typescript` (two names, one version each, if the spike landed); the hygiene case that says so is green.
5. `pnpm size` green with both budget files' baselines equal to the measurement of the shipping commit.
6. `pnpm test:e2e` green in both apps against the local compose, the floors unchanged from `D20.13`'s.
7. `pnpm test:postman` exit `0` with the counts the READMEs state.
8. `docker compose -f docker/prod/compose.yaml build` succeeds — the three images on the new toolchain.
9. `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean.

## Not in D21

Anything a major's release notes call a feature rather than a migration (React Compiler through `plugin-react` 6's Babel bridge, Vitest 5's browser mode, Rolldown's `advancedChunks` beyond what ADR-0062 §4 needs); Postgres 17/18 (`DB-05`); Node 26 (ADR-0073 §4's floor stands); the coverage threshold; a TypeScript 7 adoption that the spike did not prove.
