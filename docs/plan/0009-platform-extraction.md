# D9 — Platform extraction

- Status: **planned** — D8 shipped 2026-08-27; **scoped 2026-08-27** (`/scope`, ADR-0050): the decisions are taken, [ADR-0051](../adr/0051-platform-extraction.md) is written `proposed` and is accepted at the head of `D9.1`, and the build order below is ready for `/step`. Opening is the ledger row moving to `in progress` — the operator's decision, not a formality
- Steps: `D9.1` – `D9.7`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the app-agnostic **behavioural** machinery leaves `apps/admin/src/shared` for workspace packages, and `apps/admin` becomes its first consumer through thin doors. D8 generalised the presentation; this moves the rest. Nothing is redesigned here — a step that finds itself wanting to change behaviour has found D8's work unfinished or D10's work early, and says so rather than doing it.

**The deliverable is mechanical by construction, and that is the point.** Every claim it makes is checkable: `apps/admin` green with the workspace test total unchanged, the same Postman numbers, the same browser walk. Steps are sized for the `/step` loop (ADR-0050 — the old unattended runner is retired), and their mechanical nature is what keeps each one a small, reviewable diff.

## What moves, and the shape of the question

Roughly in dependency order, with today's sizes (excluding tests) as the honest measure of what each is:

| Slice           | LOC   | Notes                                                                                                                                  |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `grid`          | 4,775 | The largest by far; `record-navigation.ts` is its one router dependency                                                                |
| `form`          | 1,472 | Grew: D8 moved the record surface's _geometry_ to `@repo/ui` and both behavioural wrappers stayed (`D8.10`, ADR-0047 §What-code)       |
| `api`           | 1,238 | The client, session, CSRF bootstrap — **the one real generalisation this extraction demands**: parameterised by population and segment |
| `i18n`          | 1,070 | D7 built it as a factory (`createI18n`) for exactly this day                                                                           |
| `resource`      | 614   | `ResourceConfig` and the registries                                                                                                    |
| `auth`          | 340   | `can()` and the policy table — per-app data, shared mechanism                                                                          |
| `theme`         | 251   |                                                                                                                                        |
| `notifications` | 210   |                                                                                                                                        |
| `lib`           | 58    | `route-meta.ts` is router-coupled                                                                                                      |

Four files under `shared/` import `@tanstack/react-router`: `api/search-params.ts`, `grid/record-navigation.ts`, `lib/route-meta.ts`, and `form/app-form-surface.tsx` — whose `AppFormPage` keeps its `useBlocker` here, because D8 moved the container's geometry to `@repo/ui` and left both behavioural wrappers behind (`D8.10`, ADR-0047 §What-code). The count is four either way; what changed is that the fourth is not going anywhere. **Whether the router is a peer dependency of the extracted packages or an injected seam is the extraction ADR's sharpest question** — both apps use TanStack Router, so a peer dependency is honest and cheap; an injected seam is purer and costs a boundary at every one of those four call sites.

Package granularity is the ADR's decision. House precedent (`contracts`, `crypto`, `logger`, `ui`) favours focused packages over one `@repo/app-platform`, and the dependency order above is a plausible package order.

## Rules the extraction inherits

- **Each app keeps its FSD `shared/` layer as thin doors** re-exporting from the packages — ADR-0031's one-door pattern generalised, so a page still imports from `@/shared/grid` and never from a package path.
- **`pages`, `features` and `entities` stay strictly per-app.** Nothing that names a resource may move.
- **Strings inside extracted machinery follow D7's package boundary** ([ADR-0046](../adr/0046-interface-localization.md)): a shared package ships its own namespace JSON and a `register(i18n)`, and each app composes its own bundle. This is why extraction runs after localization — the components move already dictionary-fed rather than needing a second sweep.
- **The `@repo/contracts` rule is not relaxed** ([ADR-0023](../adr/0023-shared-contracts-package.md)): zod and nothing else. A package that needs a contract imports it; contracts imports nobody.

## The decisions, taken 2026-08-27

All in [ADR-0051](../adr/0051-platform-extraction.md) (`proposed`, accepted at the head of `D9.1`, delta-superseding [ADR-0033](../adr/0033-browser-api-client-and-session.md) and [ADR-0049](../adr/0049-admin-app-architecture.md)'s `shared/` tree annotations): **six focused packages** (`api-client`, `i18n`, `resource`, `grid`, `form`, `app-services`), **the router as a peer dependency** of the packages that call it (the injected seam rejected — no planned app uses another router), the **door rule** generalised from ADR-0047, and **strings via ADR-0046 §13's `register(i18n)`**, its first real use. The [ADR-0022](../adr/0022-frontend-apps.md) roster supersession is **deferred to D11**, the deliverable that changes a roster fact.

## Build order

### ~~1. `@repo/api-client` — the client, parameterised~~ — **done 2026-08-27**

**ADRs:** [0051](../adr/0051-platform-extraction.md) (accepted at the head of this step; 0033 and 0049 move to `superseded by`), [0029](../adr/0029-csrf-strategy.md), [0030](../adr/0030-csrf-bootstrap-endpoint.md), [0023](../adr/0023-shared-contracts-package.md)

First because everything else sits on it, and because it carries the deliverable's one generalisation: the client, envelope/error handling, session store, CSRF bootstrap and URL⇄query serialization move to `@repo/api-client`, parameterised by segment — `apps/admin` configures `admin`, nothing else changes. `shared/api` becomes a named re-export door; the router peer lands here (`search-params.ts`).

**Done when:** ADR-0051 reads `accepted`, 0033 and 0049 read `superseded by ADR-0051`, the index says so; `apps/admin/src/shared/api` contains re-exports and app-specific config only; the package's suite carries the moved tests; `pnpm lint && pnpm check-types && pnpm test` green; `pnpm test:postman` at unchanged numbers.

**Amended 2026-08-27 (D9.1).** Four shapes the step had to settle:

- **The door is the slice's existing files, not a new `index.ts`.** ADR-0051's example sentence reads "a page still imports `@/shared/grid`", which suggests one module per slice; the shipped admin imports per file (`@/shared/api/client`, `@/shared/api/session-store`, and seven more across ~70 sites). Collapsing them would be a redesign of the import surface, which is the one thing this deliverable forbids itself, so each file became a named re-export instead and **not one import site above `shared/` changed**. What makes it a door is the lint rule, not the file count: `no-restricted-imports` forbids `@repo/api-client` outside `src/shared/api/**`, exactly as ADR-0047's rule forbids `@repo/ui/*` outside `src/shared/ui/**`. The `@/shared/grid`-style single door is available to any slice that wants one later.
- **Two files stayed, and the reason is dependency order rather than judgement.** `bulk-outcome.ts` imports `@/shared/notifications` and `query-meta.ts` imports `@/shared/i18n` — slices that extract at `D9.2` and later. They move when their dependencies do; until then they sit beside the door importing through it, which costs nothing and keeps this step's diff to the machinery it names.
- **`useSetPrincipal` widened in the package and re-narrowed in the door.** The shipped hook took a `StaffPrincipalResource` on D3.9's reasoning that the client is pinned to `/api/v1/admin`. That pin is now a parameter, so the package cannot make the claim and takes `PrincipalResource`; `apps/admin`'s door re-exports it typed back to staff. The narrowing is sound rather than asserted — a function accepting the union satisfies one accepting a member — so every call site in the app rejects a `user` principal exactly as before, with no cast written anywhere.
- **The suite keeps jsdom, and that is about transport rather than rendering.** The first draft gave the package `nodeConfig` on the reasoning that nothing in it renders — true, and the wrong question. **axios selects its adapter by environment**: `XMLHttpRequest` under a browser environment, Node's `http` otherwise. Under `node` this suite would have certified the `http` adapter, which the shipped client never takes, and `withCredentials: true` — the whole basis of the cookie session and the single-flight refresh (ADR-0029, ADR-0033) — is a no-op there. The tests ran under the admin's jsdom before the move, so the package takes `reactConfig` and a `jsdom` devDependency to keep proving what they proved. Caught by the review pass; it is the only behaviour change the move made beyond the two it intended.
- **The package carries a copied MSW harness, and the duplication is recorded rather than hidden.** `client.test.ts` needs an msw server, the envelope builders and the auth handlers; the admin's copies back **twelve** of its own test files (every resource handler extends the same envelope), so they could not move. A package whose tests imported from `apps/admin` would make the app a dependency of the thing it consumes, so the package took its own copy of `envelope.ts` and `auth.handlers.ts` plus a `server.ts` and `setup.ts` of its own. **The cost is two harnesses with one shape that can drift.** The option not taken is a shared test-harness package — not in ADR-0051's six, and not worth opening a seventh for on this step's evidence; the honest place to decide it is when a second package needs the same harness, which is `D9.4`'s grid.

### ~~2. `@repo/i18n` — the factory, and §13's first register~~ — **done 2026-08-27**

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0046](../adr/0046-interface-localization.md) §13

`createI18n` and its helpers move; the package ships the `register(i18n)` mechanism ADR-0046 §13 designed, which the later packages' namespaces will use; the admin's catalogues stay in the app. `shared/i18n` becomes the door plus app-owned catalogues.

**Done when:** the door re-exports; `pnpm i18n:check` green; the pseudo-locale route suite green; the gate green.

**Amended 2026-08-27 (D9.2).** The boundary this step had to find, and the two things that found it:

- **One question decided every file: does it read the app's catalogue?** The machinery does not — the factory, locale negotiation and its `localStorage` cache, the Intl formatters, the pseudo lens, the locale control's context — so it moved. The dictionary does: the ten namespaces, the `en` catalogues, the `CustomTypeOptions` augmentation, `englishTranslation` walking the bundled `en`, and `useKeyT` bound to the namespace list. Those stayed, which is ADR-0046 §13's rule rather than this step's judgement. **`TranslationKey` is named in the package and still resolves over the app's merge**, because i18next's declaration merging is global to a TypeScript program — so the package types the app's keys without owning one of its strings, and a typo is still a compile error at the call site.
- **`zod-locale.ts` went to the package and came back, and `pnpm i18n:check` is what sent it back.** Its `RULE_KEYS` name keys in the app's own `form` namespace, so it is app copy wearing machinery's clothes; moved, it took three keys out of the checker's `src/` scan and they reported as orphans. That is the check doing exactly its job, and the honest answer is that the installer belongs with the copy it names — it can move to `@repo/form` at `D9.5`, which will own a namespace of its own. What the factory needed from it became two seams, `onLocaleApplied` and `localeSideEffectsReady`.
- **Four things became parameters, and the fourth was a silent breakage.** `defaultNamespace` and the two zod seams were foreseeable. `loadCatalogue` was not: the lazy-import specifier was `./locales/${language}/${namespace}.json`, **relative to the module that writes it**, so the moment the factory moved it pointed at a package with no `locales/` — an `lv` that never loaded, with `check-types` and lint both silent. The plural suite caught it by asserting Latvian's three forms. The loader is the app's now, for the reason the catalogues are.
- **`register` leaked into the caller's catalogue object, and the fix is a copy at `init`.** `ResourceStore` holds what `init` was handed **by reference**, and `addResourceBundle` writes into that same object — so registering a package's namespace on one instance wrote it into `apps/admin`'s module-level `EN_RESOURCES`, and every instance built from it afterwards inherited the registration. That is exactly the cross-instance sharing ADR-0046 §13's factory rule exists to prevent: `D7.1` put the instance inside a provider so a suite gets one per render, and this would have handed the next render the previous one's packages. `createI18n` now copies each locale's catalogue at `init`. Found by the review pass and pinned by a test that goes red when the copy is removed — none of the three original `register` cases could see it, because each built its catalogue inline.
- **The door binds all four, so no call site moved.** `shared/i18n/create-app-i18n.ts` wraps the package's factory with this app's answers and the door re-exports it _as_ `createI18n`; the eleven places that build an instance — the composition root and ten suites — are untouched. That is what "the door carries app-specific config" means concretely, and it is why the extraction cost the app no churn. **The wrapper narrows as well as binds**: the package had to widen `resources` and `namespaces` to `string`-keyed shapes, and that parameter is the only thing enforcing that every name in `NAMESPACES` has an eager `en` catalogue — `EN_RESOURCES` is `as const` and never annotated — so left wide, `namespaces: ["bogus"]` would have type-checked at the composition root. Caught by the review pass; the wrapper's own `CreateAppI18nOptions` restores it, verified by probe.

### ~~3. `@repo/resource` — the vocabulary~~ — **done 2026-08-27**

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0035](../adr/0035-config-driven-resource-ui.md)

`ResourceConfig` and the registries move; `shared/resource` becomes the door. Small, and unblocks the two big moves that both depend on it.

**Done when:** the door re-exports; no package imports an app; the gate green.

**Amended 2026-08-27 (D9.3).** The easiest move in the deliverable, and the one thing worth recording about it:

- **The vocabulary had exactly one coupling and `D9.2` had already removed it.** `config.ts` and `types.ts` reach for `dynamicKey`, `TranslateKey` and `TranslationKey` and nothing else outside `@repo/contracts` — all three now in `@repo/i18n`, so the move is an import repoint and a door. That ordering was the plan's ("small, and unblocks the two big moves that both depend on it") and it held: `@repo/resource` depends on contracts and i18n, on no app, and needed no generalisation at all — the first package in D9 to move with **zero** parameters added.
- **Two suites, and they are not duplicates.** The app's `config.test.ts` stayed untouched: it drives these readers through the demo fixture and a real i18next instance built from the app's catalogues, which is an integration between this vocabulary and a _dictionary_, and a dictionary belongs to an app (ADR-0046 §13). The package's new suite asks what can be asked with nothing else mounted — declaration order, override merging, the `humanize` fallback — with inline fixtures, because a package borrowing the app's demo config would be a package importing from an app. Neither suite can answer the other's question.
- **The door blocks are now four and each is exempt from its own group only** — and the fourth arrived with a hole the review pass found: the new `shared/resource/**` block carried the api-client and ui groups but not i18n, so that one slice could have reached `@repo/i18n` directly, which is precisely what the block exists to prevent. Latent, because neither door file imports i18n; the next config helper needing `dynamicKey` would have taken it. Closed and verified by probe. The invariant is worth stating once more because it will keep growing: **N doors means each block re-declares the N−1 groups it is not the door for**, and a block that omits one is a hole rather than a permission.
- **Writing that suite fresh cost two signature mistakes, both caught by `check-types` before a single assertion ran.** `mergeColumns` returns _entries_ rather than an object and hides a column through `hidden: true` rather than a `false` override; `resolveOptions` takes the options first and the translator second. Worth noting because it is the argument for the app's file staying where it is: a re-written test is a new test, and this step had no mandate to write new claims about shipped behaviour.

### ~~4. `@repo/grid` — the largest move~~ — **done 2026-08-27**

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0035](../adr/0035-config-driven-resource-ui.md), the grid ADRs [0037](../adr/0037-grid-viewport-layout.md)–[0044](../adr/0044-record-routes-without-list-state.md) as carried

The grid moves whole, tests with it, router peer declared (`record-navigation.ts`); its strings ship as the package's namespace with `register`. `shared/grid` becomes the door.

**Done when:** the door re-exports; both grid screens' suites green unmoved in the app where they assert behaviour; the gate green.

**Amended 2026-08-27 (D9.4).** The largest move, and the one that cost real debugging. Four things it found:

- **Registering a namespace on a live instance loses state during an asynchronous gesture.** This is the finding, and it is now [ADR-0051](../adr/0051-platform-extraction.md)'s amended §Strings. `@repo/grid` ships the `grid` namespace, and the app first composed it with §13's `register(i18n)` — `addResourceBundle` after `init`. i18next emits on that, react-i18next re-renders every bound component, and during a `user-event` click (asynchronous, many ticks) the re-render lands **between the click and its assertion**: seven grid tests failed with a row selection that silently refused to stick. Nothing failed to type-check, no error was logged, and `fireEvent` — synchronous — passed where `user.click` did not, which is what finally named it. The app composes package bundles into `resources` at `init` now; `register` stays for a late-learned namespace. **Its corollary bit first**: `loadCatalogue` was still fetching `grid`, whose JSON had moved, so the dynamic import rejected and left the namespace half-loaded.
- **`useKeyT` had to stop being bound to an app's namespace list.** `D9.2` made it a factory the app bound to `NAMESPACES`; grid components in a package cannot name an app's namespaces. It reads `i18n.options.ns` off the mounted instance — the exact array `createI18n` passed to `init` — which is the same guarantee dynamically rather than lexically, and correct in every app without either naming the other.
- **The error panel is a slot, and the door binds it.** `AppGrid` rendered the admin's `QueryError`, which turns an unknown into a sentence through that app's notifications and `errors` catalogue. `renderError` is **required** — a grid that swallowed a refused list and showed an empty table is what ADR-0043 built the panel to prevent — and `apps/admin`'s door supplies it, so no call site in that app changed.
- **The suite got slower, and the ceilings moved with it.** Every worker now transforms the extracted packages' TypeScript source, and under the full `pnpm test` run the heaviest routing files crossed the fifteen-second test timeout while passing comfortably when the app's suite runs alone — the same load-not-cost diagnosis `D4.4` made. Thirty and twenty, with the gap between them preserved for the reason `setup.ts` gives.
- **The review pass caught a frozen-ADR regression the fix had introduced.** Composing at `init` was right for the source locale and wrong for the rest: `bundles = { en, lv }` made the package's Latvian a static import, folding it into the app's main chunk and undoing [ADR-0046](../adr/0046-interface-localization.md) §3's per-locale chunking — a frozen decision, broken silently, with the gate green. A package now exports its `en` **and its own loader**, and the app delegates a package namespace to it; `en` is complete at `init`, every other locale is a chunk, and the loader ships with the catalogues rather than being written by each app, which is `D9.2`'s lesson applied before it could bite twice.
- **And a test that had quietly stopped asserting anything.** The package harness mounts only the grid's namespace, but `optionLabel` resolves `common:options.<value>` with `humanize(value)` as its default — so `getByText("Active")` in the registry suite would have passed with no catalogue mounted at all. The harness now stubs `common` with **non-English** words, so the case can only get them from the catalogue. That `@repo/resource` names `common:` is the same borrowing this step removed from the grid, one layer down; it is D9's close-out to decide.
- **What did not move**: the grid tests that need the app's render harness, its MSW server or the demo fixture stayed in `apps/admin`, because each of those is the app's. The package's own suite is what can be asked of the grid with only its own copy mounted.

### ~~5. `@repo/form` — the machinery and both wrappers~~ — **done 2026-08-28**

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0035](../adr/0035-config-driven-resource-ui.md), [0047](../adr/0047-ui-package-scope.md), [0048](../adr/0048-app-shell-and-record-surfaces.md) §4

The form machinery moves, including the record surface's two behavioural wrappers (`react-hook-form` and router as peers); `@repo/ui` gains nothing (0047's boundary holds). `shared/form` becomes the door.

**Done when:** the door re-exports; the three-shell parity suite and the password-dialog suites green in the app; the gate green.

**Amended 2026-08-28 (D9.5).** The move itself was `D9.3`-shaped — nine files, one door file each, no call site above `shared/` touched. What it cost was elsewhere, and five things are worth keeping:

- **`zod-locale.ts` came back, and it came back through `shared/form`.** `D9.2` sent it home because its `RULE_KEYS` name keys in the `form` namespace and an installer belongs with the copy it names; that namespace is `@repo/form`'s since this step, so the two travel together and the door is `@/shared/form/zod-locale`. The `form` catalogue moved whole and gained one key from the admin's `common`: **`actions.cancel`**, the label on the button `AppFormActions` renders. Unlike the three the grid took at `D9.4`, the admin _keeps_ its own `actions.cancel` — `ConfirmDialog` renders one and no form does — so this is two owners of one English word rather than a key that migrated. ADR-0046 §13 is a rule about ownership, not about de-duplicating a dictionary, and a consuming app whose dialogs say "Cancel" differently from its forms is now free to.
- **Moving that suite is what kept it able to ask its question.** Its sharpest case is a _partly-translated_ locale falling back to the source sentence, and it posed that by handing `createI18n` an empty `lv.form`. Posing it from the app now means widening that app's `Catalogue` to hold a namespace it does not own — the thing that type exists to refuse — and without the widening `changeLocale("lv")` fetches the package's real Latvian through the lazy loader and the case passes for the wrong reason. In the package the harness supplies `lv` eagerly and empties it deliberately. The move also found something the app's wiring had been hiding: **a harness must bind the two locale seams itself.** `@repo/i18n`'s factory does not install zod's map — it is a parameter, `D9.2`'s decision — so the first draft built an instance whose `changeLocale` moved i18next and left zod behind, and two cases went red saying so. Bound, they are the same pair `create-app-i18n.ts` binds, which is the harness standing in for an app rather than for a stub.
- **`ErrorMessage` went to `@repo/api-client` — one line, and it retires a coupling rather than adding one.** `applyServerErrors` requires a caller that can turn an unknown into a sentence; _producing_ that sentence needs an app's `errors` catalogue and stayed in `shared/notifications`. The alternative was two structurally-identical aliases in two packages, so the type sits beside the error it is asked about instead. It was also the only thing keeping `shared/api/bulk-outcome.ts` pointed at `shared/notifications` — the file `D9.1` left behind for exactly this dependency — so that import was repointed at the api door in the same diff, and `D9.6` inherits one less knot than it was scoped with.
- **The one exemption from the door rule became a file rather than a slice, and the review pass is what made it one.** `D9.3` stated the invariant — N doors means each block re-declares the N−1 groups it is not the door for — and `D9.4` opened the single exception to it: `src/shared/i18n/**` may reach a package's catalogues, because `create-app-i18n.ts` composes them. Six doors in, that exemption covered five files and one suite directory that need no such reach, and this step would have widened it a second time. It is now `files: ["src/shared/i18n/create-app-i18n.ts"]`, the slice block is complete at five groups like every other, and `D9.6` adds its package to two lists rather than to a growing hole. **An exemption wider than its reason is the same shape of defect as a block missing a group**, which is worth saying once because the count only goes up from here.

- **The break this step caused was silent, and the thing that caught it was `@ts-expect-error`.** Deleting `locales/en/form.json` left an `import type form from "./locales/en/form.json"` inside the app's `CustomTypeOptions` augmentation. `check-types` reported no missing module; it reported **two unused `@ts-expect-error` directives**, in the staff and user config suites, which is `TranslationKey` having quietly collapsed and a deliberately misspelled key having stopped being a compile error. The instrument ADR-0046 §7 rests on had turned itself off, and the only reason the gate went red at all is that those two suites assert the instrument works. Worth stating as a property rather than as an incident: **a typed-key design needs at least one test that asserts a bad key fails**, or its failure mode is silence.

### 6. `@repo/app-services` — the tail, and `route-meta`'s home

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0042](../adr/0042-client-side-authorization.md), [0045](../adr/0045-user-settings.md), [0046](../adr/0046-interface-localization.md)

Theme, notifications, the `can()` mechanism and the lib helpers (including router-coupled `route-meta.ts`) find their one home each — placement is this step's call, recorded in the package's door comments. The policy _data_ stays per-app; the mechanism moves.

**Done when:** every `shared/` slice under `apps/admin/src` is a door or app-specific config; the gate green.

### 7. Close-out

**ADRs:** none of its own — the checklist below

The mechanical claim, cashed: workspace test total compared against D8's close, `pnpm test:postman` unchanged, the D8 browser walk repeated and finding nothing different, `pnpm test:unit` twice with the second run FULL TURBO, `pnpm format:check`, clean tree; ADR-0051's amendments labelled; the ledger row, §How D9 closed, and the window documents — one reading pass.

**Done when:** every §Definition-of-done item is checked or recorded as pending operator acceptance; the row reads `shipped`; the window on 0051 is shut.

## Definition of done

1. **No behaviour change, checked as totals**: the workspace test count matches D8's close, `pnpm test:postman` at unchanged numbers, and the D8 browser walk repeated with nothing different — the operator-acceptance item.
2. **Doors, not implementations**: every slice under `apps/admin/src/shared` re-exports from a package or holds app-specific config; each app's lint pattern forbids package paths outside the door.
3. **Boundaries hold**: no package imports an app; `@repo/contracts` still depends on zod alone; `apps/web` still builds.
4. **Green and cached**: `pnpm lint && pnpm check-types && pnpm test` green; `pnpm test:unit` twice, the second FULL TURBO; `pnpm format:check` clean; clean tree.
