/**
 * The account's settings, as this app reads and writes them (`D12.7`;
 * ADR-0045 as carried by ADR-0053, ADR-0055 §3).
 *
 * The slice's public API, which is the only way anything above `entities` may
 * reach it (the `boundaries` policy in `eslint.config.js`).
 *
 * **Narrower than the admin's, and by the same rule `shared/density` applies to
 * itself**: `createSettingsApi` and `settingsKeys` are the query layer's own
 * plumbing and nothing outside this slice has a use for either — a door line
 * with no consumer is a claim about a need that does not exist. They are one
 * line away when a loader or a second invalidation asks for them.
 */
export { useSettings, useUpdateSettings } from "./settings.queries";
export {
  SETTINGS_WRITE_DEBOUNCE_MS,
  createSettingsWriter,
  type SettingsWriter,
} from "./settings.storage";
