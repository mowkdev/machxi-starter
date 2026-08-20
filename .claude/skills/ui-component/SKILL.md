---
name: ui-component
description: Add or update a shadcn/ui primitive in packages/ui and expose it through apps/admin's shared/ui door, per ADR-0031 — including the dependency move the CLI gets wrong and the byte-identical rule. Use for "add the <x> component", "we need a popover", "update the table primitive".
---

# UI component — `$ARGUMENTS` (shadcn component name, kebab-case)

Read `/frontend-conventions` §Design system. ADR-0031 is the decision; this is its checklist.

**First ask whether it is a primitive at all.** A shadcn component is generated code this repository _owns_ — it belongs in `packages/ui/src/components/`. A component with behaviour of its own (a loader that waits before it appears, a confirm dialog, an error panel) is **not** a re-export and does not go there: it is a file in `apps/admin/src/shared/ui/` beside the door, and it is written by hand. Getting this wrong is how a design system acquires app logic.

## Adding a primitive

1. **Generate it from `apps/admin`**, not from `packages/ui`:

   ```
   cd apps/admin && npx shadcn@latest add <component>
   ```

   The app's `components.json` aliases point at `@repo/ui`, so the file lands in `packages/ui/src/components/<component>.tsx`. That indirection is the mechanism that keeps "shared" true — the path of least resistance is the shared package.

2. **Move the dependency the CLI installed.** It adds the radix (or other) runtime dependency to the _app_ it was invoked from. Every primitive dependency belongs in `packages/ui`'s `dependencies` — `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `tailwindcss`, `tw-animate-css`. Remove it from `apps/admin/package.json`, add it there, `pnpm i`. The one exception is `lucide-react`, which an app may hold directly because icons are authoring rather than design system — pinned to the same range as `packages/ui`.

3. **Do not reformat and do not rename.** The generated file stays byte-identical to what the CLI emits; `.prettierignore` covers `packages/ui/src/components/` and `src/hooks/` for exactly this reason. Files stay kebab-case as generated.

4. **If it must be edited, the edit earns a comment** at the point of change saying which rule forced it — `exactOptionalPropertyTypes`, the `react-hooks` purity rules, a dependency this repo refuses. There are four such edits today; read one before adding a fifth.

5. **Open the door.** Add a named re-export to `apps/admin/src/shared/ui/index.ts`, alphabetically, in the existing grouping. Named, never `export *`: the door is also the inventory of what this app uses, and adding to it should be a visible line in a diff.

6. **Tests.** The primitives are upstream's and are not unit-tested here; what gets tested is the behaviour this repo added. If the component needs a jsdom capability the harness lacks (pointer capture, `scrollIntoView`, a media query), extend `apps/admin/src/test/setup.ts` with a stub and a comment — the ceiling is known and the stub is the proportionate answer.

## Updating a primitive

There is no `npm update` for copied code. Re-run the CLI, diff the result against the local copy, and re-apply the commented local edits deliberately — that is the ownership model working, not a workaround. Check `@repo/ui`'s own suites and `pnpm test --filter admin` afterwards, since every app screen composes these.

## Finish

`pnpm lint && pnpm check-types && pnpm format:check` (the last one proves the carve-out still holds), then `pnpm test`. If the component changes what the design system _is_ — a new token, a theming decision, a second style — that is an ADR-0031 matter, not a component addition.
