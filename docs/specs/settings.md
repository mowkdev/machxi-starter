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
