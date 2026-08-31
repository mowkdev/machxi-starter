/**
 * The door onto `@repo/resource`'s config helpers (`D12.6`, ADR-0051).
 *
 * `no-restricted-imports` keeps `@repo/resource` out of every layer above this
 * slice. This file is a door and holds no logic.
 *
 * The two the account area's details form needs: `fieldsForVariant` says what
 * a variant renders, `dirtyValuesOf` prunes a submit to what actually changed
 * so `updateProfileBody`'s "at least one field" refinement measures a real
 * edit. The rest of the package's surface arrives with its first caller.
 */
export { dirtyValuesOf, fieldsForVariant } from "@repo/resource";
