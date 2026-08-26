# ADR-0049: Admin app architecture — Feature-Sliced Design and TanStack Router

- Status: proposed
- Date: 2026-08-26
- Supersedes: [ADR-0032](0032-admin-app-architecture.md)

> Written 2026-08-26 **ahead of** D8 (app shell and record surfaces, [`docs/plan/0008-app-shell-and-record-surfaces.md`](../plan/0008-app-shell-and-record-surfaces.md)) — writing is not opening, the D4 precedent its siblings [ADR-0047](0047-ui-package-scope.md) and [ADR-0048](0048-app-shell-and-record-surfaces.md) already carry for this deliverable. D8's plan now has its steps (`D8.1`–`D8.11`) but the deliverable has not opened, and per the ledger opening is a decision, not a formality. This record stays `proposed` until it is accepted **at the head of `D8.4`** — the step that makes `widgets/dashboard-layout` a thin adapter over the shell, which is the first step that stands on what this record changes; the account menu's own move follows at `D8.5`, and both steps are governed by it ([ADR-0025](0025-deliverables.md) rule 3, the per-step acceptance D4–D7 ran on); [ADR-0032](0032-admin-app-architecture.md) stays `accepted` and in force until that acceptance and moves to `superseded by ADR-0049` in the same motion — the D5 mechanics, the same its sibling 0047 applies to [0031](0031-ui-design-system.md) at `D8.1`. Once accepted, it is amendable in place while D8 is `in progress` in [`docs/plan/README.md`](../plan/README.md) (ADR-0025 rule 2).
>
> **This record carries the whole of ADR-0032, not the delta** (ADR-0024 rule 1). Everything that ADR decided — the FSD layers with the downward-only rule, the boundaries enforcement with its D3.3 corrections, the directory tree with the D3.5/D3.6/D3.9 amendments folded in, file-based TanStack Router with the generated tree excluded from lint and (per D3.3) from formatting, the `_auth`/`_dashboard` topology, the router context, the structural guards, the thin-route-file rule, minimal client state, the stack pins and the `apps/web` carve-out — is restated here unchanged. **Three decision changes and one new subsection**: two tree annotations; the `widgets`→`widgets` public-API carve-out, which ADR-0032 §FSD and §Enforcement decided the other way and which the shipped config has contradicted since D3.3, now stated as the decision it is; and §The-shell-adapter, which is new: `widgets/dashboard-layout` becomes a thin adapter over `@repo/ui`'s `AppShell` composition, and the account menu — the current-principal block, logout, theme and locale — leaves `widgets/app-sidebar`'s footer for the shell's `headerEnd` slot. The tree below is the one D3 built with its amendments folded in and those two changes applied; the slices D6 and D7 added are placed by the layer map rather than re-inventoried.

## Context

[ADR-0032](0032-admin-app-architecture.md) is the dedicated ADR for `apps/admin`'s structure and routing, and its decisions have held through five deliverables: the FSD layers and their lint-enforced direction, file-based TanStack Router, the pathless-layout guards. Nothing below changes any of that. What forces a successor is one line of its directory tree: `widgets/app-sidebar` is annotated `# navigation, current-principal block, logout`, and D8 moves the block that annotation places.

[ADR-0048](0048-app-shell-and-record-surfaces.md) §2 decides that **the whole `AccountMenu` dropdown moves to the shell's `headerEnd` slot** — the slot's proving consumer — and that `widgets/dashboard-layout` thins into an adapter over the `AppShell` composition [ADR-0047](0047-ui-package-scope.md) admits into `@repo/ui`. That is a divergence from a frozen record: D3 shipped 2026-08-20, so ADR-0032 changes only by supersession ([ADR-0024](0024-adr-lifecycle.md) rule 1, [ADR-0025](0025-deliverables.md) rule 2), and the successor carries the whole decision, never the delta. This is that successor — the same mechanism ADR-0047 uses for frozen [ADR-0031](0031-ui-design-system.md), applied to the frozen record on the other side of the same move.

It also resolves a tear the refutation of D8's records found inside ADR-0048 **as first written**: that draft's §Context corrected the plan's framing by pointing out the stranded chrome was placed deliberately — "[ADR-0032](0032-admin-app-architecture.md) assigns 'navigation, current-principal block, logout' to `widgets/app-sidebar`" — while its §Decision 2 and §Consequences claimed the adapter design "keeps ADR-0032 unamended". Both could not hold: if the tree's annotation is part of the decision, moving the block diverges from it; if it is not, the correction in §Context has no force. This record takes the first reading — the annotation placed the block on purpose, and changing where it lives is a decision to record, not an illustration to shrug off — and supersedes accordingly. ADR-0048 was revised on 2026-08-26 in the same motion and now points here; the word "unamended" appears nowhere in it.

Two things are put on the record honestly rather than smoothed over:

- **The move reverses a placement D6.3 and D7.5 made deliberately.** Theme and locale went into the account menu because "a preference about the operator [belongs] in the menu named after them" — the code says so in as many words. That reasoning **survives**: the menu moves intact, `ThemeMenuItems` and `LocaleMenuItems` keep their `DropdownMenuRadioGroup` shape and its screen-reader semantics, and the preferences stay in the menu named after the operator. What changes is where the menu named after the operator hangs — the sidebar footer today, the header's end after `D8.5`.
- **[ADR-0045](0045-user-settings.md)'s D6.3 placement sentence survives, and no third supersession is owed.** It records that the theme control landed in the account menu; the menu still exists, still belongs to `widgets/app-sidebar`, and still holds the preferences — only where it hangs changes. A record that placed a control *in the sidebar footer* would be diverged from; one that placed it *in the account menu* is not.
- **Header chrome placement is precisely what the customer app does differently** — and today that is D8's own scope talking, not D11's file. [D11](../plan/0011-customer-app.md) states its needs generically ("whichever shell slots this app fills differently from the admin panel"), so under ADR-0048's slot-honesty rule the header-chrome requirement is **written into `docs/plan/0011-customer-app.md` by `D8.5`, the step that cites it** — a citation may not point at a sentence that does not exist. A shell whose header can hold the account menu, proved by the admin panel actually mounting it there, is what makes `headerEnd` exercised rather than offered.

## Decision

### Feature-Sliced Design, importing strictly downward

`apps/admin` uses [Feature-Sliced Design](https://feature-sliced.design) with the standard layers. The dependency rule is the whole point and is stated first:

```
app  →  pages  →  widgets  →  features  →  entities  →  shared
```

- A layer may import only from layers **below** it. Never upward, never sideways — except a widget consuming a sibling widget's *public API*, which the config has permitted since D3.3 and §Enforcement states in full.
- Within a layer, code is grouped into **slices** (a slice ≈ a domain concept or a user interaction). Slices in the same layer do not import each other — except the `widgets` carve-out §Enforcement states.
- A slice is consumed only through its **public API** — an `index.ts` at the slice root. Deep imports into a slice's internals are forbidden; what a slice does not export does not exist to the rest of the app.

The layers mean, in this codebase:

| Layer        | Holds                                                                       | May import        |
| ------------ | --------------------------------------------------------------------------- | ----------------- |
| **app**      | providers, the router, global styles, generated route tree — wiring only    | everything below  |
| **pages**    | one slice per screen; thin composition of widgets and features              | widgets and below |
| **widgets**  | large self-contained UI blocks reused across pages (shells, sidebar)        | features and below|
| **features** | user interactions that change something (a form, a dialog, a mutation)      | entities, shared  |
| **entities** | domain resources: query hooks, query-key factories, per-resource UI config  | shared            |
| **shared**   | the API client, `@repo/ui` re-exports, validated env, generic lib code      | nothing above it  |

### The shape

The D3 tree with its amendments folded in and the two D8 changes applied — the annotations on `dashboard-layout` and `app-sidebar` are what this record changes against its parent. The slices D6 and D7 added are placed by the layer map above rather than re-listed here:

```
apps/admin/src/
├── app/
│   ├── providers/               # QueryClientProvider, RouterProvider, theme, i18n, Toaster
│   ├── routes/                  # file-based route definitions (wiring — see §Reconciliation)
│   ├── routeTree.gen.ts         # generated by the router plugin; never hand-edited
│   ├── index.tsx                # createApp composition, mounted by main.tsx
│   └── styles.css
├── pages/
│   ├── login/                   # composes widgets/auth-layout + features/auth/login
│   ├── staff/                   # composes widgets/dashboard-layout + the staff grid
│   ├── users/
│   └── profile/
├── widgets/
│   ├── dashboard-layout/        # thin adapter over @repo/ui's AppShell (ADR-0047/0048): fills the
│   │                            #   slots, mounts the account menu in headerEnd; still the _dashboard shell
│   ├── auth-layout/             # the login-01 shell: centered card, unauthenticated chrome
│   └── app-sidebar/             # navigation; exports AccountMenu for the shell's headerEnd mount
├── features/
│   ├── auth/login/              # the login form and its mutation
│   ├── staff-manage/            # create/edit/disable/reset-password dialogs + mutations
│   ├── users-manage/
│   └── profile-manage/          # name form, change-password dialog (the D3.9 name — it owns more than an edit)
├── entities/
│   ├── staff/                   # TanStack Query hooks, query-key factory, staff resource UI config (ADR-0035)
│   ├── user/
│   └── profile/                 # the caller's own account — a singleton (D3.9): no list, no :id,
│                                #   no ResourceConfig; still a domain resource, placed by the layer map
└── shared/
    ├── api/                     # the API client (ADR-0033): axios instance, envelope/error handling, session store
    ├── resource/                # the ResourceConfig vocabulary + its helpers (ADR-0035; placed by D3.6)
    ├── grid/                    # AppGrid + the grid registry (ADR-0035) — resource-agnostic, no domain knowledge
    ├── form/                    # AppFormProvider, AppFormInput + the field registry (ADR-0035)
    ├── notifications/           # the ErrorCode → message map (ADR-0043; placed by D3.5)
    ├── ui/                      # re-exports of @repo/ui — the one door components come through
    ├── config/                  # import.meta.env parsed by a zod schema, the ADR-0004 posture applied to Vite
    └── lib/                     # generic helpers with no domain knowledge
```

The tree grew slices after ADR-0032 was written — `shared/{auth,theme,i18n}`, `entities/settings`, `features/{theme,locale}` and their kin, each placed by the ADR that added it ([0042](0042-client-side-authorization.md), [0045](0045-user-settings.md), [0046](0046-interface-localization.md)) — and this record does not re-inventory them: the layer map above is what places them, and those ADRs stand.

The split between `features` and `entities` follows the cache seam ADR-0032's D3.5 amendment settled: the line is **the cache surface, not reads versus writes**. An entity owns its queries, its key factory *and* the mutation hooks that invalidate them, because "invalidate `lists()` and the touched `detail(id)`" is a rule about keys and belongs where the keys are; a mutation hook living in a feature would import a key factory across a slice boundary and the rule would have as many homes as callers. Features own the *interactions* that call those hooks — the form, the dialog, the confirm, the decision of what to do afterwards. A feature composes entity hooks; an entity never knows a feature exists.

Everything here is functional per the house style: slices export plain functions, hooks and `as const` config objects — no classes, no decorators.

### The shell adapter and the account menu — the changed section

This is the section that supersedes ADR-0032's placement of the shell and the account block. Its licence is [ADR-0047](0047-ui-package-scope.md) (compositions may live in `@repo/ui`) and its design is [ADR-0048](0048-app-shell-and-record-surfaces.md) §2; what belongs *here* is what the admin app's own architecture says about it.

- **`widgets/dashboard-layout` survives as a thin adapter over `@repo/ui`'s `AppShell` composition.** It stays in the `widgets` layer and stays the `_dashboard` layout's widget — the layer owns the composition's *contents* (the typed route links and the `can()` join per [ADR-0042](0042-client-side-authorization.md), the resolved `staticData.title`, the account menu), the package owns its *geometry*. A widget that renders layout markup of its own beside the shell is the adapter failing at its one job; the height contract ([ADR-0037](0037-grid-viewport-layout.md)) and the `data-slot="page-container"`/`data-full-height` attribute pair are the composition's responsibility now, per ADR-0048, and the adapter's job is to not get between them and the page.
- **`widgets/app-sidebar` holds navigation** — the typed nav links with their explicit `can()` join, the brand block, the collapsible drawer behaviour the primitives provide, and the whole `<Sidebar>` element: it is handed to the adapter as **one node**, not decomposed into region fragments, which is the shape [ADR-0048](0048-app-shell-and-record-surfaces.md) §2 settles on for the same reason. The current-principal block and logout leave its footer at `D8.5`, and **`SidebarFooter` then holds nothing and is removed** — it held `AccountMenu` and only `AccountMenu`. An empty region kept "for symmetry" is the unexercised-surface defect this deliverable is otherwise policing.
- **`AccountMenu` becomes an exported component of `widgets/app-sidebar`** — today it is a non-exported `const` inside `apps/admin/src/widgets/app-sidebar/index.tsx`, invisible past the slice's public API — **and is mounted by `widgets/dashboard-layout` into the shell's `headerEnd` slot.** The config would in fact permit `dashboard-layout` to import it directly through the slice's public API (§Enforcement's carve-out), so the hand-off is chosen on a layering ground rather than a lint one — the adapter's job is to be a frame, and a frame that reaches for the account menu is a frame that knows a principal exists. The export therefore travels the way `sidebar` already does: the `_dashboard` route file — `app`-layer wiring, the one place that may see both slices — composes `<AccountMenu />` and hands it down, and the adapter places what it is handed into `headerEnd`. The menu stays in `app-sidebar`'s slice because it is made of the same session facts the sidebar's author owns and changes for the same reasons; only its mount point is the adapter's.
- **The header mount re-chooses the trigger and the popover placement, and nothing else.** The mechanics are what the code demands, not taste: the current trigger is a `SidebarMenuButton size="lg"` with a `tooltip`, whose collapsed-state rules never match outside a `Sidebar` ancestor — in a header it would be a dead prop on a wrongly-styled button; and the current `DropdownMenuContent` is `align="end" side="right" className="w-56"` — sidebar-footer geometry, flying the popover out rightward from the rail. So the header mount uses a plain ghost `Button` as the `DropdownMenuTrigger` and places the popover `side="bottom" align="end"`. **The trigger carries `aria-label={t("account.menu")}` across with it and keeps rendering the operator's display name and email as its text content** — the `tooltip` prop and the two `SidebarMenu*` wrappers go; `size` and the popover width are re-chosen against the header. That is not decoration: **six shipped assertions and one docblock** turn on it. Four reach the menu by that accessible name or read its text (`pages/profile/__tests__/profile-page.test.tsx:102,126,138` and `features/auth/__tests__/logout.test.tsx:38`), and a ghost `Button` that merely looks right would break all four. The other two break for the opposite reason: `SidebarInset` **is** the `<main>` landmark and today’s header sits inside it, so moving the menu there puts the operator’s email inside `main` — where `profile-page.test.tsx:73` and `:96` already query it through a `page()` helper scoped to `main` (:60). `PROFILE.email` and `PRINCIPAL.email` are the same string, so both become two-element matches and throw. They are re-scoped to the profile’s own account card rather than to `main`, and the docblock at :52-58 that explains the old arrangement (“once in the sidebar footer … `main` is the `SidebarInset`”) is rewritten with them. `ThemeMenuItems` and `LocaleMenuItems` — the D6.3/D7.5 `DropdownMenuRadioGroup` fragments — are unchanged, and so are `LogoutMenuItem`, the principal label with its `aria-label` rule, and the profile link: the menu's contents move intact.

The D6.3/D7.5 reasoning is thereby kept, on the record: the preferences stay in the menu named after the operator; the menu hangs from the header instead of the sidebar footer, because header chrome is the thing the second app ([D11](../plan/0011-customer-app.md)) places differently and `headerEnd` must have an exerciser (ADR-0048's slot-honesty rule).

### Enforcement is part of the decision

FSD without an import linter decays into folders with aspirational names — the dependency rule only exists if something fails when it is broken, which is the lesson [ADR-0009](0009-api-modular-layering.md) encoded and the API enforces by structure. Here structure cannot enforce it (any ES import resolves), so lint does:

- `eslint-plugin-boundaries` in `apps/admin`'s flat config (extending `@repo/eslint-config`). `boundaries/elements` names the six layers by folder pattern; the layer table above is encoded as rules; entry-point rules pin consumption to each slice's `index.ts`.

  Three facts ADR-0032's D3.3 amendment found are folded in as part of the decision rather than repeated as history:

  - **The rule is `boundaries/dependencies`** — the plugin's v7 spelling, which folded the deprecated `entry-point` and `no-private` rules in; the entry-point half is a `file` selector inside the `to` clause. The snippet below is the statement of intent; the config is the v7 one.
  - **The rule enforces nothing without a resolver.** `boundaries` classifies the *target* of every import, and an unresolvable import passes silently — an upward `shared` → `widgets` import linted clean until `eslint-import-resolver-typescript` was configured. The resolver is part of the decision, and the enforcement claim is only worth making against deliberate violations: upward, cross-slice, and past-the-public-API probes, all three verified failing.
  - **Unclassified files need their own rule.** A file matching no element would be importable from everywhere and checked by nothing; `boundaries/no-unknown-files` and `no-unknown-dependencies` close it, with the entry point (`main.tsx`) and colocated tests as the only exemptions.
- An upward import, a cross-slice import **outside the `widgets` carve-out**, or a deep import past a public API **fails `pnpm lint`**, which fails the gate. The rule is taught by the error message, not by the onboarding doc.
- **The cross-slice ban has one carve-out, shipped since D3.3 and carried here as part of the decision**: the `widgets` policy is `allow: [publicApiOf(["features","entities"]), anyFileOf("shared"), publicApiOf("widgets")]` — **a widget may consume a sibling widget's public API, and only a widget's** — because "the shell/sidebar split" is exactly that shape and the D3 tree drew it. Every other layer's cross-slice imports remain disallowed. This is stated rather than elided because the alternative below is rejected on a different ground once it is true.

```js
// eslint.config.js — the layer graph as intent, in the v5 shape ADR-0032 published it in.
// The shipped config is the v7 one: the rule is `boundaries/dependencies`, its body is a
// `policies` array, and the entry-point half is a `file` selector inside each `to` clause.
settings: {
  "boundaries/elements": [
    { type: "app",      pattern: "src/app/**" },
    { type: "pages",    pattern: "src/pages/*",    capture: ["slice"] },
    { type: "widgets",  pattern: "src/widgets/*",  capture: ["slice"] },
    { type: "features", pattern: "src/features/*", capture: ["slice"] },
    { type: "entities", pattern: "src/entities/*", capture: ["slice"] },
    { type: "shared",   pattern: "src/shared/*" },
  ],
},
rules: {
  "boundaries/element-types": ["error", { default: "disallow", rules: [
    { from: "app",      allow: ["pages", "widgets", "features", "entities", "shared"] },
    { from: "pages",    allow: ["widgets", "features", "entities", "shared"] },
    { from: "widgets",  allow: ["features", "entities", "shared"] },
    { from: "features", allow: ["entities", "shared"] },
    { from: "entities", allow: ["shared"] },
    { from: "shared",   allow: ["shared"] },
  ]}],
}
```

The FSD ecosystem's own linter, `steiger`, stays rejected for a toolchain reason, not a quality one: this repository has one lint gate (`pnpm lint`, ESLint everywhere, [ADR-0002](0002-monorepo-layout-and-tooling.md)), and a second linter is a second config format, a second set of versions and a second thing CI must run. `eslint-plugin-boundaries` expresses the layer graph inside the toolchain that already exists.

### Routing: TanStack Router v1, file-based

`apps/admin` uses **TanStack Router v1** with **file-based route definitions** and the generated route tree, via the official Vite plugin. The rationale, recorded because "file-based" is the part most likely to be second-guessed:

- **The generated route tree gives full type safety** on paths, params and search params. `Link to="/staf"` is a compile error; a search param the route did not declare is a compile error. With code-based routing the same safety exists only if a hand-maintained tree is kept precisely in sync — the codegen makes it unconditional.
- **Route-by-route code splitting is automatic** (`autoCodeSplitting: true`). Every page becomes its own chunk with no `React.lazy` bookkeeping; the login screen does not download the data grid.
- **First-class typed search params** — `validateSearch` per route — are the mechanism the grid's URL-held list state stands on, today through the one codec of [ADR-0043](0043-readable-list-search-params.md). The router validates, defaults and types the list query the way `validate()` middleware types `req.valid.query` on the API; the grid reads and writes route search, not component state.

### Reconciling file-based routes with FSD

A `routes/` directory looks like a seventh layer and is not one: route files are **wiring**, the SPA's equivalent of `apps/api/src/routes/` — path, guard, validation, mount — which is why they live under `app/`, the layer whose job is wiring:

```ts
// vite.config.ts
tanstackRouter({
  routesDirectory: "src/app/routes",
  generatedRouteTree: "src/app/routeTree.gen.ts",
  autoCodeSplitting: true,
})
```

Route files stay thin by rule: a path, `validateSearch`, a `beforeLoad` guard, and a lazy import of the page component from `pages/`. A route file that grows JSX beyond composition is a page in the wrong folder. `routeTree.gen.ts` is a build artifact that lives in the tree (the types depend on it), is **excluded from lint and from formatting** (the D3.3 rule, with the same precedent `packages/ui`'s generated primitives set — otherwise `pnpm format` and the generator take turns dirtying the working tree), and is never hand-edited — a conflict in it is resolved by regenerating, not by merging.

### Layout topology and guards

Two **pathless layout routes** partition the app:

- **`_auth`** renders `widgets/auth-layout` — the login screen and anything else unauthenticated.
- **`_dashboard`** renders `widgets/dashboard-layout` — the shell around every protected page. The route file is also where the two sibling widgets meet: it composes `app-sidebar`'s exports — the sidebar and, per §The-shell-adapter, `AccountMenu` — and hands them to the adapter, because it is the one layer that may see both slices.

The router is created with a context carrying what guards and loaders need:

```ts
// app/providers/router.ts
const router = createRouter({
  routeTree,
  context: { queryClient, session },   // session: the token store from ADR-0033
});
```

[ADR-0044](0044-record-routes-without-list-state.md) (carrying 0040) extended this context with the API client so loaders can fetch; that extension is that record's and stands beside this one.

Guards belong to the route tree, not to components — a `<RequireAuth>` wrapper is a guard every new page has to remember, the per-route-auth mistake [ADR-0015](0015-route-segments-and-versioning.md) rejected on the API. Instead:

```ts
// app/routes/_dashboard.tsx
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: ({ context, location }) => {
    if (!context.session.isAuthenticated())
      throw redirect({ to: "/login", search: { redirect: location.href } });
  },
});

// app/routes/_auth.tsx — the mirror: an authenticated visitor is sent to the dashboard
```

The `redirect` search param is how a session that expires mid-task returns the operator to the screen they were on. Adding a protected page means adding it under `_dashboard/`; the guard is inherited, and there is no way to mount a protected page outside it by accident.

### Client state stays minimal

By decision, not by omission:

- **Server state** belongs to TanStack Query (**v5**) — caching, invalidation, background refetch, per [ADR-0043](0043-readable-list-search-params.md).
- **Session state** belongs to the [ADR-0033](0033-browser-api-client-and-session.md) token store, exposed to the router via context.
- **Everything else is local React state** (`useState`, `useReducer`, lifted no further than it must be). URL-worthy state lives in route search params, per §Routing.

No global state library — no Redux, Zustand, Jotai — until an ADR adds one with a problem it names. ADR-0032 said a fourth category appearing is the signal to write that ADR, and it was right twice: [ADR-0041](0041-grid-preferences.md)'s preferences and [ADR-0045](0045-user-settings.md)'s settings each arrived as their own decision, behind their own seam, rather than as a store.

### Stack and scope

- Named versions: **React 19, Vite 7, TypeScript 5.9, TanStack Router v1, TanStack Query v5**. The implementation pins exact versions; this ADR pins the majors so a bump that changes one is a visible decision.
- This ADR governs **`apps/admin` only**. `apps/web` (Next.js) gets its own architecture ADR in its own deliverable (D13 in the re-scoped ledger): Next's file-system router and server components occupy the ground FSD's `app` and `pages` layers stand on, so mapping FSD onto it — or choosing not to — is a separate decision this one does not prejudge. The planned customer app (D11) is likewise its own decision; what it inherits from here, if anything, is D11's to say.

## Consequences

- Everything ADR-0032 banked still holds and is unchanged by the delta: "where does this go?" has a mechanical answer that fails lint when wrong; guards are structural; splitting is the plugin's job; the codegen artifact's price is paid once in tooling config; the cross-slice ban keeps producing the demote-or-promote refactor pressure that keeps the layers honest; and this tree stays the scaffold target a blueprint repository is judged by, so a slice added without a home in the layer map is a defect rather than a preference.
- **`headerEnd` gets its exerciser and the tree stays truthful.** The one line a reader of the tree could be misled by — the sidebar annotation placing a block the code no longer keeps there — is corrected in the record that owns it, rather than surviving as a known lie ADR-0048 apologises for.
- **The D6.3/D7.5 reversal is on the record in the record it diverges from.** Anyone reading those steps' reasoning finds the counter-argument here and in ADR-0048 §2, not a silent contradiction; and the half of the reasoning that survives — the account menu as the home of operator preferences — is stated as surviving.
- **Both siblings were retargeted in the same motion, on 2026-08-26, while all three were `proposed`.** ADR-0048 §Decision 2 and §Consequences, and ADR-0047 §What-this-does-not-decide, now point here rather than asserting that ADR-0032 survives untouched. Nothing is owed to either record at `D8.4`; the edits are already in the working documents, which is what `proposed` is for.
- **`widgets/dashboard-layout` thins rather than disappears**, and the adapter boundary is reviewable: layout markup in the adapter is a defect, contents in the package is a defect. The `_dashboard` route file gains one composition duty (passing `AccountMenu` down beside `sidebar`), which is wiring doing wiring's job.
- **The existing ADR-0032 citations stand as history and are not swept.** From D8 on a comment about the admin app's structure cites this record; the roughly eighty ADR-0032 citations already in the tree stay where they are — the D5 precedent that left 165 ADR-0034/0040 citations in place. The exception is a comment that asserts a fact a D8 step *falsifies*, which is corrected by that step rather than left as a true-looking lie: `apps/admin/src/widgets/app-sidebar/index.tsx:51-52` ("the footer holds the account menu, which is where logout lives"), the `profile-page` test named for the sidebar footer, and `apps/admin/src/pages/profile/__tests__/profile-page.test.tsx:52-58` (the `page()` docblock the move falsifies, beside the two assertions it explains) and `apps/admin/eslint.config.js:18-19,112-117` (whose comments cite ADR-0032 for the layer graph and for the sibling-widget carve-out this record now owns) — the first two owned by `D8.5`, the config comments by `D8.5` alongside its boundaries-green check, and `widgets/dashboard-layout/index.tsx`'s own ADR-0032 citation by `D8.4`, which rewrites that file anyway.
- **A superseded record's history stays intact.** ADR-0032 moves to `superseded by ADR-0049` at `D8.4`'s head with its amendment trail untouched; its D3-era snippets (the v5 lint spelling, the pre-D8 tree) remain readable in place, out of force.
- **Four documents name a superseded record, and two of them go stale one step before this one is accepted.** `.claude/rules/frontend.md` carries the en-dashed range `0030–0046` in its heading and its lede and has no frontmatter; `.claude/skills/frontend-conventions/SKILL.md` carries the hyphenated range in its YAML `description:` and, in its body, an enumeration ending "0046 (D7). All of them are frozen" — which gains `0047–0049 (D8)` and stops calling 0031 and 0032 frozen. Two more cite ADR-0032 in their `description:` line alone: `.claude/agents/ui-builder.md` and `.claude/skills/new-resource-ui/SKILL.md`. 0031's flip happens at `D8.1`, so all five are wrong from there. They are therefore corrected at **`D8.1`**, to the range `0030–0049` with both supersessions marked — **both occurrences in each document, the YAML `description:` as well as the body, and noting that `/frontend-conventions` spells the range with a hyphen in one and an en-dash in the other, so one grep finds only half** — rather than at this record's own step or at close-out: they load without anyone opening them, which is how D7's close-out found the last one out of step. `.claude/skills/ui-component/SKILL.md` is corrected at `D8.1` for the same reason, and the ADR index at each acceptance.
- The cost ADR-0024 rule 1 charges is paid again: most of this record restates its parent verbatim so it stands alone, and the real delta is two tree annotations and one subsection. That imbalance is the mechanism — a reader of this record never assembles the current rule from two documents.

## Alternatives considered

- **Amend ADR-0032 in place.** Unavailable: D3 shipped 2026-08-20, the record is frozen, and no window is open — an accepted ADR with code standing on it changes only by supersession (ADR-0024 rule 1, ADR-0025 rule 2). This is the mechanism working, not a formality endured.
- **Argue the tree annotation is merely illustrative, so no supersession is needed.** The lifecycle does say snippets are illustrative of shape and naming — but the annotation is not a snippet detail, it is the ADR assigning a responsibility to a slice, and the code's own comments cite it as such ("ADR-0032 names 'navigation, current-principal block, logout' as this widget's job"). Rejected by the operator, and the refuter's finding is the reason on the record: [ADR-0048](0048-app-shell-and-record-surfaces.md) **as first written** claimed both that 0032 assigns the block to `app-sidebar` (§Context, correcting the plan's framing) and that the design keeps 0032 unamended (§Decision 2) — an internal tear that only holds if the annotation is authoritative when useful and illustrative when inconvenient. This record resolves it by treating the annotation as what it was: a decision, now superseded; and 0048's 2026-08-26 revision drops the claim and points here.
- **Give `AccountMenu` its own slice, `widgets/account-menu`.** The placement the layer map arguably points at once the component no longer renders inside the sidebar, and it would end the oddity of a slice annotated "navigation" that exports a menu. Rejected: the menu is made of the same session facts the sidebar's author owns and changes for the same reasons, so a fourth widget slice with exactly one consumer would buy a directory and a public API to keep two things in step that are already in step. The tree annotation says what is true instead — navigation, plus the account menu it exports for the header's mount.
- **Keep `AccountMenu` in the sidebar footer.** The status quo, and it fails D8's own slot-honesty rule: `headerEnd` would ship with no exerciser — the unexercised-surface defect this repository has recorded twice about the `page` edit surface — and the customer app's header-chrome requirement would be answered by a slot no consumer has proved. Rejected; the admin panel's own chrome is the proof the slot needs.
- **Move only `ThemeMenuItems`/`LocaleMenuItems` to the header** (carried from ADR-0048). They are bare `DropdownMenuRadioGroup` fragments, mountable only inside a `DropdownMenuContent`; moving them alone means restructuring both features away from the radio-group semantics D6.3 chose. The whole menu moves instead — cheaper, and it keeps the D6.3 grouping intact while reversing only the mount.
- **Let `widgets/dashboard-layout` import `AccountMenu` directly.** It needs no lint exception — the `publicApiOf("widgets")` carve-out above already permits it, so the honest cost is not a broken fence. It is rejected on the layering ground it actually has: the adapter's one job is to be a frame, and a frame that reaches for the account menu itself is a frame that knows a principal exists. The route file already composes these exact siblings for `sidebar`, so the hand-off costs one prop and keeps the adapter ignorant.
- **Plain type-based folders** (`components/`, `hooks/`, `utils/`) (carried). Fine at ten files; at a hundred, everything imports everything and deleting a screen is archaeology. Still rejected.
- **React Router 7** (carried). No first-class validated search params and path typing as a typegen afterthought — the URL-held grid state would be hand-rolled parsing beside a data layer TanStack Router integrates with natively. Still rejected.
- **Next.js for the admin panel** (carried). Rejected by [ADR-0022](0022-frontend-apps.md) and nothing since has weakened it: an admin panel behind a login gets nothing from SSR. Still rejected.
- **`steiger` as the FSD linter** (carried). Purpose-built and would validate more of the methodology; still a second lint toolchain against one gate. Still rejected.
- **Code-based TanStack Router routing** (carried). No codegen step, at the price of hand-maintained splitting and per-route boilerplate, with the same library. Still rejected.
