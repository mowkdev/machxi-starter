/**
 * The door onto `@repo/resource`'s config helpers (`D9.3`, ADR-0051).
 *
 * The vocabulary moved; the import path every entity and feature writes did
 * not. `no-restricted-imports` keeps `@repo/resource` out of every layer above
 * this slice. This file is a door and holds no logic.
 */
export {
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
