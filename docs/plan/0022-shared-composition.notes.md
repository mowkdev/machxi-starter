# D22 — Shared composition, second wave: build notes

The per-step build record of [D22](0022-shared-composition.md) — what was built, the amendments, the review findings and their fates, the gate's output, the workspace test total and the bundle measurements before and after each step, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D22.1 — ADR-0077 accepted; the session, the principal cache and the root's join in the kit (2026-09-29)

**Head.** [ADR-0077](../adr/0077-shared-composition-second-wave.md) moved from `proposed` to `accepted`. [ADR-0062](../adr/0062-frontend-build-and-shared-composition.md) gained its third delta on its `- Status:` line and a dated note in its body: §1's contents of the kit, and the `D14.8` amendment's list of what stays in the apps. The index rows for both records, the topic table's "SPA architecture, doors and the shared composition" row and the ledger's window section say so. `scripts/rules-digest.mjs` gained the line "The session and the root in the kit", citing 0077 as its own, and "Where the machinery lives" now says an app keeps its settings provider rather than its providers.

**Built.** Closes `FE-01` for its composition half.

- `@repo/app-kit` gained four modules:
  - `providers/session.tsx` exports `createAppSession({ segment, baseUrl, unreachable })`. It returns the store, the client, the boot sequence, `onSessionEnded` and the `SessionProvider` with its unreachable notice.
  - `providers/principal-cache.tsx` exports `createPrincipalCache(ownerOf)`. The kit answers for "nobody is signed in" itself, and asks the app's function about a principal only.
  - `providers/app-root.tsx` exports `AppRoot`. The session gate and the settings gate are slots, the router arrives as `children`, and the translation bindings moved in with the order.
  - `feedback/error-reporting.ts` exports `createErrorReporter(dsn, load)` and the `ErrorContext` shape.
- Both apps' `app/providers/session.tsx`, `app/providers/principal-cache.tsx` and `app/index.tsx` are bindings. The six files went from 935 lines to 359.
- Each app gained two door files, `shared/api/session.ts` and `shared/api/principal-cache.ts`. `shared/ui` gained `AppRoot` and lost `AppLoader` and `AppErrorBoundary`, whose last consumer in each app was `app/index.tsx`.
- The kit reads `common:boot.unreachable`, so both apps' `scripts/i18n.mjs` name the key in `DYNAMIC`, beside `loading.starting`.
- No dependency was added and no lockfile line moved, so no side worktree was needed and nothing was restarted.

**The files under `shared/` that are identical in both apps.** Six same-path files were byte-identical. One moved, one moved in part, and four stay:

| File                                 | Fate          | Why                                                                                      |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| `shared/error-reporting/context.ts`  | moved         | A type that binds nothing.                                                               |
| `shared/error-reporting/index.ts`    | moved in part | The factory moved. The file stays as the binding of the app's DSN and the app's adapter. |
| `shared/error-reporting/reporter.ts` | stays         | ADR-0066 §3 names it as the one file a fork replaces, and that record is closed.         |
| `shared/api/query-client.ts`         | stays         | It binds the app's error map and the app's translator.                                   |
| `shared/theme/provider.tsx`          | stays         | It binds the app's device-key prefix.                                                    |
| `test/matchers.d.ts`                 | stays         | It is under `test/`, and the app's own TypeScript program needs the augmentation.        |

The factory takes the adapter's loader as a parameter, so the `import("./reporter.js")` is still written in the app and the adapter is still a chunk of the app's build. Both apps' `DOORS` rows for the kit gained the `error-reporting` slice.

**One difference that was not a value.** The plan and the record name two differences between the session providers, the segment and the sentence. There was a third: the customer's unreachable notice carried `bg-background` and the admin's did not. The kit ships the class, so the admin's notice gained it. `packages/ui/src/styles/globals.css` paints `body` with the same token, so no pixel should differ. That was read from the stylesheet and not seen in a browser. The alternative was a class parameter, which ADR-0077 §1 does not name.

**Tests.** Unit tier, per workspace:

| Workspace       | Before | After |
| --------------- | ------ | ----- |
| `@repo/app-kit` | 48     | 75    |
| `admin`         | 537    | 532   |
| `customer`      | 296    | 290   |
| every other     | 1523   | 1523  |
| **total**       | 2404   | 2420  |

The integration tier is unchanged: `api` 823 and `@repo/db` 113.

- **Moved, 7 cases.** The four session cases both apps shared and the three error-reporting cases. Each ran twice, once per app, and now runs once in the kit.
- **Kept as the doors' smoke tests, 5 cases.** The admin keeps one session case and one error-reporting case. The customer keeps two session cases (the real boot sequence over its own handlers, and the sentence under its own catalogue) and one error-reporting case.
- **Net-new, 20 cases, all in the kit.**
  - `session-provider.test.tsx`, 5: "the session provider is bound by segment", "gives every session its own store, client and ended-handler", "interpolates the values the app passes into its own sentence", "names nothing the app did not pass", "reads the sentence from a mounted instance when there is one".
  - `principal-cache.test.tsx`, 6: "the principal cache key is the app's function" and five on the boundary's own mechanics.
  - `app-root.test.tsx`, 4. Neither app had a suite for `app/index.tsx`.
  - `composition.test.ts`, 4: "a composition root imports only shakeable barrels", its vacuity guard and two negative cases.
  - `error-reporting.test.ts`, 1: "swallows an adapter that will not load".
- Both apps' `principal-cache.test.tsx` stay where they are. They render the app's `SettingsProvider` over the settings handlers, so they prove the binding together with the subtree it keys, and they cannot move before the settings client does.

**The barrel case went red.** With `import { createLogger } from "@repo/logger"` appended to `apps/admin/src/app/index.tsx`, "a composition root imports only shakeable barrels" failed naming `@repo/logger`. It went green again with the file restored.

**What the barrel case reads.** Each app's `app/index.tsx`, the app files it imports (one hop), and the kit's own shipped sources. The kit's own barrel is exempt from the map, because `SHAKEABLE`'s docblock leaves the kit out for its `testing/setup` entry, and step 2's done-when counts eight packages with `@repo/account`.

**`pnpm size`, gzipped kB, before → after.**

| app      | js            | css         | entry         |
| -------- | ------------- | ----------- | ------------- |
| admin    | 365.3 → 364.7 | 14.6 → 14.6 | 163.2 → 162.7 |
| customer | 308.8 → 308.7 | 13.7 → 13.7 | 105.9 → 106.0 |

The vendor chunks moved by at most 0.1 kB. No row moved by 1%, so neither budget file is touched.

**Gate.** Run link by link on the tree before the review's fixes:

| Link           | Result |
| -------------- | ------ |
| `lint`         | 21/21  |
| `check-types`  | 16/16  |
| `test`         | 16/16  |
| `size`         | 4/4    |
| `format:check` | clean  |

The links were run again after the review's fixes and this note, and were green again.

**The done-when's other commands.**

- `pnpm rules:digest` wrote 2 of 3, then 0 of 3.
- `pnpm docs:check` and `pnpm i18n:check` passed inside `lint`.
- `pnpm test:e2e` passed against the running stack, on the tree before the review's fixes: admin 38 passed and 1 skipped, customer 12 passed. The fixes touched three test files and two comments.

**A flake, observed once.** In the first `pnpm check`, `users-manage.test.tsx` "keeps the operator where they are when the mint is refused" timed out at 20s waiting for its toast, while the whole unit tier ran in parallel. The file passed alone (39/39) and passed in the gate's `pnpm test`. It renders through `renderWithProviders`, which this step does not touch.

**Amendments.** None. Neither the plan nor ADR-0077 was amended.

**Review: one `adr-reviewer` pass, five findings, all minor.**

- **The admin's unreachable notice gained `bg-background`.** Declared above, and the kit's docblock now says the two copies differed in three things. Not reverted.
- **"gives every session its own store, client and ended-handler" asserted nothing about the handler.** Fixed: the case registers a handler on each of two sessions, ends the first, and asserts the first was called and the second was not.
- **The vacuity guard counted the kit's own sources**, which are always there. Fixed: it counts the app's half alone.
- **A comment in the customer's smoke test claimed a proof the test does not make.** Fixed: the comment now says the segment is proved by the assertion on the app's own client.
- **The barrel case follows one hop.** Logged, and it matters at step 2: `@repo/account` arrives through feature slices, which sit two hops from `app/index.tsx`, so the case would stay green without an `account` row in `SHAKEABLE`. Step 2's own done-when requires that row.

**Loose ends observed, not taken here.**

- `@repo/app-kit` declares no `sideEffects`, and both roots now import more of it by barrel. An honest declaration would name `./src/testing/setup.ts`. Adding the kit to `SHAKEABLE` makes step 2's count nine where the plan says eight, so it is the operator's call.
- `/frontend-conventions` still describes `app/providers/` as holding the session. The plan gives the skills to step 4.
- `AppCrash` is re-exported by both `shared/ui` doors and has had no consumer in either app since before this step.

**Pending the operator.** One thing to eyeball: the admin's "API is not reachable" screen, in both themes, to confirm `bg-background` changed nothing. It shows when the admin is loaded with the API stopped, so it needs the operator's stack. _Accepted by the operator 2026-09-29; see the D22.2 note._

## D22.2 — `@repo/account`: the settings client, the preference cards, password reset and the shared profile features (2026-09-29)

**Head.** [ADR-0051](../adr/0051-platform-extraction.md), [ADR-0045](../adr/0045-user-settings.md) and [ADR-0053](../adr/0053-account-area.md) moved to `superseded by` [ADR-0077](../adr/0077-shared-composition-second-wave.md). Each change is its `- Status:` line plus one appended dated paragraph that states the delta and what stands. With 0062 moved at `D22.1`, all four of 0077's parents have now moved. The index rows, the topic table's "SPA architecture, doors and the shared composition" and "User settings and the account area" rows, and the ledger's window section say so. `scripts/rules-digest.mjs` gained the line "The account package". "Where the machinery lives" and "Doors" now cite 0077, and the digest loads with "the eight platform packages".

**Built.** Closes `FE-01`.

- **`packages/account`** is new, with `"sideEffects": false` and its `accountClient` catalogue in `en` (composed at `init`) and `lv` (loaded lazily). It holds:
  - `settings/`: the settings API, keys and queries, the coalescing writer with the server preference adapter, and the settings gate (`settings-provider.tsx`);
  - `preferences/`: the theme, density and locale cards over one options control;
  - `password-reset/`: the forgot-password form, the reset form and `use-reset-password`;
  - `profile/`: the profile details form and the change-password dialog.
- **The grid preference adapter is a parameter.** The admin passes it as a `GridPreferenceSeam`. The customer passes none, and with no seam the writer never reads a grid and no `grids` key goes on the wire.
- **Both apps' slices are now doors** under ADR-0077 §3: `entities/settings`, `features/auth`, `features/profile-manage`, `features/theme`, `features/locale` and `features/density`. Each is an index that re-exports and binds the app's values. `app/providers/settings.tsx` in each app is a binding. A page's imports did not change.
- **`doorRules`** in `packages/config-eslint/doors.js` learned a door outside `shared/`. Both `DOORS` tables gained the six-slice row, both `eslint.config.js` files carry it, and `app-i18n.ts` is exempted by file to reach the catalogue.
- **The stylesheets.** Both `styles.css` files gained `@source` for the package and `@source not` for its `__tests__`, and `RENDERING_PACKAGES` gained `@repo/account`.
- **`composition.test.ts`.** `SHAKEABLE` gained `account: false`, so it names eight. The barrel walk now follows a root until the route tree rather than one hop, because `@repo/account` sits three hops from each root (`app/index.tsx`, then the settings provider, then `entities/settings`). A guard case proves the walk reaches that door. This closes the one-hop finding logged at D22.1.
- **The customer's twin of `grid-chunk.test.ts`**: "the account package brings no grid".
- **One lockfile entry.** `pnpm-lock.yaml` gained the workspace package. Both apps depend on `@repo/account`, and both `tsconfig.json` files reference it. The step was built in the side worktree `.claude/worktrees/d22-2`, so `main` and the running stack were not touched. The worktree ran on the committed `.env.example` files, because a permission rule refused copying the operator's `.env` (the D28.2 precedent).

**Declared deviations from the plan's wording.**

- The namespace is `accountClient`, not `account`, because both apps already own an `account` namespace for `pages/account`.
- The kit's `SettingsOptions` control and principal-cache boundary reach the package as slots, because it depends on `@repo/app-kit` never.
- The profile entity stays in each app.
- Tests are net +71, not zero (see below).
- `settings.md` and `users-and-profile.md` each gained one requirement, rather than only renaming their `Proved by:` paths.

**Amendments.**

- **ADR-0077 §2**, `Amended 2026-09-29 (D22.2)`: the namespace, what is worded identically versus what arrives as a key, the slots, and the profile entity staying per app.
- **ADR-0077's Supersedes line and 0045's Status line and paragraph**, from the review: the delta is named "§The client (its home)", because 0045 has no heading called "The client's home".
- **This plan's step 4** gained the kit's own `sideEffects` / `SHAKEABLE` item (below).

**Tests.** Unit tier, per workspace, from the gate's `pnpm test` log:

| Workspace       | Before | After |
| --------------- | ------ | ----- |
| `@repo/account` | —      | 110   |
| `@repo/app-kit` | 75     | 77    |
| `admin`         | 532    | 500   |
| `customer`      | 290    | 281   |
| every other     | 1523   | 1523  |
| **total**       | 2420   | 2491  |

The integration tier is unchanged: `api` 823 and `@repo/db` 113. `packages/config-eslint/rules.test.js` runs inside `lint` and gained "a feature slice is a door for its own groups and no others (ADR-0077)".

- Net +71 is the measured delta, and it includes the one case the review added ("reaches no grid through the workspace packages it depends on", in the customer's `grid-chunk.test.ts`). The builder declared +71 before that case existed. The one-case difference between the two counts was not reconciled.
- The package's suites are the moved app suites, split into `settings.storage`, `settings-provider`, `theme-cards`, `density-cards`, `locale-rows`, `forgot-password-form`, `reset-password`, `profile-details-form`, `change-password-dialog` and `catalogue`. Each app's slice keeps its own tests as the door's smoke tests.

**`pnpm size`, gzipped kB, D22.1's close → this step.**

| app      | js            | css         | entry         |
| -------- | ------------- | ----------- | ------------- |
| admin    | 364.7 → 366.5 | 14.6 → 14.6 | 162.7 → 163.2 |
| customer | 308.7 → 311.1 | 13.7 → 13.7 | 106.0 → 107.2 |

The customer's build has no `table` chunk. Both apps are within budget, and neither budget file is touched.

**Verified by running**, in the worktree, on the tree including the review's fixes:

| Link           | Result                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `lint`         | 22/22, cold                                                                                            |
| `check-types`  | 17/17, cold                                                                                            |
| `test`         | 17/17, cold (the integration tier ran against the test database)                                       |
| `size`         | 4/4                                                                                                    |
| `format:check` | red once on `docs/adr/README.md` (a table the anchor fix widened), then clean after `prettier --write` |

- The builder had run the same links cold on the staged tree before the review, and every link passed.
- **The lint red case.** `export { ThemeCards as __probe } from "@repo/account"` was appended to each app's `pages/account/index.tsx`. `eslint --max-warnings 0` refused it in both apps with the ADR-0077 `no-restricted-imports` message. Both files were then restored from the index.
- `pnpm docs:check` and `pnpm i18n:check` passed inside `lint`. The reviewer ran `node scripts/rules-digest.mjs --check`, which answered "up to date (3 digests)".

**Inferred, not run.**

- `pnpm test:e2e` was not run. The worktree serves nothing, and the operator's stack serves `main`, which does not have this step until it is fast-forwarded and installed.
- "No pixel changes" for the account screens rests on the moved components being the same markup, as the review read them. Nobody looked at them in a browser.

**Review: one `code-reviewer` pass and one `adr-reviewer` pass.** Neither found a blocker or a major. The code reviewer read every removed app file beside its package counterpart and found no behaviour lost: the query keys, the latch, the writer's coalescing, the reset hook's two app variants, the catalogue keys and `sideEffects: false` all hold.

- **(adr, minor) `.claude/rules/frontend.md` does not load the digest for `packages/account/**`.** Logged for D22.4: step 4 already owns "the rule files".
- **(adr, minor) The customer's `app-i18n.ts` comments** said it registers `@repo/form` alone, and "like the two above it". Fixed.
- **(adr, minor) "§The client's home" names no heading in ADR-0045.** Fixed in 0045, in 0077's Supersedes line and in the index row, as "§The client (its home)".
- **(code, low) The customer's `grid-chunk.test.ts` checked only `@repo/account`'s own manifest.** A grid declared by one of the package's workspace dependencies would still have reached the bundle. Fixed: a case now checks each `@repo/*` dependency one level down.
- **(code, low) The customer's `settings-provider.test.tsx:163` asserts "no toast" right after the density renders**, so a toast arriving a tick later would pass unseen. The assertion is inherited from the pre-move suite, so this step did not introduce it. Logged, not changed.

**Decided by the operator (delegated to the coordinating session), 2026-09-29.**

- **The kit's own `sideEffects` / `SHAKEABLE` row: yes, and built at D22.4, not here.** After D22.1 and this step, `@repo/app-kit` is the barrel both composition roots import most, so its exemption is a hole in the barrel guard exactly where the imports are. Step 4 was amended in place (`Amended 2026-09-29 (D22.2)`):
  - First confirm that no module under `packages/app-kit/src` has an import-time side effect.
  - If none has, the kit gets `"sideEffects": false` and a `SHAKEABLE` row, taking the count from eight to nine, with a labelled amendment to ADR-0077.
  - If one has, the exemption is written into ADR-0077.
  - Either way, `pnpm size` is measured before and after.

  This step builds without it: `packages/app-kit/package.json` and the kit's `SHAKEABLE` exemption are untouched.

- **The admin's unreachable notice keeps `bg-background`** (carried from D22.1), and the kit gains no class parameter. ADR-0077 §1 names the segment and the sentence as the providers' only deliberate differences, so the class was drift between two copies. `body` paints the same token, so no pixel should change. _Accepted by the operator 2026-09-29: seen with the API blocked, in both themes, it looks the same._ If it ever differs, the fix is to remove the class from the kit, not to parameterise it.

**Pending the operator.** Step 2's checkbox is not ticked. Its done-when includes `pnpm test:e2e`, which needs this commit in `main`.

1. Fast-forward `main` to `d22-2` (`git merge --ff-only d22-2`, run in the main checkout).
2. `pnpm install` in `main`, since the lockfile gained `@repo/account`. Restart whatever the install disturbs.
3. `pnpm test:e2e`, in both apps, against the running stack.
4. Open the admin with requests to `localhost:4000` blocked, in the light theme and in the dark theme, and confirm the "API is not reachable" screen looks unchanged.
5. Tick step 2 when all of the above pass.

**Closed 2026-09-29.** `main` was fast-forwarded to `d716f50` by the coordinating session, on the operator's instruction. The operator then ran `pnpm install` and `pnpm test:e2e` in `main` and reported both green; that is the operator's report, and no counts were recorded. The step was ticked on the operator's instruction. The visual check of the admin's unreachable notice, item 4, was not reported at the tick. The operator reported it later the same day: seen with the API blocked, in both themes, it looks the same. It is _accepted by the operator_.

## D22.3 — The grid's and the form's suites live in their packages (2026-09-29)

**Head.** No record moves at this step. ADR-0077 §4 was accepted at `D22.1`, and neither the plan nor a record was amended here.

**Built.** Closes `FE-04`, `FE-09`'s residual as far as this step can (see the durations), and `FE-15` for its first and fifth files. The fates are written into the reviews at `D22.4`.

- **The moved suites.** Ten admin files left `apps/admin/src/shared/{grid,form}/__tests__` for `packages/grid/src/__tests__` and `packages/form/src/__tests__`.
  - The grid's `app-grid.test.tsx` was split by concern as it landed: `demo-grid` (the table, the pager, search, loading and the viewport frame), `header-filters`, `filter-bar` (the applied-filters bar and the hot filters), `selection-and-toolbar` and `column-preferences`. The five share `support/demo-harness.tsx`.
  - The form's `app-form-surface.test.tsx` was split into itself (the parity cases, the one deliberate difference, the drawer's refusal and the page's blocker) and `app-form-surface-layout.test.tsx` (the inverted frame). The two share `support/surface-harness.tsx`.
  - `list-state`, `filter-chips`, `bulk-summary`, `grid-locale`, `app-form`, `app-form-dialog`, `server-errors` and `server-errors-locale` moved whole.
- **The harness.** Both packages run on `@repo/app-kit/testing/setup`, with `testTimeout: 30_000` above its twenty-second `asyncUtilTimeout`, as both apps do. Each package's own `support/setup.ts` was a subset of the same stubs and was deleted. Each package gained `support/matchers.d.ts`, the apps' `test/matchers.d.ts` in miniature, because the setup file is outside the package's TypeScript program.
- **The fixture.** The admin's demo resource was split between the packages: the columns and rows to `@repo/grid`, the fields and bodies to `@repo/form`. Each half has its own `demo:` catalogue and `ResourceNamespaceMap` augmentation. The admin's own fixture stays, because `shared/resource/__tests__/config.test.ts` still reads it.
- **The instances.** `@repo/grid`'s `demo-i18n.ts` composes the grid's catalogue in `en` and `lv`, the fixture's, and the `common:options` slice an enum resolves through. `@repo/form`'s `render.tsx` composes the form's catalogue in both locales and the fixture's, and binds `applyZodLocale` and `zodLocaleReady` as `zod-locale.test.ts` does. Both are `@repo/i18n`'s factory.
- **The doors' smoke tests.**
  - The grid door keeps `app-grid.test.tsx` with the two density-binding cases it already had, over the door's own `AppGrid`.
  - The form door keeps `server-errors-locale.test.tsx` with the Latvian re-derivation through the admin's own `createI18n`. That is the case that proves the admin's binding installs zod's map. The file keeps its `lv` block because `turbo gen resource-screen` fills it (`PARTIAL_LV_FIXTURES`).
- **The pending submit label.** `packages/form/src/__tests__/app-form-actions.test.tsx`: "the pending submit label is a catalogue string", under the pseudo-locale. It asserts the key exists, the label is bracketed by the lens, it is not the primitive's "Loading", and it is `t("form:actions.pending")`.
- **The dependencies.** `@repo/grid` gained `@repo/app-kit` as a devDependency. `@repo/form` gained `@repo/app-kit`, `@repo/app-services` (the route-meta hooks the surface harness reads), `@hookform/resolvers`, `@testing-library/user-event` and `react-i18next`, all as devDependencies. Both `tsconfig.json` files reference the new workspaces. Neither the kit nor `@repo/app-services` depends on either package, so no cycle arises. The customer's `grid-chunk.test.ts` checks `@repo/account`'s dependencies one level down for `@repo/grid` and the table engine, and `@repo/form` still declares neither.
- **The lockfile moved**: 18 lines in `pnpm-lock.yaml`, importers only. So the step was built in the side worktree `.claude/worktrees/d22-3` on branch `d22-3`, and `main` and the running stack were not touched. The worktree ran on the committed `.env.example`, copied to its ignored `.env`, as at D22.2.

**Declared deviations from the plan's wording.**

- **"Each door keeps one smoke test."** The grid door keeps one file with two cases (with and without a density provider), both pre-existing. The form door keeps one case, which is also moved into the package, so it runs twice (below).
- **Three moved cases read a stand-in rather than the admin's words.** `bulk-summary` reads the fixture's `demo:noun` ("widget", "widgets") where it read `staff:noun` and `users:noun`, which are the admin's namespaces. `server-errors` reads the harness's `APP_ERRORS` ("… (test).") where it read the admin's `errors` catalogue. The review confirmed that every other body is unchanged, and that the stand-ins make those cases stricter: a "(test)" sentence arrives only through the `messageForError` the case passes.
- **The surface harness returns the render result alone.** In the admin it also returned the router, which no case read. Exported from its own module, the router's inferred type could not be named by the declaration emit.

**Tests.** Unit tier, per workspace, from the gate's `pnpm test` log:

| Workspace    | Before | After |
| ------------ | ------ | ----- |
| `@repo/grid` | 101    | 206   |
| `@repo/form` | 7      | 74    |
| `admin`      | 500    | 330   |
| every other  | 1883   | 1883  |
| **total**    | 2491   | 2493  |

The integration tier is unchanged: `api` 823 and `@repo/db` 113.

- **Moved, 170 cases, at zero net.** 105 to `@repo/grid` and 65 to `@repo/form`. The review matched the titles: 161 in the ten files at `HEAD`, and 162 across the new package files and the two admin smoke files. The one extra title is the duplicated Latvian case.
- **Kept as the doors' smoke tests, 3 cases.** The two density cases and the Latvian case.
- **Net-new, 2 cases, both in `@repo/form`.** "the pending submit label is a catalogue string", and the package's copy of "says it in Latvian once the locale has moved, with no reload".

**The pending-label case went red.** With `actions.pending` deleted from `packages/form/src/locales/en.json`, the case failed on `expected false to be true` (the `exists` assertion). It went green again with the file restored from the index.

**Line counts** (`wc -l`) of every moved file, before → after. The admin paths are under `apps/admin/src/shared/`, the package paths under `packages/{grid,form}/src/__tests__/`.

- `grid/__tests__/app-grid.test.tsx`, 1838 → `demo-grid` 325, `header-filters` 265, `filter-bar` 346, `selection-and-toolbar` 371, `column-preferences` 414, and `support/demo-harness.tsx` 167. The admin's smoke file of the same name is 100.
- `grid/__tests__/list-state.test.ts`, 360 → 359.
- `grid/__tests__/filter-chips.test.ts`, 249 → 252.
- `grid/__tests__/grid-locale.test.tsx`, 129 → 130.
- `grid/__tests__/bulk-summary.test.ts`, 104 → 107.
- `form/__tests__/app-form-surface.test.tsx`, 764 → `app-form-surface` 295, `app-form-surface-layout` 216, and `support/surface-harness.tsx` 294.
- `form/__tests__/server-errors.test.tsx`, 308 → 303.
- `form/__tests__/app-form.test.tsx`, 282 → 285.
- `form/__tests__/server-errors-locale.test.tsx`, 264 → 234. The admin's smoke file of the same name is 164.
- `form/__tests__/app-form-dialog.test.tsx`, 217 → 216.

No moved or split file is over 600 lines. The largest is `column-preferences.test.tsx` at 414.

**The admin unit tier's duration**, from the tier's own `Duration` line, `pnpm turbo run test:unit --filter=admin --filter=@repo/grid --filter=@repo/form --force --concurrency=1` in the worktree, once each:

| Workspace    | Before (`4bbe52c`)          | After                       |
| ------------ | --------------------------- | --------------------------- |
| `admin`      | 96.93s, 60 files, 500 tests | 87.55s, 52 files, 330 tests |
| `@repo/grid` | 38.58s, 12 files, 101 tests | 19.26s, 21 files, 206 tests |
| `@repo/form` | 3.04s, 1 file, 7 tests      | 13.46s, 8 files, 74 tests   |

- The admin link is about 10% shorter. That is one run each way on one machine, and the grid's before-run shows how noisy a single run is: 38.6s for 101 tests, then 19.3s for 206.
- The bill `FE-09` named is `staff-page`, `staff-manage`, `users-manage`, `users-page` and `record-routes`: the files that mount the whole route tree. They stayed in the admin, and they were most of that link. `app-grid` was the one package suite among them, and it left. Whether the rest is worth pre-bundling is D22.4's close-out question, not this step's.

**`pnpm size`, gzipped kB, D22.2's close → this step.**

| app      | js            | css         | entry         |
| -------- | ------------- | ----------- | ------------- |
| admin    | 366.5 → 366.4 | 14.6 → 14.5 | 163.2 → 163.2 |
| customer | 311.1 → 311.0 | 13.7 → 13.7 | 107.2 → 107.2 |

No shipped source changed. The admin's CSS fell 0.1 kB, which is consistent with Tailwind no longer scanning the moved test files' class names under `apps/admin/src`. That was inferred, not traced. Neither budget file is touched.

**Verified by running**, in the worktree, on the tree before the review's two edits:

| Link           | Result                                                           |
| -------------- | ---------------------------------------------------------------- |
| `lint`         | 22/22 (1 cached)                                                 |
| `check-types`  | 17/17 (14 cached, from the step's own earlier run)               |
| `test`         | 17/17, cold (the integration tier ran against the test database) |
| `size`         | 4/4                                                              |
| `format:check` | clean                                                            |

After the review's two edits and this note, the links were run again: see the commit message.

**Inferred, not run.** `pnpm test:e2e` was not run. The worktree serves nothing, and the operator's stack serves `main`, which does not have this step until it is fast-forwarded and installed. The step changes no shipped source, so no browser-visible change is expected.

**Review: one `code-reviewer` pass, three findings, all low, all carried over from the admin.** The reviewer compared each moved case's body, keyed by title, with the version at `HEAD`, and found none weakened and none lost.

- **The `common:options` stand-in words are what `humanize` answers**, so the enum cases pass with that block deleted. The admin had the same gap. Not changed: the fix would rewrite a dozen moved assertions. `demo-i18n.ts` now says the lookup is not checked here and is `@repo/resource`'s to certify.
- **The admin's density case "hands the table the account's mode" looped over the cells with no non-empty guard.** Fixed: it gained its sibling's `toBeGreaterThan(0)`.
- **At `en`, "shows the schema's rule rather than the wire's copy" is satisfied by either source**, as its own comment says. The Latvian case beside it is the real proof, in the package and in the admin. Logged, not changed.

**Pending the operator.** Step 3's checkbox is not ticked. The step moved the lockfile, so it follows the D22.2 path:

1. Fast-forward `main` to `d22-3` (`git merge --ff-only d22-3`, run in the main checkout).
2. `pnpm install` in `main`, since `pnpm-lock.yaml` gained the new devDependencies of `@repo/grid` and `@repo/form`. Restart whatever the install disturbs.
3. `pnpm test:e2e`, in both apps, against the running stack.
4. Tick step 3 when all of the above pass.

**Closed 2026-09-29.** The coordinating session fast-forwarded `main` to `90c8642` on the operator's instruction. The operator then ran `pnpm install` and `pnpm test:e2e` in `main` and reported them green; that is the operator's report, and no counts were recorded. Before the operator's install, the coordinating session's `pnpm exec prettier` set off pnpm's pre-run dependency check in `main`. It reported the workspace and lockfile up to date and re-ran `argon2`'s install script, and the running API stayed healthy (`/health` ok, not restarted). The step was ticked on the operator's instruction.

The visual check of the admin's unreachable notice (D22.1, D22.2) was still pending when this note was written. The operator accepted it later the same day; see the D22.2 note.
