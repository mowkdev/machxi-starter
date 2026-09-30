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

## D31.4 — Close-out (2026-09-30)

**Built.**

- `/frontend-conventions` describes what D31 changed wherever it described the old behaviour. The app-kit row names the pending component and its two numbers. "A header click writes the URL" now reads "the header's sort control". The grid section cites ADR-0039 as carried by ADR-0080 and gains a "header cell" bullet: the name is a label, the controls run sort then filter, and tests find sorting by `"Sort by <header>"`. A new section, "The shell, the auth card and the waits", covers the drawer toggle, the auth card, the email's row and the pending state.
- `/new-resource-ui`: the page test finds sorting by `"Sort by <header>"`, and the columns note says `sortable` renders a sort button at the header cell's end.
- The generator's page template and the admin's staff and organizations pages said "their sort arrows" in a comment; they now say "their sort and filter controls".
- `.claude/rules/*.md` needed no change.
- `main` was merged in twice: to 6cf7c96 (D29.3) and to c68e34d (D29.3's notes). Both were fast-forwards.

**Corrected on the operator's decision: the static boot indicator is withdrawn.** The operator: "remove the spinner from index html files, looks ugly and unnecessary. We only meant spinners where we have data loading going on, whenever the route gets ready."

- Both `index.html` roots are empty again, and both apps' `styles.css` lost the `.boot-indicator` rules. The four files now match their state before D31.3.
- `scripts/size.mjs`: `bootIndicatorViolations` became `inlineStyleViolations`. It no longer requires the root to open with the indicator, and it still refuses any `style` attribute. `inlinePageViolations` (inline script and style elements, ADR-0074 §6) is unchanged.
- `scripts/size.test.mjs`: the case is now "the built page carries no inline style". It keeps the style-attribute refusals, directly and through `check`, and the check that both apps' `index.html` pass.
- ADR-0080 §5 was amended in place, labelled `D31.4`. The "Before the script" bullet is withdrawn, together with the `D31.3` amendment's static-indicator clauses. The index row, the plan's D31.3 lines, the "Every wait shows" digest line and `/frontend-conventions` all say so.
- What stands: the route pending state (1000 ms threshold, 500 ms minimum, both routers' default), `AppLoader`'s delay once per page load, and skeletons.

**Size re-baselined** (definition of done, item 3). Both `size-budget.json` baselines are this tree's measurement, taken from a fresh build after the indicator was removed, with a RE-BASELINED note in each. No ceiling changed.

- Admin: js 376664 → 376979, css 14890 → 15125, entry 167061 → 167192.
- Customer: js 319452 → 319471, css 14047 → 14272, entry 109078 → 109189.
- Every vendor chunk is unchanged to the byte.

**Net-new tests: 0.** The size script case was renamed and rewritten in place.

**Definition of done.**

1. **The gate.** The integration tiers — api (826) and @repo/db (118) — are accepted by the operator 2026-09-30 on the Linux evidence: the same API and db code as this tree passed both on Linux (c68e34d, D29.3's notes), and D31 changes no API or db code. On this Windows machine both tiers fail intermittently on `write CONNECT_TIMEOUT localhost:5432` against the Postgres container (four gates today), which is environmental and D29's lane measured too.
   - The four gates, recorded rather than retried:
     - Full gate at 6cf7c96: api integration 3 of 826 failed. The failures were the CONNECT_TIMEOUT, a `[200, 500]` in the concurrent handoff exchange, and the staff-delete race.
     - Run A, the api integration tier alone at 6cf7c96: 824 of 826, with one 10 s 500 plus the CONNECT_TIMEOUT.
     - Two gates at c68e34d: `@repo/db`'s `prune-sessions.int.test.ts` hit CONNECT_TIMEOUT, once at setup and once mid-file.
   - The gate that closes the step ran with no Postgres-backed test: `pnpm lint --force --concurrency=2 && pnpm check-types --force --concurrency=2 && pnpm test:unit --force && pnpm size --force --concurrency=2 && pnpm format:check`. It exited 0, green:
     - lint: 22 of 22, with the script tests at 69 of 69;
     - check-types: 17 of 17;
     - test:unit: 17 of 17;
     - size: 4 of 4, with every figure `ok` (admin js 368.1 / 383.8 kB, css 14.8 / 15.2, entry 163.3 / 170.9; customer js 312.0 / 324.2 kB, css 13.9 / 14.5, entry 106.6 / 111.3);
     - Prettier: clean.

     An earlier attempt at the same gate failed only in `//#test:scripts` › "the committed digests are what the generator produces", because the digest source had been edited and `pnpm rules:digest` not yet re-run. Regenerating fixed it.
2. **`pnpm test:unit` twice.** The gate's `pnpm test:unit --force` was the first run. The second was 17 of 17 cached, `FULL TURBO`.
3. **Size.** Re-baselined as above and confirmed by the gate's `pnpm size`. A measurement of the gate's build afterwards equals both baselines to the byte.
4. **`pnpm test:e2e` in both apps.** Pending the coordinator's run on `main` after the fast-forward.
   - The coordinator's D31.3 e2e, on `main` at e73f8fb: a full run failed one test per app, and both passed when re-run alone.
     - Admin: `onboarding.spec.ts` "an operator is invited, follows the link, and chooses their own password".
     - Customer: `organizations.spec.ts:151` "an account registers, makes a team, invites somebody, and they join".
   - Both are mail-link flows that ran after earlier e2e runs and the D31.3 measurement's logins. A rate-limit window or timing is the likely cause; that is unconfirmed.
5. **The operator's walk, in both themes.** Pending the operator, by name:
   - a grid header;
   - the drawer toggle, wide and narrow;
   - login, forgot password and reset password in both apps;
   - the customer's profile;
   - a cold load and a deep link to a record. Since the correction this means `AppLoader`, then the page, with no static indicator.
6. **Digests and docs.** `pnpm rules:digest` wrote 1 of 3, then 0 of 3. `pnpm docs:check` is clean.
7. **Test total.** **No opening total was taken when D31 opened.** That gap goes to the operator, to be accepted by name at `/ship`. The net-new tests the steps declared total 13: D31.1 4, D31.2 3, D31.3 6, and D31.4 0.
   - The closing total is 3483: this gate's unit tier, 2539, plus the Linux integration counts, api 826 and `@repo/db` 118.
   - The unit tier by package: api 809, admin 331, customer 282, contracts 246, grid 209, ui 103, account 110, db 105, app-kit 84, form 74, api-client 55, crypto 39, resource 31, logger 19, i18n 19, app-services 13, eslint-config 10.
   - The repo's script tests, 69, run under lint and are not in that figure.
   - With no opening total, the equation "opening + 13 = closing" cannot be checked.

**Review** (`code-reviewer`, one pass). It confirmed:

- the four restored files match their state before D31.3;
- `inlineStyleViolations` still refuses `style=` on any tag, and the rewritten test's refusal comes from that check;
- the baselines and headroom figures agree with the gate's measurement;
- every claim in the skills matches the code.

Two findings:

1. The refusal message in `scripts/size.mjs` cited ADR-0074 §6 for the `style`-attribute rule, but that section covers only inline script, style elements and `on*` attributes. **Fixed**: it now cites ADR-0080 §5 as amended at D31.4, beside ADR-0074 §6, and `size.test.mjs`'s assertion matches.
2. Removing the indicator check also removed the only refusal of a built page with no `<div id="root">`. **Logged, not fixed**: this is the state before D31.3, and the operator's correction asked for parity. A root-presence check would be a new rule for a later step to take if wanted.

Re-verified after the fix with `node --test scripts/size.test.mjs` (15 of 15), then `pnpm lint --force --concurrency=2` (22 of 22) and `pnpm format:check`.
