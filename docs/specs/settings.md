# Settings

Per-account display settings — theme, locale, grid density and a per-grid arrangement map — on both segments, one table per population, with no row meaning the defaults.

## Requirement: A principal has settings whether or not a row exists

`GET /{admin,user}/settings` answers `200` with the defaults for a principal who has never written any, and the stored row otherwise; it never answers `404`. The subject is the session's principal — there is no id to name, so no account can read another's.
Records: [ADR-0045](../adr/0045-user-settings.md), [ADR-0053](../adr/0053-account-area.md)
Proved by: `apps/api/test/settings.int.test.ts`

### Scenario: First read

- **WHEN** a freshly created account reads its settings
- **THEN** the answer is `200` with the default theme, locale and density and an empty `grids`

## Requirement: A patch merges, and the merge is per grid

`PATCH /settings` replaces the scalars it carries, leaves the ones it omits, and merges `grids` per key: an object replaces that grid's entry, `null` deletes it, an unmentioned key is untouched. The merged row may hold at most `MAX_SETTINGS_GRIDS` entries, checked after the merge; the answer is the row as stored. An empty patch is refused.
Records: [ADR-0045](../adr/0045-user-settings.md)
Proved by: `apps/api/test/settings.int.test.ts`, `apps/api/src/modules/settings/__tests__/settings.service.test.ts`

### Scenario: Two grids, two tabs

- **WHEN** two patches each carry a different grid's arrangement
- **THEN** both entries are present afterwards

### Scenario: Deleting one grid

- **WHEN** a patch carries `grids: { "<id>": null }`
- **THEN** that entry is gone and every other entry stands

### Scenario: Too many grids

- **WHEN** a valid patch would leave more than `MAX_SETTINGS_GRIDS` entries
- **THEN** the answer is `400 VALIDATION_ERROR` with a detail at `grids`

## Requirement: The two populations never share a row

A staff member's settings live in the staff table and a customer's in the user table, chosen by the session's population; the same person holding both kinds of account has two independent rows.
Records: [ADR-0045](../adr/0045-user-settings.md), [ADR-0017](../adr/0017-identity-model-populations-and-roles.md)
Proved by: `apps/api/test/settings.int.test.ts`

### Scenario: Both segments

- **WHEN** a staff session and a user session each patch a theme
- **THEN** each segment's read answers its own value

## Requirement: Either app sends what changed, once per burst

What a browser asks of `/settings` is the same in both apps. An anonymous visitor asks nothing. A signed-in one reads once, before anything that depends on the answer is rendered, and a read that fails leaves the device's own values in force with nothing said. Changes made within one second of each other leave as one `PATCH` carrying only the keys that changed; a grid's arrangement is among them only in an app that mounts a grid, where `null` for a grid means it was reset. A write that is refused leaves what the person chose on screen.
Records: [ADR-0045](../adr/0045-user-settings.md), [ADR-0077](../adr/0077-shared-composition-second-wave.md), [ADR-0041](../adr/0041-grid-preferences.md)
Proved by: `packages/account/src/__tests__/settings.storage.test.ts`, `packages/account/src/__tests__/settings-provider.test.tsx`

### Scenario: A burst of changes

- **WHEN** a theme and a density are chosen within the same second
- **THEN** one `PATCH` leaves, carrying those two keys and no others

### Scenario: Nobody is signed in

- **WHEN** the app is opened with no session
- **THEN** it renders at once from the device's values, and `/settings` is neither read nor written

### Scenario: An app with no grid

- **WHEN** an app that mounts no grid writes a preference
- **THEN** the body carries no `grids` key
