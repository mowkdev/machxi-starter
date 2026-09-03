/**
 * The door onto `@repo/resource`'s config helpers (`D9.3`, ADR-0051).
 *
 * The vocabulary moved; the import path every entity and feature writes did
 * not. `no-restricted-imports` keeps `@repo/resource` out of every layer above
 * this slice. This file is a door and holds no logic.
 *
 * `assertConfigMatchesContract` joined it at `D14.10` (ADR-0063 §2): the one
 * claim about a config that no type can make — that the endpoint allow-lists
 * what the config offers to sort, filter and search by — asked once per
 * resource, from that resource's own `__tests__`.
 */
export {
  assertConfigMatchesContract,
  dirtyValuesOf,
  editSurfaceOf,
  fieldsForVariant,
  humanize,
  initialValuesFor,
  isInVariant,
  mergeColumns,
  optionLabel,
  optionValues,
  resolveOption,
  resolveOptions,
  type ResolvedOption,
} from "@repo/resource";
