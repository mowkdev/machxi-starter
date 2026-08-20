# D5 — User settings

- Status: **planned** — opens when D4 ships (ADR-0025 rule 5: one at a time)
- Steps: written when the deliverable opens; this file carries scope, order rationale and the assumptions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: server-persisted per-account settings — **theme, locale, and per-grid preferences** — as one new API module exposed on **both** population segments, and the admin app consuming it. The theme stops being a device fact and becomes an account fact; the grid arrangement an operator built on one machine follows them to the next; the locale slot exists before D6 has anything to put in it.

## Why this is first after D4

Three reasons, in order of weight:

1. **ADR-0041 pre-paid the design.** The grid-preferences store ships behind a three-function `PreferenceStorage` adapter precisely so that "a server-backed user-settings adapter slots in later without touching the store or AppGrid" — and its §Consequences names the claim this deliverable holds it to: *"when it lands, the store and AppGrid do not change."* Building D5 immediately after D4 exercises that seam while it is the freshest contract in the repository, and is the cheapest possible falsification of it.
2. **D6 (localization) needs a locale to persist.** A locale switch that forgets itself on the next device is a toy; sequencing settings first means D6 wires into a slot that already exists instead of building persistence as a side quest.
3. **It is the smallest of the five planned deliverables** — one module, two segments, no new app, no new package — and it is the first new API module since D2, which re-exercises `/new-api-module` and the whole ADR-0009 layering on a body of code that has only been maintained, not extended, for two deliverables.

## Design sketch (the ADR decides; this is the shape to start from)

- **A typed resource, not a key-value bag**: `theme` (`"light" | "dark" | "system"`), `locale` (enum in `@repo/contracts`, initially `["en"]` — D6 widens it), `grids` (record of `gridId` → grid-preferences object). The grid-preferences zod schema currently lives beside the store in `apps/admin` because "nothing on the wire speaks it today"; ADR-0041 reserved its move into `@repo/contracts` for "the day the user-settings API does" — that day is this deliverable, and the move is part of it.
- **Self-scoped endpoints on both segments** (`GET` + `PATCH`, shaped like the existing profile module): staff read and write their settings through `/admin`, customers through `/user`. Storage is the ADR's first real decision — per-population tables in the ADR-0017 tradition, or one table keyed by `(principal_type, principal_id)`.
- **Sync semantics in the client**: read at session bootstrap; write-through debounced; on first sync **server wins if an entry exists, otherwise the local entry is adopted and uploaded** — nobody loses the arrangement they built before the API existed. `localStorage` stays as the ADR-0041/ADR-0033 carve-out cache, so a failed write still degrades to "preferences not persisting", never to a broken grid.

## Decisions this deliverable needs

- **One new ADR**: the settings model — resource shape, storage keying, endpoint placement, merge semantics, and the contracts move of the grid-preferences schema. Additive beside frozen ADR-0033/0034; ADR-0041 (frozen when D4 closes) anticipated it explicitly, so no supersession is expected anywhere.

## Assumptions taken 2026-08-20 (revisable until the deliverable opens)

- **Both populations get settings** from day one. Recorded as the default because the customer app (D7) inherits account-portable theme and locale for free, and one settings model beats two arriving a deliverable apart. If the operator prefers staff-only first, the `/user` half moves to D7 and only this file changes.

## Acceptance sketch

Sign in as the same staff account in a second browser and find the first browser's theme and grid arrangement; a corrupt or unknown-version server value degrades to defaults without an error surface; the signed-out app still themes itself from the local cache; `pnpm lint && pnpm check-types && pnpm test` green with the new module's unit and integration tiers, and the Postman collection extended.
