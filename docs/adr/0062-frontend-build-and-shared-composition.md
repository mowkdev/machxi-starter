# ADR-0062: Frontend build and shared app composition (supersedes ADR-0051, ADR-0002, ADR-0052 and ADR-0049/ADR-0055 in part — deltas)

- Status: superseded by [ADR-0073](0073-review-hardening.md) (delta: §4's budget gains a bound — every ceiling at most 15% over a committed baseline, re-measured in the diff that raises it — and, below the route split, the rendering packages declare `sideEffects: false` so a barrel import costs the entry only what it uses; the vendor groups, the hidden sourcemaps, the per-chunk ceilings and the 60% cap stand)
- Date: 2026-09-02
- Supersedes (**landed at `D14.8`** 2026-09-03, the step that builds §1–§2; **§3–§4 landed at `D14.9`** 2026-09-03 under this same record): [ADR-0051](0051-platform-extraction.md) (delta: a **seventh** platform package, `@repo/app-kit`, holding the composition the six left in the apps — the door rule, the per-app dictionary, policy data and config are exactly as 0051 wrote them), [ADR-0049](0049-admin-app-architecture.md) as carried by 0051 (delta: the layering gains one shared-composition door and the door blocks are generated from a `DOORS` table rather than hand-copied; every layer, arrow and public-API rule stands), [ADR-0055](0055-customer-app.md) (delta: the app roster — `apps/web` leaves the tree at `D14.1` and the marketing site scaffolds fresh at D16; every stack decision 0055 and, through it, [ADR-0022](0022-frontend-apps.md) made about it stands), [ADR-0002](0002-monorepo-layout-and-tooling.md) (delta: a **declarations-only** build exists for type-checking, emitted to a gitignored directory that nothing at runtime resolves to — the no-build-step decision for source consumption stands), [ADR-0052](0052-grid-and-admin-followups.md) (delta: `size-budget.json` grows per-chunk ceilings beside its totals; the mechanism — a committed number raised only by a reviewed diff — is unchanged)

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; **accepted 2026-09-03 at the head of `D14.8`**, where all five parents moved to `superseded by` in the same commit. Amendable in place, labelled, while D14 is `in progress` (ADR-0025 rule 2).
>
> **Superseded in part 2026-09-18 by [ADR-0073](0073-review-hardening.md)**, at the head of `D20.9`, the step that makes the delta true. §4 set the budget's shape — three totals, a ceiling per vendor chunk, the entry capped at 60% of `js` — and left every ceiling a number somebody chose: the review found both files 2–5% over measurement with nothing bounding a raise. 0073 §5 bounds it (a ceiling at most 15% over the baseline beside it, `scripts/size.mjs` refusing the file otherwise, so a raise is a diff that shows both numbers) and lowers the entry from below the route split — `@repo/grid` and `@repo/form` declare `sideEffects: false`, so the barrel imports the composition roots make no longer carry every module those barrels re-export into the entry. Everything else in §3–§4 stands as written and is in force as part of 0073.
>
> **Two of the five deltas were executed before this record was accepted, and both were deliberate.** `D14.1` deleted `apps/web` on the plan's own instruction — the roster delta is the one part of this record a housekeeping step could land without the package existing — and `D14.9` builds §3–§4. Accepting the whole record at `D14.8`'s head is the house rule (an ADR is accepted at the head of the step that builds it, and this is the first step that builds any section of it); the parent list above states which section each supersession belongs to so that neither reading is left to inference.
>
> **Amended 2026-09-03 (D14.8) — what §1's provider list means by "the provider stack".** §1 names four providers for the kit: i18n, query client, ui-strings, settings. Three moved. **`SettingsProvider` did not, and cannot**: it is built out of `entities/settings` — the settings query, its coalescing writer and, in the admin alone, the server preference adapter behind ADR-0041's storage seam — and §Consequences of this record forbids the kit to "learn a route name, a resource name or a policy". A `SettingsProvider` in the kit would learn all three. The same reading keeps `app/providers/session.tsx`, `principal-cache.tsx` and `router.tsx` in the apps (a session store bound to a segment, a policy cache, and a route tree), and `test/render.tsx` with them (it composes the app's own route tree and providers). What moved is everything whose only app-bound parts are values a door can bind: the i18n provider takes the app's `createI18n` as a parameter, the query client takes the app's error map and translator, and `AppUiStrings` takes the app's key map.
>
> **Amended 2026-09-03 (D14.8) — §2's boundary renders a way out, not only a sentence.** §2 said the boundary "renders a localized failure surface, never `error.message`", and the first build of it did exactly that — which the diff review found is a **worse** failure than the white screen this record set out to replace: the boundary latches, a throw above the router has taken the shell with it, and there is no navigation left to recover on, so the window is permanently dead. So the top-level fallback is `AppCrash`: the router default's sentence with a **reload** beside it. A reload rather than a state reset, because whatever threw is still in whatever state produced it and clearing a boolean would re-run the same render on the same inputs; the session survives it, since [ADR-0018](0018-authentication-sessions-and-tokens.md)'s refresh cookie is `httpOnly` and the boot gate re-mints from it. The label is `common:actions.retry`, which both apps already carry for `QueryError`, so the surface adds no key to any catalogue. The route-level `AppError` keeps no action, and that is the same argument read the other way: the router remounts the route on the next navigation, and the shell around it is still on screen.
>
> **Amended 2026-09-03 (D14.8) — the account-area shell is the shell, not the navigation.** §1 names "the account-area shell" as kit content. What moved is `AccountShell` (the `SettingsLayout` composition and its nav label), `AccountSummary` (the `<dt>`/`<dd>` pair both apps repeated) and `ACCOUNT_SECTION_LINK` (the 300-character active-link class string, the actual duplicated design decision). **The section list did not**, because `@tanstack/react-router`'s `Link` types `to` against the app's own registered route tree: a package rendering `<Link to={someString}>` either fails the app's `check-types` or is admitted by a cast, and a cast that turns a route id into a string is exactly the class of defect the router's typing exists to prevent. Seven lines stay per app; the geometry moved.
>
> **Amended 2026-09-03 (D14.9) — a vendor chunk lives in its own directory, and the entry ceiling is capped rather than merely set.** §4 says each vendor group gets a chunk and each chunk a ceiling. Building it found the ceiling was uncheckable as written: a hashed name is `<name>-<hash>.js` and Vite's hash alphabet includes `-`. The admin already ships `query-error-<hash>.js` beside a `query` vendor chunk, so a `query-*.js` glob over `assets/` matches both; and stripping a hash at its last `-` gets the wrong answer on a hash that contains one, which this build's own `router-Ccolk-CK.js` does. So `chunkFileNames` routes the vendor groups to `assets/vendor/`, which is a boundary no glob can get wrong, and `scripts/size.mjs` fails when a budgeted name matches anything but exactly one file there, **and** when a file there is budgeted by nothing. The second half is the one worth naming: adding a group to `VENDOR_GROUPS` cannot ship unpriced. Beside it, the script refuses an `entry` budget above 60% of the `js` budget — the number this record's §Consequences predicted would fall, held down by arithmetic rather than by a note, because a ceiling anyone may raise to the sky is not a ceiling.
>
> **Amended 2026-09-03 (D14.9) — `"hidden"` sourcemaps are emitted, then dropped from the runtime image.** §4 decides the maps exist without being referenced from the bundle. What it did not say is where they end up: `dist/` is copied whole into each SPA's nginx stage ([ADR-0059](0059-ci-containers-and-deployment.md) §4), so "unreferenced" would have meant "served, and reachable by anyone who guesses a file name" — the app's entire source, published. The maps therefore leave the image (`apps/*/Dockerfile`) and stay in `dist/`, where a release pipeline or the error reporter of [ADR-0066](0066-infrastructure-seams.md) §3 can still take them.
>
> **Amended 2026-09-03 (D14.9) — the declaration emit is owned by `^check-types`, and a consuming project only reads it.** §3 says the packages set `composite` and the apps declare `references`. What that leaves unsaid is who *writes* `dist-types/`, and under Turborepo it matters: `tsc -b` in an app would happily rebuild a referenced package's emit, which is a task writing outside its own package and outside its declared `outputs`. The rule is that `check-types` declares `dependsOn: ["^check-types"]`, so every referenced project is already up to date before a consumer runs and the consumer's `tsc -b` finds nothing to do. An app's own `dist-types/` therefore holds a `.tsbuildinfo` and no declarations, which is correct — an app is not a referenced project.

## Context

[ADR-0051](0051-platform-extraction.md) (platform extraction) moved the behavioural machinery into six packages and left each app its own `shared/` doors, its dictionary, its policy data and its config. D12 then built `apps/customer` from those records and reported the headline the extraction was for: the six packages and `@repo/ui` took **no diff at all** from a second consuming app. That was true of the machinery. It was not true of the **composition** around it.

`apps/customer/src` holds roughly 128 files. About 110 have a same-path twin in `apps/admin/src`, and about 52 are code-identical — the i18n, query-client and ui-strings providers, `widgets/auth-layout`, the account-area shell, `shared/ui/app-loader`, `test/render` and the MSW harness, the app i18n factory. Nothing owns them, so they drift, and they already have, in both directions:

- **The customer app's stylesheet lost a package.** `apps/customer/src/app/styles.css` declares no `@source` at all — correct when it was written, and its own comment says `D12.6` will add the `form` pair with the first form. `D12.6` added three `@repo/form` renderers under `features/profile-manage` and did not add the lines. So the built customer CSS is missing utilities the form package uses (`gap-5` is in the admin's `dist` CSS and absent from the customer's) — the exact D9 defect `D10.4` diagnosed at length in the admin's own file, reproduced one app over, invisible to lint, types and every test.
- **The customer app is ahead of the admin.** Its router sets `defaultErrorComponent` and `defaultNotFoundComponent`, from `D12.2`'s review, because the router's own defaults render `error.message` behind a **Show Error** button in production. The admin's router still has neither.
- **The customer's lint config is the better one.** It generates its door blocks from a `DOORS` table through a `doorRules()` helper, in 324 lines; the admin hand-copies nine `no-restricted-imports` blocks with every other door's patterns written out inside each, in 745.

Neither app has a top-level React error boundary, so a render-time throw outside a route's own error component is a white screen with nothing recorded.

The build has its own slack. Every package exports raw TypeScript (`"exports": { ".": "./src/index.ts" }`, [ADR-0002](0002-monorepo-layout-and-tooling.md)'s no-build-step decision, which is why dev is fast); no package sets `composite` and no app sets `references`, so `check-types` in each app is a `tsc --noEmit` that re-checks every package from source, and `apps/admin/vitest.config.ts` raised `testTimeout` to 30 s at `D9.4` for the same reason. `autoCodeSplitting` is on but there is no `manualChunks`: the admin's entry chunk is 258 kB of 336 kB gzipped — about 76% of all JavaScript paid before anything renders — and `size-budget.json` prices only the totals ([ADR-0052](0052-grid-and-admin-followups.md) §The bundle budget), so vendor code moving into the entry costs nothing at the gate. Sourcemaps are off, so a production stack trace is unreadable.

## Decision

### 1. A seventh platform package, `@repo/app-kit`

`packages/app-kit` holds what both SPAs compose identically:

```
packages/app-kit/src/
  providers/      the provider stack (i18n, query client, ui-strings, settings)
  layouts/        the auth layout, the account-area shell
  feedback/       the app loader, the top-level error boundary
  router/         the router defaults — error and not-found components
  i18n/           the app i18n factory
  testing/        render helpers, the MSW server bootstrap
```

Each app reaches it **only through its own `shared/` doors**, exactly as it reaches the six D9 packages — one more row in a table, not a new kind of dependency. The app-specific parts stay in the apps and do not move: the route tree, the dictionaries, the policy data, `shared/config`, the size budget.

**The doors are declared once per app, as data.** The customer's `DOORS` table is the shape; its `doorRules()` helper moves into `@repo/eslint-config` (`packages/config-eslint`) so both apps — and any third — consume one implementation and declare only their table. The admin's hand-copied blocks are deleted, not ported. A package becomes one row in each app's table. The kit's contents beyond the providers: the auth layout, the app loader, the account-area shell, the settings options, the router error and not-found defaults, the top-level error boundary, the i18n app factory and the test harness (render helpers, the MSW server bootstrap).

The stylesheet defect is fixed by rule rather than by a line:

> **Every app's `styles.css` declares an `@source` for every platform package it depends on that renders**, and the pair is asserted — the app's dependencies read against its `@source` list, in a test or in `scripts/size.mjs`.

That is the check the admin's comment asked for in prose and nothing enforced.

### 2. A top-level error boundary in every SPA

Each app wraps its tree in `@repo/app-kit`'s error boundary, above the router and below the providers that give it copy. It renders a localized failure surface, never `error.message`, and reports through the reporting seam ADR-0066 decides. A route's own error component still handles what the router catches; this catches everything else.

### 3. TypeScript project references

The packages set `composite: true`; the apps declare `references`; `check-types` becomes `tsc -b`. Type-checking then walks each package once and caches it, instead of every app re-checking every package from source.

**ADR-0002's decision stands** — packages have no publish step and no bundling step, and Vite and `tsdown` still consume `src/*.ts` directly. The delta is narrow and worth stating exactly: a **declarations-only build exists for type-checking**, emitted to a gitignored directory, and nothing at runtime resolves to it.

### 4. Chunks, sourcemaps and per-chunk budgets

Each app's Vite build declares `manualChunks` for the vendor groups it actually has — react, router, query, table — so the entry carries the app and the framework is cached across deploys of it. `build.sourcemap: "hidden"` emits maps without referencing them from the bundle.

`size-budget.json` gains **per-chunk ceilings beside the totals**, and `scripts/size.mjs` fails on any chunk over its own ceiling. That is the delta on ADR-0052: the budget's shape grows a dimension, and the mechanism it decided — a committed number, raised only by a reviewed diff — is unchanged.

## Consequences

- The composition has an owner, so a fix like `D12.2`'s router defaults lands once for both apps, and the next divergence is a diff in one package rather than an invisible asymmetry.
- A third app — `apps/web`'s successor, a mobile shell — starts from `@repo/app-kit` plus a route tree and a dictionary.
- **The roster delta on [ADR-0055](0055-customer-app.md) §1 (and ADR-0022 as carried by it): `apps/web` leaves the tree at `D14.1`.** The placeholder scaffolded at `D3.1` never grew past one card, carried the heaviest dependency in the install for one consumer with no tests and no budget, and paid a Next type generation on every gate run. The marketing site is still a Next.js app on port 3003 — every stack decision 0022 and 0055 made about it stands — and D16 scaffolds it fresh on the current Next rather than upgrading a stub. Until then the port roster is two SPAs and the API.
- `@repo/app-kit` is the first package that may depend on other platform packages; its dependency direction is downward-only, and it must not learn a route name, a resource name or a policy.
- `tsc -b` makes the first check slower and every later one much faster; the `testTimeout` raised at `D9.4` can be revisited once it lands, on measurement rather than on hope.
- Splitting vendor chunks moves bytes rather than removing them; the totals in `size-budget.json` should barely move, and the entry ceiling should fall. If it does not, the split was cosmetic and the numbers say so.

## Alternatives considered

- **Fix the drift and move on** — sync the stylesheet, port the router defaults, copy the doors helper. It repairs the three known divergences and leaves the next one just as invisible, which is the actual defect.
- **Merge the two SPAs into one app with two route trees.** Contradicts [ADR-0055](0055-customer-app.md)'s separate app on its own port and [ADR-0056](0056-per-population-csrf-cookie.md)'s per-population cookie split, which exists precisely because the two populations must not share a document.
- **Build the packages to JS + `.d.ts`.** A full supersession of ADR-0002's no-build-step decision and a build step in every dev loop, to buy what project references buy for a declaration emit alone.
- **Per-route bundle budgets instead of per-chunk.** More faithful to what a user waits for, and it prices numbers that move whenever a route file is renamed; per-chunk ceilings are stable enough to be reviewed.
