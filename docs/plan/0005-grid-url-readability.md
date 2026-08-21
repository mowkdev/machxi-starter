# D5 — Grid URL readability

- Status: **in progress**, opened 2026-08-21 — the day D4 shipped ([ADR-0025](../adr/0025-deliverables.md) rule 5: one at a time). The amendment window is open on **ADRs 0043–0044 only**; ADRs 0001–0042 stay frozen.
- Steps: `D5.1` – `D5.5`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: the address bar of the two grid screens. The URL is the most public artifact this panel produces — it is what an operator copies into a message when they say "look at this" — and D4 made it load-bearing in three separate places (list state lives there, record identity lives there, the applied-filters bar renders _from_ it and from nothing else) without ever making it legible. Two defects, one theme:

**The list URL is a JSON blob.** [ADR-0034](../adr/0034-server-state-and-notifications.md) §61 decided that the browser's serialization and the API's wire form "need not match", and left the browser holding TanStack Router's JSON encoding of the parsed shape. `D3.8` fixed the empty case — `/staff` is the canonical first page — but the moment anything is applied:

```
/staff?sort=%5B%7B%22field%22%3A%22email%22%2C%22direction%22%3A%22desc%22%7D%5D
      &filters=%5B%7B%22field%22%3A%22status%22%2C%22op%22%3A%22eq%22%2C%22value%22%3A%22active%22%7D%5D
```

The same state, in the query language [ADR-0014](../adr/0014-pagination-filtering-sorting.md) defined for this repository and `shared/api/list-params.ts` already writes for every request the panel sends, is `?sort=-email&filter[status]=active`. There is no third syntax to design here: the good one exists, is tested, and is pointed at axios instead of at the router.

**Record URLs carry the whole list.** [ADR-0040](../adr/0040-record-routes-and-edit-surfaces.md) puts `retainSearchParams` on the list parent so that closing a record returns the operator to the page they opened it from — the right requirement, answered by stapling the sender's offset, page size, sort and filters onto `/staff/$id`. "Look at this account" should be a link to an account, not to somebody's grid.

**`apps/admin` and `packages/contracts` only.** No endpoint, no zod schema the API validates with, no migration: `listQuerySchema` is untouched and every request the panel sends carries the same parameters it carries today — spelled with literal brackets rather than `%5B`, which is the same query once decoded and is checked against the API rather than assumed. That makes `pnpm test:postman` a regression check rather than a target — the same claim D4 made, and the same evidence closes it.

Everything here builds on decisions that stand unchanged: the URL owns view state and preferences own ergonomics ([ADR-0041](../adr/0041-grid-preferences.md)), the list-query language is defined once in `@repo/contracts` (ADR-0014, [ADR-0023](../adr/0023-shared-contracts-package.md)), the applied-filters bar renders from the URL and never from the configs ([ADR-0039](../adr/0039-grid-filter-ux.md)), a record is a route and `grid.editSurface` picks its shell without changing the URL (ADR-0040), and FSD layering with downward-only imports ([ADR-0032](../adr/0032-admin-app-architecture.md)).

**Gate.** ADRs [0043](../adr/0043-readable-list-search-params.md) and [0044](../adr/0044-record-routes-without-list-state.md) are `proposed`, and opening this deliverable did not change that. Each is accepted at the head of its own implementing step (ADR-0025 rule 3) — the per-step acceptance D4 ran on, which is the stricter reading and costs one edit per step. **`D5.1` and `D5.2` are gated on ADR-0043; `D5.3` is gated on ADR-0044.** Both supersede rather than amend, because their parents shipped with D3 and D4 and are frozen (ADR-0024 rule 1): ADR-0043 carries the whole of ADR-0034, ADR-0044 the whole of ADR-0040.

Each step names the ADRs that govern it. Read them before implementing — they carry the reasoning, this file carries the work. Every step ends green on `pnpm lint && pnpm check-types && pnpm test` and a conventional commit.

## Build order

### ~~1. One codec for the list-query language~~ — **done 2026-08-21**

**ADRs:** [0043](../adr/0043-readable-list-search-params.md) (accept at the head of this step), [0014](../adr/0014-pagination-filtering-sorting.md), [0023](../adr/0023-shared-contracts-package.md)

First because everything after it is wiring, and because the half that does not exist is the half a compiler cannot cover for. The language has a **writer** — `apps/admin/src/shared/api/list-params.ts`, which turns a parsed `ListQuerySearch` into ADR-0014's wire string for the axios `paramsSerializer` — and no **reader**: the API's reader is `listQuerySchema`, which parses the wire form into `ListQuery` and is deliberately not an involution (the `D3.5` finding recorded in ADR-0034, and the reason `listQuerySearchSchema` exists at all).

The writer moves to `@repo/contracts`, beside the schemas that define the language, and gains its inverse. `parseListSearch` reads a `URLSearchParams` into the parsed shape; `stringifyListSearch` writes it back; the two are tested as a round trip rather than as two functions that look right. Contracts keeps its one dependency (ADR-0023: zod, and nothing else) — this is pure string work over `URLSearchParams`, which is why it can live there at all.

Three shapes carry information the string does not, and each is recovered from the operator rather than guessed: `in` is a comma list, `null` is a boolean, and a bare `filter[x]=v` is `eq` — the shorthand ADR-0014 defines and `appendFilter` already writes.

**Done when:** `parseListSearch(stringifyListSearch(state))` equals `state` across a table covering every ADR-0014 operator, a multi-field sort with both directions, an `in` list, a `null` presence filter, an absent `q` and an empty filter set; `stringifyListSearch` reproduces today's `serializeListParams` output for every one of those inputs **up to the bracket spelling** — the canonical string writes `filter[status]` literally where `URLSearchParams.toString()` writes `filter%5Bstatus%5D`, which is the same query decoded and is proved so by an API-side test rather than by reasoning (ADR-0043 §The canonical string); `apps/admin` imports the contracts codec and `shared/api/list-params.ts` is gone; `@repo/contracts` still declares only `zod`.

**Closed.** ADR-0043 accepted at the head of the step, then built: `packages/contracts/src/list-search.ts` — `stringifyListSearch`, `parseListSearch` and the `isListSearchState` predicate the axios adapter branches on — with the writer moved out of `apps/admin` and the reader written for the first time. The suite is the round trip over a ten-state table (`listQuerySearchSchema.parse(parseListSearch(stringifyListSearch(state)))`), plus the canonical string asserted **as one string** rather than parameter by parameter, because the readability of the whole is the decision and a per-parameter assertion passes just as happily on `%5B`.

Two things the step changed that its own text had not anticipated, both recorded rather than folded into "done":

**`shared/api/list-params.ts` did not disappear; it emptied out.** The Done-when above says the file is gone, and what makes sense is that the _syntax_ is gone from it — no sort joining, no bracket keys, no ISO instant. What remains is an axios adapter (one structural branch: a list query goes through the canonical writer, an ordinary parameter bag does not) and `toListQuery`, the `exactOptionalPropertyTypes` hand-off that exists because `q?: string | undefined` is not `q?: string`. Deleting the file would have moved those two into an unrelated module to satisfy a sentence; the requirement it was really making — **no list-query syntax in the app** — is met. `toListParams` did go: renaming `filters` to the `filter` parameter is a fact about ADR-0014, not about axios, so it belongs to the codec, and the entity APIs now hand the parsed query straight to the client.

**One test assertion moved, in the tier that sees a real request URL.** `entities/staff/__tests__/staff.queries.test.tsx` pinned `filter%5Bstatus%5D=active` through MSW, and it now pins `filter[status]=active`. That is the change landing end to end rather than a chore — it is the only place in the admin suite that looks at the characters a request actually carries — and it is worth separating from `D5.4`'s claim that the MSW tier should not move: that claim is about handlers in `src/mocks`, which are untouched.

**The bracket equivalence is proved, not argued.** `apps/api/test/list-query.int.test.ts` gains one test that builds a query string with `stringifyListSearch`, sends it raw to `/api/v1/admin/users`, and asserts the response equals the one produced by the same query percent-encoded — same rows, same `meta.filters`, same total. It is test-only and deliberately outside the deliverable's `apps/admin` + `packages/contracts` line, because the claim is about Express and `qs` and could not honestly be checked anywhere else.

**Verified:** `pnpm lint`, `pnpm check-types` and `pnpm format:check` clean. `pnpm test` green at `0 cached, 8 total` — contracts 151 (+21), admin 414 (unchanged in count; one assertion rewritten), API integration 434 (+1, the bracket test), and the API's non-integration tier at 446. The full gate ran against the live Postgres, so the integration tier really executed. `pnpm test:postman` not run here — D5 changes no API surface and it is item 6 of the deliverable's own checklist.

### ~~2. The router speaks the API's query language~~ — **done 2026-08-21**

**ADRs:** [0043](../adr/0043-readable-list-search-params.md), [0032](../adr/0032-admin-app-architecture.md), [0034](../adr/0034-server-state-and-notifications.md) (superseded by 0043)

The admin router is created with `parseSearch` / `stringifySearch` built from `D5.1`'s codec. The seam is the **router**, not the route: `validateSearch` has to be an involution — TanStack Router round-trips its own validated output back into the URL on every navigation, which is the whole of the `D3.5` finding — so the shape the routes hold must stay exactly `ListQuerySearch` and the change must live in the layer that turns that object into characters.

The codec knows exactly the names `LIST_QUERY_PARAMS` defines and hands **everything else to the router's default behaviour**, so `/login?redirect=/staff` is untouched and a future non-list search param needs no permission from this decision.

Nothing downstream moves in this step, and it is finished by demonstrating that rather than by asserting it: `useSearch` still yields a validated `ListQuerySearch`; `listSearchDefaults` + `stripSearchParams` still strip a param equal to its default, so `/staff` stays bare; the query key still derives from the object, so the cache is keyed identically; and every pure function in `shared/grid/list-state.ts` — `withFilters`, `withSearch`, `clearedFilters`, `RETAINED_SEARCH_PARAMS` — is untouched.

**The tests go at the seam, not beside it.** This is `D4.7`'s lesson spent rather than merely quoted: `q` became unclearable in a repository where the pure functions were right and the suites asserted _setting_ a term instead of clearing one, so the defect lived entirely between two correct pieces. `D5.1`'s round trip is necessary and not sufficient. This step drives a **real router**: apply, read `window.location.search`, then mount a fresh router at that URL and assert the grid it produces.

**Done when:** applying a sort, one filter of each of the four kinds, a search term and a page change writes `?offset=40&limit=50&sort=-email&filter[status]=active&q=ann` — the API's spelling, in the address bar; a router mounted cold at that URL renders the same grid; `/staff` is still bare on the first page with default size and no filters; `/login?redirect=…` round-trips unchanged; back and forward still walk grid states; the applied-filters bar and the hot-filter stances read the same URL they always did.

A D4-era bookmark carrying the JSON form does **not** parse, deliberately — ADR-0043 §Consequences says so rather than carrying a reader for a shape nothing will ever write again. The only URLs of that form in existence are in a developer's own history.

**Closed.** `parseSearch` / `stringifySearch` on `createAppRouter`, built from `D5.1`'s codec in a new `shared/api/search-params.ts` — the address bar's adapter, sitting beside `list-params.ts`, which is the same language for axios. No route changed: `validateSearch: listQuerySearchSchema` stands, `useSearch` still yields the same validated object, the query keys still derive from it, `stripSearchParams` still strips, and every pure function in `shared/grid/list-state.ts` is untouched. A filtered, sorted, searched grid now reads `?sort=email&filter[email][like]=%25ada%25` where it read forty percent-encoded characters of JSON.

**What the wiring found**, amended into ADR-0043 rather than worked around: **`stripSearchParams` runs before serialization**, so what reaches `stringifySearch` on a list route is not a whole `ListQuerySearch` but whatever survived the strip — one key, for a first page with a sort on it. `D5.1`'s writer always wrote `offset` and `limit`; it now writes **the keys it is given and no others**, which is what lets one function serve both axios (every key present) and the router's remainder, and is what keeps `/staff` the canonical first page instead of `/staff?offset=0&limit=20`. The adapter adds one rule of its own: a list-named value of the wrong shape **falls through to the router's own serializer rather than being dropped**, because "the router only serializes what it validated" is exactly the kind of true-today assumption that loses a filter silently.

**The tests are at the seam, and were checked by breaking it.** `app/__tests__/search-serialization.test.tsx` drives the real route tree through `renderApp` — a header click, a filter dialog, the search box — and asserts `router.state.location.searchStr`, the string a browser would show, **as one string**: a per-parameter assertion would have passed just as happily on the JSON encoding, which is the point. It also loads a link cold and asserts the request it produces, reads a hand-typed URL with `%5B` in it, and checks that Back still walks grid states. Detaching the two router options and re-running left **4 of its 7 failing** — the four that are about the new spelling — which is what says the suite is testing this change and not the app in general; the other three (a bare first page, `q` clearing, the login redirect) pass either way and are regression guards, not evidence. `shared/api/__tests__/search-params.test.ts` covers what neither tier does: the delegation that bounds a global codec's blast radius.

**Verified:** `pnpm lint`, `pnpm check-types`, `pnpm format:check` clean. `pnpm test` green at `0 cached, 8 total` — admin **427 (+13)**, contracts 152 (+1), API integration 434 unchanged, API non-integration 446. `pnpm test:postman` not run: no API surface changed, and it is item 6 of the deliverable's checklist.

**Walked in Chrome against the dev stack**, after the operator reported still seeing JSON URLs — which was true, and was a **stale Vite module**, not the code: this step's own isolation check restored `router.tsx` with `mv` from a backup, which put back an **older mtime** than the stripped version the dev server had already transformed, so the watcher never saw it return. `touch` on the file was the whole fix. Worth recording because nothing about it is visible from a test run: every suite was green against a source file the browser was not being served.

What the walk then confirmed, which jsdom cannot: a real address bar keeps the brackets literal rather than re-encoding them — `/staff?sort=email`, then `/staff?sort=email&filter[email][like]=%25admin%25` after a header dialog — with the `%` of the LIKE pattern still encoded beside them; and Clear all dropped the filter while the sort stood, which is ADR-0039's rule in a browser.

**Still owed by `D5.4`'s walk:** item 4, the query string pasted onto `/api/v1/admin/staff`. The browser tool blocks reading query strings out of `performance` entries, so the client-to-API half rests on `D5.1`'s integration test rather than on something seen.

**One finding, amended into ADR-0043 rather than fixed here.** A D4-era JSON URL does not fail at the router: the blob is read as a single sort token, the schema accepts it, and the **API** refuses the nonsense field — so the refusal costs a round trip and arrives as the generic `VALIDATION_ERROR` sentence, which is written for a form and reads oddly under a grid. The decision ("stale bookmarks are refused") stands; the message is a pre-existing gap in `ERROR_MESSAGES` that belongs to the deliverable owning operator copy.

### ~~3. Record routes carry no list state~~ — **done 2026-08-21**

**ADRs:** [0044](../adr/0044-record-routes-without-list-state.md) (accept at the head of this step), [0040](../adr/0040-record-routes-and-edit-surfaces.md) (superseded by 0044), [0032](../adr/0032-admin-app-architecture.md), [0038](../adr/0038-grid-selection-and-capabilities.md)

`retainSearchParams` comes off the list parent and `/staff/$staffId`, `/staff/new` and their `users` mirrors become bare paths.

The consequence has to be **answered rather than shipped**, and it is the reason ADR-0040 retained the params in the first place: for the `dialog` and `drawer` surfaces the parent renders the grid _and_ the `Outlet`, so the grid behind the overlay reads the **parent route's search** — the record route's URL is the same URL. Strip the params with nothing in their place and a drawer floats over page one of an unfiltered grid, and closing it lands the operator there.

So the list state moves out of the URL and into the navigation's **history state**: the entry point carries it, the close navigation restores it into the URL, and it survives a reload because `history.state` does. A record URL that arrives **cold** — the shared link, which is the entire point of the change — has no state, renders the bare list behind it, and closes to the bare list. That is the honest answer rather than a degradation: the recipient never had the sender's view, and the previous behaviour only appeared to give it to them because the sender's view was stapled to the link.

One helper in `shared/grid` owns both halves so neither resource restates it, and `shared/grid` still never learns a resource name (ADR-0038's rule).

**Done when:** opening a record from filtered page 3 gives `/staff/<id>` with nothing after it; the grid behind the drawer is still on filtered page 3; Cancel, Escape, the overlay click, Back and the post-save close all land on filtered page 3; a reload with the record open restores the record **and** the grid behind it; a cold `/staff/<id>` in a fresh browser session loads the record over a bare list and closes to `/staff`; `/staff/new` is bare too; the `page` surface — which unmounts the grid — behaves identically, since it has no grid behind it to preserve and the close navigation is the same call.

**Closed.** ADR-0044 accepted at the head of the step, ADR-0040 moved to `superseded by`, and then built: `retainSearchParams` off both list parents, `RETAINED_SEARCH_PARAMS` deleted with it, and `shared/grid/record-navigation.ts` carrying the list state as **history state** instead — `openState` for the four entry points (two row-action `Edit`s, two Create links), `closeSearch` for the six close paths (four surfaces, two error surfaces). `/staff/<id>` and `/staff/new` carry the record and nothing else.

**Two defects found by this step's own tests, both in the seam the ADR warned about.**

`location.search` **is not** `useSearch`. The first implementation read the snapshot from `useRouterState({ select: (s) => s.location.search })`, which yields what the URL _literally carried_ — `{}` on a bare `/staff` — while `useSearch({ from })` yields the route's _validated_ object. So the carrier handed the grid a state with no `sort` and no `filters`, and the grid died on its first `.map`. The doc comment written beside it asserted the opposite ("on a list route they are the same thing"), which is the kind of sentence a test is for. The carrier now normalises through `listQuerySearchSchema` with `safeParse`, because it runs on every route and a screen with no list state must not throw its way out of a render.

The **stale-closure** one, caught by `react-hooks/exhaustive-deps` rather than by a test: a row-action list is a `useMemo`, so a carrier rebuilt on every render is either left out of its dependencies — capturing the list state as it was when the actions were built, and carrying _that_ into a record opened three pages later — or included and rebuilding constantly. The carrier is memoised on the location's own values, which changes exactly when the answer does. Both are amended into ADR-0044.

**Tested at the seam, and isolated in two directions.** Five new cases in `app/__tests__/record-routes.test.tsx`: a record opened from a filtered page has a bare URL, the grid behind it stays on that view, a cold record link closes to the bare list, the create surface is bare too and still returns, and the drawer resource behaves identically. Re-attaching `retainSearchParams` to the staff route fails two of them; bypassing `useCarriedListState` in the page fails the third. That second check is why that assertion reads `screen.getByLabelText("Rows per page")` rather than `router.state.location.state.list` — **the first draft asserted the carrier's contents, which passes just as well with the grid ignoring it**.

**Verified:** `pnpm lint`, `pnpm check-types`, `pnpm format:check` clean. `pnpm test` green at `0 cached, 8 total` — admin **431 (+4 net: five added, one deleted with its subject)**, contracts 152, API 434/446 unchanged.

**Walked in Chrome against the dev stack**, on the operator's own report. From `/staff?limit=50&sort=-lastName`, opening a record gave **`/staff/01a01599-…` and nothing after it**, with the grid behind still at 50 rows and the Last-name-descending order. `history.state` carries `list`, seen directly. A real `location.reload()` restored **both** halves — the dialog and the grid behind it — which is the claim about `history.state` surviving a reload, and the one thing the jsdom tier cannot show. Cancel returned to `?limit=50&sort=-lastName`. A cold link to the same record rendered the bare list behind it, exactly as §Consequences says it should.

### ~~4. The sweep — both resources, both changes, and the documents that describe a URL~~ — **done 2026-08-21**

**ADRs:** [0043](../adr/0043-readable-list-search-params.md), [0044](../adr/0044-record-routes-without-list-state.md), [0036](../adr/0036-admin-testing-strategy.md), [0035](../adr/0035-config-driven-resource-ui.md)

`staff` and `users` walked through both changes on all three edit surfaces, and then the prose. **The MSW tier should not move at all** — the request the client sends is unchanged, byte for byte, because `D5.1` pinned the writer's output before anything was rewired — so a handler that needs editing in this step is a finding about `D5.1`, not a chore. (The handlers live in `src/test/msw/handlers`, not `src/mocks`.)

What does move is every document that shows a URL or explains the two serializations: the `/frontend-conventions` and `/new-resource-ui` skills, `CLAUDE.md`'s frontend bullet, and the doc comments in `shared/grid` and `shared/api` that still describe a browser URL holding TanStack Router's encoding. This is where the D4 close-out's finding is spent: a decision asserted in an ADR and denied in the file an agent reads first is not a decision, it is a note.

**Done when:** both resources pass the `D5.2` and `D5.3` assertions on all three `editSurface` values; `git diff` touches no file under `src/test/msw` (the step's first draft said `src/mocks`, a directory this app does not have); no document in the repository describes the browser URL as carrying a serialization different from the API's; the resource-UI checklist tells the next resource nothing it would have to unlearn.

**Closed.** The prose first: `/frontend-conventions` (server state now cites ADR-0043 and carries the one-serialization rule, the record bullet carries ADR-0044's carrier and the `useCarriedListState` trap, the preferences taxonomy is three-way), `/new-resource-ui` (no `retainSearchParams` in the route checklist, `state={openState}` on the create link, `useCarriedListState` in the page recipe, and the page-test line now asks for a URL asserted **as one whole string** and a record assertion made on what the grid renders), both skill descriptions re-ranged to 0030–0044, `CLAUDE.md`'s frontend bullet, and the two doc comments the step named — `shared/api/client.ts`'s serializer note and `shared/grid/list-state.ts`'s header, which now says explicitly that these functions are about the _shape_ of list state and never its spelling.

**The MSW tier did not move**, which was the step's own falsifiable claim: `git diff` over `apps/admin/src/test` is empty. `D5.1` pinned the writer's output before anything was rewired, so every handler still parses what it always parsed.

**Coverage added:** the other resource's URL through the router, so ADR-0043's claim is exercised on both screens rather than on the one that was walked. `D5.3`'s suite already covered both.

**One deviation, taken deliberately.** "All three `editSurface` values" is not fully met and cannot be met honestly by this step: no resource declares `page`, and flipping the config in a test would require module mocking, which ADR-0036 forbids ("every dependency is passed, never module-mocked"). What the URL claims actually depend on is surface-independent by construction — the record path is identical across the three, and the close navigation is the same shared function — and the `page` shell's own behaviour is covered by `shared/form/__tests__/app-form-surface.test.tsx`. **The gap is the config path into `page`, and it is unchanged from D4**, which recorded it at `D4.2` and again at `D4.6`; D5 neither widened nor closed it. Naming it here rather than letting the checkbox pass.

**Two stale-citation decisions**, both recorded rather than silently taken. There are 159 references to ADR-0034 and ADR-0040 across 83 files in `apps/admin`, almost all of them citing rules that **carried over unchanged** into their successors. They were left alone: a blanket rename would turn accurate sentences like "ADR-0034, amended D3.7" into false ones, since 0043 has no D3.7 amendment — it folded that amendment into its body. A reader following any of them lands on a file whose first line says `superseded by`, which is one hop and self-documenting. What _was_ fixed is every comment that **describes** the old behaviour rather than merely citing it — and after this step `git grep` finds exactly two mentions of `retainSearchParams` in the app, both deliberate history in the code that replaced it.

**An incidental finding, and it is about this repository's test margins rather than about D5.** Adding one test tipped `staff-page`'s preferences-isolation case over the global 15s timeout — but only under the whole suite running in parallel; it takes ~3.7s alone. It is the heaviest test here, mounting the app twice and driving a real pointer drag. It now carries an explicit `30_000`, measured rather than guessed, so the diagnosis stays at the test that needs it instead of loosening the default for every suite. A second observation belongs beside it: `pnpm check` — the parallel loop, not the gate — failed _worse_ on an overloaded machine, with individual tests reporting 274s. That is contention, not correctness; the gate (`turbo run test --concurrency=1`) is green, and this is the first time the difference between the two commands has mattered.

**Verified:** `pnpm lint`, `pnpm check-types` and `pnpm format:check` clean. `pnpm test` green at `0 cached, 8 total` — admin **432 (+1)**, contracts 152, API integration 434 and non-integration 446 both unchanged across the whole deliverable, which is what "no API surface" means.

### 5. Close-out

**ADRs:** [0025](../adr/0025-deliverables.md) rule 4

- Fill the _Implemented_ column in `docs/adr/README.md` for ADRs 0043–0044 in `D5.N` form, and set ADR-0034 and ADR-0040 to `superseded by`.
- Sync `CLAUDE.md`, `docs/README.md` and the ledger's frozen-set sentence — all four of the places D4's close-out found saying different things about which window is open.
- Run the acceptance checklist below on a fresh clone.
- Move the D5 row in `docs/plan/README.md` to `shipped YYYY-MM-DD`, which shuts the amendment window on ADRs 0043–0044 and freezes 0001–0044.

## Definition of done

D5 is closed when every step above is closed and this checklist passes on a fresh clone:

1. `pnpm i && cp .env.example .env && cp apps/admin/.env.example apps/admin/.env && pnpm docker:up && pnpm db:setup && pnpm db:seed -- --dev`; `pnpm dev --filter api` and `pnpm dev --filter admin`; sign in as the seeded super admin.
2. `pnpm lint && pnpm check-types && pnpm test` green; `pnpm test:unit` twice hits cache the second time, admin and contracts included; `git status` clean after the gates.
3. **Read the URL.** On both grids: sort a column, apply one filter of each of the four kinds, type a search term, change page and page size — and read the address bar. Every parameter is the API's own spelling, no percent-encoded braces anywhere, and clearing everything returns the bare path.
4. **Paste the URL at the API.** Copy the grid's query string onto `/api/v1/admin/staff` in Postman with a staff token: same `total`, same first row. This is the property the deliverable exists for, and it is one keystroke to check.
5. **Record walk, both resources, all three surfaces.** Open a record from a filtered page 3 — the URL is the bare record path; the grid behind is still filtered page 3; every way out lands back on it; a reload with the record open restores both halves; a cold record link in a fresh session loads the record and closes to the bare list.
6. `pnpm test:postman` green, untouched — D5 changes no API surface.
