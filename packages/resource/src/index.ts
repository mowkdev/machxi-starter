/**
 * The `ResourceConfig` vocabulary, extracted (`D9.3`, ADR-0051).
 *
 * [ADR-0035](../../../docs/adr/0035-config-driven-resource-ui.md)'s serializable
 * config plus the pure functions that read it — the language both the grid and
 * the config-driven forms are written in, which is why it moves before either
 * of them. Nothing here renders, fetches or knows a resource's name: a
 * `ResourceConfig` is data an app writes, and this package is the shape it must
 * take and the helpers that interpret it.
 *
 * It depends on `@repo/contracts` for the enums a config's options are derived
 * from and on `@repo/i18n` for `TranslationKey` — because ADR-0046 §7 made every
 * operator-facing string in a config a typed key, so the vocabulary cannot be
 * described without naming that type. It depends on nothing else, and on no app.
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
} from "./config";

export type {
  CellRendererKey,
  ColumnConfig,
  ColumnConfigMap,
  ColumnOverrides,
  ComponentProps,
  EditSurfaceKey,
  FieldComponentKey,
  FieldConfig,
  FieldConfigMap,
  FieldVariant,
  FilterControlConfig,
  FormatterKey,
  GridCapabilities,
  GridConfig,
  HotFilterConfig,
  OptionConfig,
  ResourceConfig,
} from "./types";
