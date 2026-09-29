# D22 — Shared composition, second wave: build notes

The per-step build record of [D22](0022-shared-composition.md) — what was built, the amendments, the review findings and their fates, the gate's output, the workspace test total and the bundle measurements before and after each step, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D22.1 — ADR-0077 accepted; the session, the principal cache and the root's join in the kit (2026-09-29)

**Head.** [ADR-0077](../adr/0077-shared-composition-second-wave.md) moved from `proposed` to `accepted`. [ADR-0062](../adr/0062-frontend-build-and-shared-composition.md) gained its third delta on its `- Status:` line and a dated note in its body: §1's contents of the kit, and the `D14.8` amendment's list of what stays in the apps. The index rows for both records, the topic table's "SPA architecture, doors and the shared composition" row and the ledger's window section say so. `scripts/rules-digest.mjs` gained the line "The session and the root in the kit", citing 0077 as its own, and "Where the machinery lives" now says an app keeps its settings provider rather than its providers.

**Built.** Closes `FE-01` for its composition half.

- `@repo/app-kit` gained four modules:
  - `providers/session.tsx` exports `createAppSession({ segment, baseUrl, unreachable })`. It returns the store, the client, the boot sequence, `onSessionEnded` and the `SessionProvider` with its unreachable notice.
  - `providers/principal-cache.tsx` exports `createPrincipalCache(ownerOf)`. The kit answers for "nobody is signed in" itself, and asks the app's function about a principal only.
  - `providers/app-root.tsx` exports `AppRoot`. The session gate and the settings gate are slots, the router arrives as `children`, and the translation bindings moved in with the order.
  - `feedback/error-reporting.ts` exports `createErrorReporter(dsn, load)` and the `ErrorContext` shape.
- Both apps' `app/providers/session.tsx`, `app/providers/principal-cache.tsx` and `app/index.tsx` are bindings. The six files went from 935 lines to 359.
- Each app gained two door files, `shared/api/session.ts` and `shared/api/principal-cache.ts`. `shared/ui` gained `AppRoot` and lost `AppLoader` and `AppErrorBoundary`, whose last consumer in each app was `app/index.tsx`.
- The kit reads `common:boot.unreachable`, so both apps' `scripts/i18n.mjs` name the key in `DYNAMIC`, beside `loading.starting`.
- No dependency was added and no lockfile line moved, so no side worktree was needed and nothing was restarted.

**The files under `shared/` that are identical in both apps.** Six same-path files were byte-identical. One moved, one moved in part, and four stay:

| File                                 | Fate          | Why                                                                                      |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| `shared/error-reporting/context.ts`  | moved         | A type that binds nothing.                                                               |
| `shared/error-reporting/index.ts`    | moved in part | The factory moved. The file stays as the binding of the app's DSN and the app's adapter. |
| `shared/error-reporting/reporter.ts` | stays         | ADR-0066 §3 names it as the one file a fork replaces, and that record is closed.         |
| `shared/api/query-client.ts`         | stays         | It binds the app's error map and the app's translator.                                   |
| `shared/theme/provider.tsx`          | stays         | It binds the app's device-key prefix.                                                    |
| `test/matchers.d.ts`                 | stays         | It is under `test/`, and the app's own TypeScript program needs the augmentation.        |

The factory takes the adapter's loader as a parameter, so the `import("./reporter.js")` is still written in the app and the adapter is still a chunk of the app's build. Both apps' `DOORS` rows for the kit gained the `error-reporting` slice.

**One difference that was not a value.** The plan and the record name two differences between the session providers, the segment and the sentence. There was a third: the customer's unreachable notice carried `bg-background` and the admin's did not. The kit ships the class, so the admin's notice gained it. `packages/ui/src/styles/globals.css` paints `body` with the same token, so no pixel should differ. That was read from the stylesheet and not seen in a browser. The alternative was a class parameter, which ADR-0077 §1 does not name.

**Tests.** Unit tier, per workspace:

| Workspace       | Before | After |
| --------------- | ------ | ----- |
| `@repo/app-kit` | 48     | 75    |
| `admin`         | 537    | 532   |
| `customer`      | 296    | 290   |
| every other     | 1523   | 1523  |
| **total**       | 2404   | 2420  |

The integration tier is unchanged: `api` 823 and `@repo/db` 113.

- **Moved, 7 cases.** The four session cases both apps shared and the three error-reporting cases. Each ran twice, once per app, and now runs once in the kit.
- **Kept as the doors' smoke tests, 5 cases.** The admin keeps one session case and one error-reporting case. The customer keeps two session cases (the real boot sequence over its own handlers, and the sentence under its own catalogue) and one error-reporting case.
- **Net-new, 20 cases, all in the kit.**
  - `session-provider.test.tsx`, 5: "the session provider is bound by segment", "gives every session its own store, client and ended-handler", "interpolates the values the app passes into its own sentence", "names nothing the app did not pass", "reads the sentence from a mounted instance when there is one".
  - `principal-cache.test.tsx`, 6: "the principal cache key is the app's function" and five on the boundary's own mechanics.
  - `app-root.test.tsx`, 4. Neither app had a suite for `app/index.tsx`.
  - `composition.test.ts`, 4: "a composition root imports only shakeable barrels", its vacuity guard and two negative cases.
  - `error-reporting.test.ts`, 1: "swallows an adapter that will not load".
- Both apps' `principal-cache.test.tsx` stay where they are. They render the app's `SettingsProvider` over the settings handlers, so they prove the binding together with the subtree it keys, and they cannot move before the settings client does.

**The barrel case went red.** With `import { createLogger } from "@repo/logger"` appended to `apps/admin/src/app/index.tsx`, "a composition root imports only shakeable barrels" failed naming `@repo/logger`. It went green again with the file restored.

**What the barrel case reads.** Each app's `app/index.tsx`, the app files it imports (one hop), and the kit's own shipped sources. The kit's own barrel is exempt from the map, because `SHAKEABLE`'s docblock leaves the kit out for its `testing/setup` entry, and step 2's done-when counts eight packages with `@repo/account`.

**`pnpm size`, gzipped kB, before → after.**

| app      | js            | css         | entry         |
| -------- | ------------- | ----------- | ------------- |
| admin    | 365.3 → 364.7 | 14.6 → 14.6 | 163.2 → 162.7 |
| customer | 308.8 → 308.7 | 13.7 → 13.7 | 105.9 → 106.0 |

The vendor chunks moved by at most 0.1 kB. No row moved by 1%, so neither budget file is touched.

**Gate.** Run link by link on the tree before the review's fixes:

| Link           | Result |
| -------------- | ------ |
| `lint`         | 21/21  |
| `check-types`  | 16/16  |
| `test`         | 16/16  |
| `size`         | 4/4    |
| `format:check` | clean  |

The links were run again after the review's fixes and this note, and were green again.

**The done-when's other commands.**

- `pnpm rules:digest` wrote 2 of 3, then 0 of 3.
- `pnpm docs:check` and `pnpm i18n:check` passed inside `lint`.
- `pnpm test:e2e` passed against the running stack, on the tree before the review's fixes: admin 38 passed and 1 skipped, customer 12 passed. The fixes touched three test files and two comments.

**A flake, observed once.** In the first `pnpm check`, `users-manage.test.tsx` "keeps the operator where they are when the mint is refused" timed out at 20s waiting for its toast, while the whole unit tier ran in parallel. The file passed alone (39/39) and passed in the gate's `pnpm test`. It renders through `renderWithProviders`, which this step does not touch.

**Amendments.** None. Neither the plan nor ADR-0077 was amended.

**Review: one `adr-reviewer` pass, five findings, all minor.**

- **The admin's unreachable notice gained `bg-background`.** Declared above, and the kit's docblock now says the two copies differed in three things. Not reverted.
- **"gives every session its own store, client and ended-handler" asserted nothing about the handler.** Fixed: the case registers a handler on each of two sessions, ends the first, and asserts the first was called and the second was not.
- **The vacuity guard counted the kit's own sources**, which are always there. Fixed: it counts the app's half alone.
- **A comment in the customer's smoke test claimed a proof the test does not make.** Fixed: the comment now says the segment is proved by the assertion on the app's own client.
- **The barrel case follows one hop.** Logged, and it matters at step 2: `@repo/account` arrives through feature slices, which sit two hops from `app/index.tsx`, so the case would stay green without an `account` row in `SHAKEABLE`. Step 2's own done-when requires that row.

**Loose ends observed, not taken here.**

- `@repo/app-kit` declares no `sideEffects`, and both roots now import more of it by barrel. An honest declaration would name `./src/testing/setup.ts`. Adding the kit to `SHAKEABLE` makes step 2's count nine where the plan says eight, so it is the operator's call.
- `/frontend-conventions` still describes `app/providers/` as holding the session. The plan gives the skills to step 4.
- `AppCrash` is re-exported by both `shared/ui` doors and has had no consumer in either app since before this step.

**Pending the operator.** One thing to eyeball: the admin's "API is not reachable" screen, in both themes, to confirm `bg-background` changed nothing. It shows when the admin is loaded with the API stopped, so it needs the operator's stack.
