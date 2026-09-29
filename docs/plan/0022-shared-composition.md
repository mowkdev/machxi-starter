# D22 — Shared composition, second wave

- Status: **in progress** — **scoped in full 2026-09-29 by `/scope`**, from the row inserted 2026-09-14 (ledger §How D20–D26 were inserted) and `FE-01`, `FE-04`, `FE-09`'s residual and `FE-15` of the two reviews. **Opened 2026-09-29**, the same sitting, on the operator's decision (ADR-0025 rule 5; ledger §How D22 was scoped, §How D22 opened).
- Records: [ADR-0077](../adr/0077-shared-composition-second-wave.md) (the session in the kit, `@repo/account`, a feature slice as a door; deltas on ADR-0062, 0051, 0045 and 0053) — written `proposed` at scoping, accepted at the head of `D22.1`.
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0022-shared-composition.notes.md`](0022-shared-composition.notes.md)

## Goal

Move what the two SPAs repeat into packages before the starter is forked: the session, the principal cache and the root's join into `@repo/app-kit`, the account's client into a new `@repo/account`, and the grid's and form's door-level suites into their packages. A fork then edits a route tree and a dictionary, and a later merge from the starter does not meet the fork's own edits in those files.

## Constraints

- Mechanical by design: no behaviour changes. A step that wants one stops and says so in the notes (ADR-0051 §Six focused packages, as carried).
- `@repo/app-kit` learns no route name, resource name or policy; `@repo/account` names the account's own resources and no other, and does not depend on `@repo/grid` or `@repo/app-kit` (ADR-0077 §1–§2).
- An app reaches `@repo/account` only through the slices ADR-0077 §3 names; page and route imports do not change.
- Tests move with their code at zero net. Each step's notes declare the workspace test total before and after, and any net-new count (ADR-0051 §Consequences, as carried).
- `pnpm size` is measured at every step. A budget change is a diff of the budget file with its baseline, inside the headroom rule (ADR-0073 §5 as carried).
- Every app's `styles.css` declares an `@source` for each rendering package it depends on; the existing pair test covers the new package (ADR-0062 §1).
- A spec under `docs/specs/` that names a moved test file is updated in the same diff (ADR-0068 §1).
- A new workspace package is installed in a side worktree while the operator's stack runs, then fast-forwarded into `main` (the `D28.2` precedent). Nothing here restarts the stack (`CLAUDE.md`).
- The gate as `CLAUDE.md` §Commands defines it, at every step.

## Decisions taken at scoping (operator, 2026-09-29)

- **The cut.** D22 is the frontend wave. D23, D24, D25 and D27 fold into one backend wave, D29. D26 and D16 stay planned and are built after the fork.
- **Fat steps, security apart.** Mechanical work is merged into large steps. D22 has no security-touching step; `code-reviewer` reads each diff, and `adr-reviewer` reads `D22.1`'s.
- **The settings client lands in `@repo/account`**, so the kit's rule stands.
- **A feature slice is the door** for a feature package.
- **Residuals.** Taken, because their files move: the pending-submit label case, the barrel check on the composition roots, and `FE-15`'s first and fifth files. Declined by name: the invitation screen's status node (ADR-0077 §5).
- **No spike.** Package catalogues, segment parameters and navigation by callback each have a shipped precedent in `@repo/form`, `@repo/api-client` and `@repo/app-kit`.

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first; finding ids are what the step closes.

- [x] **1. Accept ADR-0077; the session, the principal cache and the root's join move into `@repo/app-kit`.** Accept 0077 at the head, where [ADR-0062](../adr/0062-frontend-build-and-shared-composition.md) gains its delta (the index rows, the topic table and the ledger's window section say so), and write its digest lines in `scripts/rules-digest.mjs`. The kit gains the session provider with its unreachable notice, the principal-cache boundary and the root composition, parameterised as ADR-0077 §1 states. Both apps' `app/providers/session.tsx`, `principal-cache.tsx` and `app/index.tsx` reduce to bindings. The files under `shared/` that are identical in both apps and bind nothing move with them. The suites for the moved code move into the kit. `composition.test.ts` gains the case that neither composition root imports a barrel package `SHAKEABLE` does not name. Closes `FE-01` for its composition half.
      **ADRs:** 0077 §1, 0062 §1–§2 with its `D14.8` amendments, 0051 §A door in every app, 0033 §Boot as carried.
      **Done when:** `pnpm test --filter=@repo/app-kit` green with cases "the session provider is bound by segment", "the principal cache key is the app's function" and "a composition root imports only shakeable barrels", the last red on a root importing an unnamed barrel; `pnpm test:unit --filter admin --filter customer` green; `pnpm rules:digest` writes then writes `0 of 3`; `pnpm docs:check` clean; `pnpm size` green; `pnpm test:e2e` green in both apps; the gate green.
- [x] **2. `@repo/account`: the settings client, the preference cards, password reset and the shared profile features.** Scaffold the package with its catalogue in `en` and `lv`, its `sideEffects` declaration and its row in `SHAKEABLE`. Move the settings entity, writer and gate, the three cards, the password-reset forms and hook, and the shared profile features, with their suites. The admin passes the grid preference adapter; the customer passes none. Both apps' slices become doors under ADR-0077 §3, `doorRules` in `@repo/eslint-config` learns a door outside `shared/`, and both `DOORS` tables gain the row. Both stylesheets gain the `@source`. [ADR-0051](../adr/0051-platform-extraction.md), [ADR-0045](../adr/0045-user-settings.md) and [ADR-0053](../adr/0053-account-area.md) move at this head. `settings.md` and `users-and-profile.md` name the moved tests. Closes `FE-01`.
      **ADRs:** 0077 §2–§3, 0045 §The client as carried by 0053, 0053 §5, 0046 §13 as carried, 0051 §Strings travel with the machinery, 0064.
      **Done when:** `pnpm test --filter=@repo/account` green; `pnpm lint --filter admin --filter customer` green on the tree and red on a page importing `@repo/account` directly; `packages/config-eslint/rules.test.js` case "a feature slice is a door for its own groups and no others" green; `pnpm i18n:check` green; `composition.test.ts` names eight packages; `pnpm size` green with the customer's bundle holding no `@repo/grid` module (`grid-chunk.test.ts`'s twin in the customer, "the account package brings no grid"); `pnpm test:e2e` green in both apps; `pnpm docs:check` clean; the gate green.
- [ ] **3. The grid's and the form's suites live in their packages.** Move `apps/admin/src/shared/grid/__tests__` and `shared/form/__tests__` into `@repo/grid` and `@repo/form` on `@repo/app-kit/testing`, split by concern as they land. Each door keeps one smoke test. `@repo/form` gains the case that sees its pending-submit label under the pseudo-locale. Record the admin unit tier's duration before and after, from the tier's own log. Closes `FE-04`, `FE-09`'s residual, and `FE-15` for its first and fifth files.
      **ADRs:** 0077 §4, 0036 as carried by 0052, 0051 §Consequences, 0074 §9.
      **Done when:** `pnpm test --filter=@repo/grid --filter=@repo/form` green; `@repo/form` case "the pending submit label is a catalogue string" green, and red with the key removed; `pnpm test:unit --filter admin --force` green; the notes carry both durations, both workspace totals and the line count of every moved test file; the gate green.
- [ ] **4. Close-out.** Both reviews' `FE-01`, `FE-04`, `FE-09` and `FE-15` carry their fates; `/frontend-conventions`, `/new-resource-ui`, the rule files and `.claude/README.md` describe eight packages and the feature-slice door; the `resource-screen` generator's templates still build a screen that lints; the digests regenerated; then the definition of done.
      **Amended 2026-09-29 (D22.2).** The kit's own barrel leaves its exemption, decided by the operator (delegated to the coordinating session): after D22.1 and D22.2 `@repo/app-kit` is the barrel both composition roots import most, so its exemption is a hole in the barrel guard exactly where the imports are. First confirm that no module under `packages/app-kit/src` has an import-time side effect (a CSS import, a global registration, a module-level call). If none has, `@repo/app-kit` gains `"sideEffects": false` and a `SHAKEABLE` row in `composition.test.ts`, so its count moves from eight to nine (the platform packages stay eight), with a labelled amendment to ADR-0077. If one has, the kit stays exempt and the reason is written into ADR-0077, so the exemption is a recorded decision. Either way, `pnpm size` is run before and after, and both measurements go in the D22.4 note.
      **ADRs:** 0077, 0065 as carried, 0063 §3.
      **Done when:** the definition of done below, every item.

## Definition of done

Run at `D22.4` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO`.
3. `pnpm size` green with both budget files' baselines equal to the measurement of the shipping commit.
4. `pnpm test:e2e` green in both apps against the local compose, the floors unchanged from `D20.13`'s.
5. `pnpm test:postman` exit `0` with the counts the READMEs state.
6. `pnpm turbo gen resource-screen` run in a scratch worktree with a demo resource, then `pnpm lint --filter admin` and `pnpm check-types --filter admin` green there.
7. `docker compose -f docker/prod/compose.yaml build` succeeds.
8. `pnpm rules:digest` writes nothing on a second run; `pnpm docs:check` clean.
9. The workspace test total equals D21's close plus the net-new counts the steps declared.

## Not in D22

The sidebar and the dashboard layout; the router and `test/render`; the features one segment alone has; the invitation screen's status node (ADR-0077 §5); any behaviour change; D29's backend work; D26's restatement of this record's chain.
