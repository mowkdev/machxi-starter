/**
 * Settings enumerations (ADR-0045), declared under the same one-declaration
 * rule as the top-level {@link ../enums.js | enums} (ADR-0023): the tuple is
 * written once and feeds `pgEnum` in `@repo/db`, `z.enum` in the request body
 * and the union type in every client.
 *
 * They live in this folder rather than in the root `enums.ts` because they
 * belong to one resource — a theme is not an identity fact — and because the
 * pair is where D7 does its work.
 *
 * **Declaration order is the sort order**, as it is for every other `pgEnum`
 * here: Postgres orders an enum column by label position, and
 * `ALTER TYPE … ADD VALUE` appends.
 */

/**
 * How the panel is painted. `"system"` is not a third palette — it is the
 * deferral to `prefers-color-scheme`, resolved by the client at apply time
 * (ADR-0045 §Theme), which is why the server stores it as a value rather than
 * as the absence of one.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The interface language. One value today: the slot exists before D7 has
 * anything to put in it, which is the cheap half of the arrangement — adding
 * `"lv"` is an appended tuple entry plus `ALTER TYPE … ADD VALUE`, and no row
 * and no sort order moves.
 */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
