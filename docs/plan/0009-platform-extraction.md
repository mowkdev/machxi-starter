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

### 2. `@repo/i18n` — the factory, and §13's first register

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0046](../adr/0046-interface-localization.md) §13

`createI18n` and its helpers move; the package ships the `register(i18n)` mechanism ADR-0046 §13 designed, which the later packages' namespaces will use; the admin's catalogues stay in the app. `shared/i18n` becomes the door plus app-owned catalogues.

**Done when:** the door re-exports; `pnpm i18n:check` green; the pseudo-locale route suite green; the gate green.

### 3. `@repo/resource` — the vocabulary

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0035](../adr/0035-config-driven-resource-ui.md)

`ResourceConfig` and the registries move; `shared/resource` becomes the door. Small, and unblocks the two big moves that both depend on it.

**Done when:** the door re-exports; no package imports an app; the gate green.

### 4. `@repo/grid` — the largest move

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0035](../adr/0035-config-driven-resource-ui.md), the grid ADRs [0037](../adr/0037-grid-viewport-layout.md)–[0044](../adr/0044-record-routes-without-list-state.md) as carried

The grid moves whole, tests with it, router peer declared (`record-navigation.ts`); its strings ship as the package's namespace with `register`. `shared/grid` becomes the door.

**Done when:** the door re-exports; both grid screens' suites green unmoved in the app where they assert behaviour; the gate green.

### 5. `@repo/form` — the machinery and both wrappers

**ADRs:** [0051](../adr/0051-platform-extraction.md), [0035](../adr/0035-config-driven-resource-ui.md), [0047](../adr/0047-ui-package-scope.md), [0048](../adr/0048-app-shell-and-record-surfaces.md) §4

The form machinery moves, including the record surface's two behavioural wrappers (`react-hook-form` and router as peers); `@repo/ui` gains nothing (0047's boundary holds). `shared/form` becomes the door.

**Done when:** the door re-exports; the three-shell parity suite and the password-dialog suites green in the app; the gate green.

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
