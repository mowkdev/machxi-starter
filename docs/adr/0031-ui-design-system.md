# ADR-0031: `packages/ui` — shadcn/ui design system on Tailwind v4

- Status: proposed
- Date: 2026-08-19

> Written at the opening of D3, whose first step (`D3.1`) implements it. [ADR-0025](0025-deliverables.md) rule 3 keeps "agreed" and "built" as separate facts: this is the agreement, and it stays amendable in place while D3 is `in progress` ([`docs/plan/README.md`](../plan/README.md)). It fulfils the _Planned_ entry the ADR index has carried since D1 — "`packages/ui` and the design system" — which [`docs/plan/README.md`](../plan/README.md) §What blocks D3 names as the one decision D3 could not start without.

## Context

`packages/ui` is the last piece of Turborepo template scaffolding left in the repository. It exports two components nobody asked for — `counter-button` and `link` — and decides nothing: no styling engine, no component conventions, no theme. Yet it is load-bearing in the one way that matters for this decision: **both frontend apps already depend on it** (`apps/admin/src/app/index.tsx`, `apps/web/src/app/page.tsx`), and [ADR-0022](0022-frontend-apps.md) aligned the whole workspace on React 19 explicitly "for `@repo/ui` to have a single React peer version". The workspace pre-paid for a shared UI package; what it never bought was the package's contents.

ADR-0022 §Consequences deferred exactly this — "frontend architecture (state, data fetching, routing, **design system**, i18n) will be covered by dedicated ADRs when those apps are built out". D3 is the admin panel, so the deferral is due. The forces:

- **Shared or per-app.** One package couples `admin` and `web` to the same component versions and upgrade cadence; two copies guarantee the apps drift apart, which for a blueprint that exists to demonstrate consistency is the worse failure.
- **Owned or depended on.** A styled component library is a dependency whose look and API are someone else's roadmap. shadcn/ui's model is the opposite: the CLI copies component source into the repository, and from that moment it is owned code — patched, restyled and reviewed like anything else in `src/`.
- **Where the theme lives.** Two apps on two bundlers (Vite, Next) need one set of design tokens, or dark mode and brand colour become a two-place edit forever.

## Decision

### The package survives, shared, as the design system

**`@repo/ui` becomes the shared design-system package for `admin` and `web`.** The rationale is the one ADR-0022 already banked: both apps depend on it, one React version was aligned across the workspace for exactly this, and per-app copies of the same components would drift from the first divergent `shadcn add` onward.

The cost is stated rather than hidden: **a shared package couples the two apps' upgrade cadence.** A Tailwind major, a radix breaking change or a restyled `button` lands in both apps at once, and the app that did not ask for it still has to absorb it. That is the price of no drift, and this ADR pays it knowingly.

### shadcn/ui, committed as source

**Components come from shadcn/ui and are committed as source under `packages/ui/src/components`.** shadcn's copy-in model means the components are owned code, not a dependency: there is no `shadcn` package in the runtime graph, only the primitives it generated, which are edited in place when the design needs it. "Upgrading" a component means regenerating it and diffing against the local copy — §Consequences.

The runtime dependencies the generated code needs — radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner` — **live in `packages/ui`, not in each app**. `react` and `react-dom` stay peers, as today. The package stays source-published per [ADR-0002](0002-monorepo-layout-and-tooling.md) §Shared conventions — no build step; Vite compiles it directly and `apps/web` already has `transpilePackages: ["@repo/ui"]`.

### Tailwind CSS v4, configured in CSS

**Tailwind v4, CSS-first.** Theme tokens — colors, radii, typography — are CSS variables in the package's own stylesheet, declared with `@theme`; dark mode is the class strategy (a `dark` custom variant on a `.dark` ancestor), so it is a token concern in one file rather than a per-app one. The stylesheet is exported, both apps import it, and it declares the package's own sources with Tailwind v4's `@source`, so an app that imports it gets the utilities the package's components use without content configuration of its own. **No `tailwind.config.js` sprawl per app** — each app's wiring is its CSS entry importing the shared stylesheet, and nothing more than content wiring beyond that.

### The shape, per shadcn's monorepo support

shadcn ships an official monorepo layout, and this follows it rather than inventing one:

```
packages/ui/
├── src/
│   ├── components/        # shadcn-generated primitives: button.tsx, input.tsx, dialog.tsx, …
│   ├── hooks/             # use-mobile.ts and friends the generator emits
│   ├── lib/               # utils.ts (cn())
│   └── styles/
│       └── globals.css    # @theme tokens, dark variant, @source
├── components.json        # tells the CLI this workspace is a target
└── package.json
```

```json
"exports": {
  "./globals.css": "./src/styles/globals.css",
  "./components/*": "./src/components/*.tsx",
  "./hooks/*": "./src/hooks/*.ts",
  "./lib/*": "./src/lib/*.ts"
}
```

**Each app carries a `components.json` whose aliases point at the workspace package**, so `npx shadcn add <x>` run from either app lands the new primitive in `@repo/ui`, not in the app. That is the mechanism that keeps "shared" true over time: the path of least resistance for adding a component is the shared package, and an app-local copy takes deliberate effort.

### The template scaffolding is deleted

`counter-button` and `link` are removed, with their tests. `apps/admin`'s template page goes with them — D3 replaces it wholesale. `apps/web/src/app/page.tsx` imports both, and it gets **the minimal edit that keeps `web` compiling** and nothing more: building `web` out is a later deliverable (D4), not this one, and dressing its placeholder page up now would be D4 work smuggled into D3.

### What ships on day one

D3 needs these, so they are in scope for `D3.1` rather than added ad hoc later:

- **The `Field` family** — shadcn's current, form-engine-agnostic primitives for label/control/description/error composition. Choosing them here is deliberate: they bind to no form library, so [ADR-0035](0035-config-driven-resource-ui.md) can decide form wiring without this package taking a side.
- **`sonner` for toasts** — what shadcn itself ships for toasts; how the apps consume it is [ADR-0034](0034-server-state-and-notifications.md)'s decision, not this one's.
- **The `sidebar-07` and `login-01` block foundations** — the sidebar, sheet, button, input, dropdown-menu, avatar, card, dialog, select, checkbox, switch, table and the rest of what those blocks pull in. The exact component list is implementation detail; the decision is that **blocks are adapted into `@repo/ui` and `apps/admin`, not treated as a vendored theme** — the layout composition an app owns lives in the app, the primitives it is built from live here.

### Component conventions

- **Functional components only, no classes.** [ADR-0009](0009-api-modular-layering.md)'s rule carried to the frontend in spirit: no `class`, no `this`. shadcn generates function components anyway, so this costs nothing to keep and something to break.
- **Files are kebab-case**, as shadcn generates them (`dropdown-menu.tsx`), and generated code is not renamed on arrival — the smaller the local diff against upstream, the cheaper §Consequences' regenerate-and-diff stays.
- The D1-era package plumbing carries over unchanged: the `lint` / `check-types` / `test` / `test:unit` scripts, `@repo/vitest-config` with jsdom, and the shared ESLint config. Nothing here adds a Turbo task, so [ADR-0026](0026-task-graph-caching-and-serialisation.md)'s table is untouched.

### What this does not decide

- **The admin app's internal architecture** — routing, state, data fetching. That is [ADR-0032](0032-admin-app-architecture.md).
- **Form wiring** — which form engine, how `Field` composes with it, validation against `@repo/contracts` schemas. That is [ADR-0035](0035-config-driven-resource-ui.md).
- **Grid theming**, beyond one sentence that belongs here because it is a token concern: AG Grid's Theming API binds to the same CSS variables this package declares, so the grid follows the theme — light, dark and brand — from the one stylesheet. The detail is ADR-0035's.

## Consequences

- **shadcn updates become "regenerate and diff", owned like any code.** There is no `npm update` for a copied component; upstream fixes arrive by re-running the CLI and reviewing the diff against local edits. That is the ownership model working as designed, and it is real maintenance the blueprint inherits.
- **Tailwind enters both apps' builds.** Vite and Next each gain the Tailwind v4 plugin and a CSS entry that imports `@repo/ui/globals.css`; the token layer stays in one place, which is the point.
- **`packages/ui` gains real runtime dependencies** — radix, `sonner`, `class-variance-authority` and friends — where it had none. They are declared once here rather than once per app, which is what keeps the two apps on the same versions of them.
- **The upgrade-cadence coupling from §Decision is now a standing fact**: a change to a shared primitive is a change to both apps, and reviews of `packages/ui` diffs must read them that way.
- **Dark mode is a token concern in one place.** An app toggles a class; the palette answers from `globals.css`, and so does the grid.
- The D1-era `@repo/ui` tests and lint config carry over, so the first real components land in a package whose quality gates already exist rather than one being scaffolded around them.
- `apps/web` compiles but stays a placeholder until D4; the minimal-edit rule above is what keeps that boundary honest.

## Alternatives considered

- **Per-app shadcn copies, `@repo/ui` deprecated.** shadcn's default posture for single apps, and it removes the upgrade-cadence coupling. It also guarantees drift: two `button.tsx` files diverge at the first app-local edit, and a blueprint that ships two visibly different design systems is demonstrating the failure it exists to prevent. Rejected because ADR-0022 already paid the alignment cost that makes sharing cheap.
- **A styled component library (MUI, Mantine).** Faster to the first screen, and it fights both choices made here: the components are a dependency rather than owned code, and the styling engine is the library's, not Tailwind — restyling means fighting a theme API instead of editing source.
- **Radix primitives, hand-styled.** shadcn minus the accelerant: the same ownership model and the same dependencies, with every component's styling, variants and composition written from scratch. The CLI's output is a better starting point than an empty file, and diverging from it later is always available because the code is owned.
- **Keep the template package as-is.** It decides nothing, both apps import junk from it, and every week it survives is a week the blueprint's UI package teaches the wrong lesson. Rejected without much ceremony.
