/**
 * The account's settings, as this app reads and writes them — a door onto
 * `@repo/account` since `D22.2` (ADR-0077 §2–§3; ADR-0045 as carried by
 * ADR-0053, ADR-0055 §3).
 *
 * The entity, its coalescing writer and the settings gate live in the package.
 * **This app passes it no grid preference adapter**: ADR-0055 §3 keeps
 * `@repo/grid` out until a domain entity arrives, so there is no store, no key
 * to parse and no arrangement to mirror — and the writer flushes the scalars
 * alone.
 *
 * **Narrower than the admin's**: `createSettingsApi` and `settingsKeys` are the
 * query layer's own plumbing and nothing in this app has a use for either — a
 * door line with no consumer is a claim about a need that does not exist.
 */
export {
  SETTINGS_WRITE_DEBOUNCE_MS,
  createSettingsProvider,
  createSettingsWriter,
  useSettings,
  useUpdateSettings,
  type SettingsProviderProps,
  type SettingsWriter,
} from "@repo/account";
