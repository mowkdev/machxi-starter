# D9 — Platform extraction

- Status: **planned** — opens when [D8](0008-app-shell-and-record-surfaces.md) ships
- Steps: written when the deliverable opens; this file carries scope, order rationale and the decisions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the app-agnostic **behavioural** machinery leaves `apps/admin/src/shared` for workspace packages, and `apps/admin` becomes its first consumer through thin doors. D8 generalised the presentation; this moves the rest. Nothing is redesigned here — a step that finds itself wanting to change behaviour has found D8's work unfinished or D10's work early, and says so rather than doing it.

**The deliverable is mechanical by construction, and that is the point.** Every claim it makes is checkable: `apps/admin` green with the same test totals, the same Postman numbers, the same browser walk. That makes it the first deliverable in this ledger genuinely suited to an unattended run.

## What moves, and the shape of the question

Roughly in dependency order, with today's sizes (excluding tests) as the honest measure of what each is:

| Slice           | LOC   | Notes                                                                                                                                  |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `grid`          | 4,775 | The largest by far; `record-navigation.ts` is its one router dependency                                                                |
| `form`          | 1,378 | Minus the surfaces D8 moved to `@repo/ui`                                                                                              |
| `api`           | 1,238 | The client, session, CSRF bootstrap — **the one real generalisation this extraction demands**: parameterised by population and segment |
| `i18n`          | 1,070 | D7 built it as a factory (`createI18n`) for exactly this day                                                                           |
| `resource`      | 614   | `ResourceConfig` and the registries                                                                                                    |
| `auth`          | 340   | `can()` and the policy table — per-app data, shared mechanism                                                                          |
| `theme`         | 251   |                                                                                                                                        |
| `notifications` | 210   |                                                                                                                                        |
| `lib`           | 58    | `route-meta.ts` is router-coupled                                                                                                      |

Four files under `shared/` import `@tanstack/react-router`: `api/search-params.ts`, `grid/record-navigation.ts`, `lib/route-meta.ts`, and the form surface D8 relocates. **Whether the router is a peer dependency of the extracted packages or an injected seam is the extraction ADR's sharpest question** — both apps use TanStack Router, so a peer dependency is honest and cheap; an injected seam is purer and costs a boundary at every one of those four call sites.

Package granularity is the ADR's decision. House precedent (`contracts`, `crypto`, `logger`, `ui`) favours focused packages over one `@repo/app-platform`, and the dependency order above is a plausible package order.

## Rules the extraction inherits

- **Each app keeps its FSD `shared/` layer as thin doors** re-exporting from the packages — ADR-0031's one-door pattern generalised, so a page still imports from `@/shared/grid` and never from a package path.
- **`pages`, `features` and `entities` stay strictly per-app.** Nothing that names a resource may move.
- **Strings inside extracted machinery follow D7's package boundary** ([ADR-0046](../adr/0046-interface-localization.md)): a shared package ships its own namespace JSON and a `register(i18n)`, and each app composes its own bundle. This is why extraction runs after localization — the components move already dictionary-fed rather than needing a second sweep.
- **The `@repo/contracts` rule is not relaxed** ([ADR-0023](../adr/0023-shared-contracts-package.md)): zod and nothing else. A package that needs a contract imports it; contracts imports nobody.

## Decisions this deliverable needs

- **The extraction ADR** — the package set, the parameterised session machinery, the router question above, the per-app door rule, and its relationship to frozen [ADR-0032](../adr/0032-admin-app-architecture.md) and [ADR-0033](../adr/0033-browser-api-client-and-session.md), both of which describe this machinery as living _in_ `apps/admin`. The ADR must carry that move explicitly. Whether it supersedes those two or lands additively beside them is a writing-time discovery, and the honest answer may well be supersession.
- **A superseding ADR for [ADR-0022](../adr/0022-frontend-apps.md)** — the app roster, stacks and dev ports. `apps/web` is re-scoped from "public/user-facing" to marketing-only and moves last; `apps/customer` is named. 0022 gave 3002 to `web`; the roster ADR reassigns. This can be written here or deferred to [D11](0011-customer-app.md) — it is only strictly needed the day an app actually changes, and this deliverable adds no app.

## Acceptance sketch

`apps/admin` fully green on the extracted packages with **no behaviour change** — the same test totals per package, `pnpm test:postman` at its unchanged numbers, and a browser walk that finds nothing different; every `shared/` door re-exports rather than implements; no package imports another app; `@repo/contracts` still depends on zod alone; both `apps/admin` and `apps/web` build; and the gate is green across the workspace with `pnpm test:unit` FULL TURBO on the second run.
