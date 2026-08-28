# ADR-0051: Platform extraction — six packages, the router as a peer, a door in every app

- Status: accepted
- Date: 2026-08-27
- Supersedes: [ADR-0033](0033-browser-api-client-and-session.md) (delta: where the machinery lives); [ADR-0049](0049-admin-app-architecture.md) (delta: what the `shared/` slices are)

> Written 2026-08-27 ahead of D9 opening ([`docs/plan/0009-platform-extraction.md`](../plan/0009-platform-extraction.md)) — writing is not opening. Accepted at the head of `D9.1`, where both parents move to `superseded by ADR-0051`; amendable in place while D9 is `in progress` (ADR-0025 rule 2). The first supersession written under [ADR-0050](0050-adr-lifecycle-and-verification.md)'s delta rule: **each parent's delta is stated below, and everything else in both parents stands as written and is in force as part of this record.**

## Context

D8 moved the two compositions' geometry into `@repo/ui`; the behavioural machinery every screen runs on still lives in `apps/admin/src/shared` — the API client and session, the grid, the form wiring, the i18n factory, the resource vocabulary. The customer app ([D11](../plan/0011-customer-app.md)) is its named second consumer, and the ledger's ordering argument is to pay the extraction once, before that app exists, rather than re-extract a moving target after it.

Two accepted records place this machinery inside `apps/admin`: [ADR-0033](0033-browser-api-client-and-session.md) throughout, and [ADR-0049](0049-admin-app-architecture.md)'s directory tree, whose `shared/` annotations describe implementations. Moving the code diverges from both, so this record supersedes both — as deltas.

## Decision

### Six focused packages, in dependency order

The app-agnostic machinery under `apps/admin/src/shared` moves to workspace packages, each with one identity, following the house precedent of `contracts`, `crypto`, `logger` and `ui`:

- **`@repo/api-client`** — the axios client, envelope and error handling, session store, CSRF bootstrap, and the URL⇄query serialization. **Parameterised by segment and population** — the one real generalisation this extraction performs: one mechanism, configured per app (`admin` today, `user` at D11). Behaviour is unchanged: the envelope, the error map, the cookie session and the CSRF flow are ADR-0033's, carried whole. *Amended 2026-08-28 (D9.5):* and `ErrorMessage`, the shape of "turn this failure into a sentence" — the type only, because producing the sentence needs an app's `errors` catalogue (ADR-0046 §2) and stays in the app. It sits beside the error it is asked about so that the packages that require one of these — `@repo/form` today, `@repo/app-services` at `D9.6` — share a definition rather than each writing an identical alias.
- **`@repo/i18n`** — the `createI18n` factory and its helpers, built at D7 for exactly this move.
- **`@repo/resource`** — the `ResourceConfig` vocabulary and its registries.
- **`@repo/grid`** — the data grid.
- **`@repo/form`** — the form machinery, including the record surface's two behavioural wrappers (`useFormContext` footer, `useBlocker` page wrapper) that [ADR-0047](0047-ui-package-scope.md) kept out of `@repo/ui`.
- **`@repo/app-services`** — the small remainder: theme, notifications, the `can()` mechanism, generic lib helpers. Exact placement of each is the extracting step's call; each slice gets exactly one home. *Amended 2026-08-28 (D9.6):* the call was made, and three of the named pieces went elsewhere — the bulk fan-out to `@repo/api-client`, the bulk summariser to `@repo/grid` (its keys are that namespace's), the `errors` catalogue's readers nowhere at all, because a dictionary is an app's. What is here is the theme, `can()` with its two hooks, and `route-meta`. It is also the one package with **more than one door per app**: its three pieces landed in `shared/theme`, `shared/auth` and `shared/lib`, which is where they already were, and inventing a slice named after the package to unify them would have been churn for symmetry's sake.

Nothing is redesigned. A step that finds itself wanting to change behaviour has found D8's work unfinished or D10's work early, and stops to say so.

### The router is a peer dependency, not a seam

Packages whose code calls `@tanstack/react-router` declare it as a **peer dependency**. Every planned SPA uses TanStack Router by decision (ADR-0049, and D11 inherits the choice), so a peer is honest and cheap; the call sites move as they are. An injection seam would buy portability to a router no planned app uses, at the price of a hand-built boundary at every routing call site and its tests. A future non-TanStack consumer writes that seam then, as its own decision. `react-hook-form` is likewise a peer of `@repo/form` — it is the machinery's engine ([ADR-0035](0035-config-driven-resource-ui.md)) — and neither enters `@repo/ui` (ADR-0047, unchanged).

### A door in every app

Each app keeps its FSD `shared/` slices as **named re-export doors** over the packages — ADR-0047's one-door pattern generalised: a page still imports `@/shared/grid`, never a package path, and each app's `no-restricted-imports` group enforces it. `pages`, `features` and `entities` stay strictly per-app; nothing that names a resource moves.

**Amended 2026-08-28 (D9.6).** Two things the last extraction step made explicit about what a door is:

- **A door is "the only path to those symbols", not "one slice per package".** `@repo/app-services` has three doors in `apps/admin` — `shared/theme`, `shared/auth`, `shared/lib/route-meta` — because that is where its three pieces already lived, and they share one lint block declaring the other six groups. The invariant the blocks keep is unchanged: **N doors means each block re-declares the N−1 groups it is not the door for**, and an exemption wider than its reason is the same defect as a block missing a group (which is why `D9.5` narrowed the i18n exemption from a slice to one file).
- **A package that reads a property must own the property; a package that names a type need not.** `@repo/i18n` names `TranslationKey` and lets each app's declaration merge supply the union. `@repo/app-services` reads `match.staticData.title`, so `StaticDataRouteOption` moved with it — left behind, the package type-checks against the empty upstream interface. The same line separates `@repo/form`'s `form` namespace (its own copy, so its own declaration) from `apps/admin`'s `query-meta.ts` (this app's `meta` contract over this app's keys, so it stayed).

### Strings travel with the machinery

Extracted machinery's strings follow [ADR-0046](0046-interface-localization.md) §13 — the package ships its own namespace JSON, and each app composes its bundle. This is §13's first real use, and the reason extraction runs after localization. `@repo/ui` stays on §12's `UiStrings` (ADR-0047, unchanged).

**Amended 2026-08-27 (D9.4).** This bullet said the package exports `register(i18n)` and stopped there, which is §13's wording and is the wrong default. **A package exports its `bundles`, and an app that knows its packages composes them into `createI18n`'s `resources` at `init`**; `register` remains for a consumer that genuinely learns of a namespace later. The reason is timing rather than taste: `addResourceBundle` on a live instance makes i18next emit and react-i18next re-render every bound component, and during an asynchronous gesture that re-render lands between a click and its assertion — the grid's own suite found it as a row selection that silently failed to stick, with nothing failing to type-check and no error anywhere. Composing at `init` means the instance is complete the moment it exists, which is what §13's "each app composes its own bundle" should have meant all along. **Its corollary**: an app must not let its lazy-catalogue loader fetch a namespace a package owns — the app has no file for it, the dynamic import rejects, and the namespace is left half-loaded.

**Amended 2026-08-28 (D9.5).** Two things the second §13 package settled, both about what "the package's own namespace" allows:

- **A package's namespace may hold a word an app also has.** `@repo/form` ships `form:actions.cancel` for the button `AppFormActions` renders, while `apps/admin` keeps `common:actions.cancel` for the confirm dialog it renders — the same English word, two owners. `D9.4` moved three keys *out* of the admin's `common` because nothing but the grid read them, and that was bookkeeping rather than the rule. The rule is ownership: a package declares the strings it renders and never reads an app's dictionary, and the consequence is that a consumer whose dialogs and forms want different words for the same gesture already can have them.
- **The installer travels with the copy it names.** `zod-locale.ts` — the map that answers `@repo/contracts`' keyed refinements in the operator's language — is `@repo/form`'s, because its `RULE_KEYS` name keys in the `form` namespace. `D9.2` had sent it back to the app for exactly that reason and named this step as its home; it arrives here as a general rule rather than as one file's fate. Its two seams on `createI18n` (`onLocaleApplied`, `localeSideEffectsReady`) stay parameters: a consumer with no zod schemas should not pay for one.

### The deltas, per parent

- **ADR-0033**: everything it decides — the client's shape, envelope and error handling, the session model, CSRF, the interceptors — **stands and is in force**; what changes is the code's home (`@repo/api-client`, parameterised by segment) and its consumer count.
- **ADR-0049**: every layer rule, routing rule and enforcement decision **stands as written**; what changes is the meaning of the tree's `shared/` annotations — those slices become doors re-exporting from the packages named above, rather than implementations.

## Consequences

- The customer app starts from packages, not from a copy of `apps/admin/src/shared`; the drift argument that built `@repo/ui` now covers behaviour.
- Upgrade coupling widens again, knowingly: a grid change is a change to every consumer at once.
- Tests move with their code, so per-project totals shift while the workspace total does not — the close-out compares workspace-wide, plus unchanged Postman numbers and an unchanged browser walk, which is what "mechanical" means here as a check. **Amended 2026-08-28 (D9.6):** with one carve-out, which is a *new claim* rather than a moved one. Extracting a mechanism from the data it used to be fused to can make something separately assertable that was not before — `can()`'s rule underneath the policy table is the case that arose, and its nine tests are net-new. So the close-out compares the workspace total against **D8's close plus the net-new count each step declared**, and each step declares it. A step that moves tests still moves them at zero net, which is the property this bullet was written to protect; what it may not do is quietly *lose* one.
- Six packages cost six sets of plumbing (`package.json`, tsconfig, vitest, exports, register, door); the `config-*` packages exist to make that cheap.
- The ADR-0022 roster supersession (web→marketing, `apps/customer` named, ports) is **deferred to D11**, the deliverable that changes a roster fact.

## Alternatives considered

- **Router behind an injected seam.** Purer, portable, and paid for at every routing call site for a consumer no plan names. Rejected; revisit only with a real non-TanStack app.
- **One `@repo/platform` package.** Cheapest plumbing; no workspace-enforced boundaries between slices, and against house precedent. Rejected.
- **Three grouped packages.** Half the plumbing, but the grid+form+resource group would hold three identities in one version, and splitting later is a second migration. Rejected.
- **Defer extraction until D11 needs it.** The original argument ("the second app is the forcing function") — answered by the ledger's re-scoping: a serialization changed after extraction is changed in packages once, not in two apps and a package. Rejected there; stands rejected here.
