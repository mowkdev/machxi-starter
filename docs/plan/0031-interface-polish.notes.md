# D31 — Interface polish: build notes

The per-step build record of [D31](0031-interface-polish.md). It holds what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator. It is kept apart from the executable plan so that a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D31.1 — Accept ADR-0080; the grid header and the drawer toggle (2026-09-30)

**Built.** [ADR-0080](../adr/0080-interface-polish.md) accepted at the head. [ADR-0039](../adr/0039-grid-filter-ux.md) moved to `superseded by` with its delta stated: the column's name is a label, and sort is an icon button beside the filter's. The index rows for 0080 and 0039, the topic table's grid row and the ledger's window paragraph say so. `scripts/rules-digest.mjs` carries 0080's lines for what this step builds: "The grid" now cites 0080 and describes the header's controls, and a new "The drawer toggle" line has been added. The auth card and the pending state get their lines at `D31.2` and `D31.3`, when those behaviours exist.

- `@repo/grid`'s header cell (`app-grid/header.tsx`): the name is a start-aligned label on every column, end-aligned ones included. It sorts nothing and truncates when it is text. After it, in `data-slot="grid-header-controls"`, come sort then filter, both `size-7` ghost icon buttons. Sort is named `Sort by <header>` (new key `sort.trigger`, `en` and `lv`). At rest it shows a neutral `ArrowUpDown`; once sorted it shows an up or down arrow in the filter's `bg-accent` treatment, with `data-active` and `data-direction`. `aria-sort` stays on the `th`.
- `@repo/ui`'s `AppShell` renders its own `DrawerToggle` in place of the generated `SidebarTrigger`. It reads `useSidebar()` (`openMobile` when narrow, `open` when wide), shows `PanelLeftClose` or `PanelLeftOpen`, and sets `aria-expanded`. The name and the primitive's `data-*` attributes are unchanged, and `sidebar.tsx` is untouched.
- The tests that found sorting by the column's name now find it by `"Sort by <header>"`: `demo-grid.test.tsx`, the admin's `staff-page.test.tsx` and `search-serialization.test.tsx`, and `e2e/grid-state.spec.ts`.

**Net-new tests: 4.** `@repo/grid` gained three: "the column's name is a label and sorts nothing", "the sort control is named for its column and shows the direction it holds", and "the header's controls sit at the cell's end in the order sort, filter". `@repo/ui` gained one: "the drawer toggle shows and announces whether the drawer is open", which was checked red with the static `SidebarTrigger` restored.

**Where it was built.** In the worktree `.claude/worktrees/lane-D31` on `lane/D31`, on the operator's decision of the same day (§How D29 opened): the main checkout stays on `main` under the dev stack. The first two gate runs used the shared `machxi_test` and failed only in `api#test`, once on a `CONNECT_TIMEOUT` and once on 401s and extra audit rows, a sign of another process working on the same database. This diff touches no API code. On the operator's decision this lane then got its own test database, `machxi_d31_test`, named in a local, skip-worktree `apps/api/.env.test` and exported for `@repo/db`'s suites.

**Gate** (with `main` merged in: already up to date), against `machxi_d31_test`, the test task forced cold: `pnpm lint && pnpm check-types && pnpm test --force && pnpm size && pnpm format:check`. Green: test 17 of 17 tasks, size 4 of 4 with every figure `ok` (admin js 368.2 / 383.8 kB, customer js 312.1 / 324.2 kB), and Prettier clean. `pnpm rules:digest` wrote 1 of 3, then 0 of 3. `pnpm docs:check` and `pnpm i18n:check` were clean.

**Review** (`code-reviewer`, one pass), both findings fixed:

1. `truncate`'s `overflow: hidden` on the label span would clip the focus ring of a header that is a control, the selection column's select-all checkbox. It was a likely finding, since jsdom cannot paint. Fixed: `truncate` applies only when the column's header is a string. Re-verified with `turbo run lint check-types test --filter=@repo/grid --filter=admin --force` (30 of 30) and `pnpm format:check`.
2. The e2e case was titled "a header click sorts". It was renamed "the header's sort control sorts".

**Pending.**

- The merge to `main` and `pnpm test:e2e` in the admin are the coordinator's. The dev stack serves the main checkout, so the e2e sees this change only after the merge. The step is done when that passes.
- Pending operator acceptance (browser-only geometry): the grid header, and the drawer toggle wide and narrow, in both themes.
- The commit `docs(plan): open D29` (7bb1f06) landed on `lane/D31` rather than `main` before the worktree move, and reaches `main` with this lane's merge.

## D31.2 — The auth card and the email's row (2026-09-30)

**Built.** [ADR-0054](../adr/0054-design-language-instrument.md) moved to `superseded by` [ADR-0080](../adr/0080-interface-polish.md) at the head, with its delta stated: §7's login is one centred card on a gradient ground, and the `D11.7` column and hairline ground retire. The topic table's design-language row and the ledger's window paragraph say so. 0054 has no row of its own in the index's tables, only its D11 history bullet, so no status column moved; that gap predates this step. `scripts/rules-digest.mjs` gains "The auth card" line (0080, 0054), and "Tokens" now reads 0054 as carried by 0080.

- `@repo/app-kit`'s `AuthLayout` renders one `Card` at §7's 400px cap, with `p-5 gap-4` over the primitive's `py-6 gap-6` through `cn`. The card holds the brand line, the heading, the lede and the page's body (`data-slot="auth-body"`, a block, so the pages' `mt-4` ways out keep their spacing). The card is centred on both axes on `bg-background bg-linear-to-br from-background to-primary-tint`. The inline hairline `style` is gone.
- Every page under the layout dropped its own `Card`: admin login, forgot-password, reset-password and onboarding; customer login, register, forgot-password, reset-password, verify-email, confirm-email, impersonate, auth-google and accept-invitation. Where the card carried `flex flex-col gap-4` (with `items-start` on impersonate), a plain `div` keeps it. Comments that placed the ways out "under the card" now say "under the form".
- The customer profile's "Change email" left the card header (`CardAction`) for the email's own row (`data-slot="account-email-row"`). The row is flex and `justify-between`, with the address in a `<dl>` of its own at the start and the `outline` button at the end. It is still offered only when `hasPassword` is true. Member-since and last sign-in keep the two-column `<dl>` below it.
- Both apps' auth-layout suites and the admin's `e2e/login.spec.ts` assert the new geometry. The spec checks a 400px card whose centre is within 1px of the ground's on both axes, one `linear-gradient` with neither stop transparent, and the unchanged 38px controls, 28/34 title and 13px control type.

**Amended.** ADR-0080 §3, labelled `D31.2`: the card is the layout's. The pages' ways out (sign in, recovery, sign-up, Continue with Google) sit under the controls inside the one card, because with the heading in the card the `D11.7` reading "a card holds only the controls" no longer divides anything. The card keeps §7's 400/20/16 rungs, and the gradient runs to the bottom right over `--background`.

**Net-new tests: 3.** `@repo/app-kit` gained two: "the auth layout centres one card on a gradient drawn from tokens", which was checked red with the `D11.7` hairline layout restored, and "renders no lede element when the screen has none". The customer gained one: "the email's change action sits on the email's row". The admin's three auth-layout cases and the customer's four were rewritten in place with the same counts.

**Gate.** `pnpm check` was green, 17 of 17. The first full gate ran with `main` merged in (up to date at 25938db), against `machxi_d31_test`: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` exited 0. Size was `ok` on every figure: admin js 368.1 / 383.8 kB and entry 163.2 / 170.9 kB; customer js 311.9 / 324.2 kB and entry 106.5 / 111.3 kB. Prettier was clean.

`main` moved twice before the step could close: to 71c1504 (D29.1), then to 0bbc47e (D29.2). Each was merged in, and the conflicts were resolved by the row: the ledger's window paragraph both times, and the index's design-language topic row the second time. `pnpm rules:digest` wrote 0 of 3 both times. **The gate that closes the step ran over 0bbc47e plus this diff**, against `machxi_d31_test`, with the turbo tasks at `--concurrency=2` to ease memory: `pnpm lint --concurrency=2 && pnpm check-types --concurrency=2 && pnpm test && pnpm size --concurrency=2 && pnpm format:check`. It exited 0: lint 22 of 22, check-types 17 of 17, test 17 of 17, and size 4 of 4 with the same figures as above (admin css 14.8 / 15.2 kB, customer css 13.9 / 14.5 kB). Prettier was clean.

**Flakes on the way to it, recorded rather than fixed** (none is in code this step touches):

- The first re-run over 71c1504 was killed by the harness under memory pressure. The partial log showed `@repo/resource#lint` exiting with 0xC0000142, a Windows process-start failure.
- The retry failed one API case: `staff-delete.int.test.ts` › "survives two super admins deleting each other at once". Exactly one delete landed, but the loser's status was neither `409` nor `401`, and the log did not say what it was. Run alone five times in a row, the file passed every time, 10 of 10.
- Two runs over 0bbc47e failed in `@repo/db`'s `prune-sessions.int.test.ts` with `write CONNECT_TIMEOUT localhost:5432`. The first failed on `resetSchema`'s first query. The second got past setup and one test, then timed out on the owner client's per-test truncate. D29 saw the same timeout in its own lane, including on a gate it ran alone. The operator restarted Docker, and the next run was the green one above. So the timeouts read as the one Postgres container going bad, not as either lane's code, and the staff-delete loss is plausibly the same pressure.

**Review** (`code-reviewer`, one pass): no correctness defects. One low, uncertain test-strength finding was fixed: the e2e did not prove both gradient stops were generated, because a missing `from-*`/`to-*` falls back to transparent and still serialises as a `linear-gradient`. It now also asserts that the gradient contains no `rgba(0, 0, 0, 0)`.

**Pending.**

- `pnpm test:e2e` in both apps is pending the coordinator's run on `main` after the fast-forward. The dev stack serves the main checkout, so the e2e sees this change only after the merge. The step is done when that passes.
- Pending operator acceptance (browser-only geometry): login, forgot password and reset password in both apps, and the customer's profile email row, in both themes.
- D31.1: the coordinator's admin `pnpm test:e2e` on `main` at 25938db was green, 38 passed and 1 skipped (the built-image smoke).

## D31.3 — Every wait shows that it is waiting (2026-09-30)

**Built.** [ADR-0052](../adr/0052-grid-and-admin-followups.md) moved to `superseded by` [ADR-0080](../adr/0080-interface-polish.md) at the head, with its delta stated: §Alternatives' rejected pending route component is taken, behind a threshold, and §Felt navigation with the shell's indicator stands. All three of 0080's parents have now moved. The index's 0052 and 0080 rows, a new topic row "Felt navigation — the indicator and the pending state", and the ledger's window paragraph say so. `scripts/rules-digest.mjs` gains the line "Every wait shows" (0080, 0052).

- `@repo/app-kit` gains `router/pending.tsx`: `AppPending` (a spinner and `common:loading.pending` in one polite status region, the primitive's own role and label stripped) and the two numbers, `PENDING_MS = 1000` and `PENDING_MIN_MS = 500`. Both apps' `createRouter` take them as `defaultPendingComponent`, `defaultPendingMs` and `defaultPendingMinMs`, through the `shared/ui` door.
- `AppLoader`'s delay is counted from the page load (`performance.now()`) instead of from each mount. The second boot gate finds the delay spent and shows the loader at once, and a gate that opened early leaves the next only the rest of it.
- Both `index.html` roots open with a static indicator: a `data-boot-indicator` `role="status"` element holding lucide's loader arc. The indicator is styled by plain rules in each app's `styles.css`, which use the `--muted-foreground` token and a CSS delay of the same 250 ms, and is replaced by the first render.
- `scripts/size.mjs` gains `bootIndicatorViolations`, run by `check` after the inline-code check: the built root must open with the indicator, and no element on the page may carry a `style` attribute.
- `common:loading.pending` is in both apps' `en` and `lv` ("Loading…", "Notiek ielāde…"), and both drift checks name it in `DYNAMIC` beside `loading.starting`.

**Measured: threshold 1000 ms, minimum 500 ms, kept at the router's defaults.** The method was a Playwright script (chromium, headless) against the running dev stack, which serves the main checkout at 50e7b74, the same commit as this lane's head. It signed in once to each app. For each navigation it clicked in the page, and an in-page `MutationObserver` timed how long the shell's indicator (`role="progressbar"`) was on screen, which is the router's pending window. A `requestAnimationFrame` loop timed the click until the URL matched and the bar was gone. The script ran twice; the second run's figures are below.

- Admin sidebar walk (Staff, Users, Organizations, Dashboard), three passes: the indicator was on screen for 12–157 ms, and click to settled took 98–298 ms.
- Admin record opens (Staff and Users, "Edit" from the row menu; the loader is the detail's `ensureQueryData`), three passes: the indicator was on screen for 150–223 ms. Click to settled took 570–680 ms, which includes Playwright's own wait on the menu item.
- The customer sidebar (Home, the only link for this fixture), three passes: 22–27 ms on screen, 81–87 ms click to settled.
- Cold deep links, navigation start to the content: the admin's staff record dialog 836–883 ms, and the customer's `/account/profile` heading 383–841 ms. Most of that is the boot gates, which `AppLoader` and the static indicator cover.
- The first run agreed: record opens 138–183 ms on screen.

The longest router-pending window was 223 ms, so a 1000 ms threshold sits more than four times above it: an ordinary navigation stays the indicator's alone, and only a real stall reaches the pending state. Nothing measured argued for moving either number. ADR-0080 §5 records them in a labelled amendment.

**Amended.** ADR-0080 §5, labelled `D31.3`: the two numbers and the measurement behind them; that they live in the kit, beside the component; that `AppLoader` counts from the page load; that the static indicator waits the same quarter-second in CSS; and that `pnpm size` checks the root and refuses `style` attributes.

**Net-new tests: 6** — `@repo/app-kit` 4, the admin 1, the scripts 1.

- `@repo/app-kit`: "the pending state is visible and announced" and "waits a second before it appears and then holds half of one" in `pending.test.tsx`; "a second boot gate shows the loader without a second delay" and "a gate that opened early leaves the next one only the rest of the delay" in `app-loader.test.tsx`. The loader's existing cases now pin `performance.now()` to the fake clock. Both new loader cases were checked red against the previous `AppLoader`.
- The admin gained "a route whose loader outlasts the threshold shows the pending state" in `navigation-indicator.test.tsx`. It runs in real time and holds the detail response past the threshold. It was checked red with `defaultPendingComponent` removed from the admin router, where it failed on `Unable to find an element with the text: Loading…`.
- `scripts/size.test.mjs` gained "the built page's root carries the boot indicator and no inline style". The fixture page's root now carries the indicator.

**Gate.**

The gate ran once with `main` merged in (up to date at 50e7b74), against `machxi_d31_test`: `pnpm lint --concurrency=2 && pnpm check-types --concurrency=2 && pnpm test && pnpm size --concurrency=2 && pnpm format:check`.

- Lint passed, 22 of 22, and check-types passed, 17 of 17.
- `pnpm test` passed 13 of 17 tasks, with `Failed: api#test`. The API's integration tier failed at global setup (`packages/db/src/reset.ts:45`, its first query, `drop schema if exists public cascade`) on `write CONNECT_TIMEOUT localhost:5432`, before any integration test ran. Every other suite was green, including the API unit tier (48 files, 803 tests), app-kit 84, admin 331 and customer 282.
- `pnpm size` and `pnpm format:check` did not run after the failure. Both were green when run separately just before it. Size was `ok` on every figure: admin js 368.2 / 383.8 kB and entry 163.3 / 170.9 kB; customer js 312.0 / 324.2 kB and entry 106.6 / 111.3 kB. Prettier was clean.
- Earlier, `pnpm check`'s lint and check-types were green, 39 of 39, and so was `pnpm test:unit`, 17 of 17. `rules:digest` wrote 2 of 3 digests, then 0 of 3.

**Accepted by the operator 2026-09-30 on this partial gate: the API integration tier's failure is the environmental connection timeout D29 also hit (D29.3, same window); D31.3 touches no API or @repo/db code. The integration tier stays owed at the definition of done (D31.4 / /ship).**

**Review** (`code-reviewer`, one pass): no blocking findings, and two low ones, both fixed.

1. Under `pnpm dev`, Vite injects the stylesheet from the script, so the static indicator shows unstyled (a still spinner in the corner) and then re-hides for 250 ms. The built page links the CSS in its head, so production is unaffected. Fixed: the stylesheet comment in both apps now names this as an accepted dev-only flash, since hiding it without the sheet would take inline paint.
2. `pending.test.tsx`'s one-status assertion could not see the `aria-hidden` spinner, so it would have passed with the primitive's `role="status"` left on. Fixed: it counts with `{ hidden: true }`.

**Pending.**

- `pnpm test:e2e` in both apps is pending the coordinator's run on `main` after the fast-forward. The dev stack serves the main checkout, so the e2e sees this change only after the merge. The step is done when that passes. `e2e/navigation.spec.ts` holds a record's detail open for less than the threshold, so the bar and the list behind it should still hold.
- Pending operator acceptance (browser-only): a cold load and a deep link to a record in both apps, showing the static indicator then `AppLoader` with no blank between, in both themes; and a navigation held past a second, showing the pending state in the outlet.
- D31.2: the coordinator's `pnpm test:e2e` on `main` at 50e7b74 was green, with admin 38 passed and 1 skipped, and customer 12 passed.
