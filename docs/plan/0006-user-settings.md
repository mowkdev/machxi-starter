# D6 — User settings

- Status: **in progress**, opened 2026-08-22 — the day D5 shipped ([ADR-0025](../adr/0025-deliverables.md) rule 5: one at a time). The amendment window is open on **ADR-0045 only**; ADRs 0001–0044 stay frozen.
- Steps: `D6.1` – `D6.4`
- Ledger: [`docs/plan/README.md`](README.md)

Scope: server-persisted per-account settings — **theme, locale, and per-grid preferences** — as one new API module exposed on **both** population segments, and the admin app consuming it. The theme stops being a device fact and becomes an account fact; the grid arrangement an operator built on one machine follows them to the next; the locale slot exists before D7 has anything to put in it. **The first new API module since D2** — `apps/api`, `packages/db`, `packages/contracts` and `apps/admin` all move, which makes this the first deliverable since D2 whose gate is a target on every tier rather than a regression check on most of them.

## Why this is first after the grid deliverables

Three reasons, in order of weight:

1. **ADR-0041 pre-paid the design.** The grid-preferences store ships behind a three-function `PreferenceStorage` adapter precisely so that "a server-backed user-settings adapter slots in later without touching the store or AppGrid" — and its §Consequences names the claim this deliverable holds it to: _"when it lands, the store and AppGrid do not change."_ Neither D4's later steps nor D5 touched the adapter, so the seam is the freshest contract in the repository, and building on it is the cheapest possible falsification of that claim.
2. **D7 (localization) needs a locale to persist.** A locale switch that forgets itself on the next device is a toy; sequencing settings first means D7 wires into a slot that already exists instead of building persistence as a side quest.
3. **It is the smallest of the planned deliverables** — one module, two mounts, no new app, no new package — and it re-exercises `/new-api-module` and the whole ADR-0009 layering on a body of code that has only been maintained, not extended, for three deliverables.

**Both populations get settings from day one.** Taken as the default when the deliverable was scoped and standing at opening: the customer app (D8) inherits account-portable theme and locale for free, and one settings model beats two arriving a deliverable apart. Reversing it later costs exactly one mount in `user.router.ts`.

Everything here builds on decisions that stand unchanged: two populations as separate aggregates in separate tables, free to grow attributes without adding nullable columns to each other ([ADR-0017](../adr/0017-principals-and-roles.md)) — which is exactly why the settings tables come in a pair; the layering, envelope and error model every module follows ([ADR-0009](../adr/0009-functional-layering.md), [ADR-0012](../adr/0012-response-envelope.md), [ADR-0013](../adr/0013-error-model.md)); enums declared once in `@repo/contracts` and consumed by `pgEnum` and zod ([ADR-0023](../adr/0023-shared-contracts-package.md)); the query cache, invalidation and notification rules ([ADR-0043](../adr/0043-readable-list-search-params.md)); `localStorage` permitted for non-credential display state and nothing else ([ADR-0033](../adr/0033-browser-api-client-and-session.md)); and the adapter seam and versioned, bounded value of [ADR-0041](../adr/0041-grid-preferences.md).

**Gate.** [ADR-0045](../adr/0045-user-settings.md) is `proposed`, and opening this deliverable did not change that. It is accepted at the head of `D6.1` (ADR-0025 rule 3) — the per-step acceptance D4 and D5 ran on — and governs `D6.1`–`D6.3`; `D6.4` names no ADR of its own. It is additive: nothing in it supersedes a frozen record, and ADR-0041 anticipated it by name.

Each step names the ADRs that govern it. Read them before implementing — they carry the reasoning, this file carries the work. Every step ends green on `pnpm lint && pnpm check-types && pnpm test` and a conventional commit; `pnpm check` is the loop inside a step.

## Build order

### 1. The contract and the tables

**ADRs:** [0045](../adr/0045-user-settings.md), [0023](../adr/0023-shared-contracts-package.md), [0006](../adr/0006-database-and-orm.md), [0008](../adr/0008-migrations-and-seeds.md), [0041](../adr/0041-grid-preferences.md)

First because everything after it is derived from it, in both directions: the API validates with these schemas and the admin store imports one of them. `packages/contracts/src/settings/` lands with `THEMES` (`light` | `dark` | `system`) and `LOCALES` (`en` — D7 appends `lv`), the settings resource, the `PATCH` body with its bounds (gridId 1–64 chars, at most 50 grids, per-key merge with `null` as delete), and **`gridPreferencesSchema` moved out of `apps/admin/src/shared/grid/preferences.ts`** with ADR-0041's D4.5 bounds intact — the move that ADR reserved for "the day the user-settings API does". The admin store imports it from `@repo/contracts` and changes in no other way; the existing preference tests pass untouched, which is the first half of ADR-0041's claim being checked. `packages/db` gains **two tables, `staff_settings` and `user_settings`** — one per population, the operator's call at opening because the two will diverge — each with a unique `staff_id` / `user_id` carrying a real foreign key `on delete cascade`, `theme` and `locale` as `pgEnum`s built from the new tuples, `grids` as `jsonb`, and one generated, reviewed, committed migration (`drizzle-kit generate`, never `push`). The contracts pair — `staffSettingsResource` / `userSettingsResource` and their bodies — is composed from one shared core and exported separately, identical today by construction: the pair is the split point when a customer setting that staff have no use for arrives.

**Done when:** `@repo/contracts` exports the settings schemas and tuples and its suite covers the body's bounds and the per-key `null`; `_shared.ts` builds the two enums from the tuples; the migration applies to a fresh database and to one already at the previous head; `apps/admin`'s grid-preference tests are green with the schema imported from contracts and no change to the store's behaviour; the gate is green.

### 2. The `settings` module on both segments

**ADRs:** [0045](../adr/0045-user-settings.md), [0009](../adr/0009-functional-layering.md), [0010](../adr/0010-request-context.md), [0011](../adr/0011-validation.md), [0012](../adr/0012-response-envelope.md), [0015](../adr/0015-route-segments.md), [0019](../adr/0019-authorization.md), [0021](../adr/0021-testing-strategy.md), [0028](../adr/0028-account-deletion.md)

`apps/api/src/modules/settings` via `/new-api-module`: routes → controller → service → repository, one controller and one service serving both mounts, the service selecting the repository's `staff` or `user` half — same signatures over the two tables — by `ctx.principal`'s population. `GET /settings` returns the defaults when no row exists — never a `404`, a principal always has settings. `PATCH /settings` is `.strict()` and partial: `theme` and `locale` replace, `grids` merges per key, and the row is upserted. Mounted beside `/profile` on both `admin.router.ts` and `user.router.ts`, under `authenticate` and with no `authorize`, for the reason both routers already give for `/profile`. The hard-delete paths (ADR-0028) need no settings code: the foreign key cascades, which is the constraint `sessions` could not have; a soft-deleted user keeps its row because its `users` row stays. The integration test asserts the cascade rather than trusting it. Unit tests over a fake repository; integration tests on both segments — defaults, upsert, per-key merge and delete, every bound, a second principal's row invisible, `401` without a session; Postman requests on both segments via `/postman-sync`.

**Done when:** both segments answer `GET` and `PATCH /settings` per ADR-0045; a staff account and a user account sharing an email address read and write different rows; a grid entry above the bounds is a `VALIDATION_ERROR` with its path; hard-deleting a staff account leaves no settings row; `pnpm test` green on both tiers, `pnpm test:postman` green with the new requests, and the collection's previous counts otherwise unchanged.

### 3. The admin app adopts its account

**ADRs:** [0045](../adr/0045-user-settings.md), [0041](../adr/0041-grid-preferences.md), [0043](../adr/0043-readable-list-search-params.md), [0033](../adr/0033-browser-api-client-and-session.md), [0032](../adr/0032-admin-app-architecture.md), [0036](../adr/0036-admin-testing-strategy.md)

`entities/settings` — keys, api, queries — with the settings query fetched at session bootstrap beside the principal. `createServerPreferenceAdapter` implements the same three `PreferenceStorage` functions: a synchronous `read` from an in-memory mirror seeded by the query, `write` and `remove` updating the mirror and scheduling one debounced, coalesced `PATCH` carrying only the changed grid entries; the adapter owns the mapping between `machxi.admin.grid:<gridId>:v1` and `grids[gridId]`, so the store never learns a gridId is on the wire. `localStorage` stays in front of it as the carve-out cache. **First sync**: server entry wins per grid; a grid that exists only locally is adopted and uploaded once. The theme provider keeps applying the local theme before first paint, adopts the server's when the query resolves, and writes both on toggle; `system` is the media query. Writes declare no success toast; the global handler's failure toast stays; the store's guards keep a failed write at "not persisting". `locale` is fetched and carried, and nothing reads it — D7's. MSW handlers derived from the contracts schemas; tests for the adapter against the in-memory store, the first-sync rule both ways, the debounce coalescing two resizes into one request, the theme adoption, and the signed-out path unchanged.

**Done when:** `AppGrid` and `createGridPreferences` have no diff in this step beyond the import `D6.1` made — the second half of ADR-0041's claim; a column resized in one test client is read back by a second client of the same principal; a server row that fails the schema degrades to defaults without a toast; the signed-out app themes itself from `localStorage` exactly as before; the gate is green.

### 4. Close-out

**ADRs:** none of its own — the checklist below

The acceptance checklist run end to end, the browser walk that jsdom cannot make (two browsers, one account), `pnpm test:unit` twice to prove the ADR-0026 cache property on the packages this deliverable touched, ADR-0045 amended with whatever `D6.1`–`D6.3` found, the ADR index's _Implemented_ column filled per step, `.env.example` untouched or updated, the ledger's row moved and its §How D6 closed written with the evidence separated the way D3–D5 separated it, and `CLAUDE.md` told that ADRs 0001–0045 are frozen and D7 is next.

**Done when:** every item in §Definition of done is checked or explicitly recorded as operator-accepted, the ledger row reads `shipped`, and the window on ADR-0045 is shut.

## Definition of done

1. **A fresh clone** runs `pnpm i`, `pnpm docker:up`, `pnpm db:setup`, `pnpm db:seed -- --dev`, `pnpm dev --filter api` and `pnpm dev --filter admin`, and the `settings` migration is among those applied.
2. **The seam held.** `git diff D5..HEAD -- apps/admin/src/shared/grid/preferences.ts apps/admin/src/shared/grid/app-grid.tsx` shows the schema import and nothing else.
3. **One account, two browsers.** Sign in as the same staff account in a second browser: the first browser's theme and column arrangement are there. Change a width in the second; reload the first; it followed.
4. **The defaults are the floor.** A `PATCH` with a hand-made grid entry outside the bounds is refused with a `VALIDATION_ERROR` naming the path; a row edited in the database to garbage renders the grid at config defaults with no toast.
5. **Both segments.** `pnpm test:postman` green, with `GET` and `PATCH /settings` on `admin` and `user` among the requests and every previous request's assertions unchanged.
6. **Green and cached.** `pnpm lint && pnpm check-types && pnpm test` green; `pnpm test:unit` twice, the second `FULL TURBO`; `pnpm format:check` clean; a clean tree afterwards.
