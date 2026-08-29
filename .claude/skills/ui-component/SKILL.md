---
name: ui-component
description: Add or update a shadcn/ui primitive or a hand-written composition in packages/ui and expose it through apps/admin's shared/ui door, per ADR-0047 (superseding ADR-0031) — including the dependency move the CLI gets wrong, the byte-identical rule, and the two regimes the path selects. Use for "add the <x> component", "we need a popover", "update the table primitive", "add a composition".
---

# UI component — `$ARGUMENTS` (shadcn component name, kebab-case)

Read `/frontend-conventions` §Design system. **ADR-0047 is the decision** (superseding ADR-0031, accepted 2026-08-26 at `D8.1`, frozen since D8 shipped 2026-08-27); this is its checklist. D9 did not touch it: `@repo/ui` gained no dependency and no behaviour in that deliverable, and [ADR-0051](../../../docs/adr/0051-platform-extraction.md) generalised 0047's one-door rule to six more packages rather than changing this one.

**First ask which of three homes it has.** ADR-0047 §What-code gives the package two regimes and the path is what selects one:

- **A generated primitive** — a shadcn component, generated code this repository _owns_ — belongs in `packages/ui/src/components/` (and generator-emitted hooks in `src/hooks/`), under the regenerate-and-diff regime.
- **A composition** — a layout every app of this shape is built from, that no CLI emits: the app shell, the record-surface container, `Banner` — belongs in `packages/ui/src/compositions/`, under the ordinary code regime. It must be **presentation-only**: geometry, slots, size tokens and accessible structure, **no `@repo/contracts` import**, and no knowledge of routing, authorization, forms, server state or the session. Admission is bounded — every slot and every variant must answer a need this repository can name today.
- **A component with behaviour of its own** (a loader that waits before it appears, a confirm dialog, an error panel), or a layout one app _owns_, is **not** a re-export and goes in neither: it is a hand-written file in `apps/admin/src/shared/ui/` beside the door. Getting this wrong is how a design system acquires app logic.

## Adding a primitive

1. **Generate it from `apps/admin`**, not from `packages/ui`:

   ```
   cd apps/admin && npx shadcn@latest add <component>
   ```

   The app's `components.json` aliases point at `@repo/ui`, so the file lands in `packages/ui/src/components/<component>.tsx`. That indirection is the mechanism that keeps "shared" true — the path of least resistance is the shared package.

2. **Move the dependency the CLI installed.** It adds the radix (or other) runtime dependency to the _app_ it was invoked from. Every primitive dependency belongs in `packages/ui`'s `dependencies` — `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `tailwindcss`, `tw-animate-css`. Remove it from `apps/admin/package.json`, add it there, `pnpm i`. The one exception is `lucide-react`, which an app may hold directly because icons are authoring rather than design system — pinned to the same range as `packages/ui`.

3. **Do not reformat and do not rename.** The generated file stays byte-identical to what the CLI emits; `.prettierignore` covers `packages/ui/src/components/` and `src/hooks/` for exactly this reason. Files stay kebab-case as generated.

4. **If it must be edited, the edit earns a comment** at the point of change saying which rule forced it — `exactOptionalPropertyTypes`, the `react-hooks` purity rules, a dependency this repo refuses, a layout invariant. **The standing inventory is ADR-0047 §What-code regime 1**: read it, and read an existing divergence in the file you are about to touch, before adding another. From D8 on a new comment cites **ADR-0047**; the existing ADR-0031 citations stand as history and are not swept. Correcting an _existing_ owned-edit comment is not a new divergence and is always permitted.

5. **Open the door.** Add a named re-export to `apps/admin/src/shared/ui/index.ts`, alphabetically, in the existing grouping. Named, never `export *`: the door is also the inventory of what this app uses, and adding to it should be a visible line in a diff. That re-export is **per symbol**; a brand-new export _path_ additionally costs the `exports` entry in `packages/ui/package.json` and the pattern in the app's `no-restricted-imports` group, and those two land together when the path opens. The rule runs in both directions — when a symbol's **last** consumer in an app goes (a colocated test counts as a consumer), the step that removed it removes the door line, and the check is a search for remaining consumers rather than a reading of your own diff.

6. **Tests.** Primitives are tested for the behaviour this repo relies on — `button`, `field` and `table` have suites today — and **compositions, being this repo's own code, are tested in full**. Suites live in `packages/ui/src/__tests__/`, and the package harness is deliberately thin: a desktop-only `matchMedia` stub and Testing Library cleanup, no router, no forms, no MSW, no `user-event`. Assert roles, accessible names, slot presence, and the structural attributes and classes the ADR pins. jsdom has no layout, so anything that needs real geometry is the manual walk's. If a composition needs a jsdom capability the harness lacks, extend **`packages/ui/test/setup.ts`** — the package's own setup file, not the admin's — with a stub and a comment.

## Adding a composition

No CLI generates one. Write `packages/ui/src/compositions/<name>.tsx` by hand, prettier applies (the `.prettierignore` carve-out covers `components/` and `hooks/` only, and **does not widen**), and it is reviewed like app code. Then:

1. **Add `"use client"`** if it holds state, reads context — reading `UiStrings` counts — or composes a primitive that does (`sidebar`, `pagination`, `breadcrumb`, `sonner` carry no directive of their own). `apps/web` transpiles this package and a Next server component must be able to import any export.
2. **Add no dependency.** Compositions use what the package already declares — radix through the primitives, `cn`, `class-variance-authority`. `react-hook-form` and `@tanstack/react-router` do not enter this package; a surface that needs one stays in the app as a thin wrapper over the geometry-only composition.
3. **Operator-facing copy goes through `UiStrings`** (ADR-0046 §12) — never an i18n dependency, never a bare literal. Nothing in `packages/ui` lints for one, so this is review-enforced. A new key costs the `UiStrings` field, the `DEFAULT_UI_STRINGS` entry, **all three** hand-maintained lists in `UiStringsProvider`, the consuming app's provider line, and both catalogues.
4. **Open the door and write the suite**, per steps 5 and 6 above.

## Updating a primitive

There is no `npm update` for copied code. Re-run the CLI, diff the result against the local copy, and re-apply the commented local edits deliberately — that is the ownership model working, not a workaround. Check `@repo/ui`'s own suites and `pnpm test --filter admin` afterwards, since every app screen composes these. A **composition** has no upstream: it is updated by editing it, and the thing to remember is that a change to one lands in every consumer at once — it is every screen's frame, not a restyled button.

## Finish

`pnpm check && pnpm format:check` (the last one proves the carve-out still holds — `compositions/` is formatted, `components/` and `hooks/` are exempt), then `pnpm test`. If the change alters what the design system _is_ — a new token, a theming decision, a second style, a new kind of code in the package — that is an ADR-0047 matter, not a component addition. ADR-0047 is frozen — D8 shipped 2026-08-27 — so it changes only by supersession.
