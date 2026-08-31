/**
 * The door onto `@repo/resource`'s vocabulary (`D12.6`, ADR-0051).
 *
 * **Two names, not the admin's nineteen**, and the subtraction is the same one
 * the `shared/ui` door makes: this is the inventory of what the app uses, and
 * `ColumnConfig`, `GridConfig`, `HotFilterConfig` and the rest describe a table
 * ADR-0055 §3 keeps out of this app until a domain entity arrives. A door line
 * for a type nothing names would be a claim that this app has a resource with
 * columns.
 */
export type { FieldConfig, FieldConfigMap, FieldVariant } from "@repo/resource";
