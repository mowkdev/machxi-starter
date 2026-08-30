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
 * The interface language.
 *
 * **`"lv"` appended by `D7.1`** (ADR-0046), which is the arrangement ADR-0045
 * reserved being spent exactly as it was written: an appended tuple entry plus
 * `ALTER TYPE … ADD VALUE` (migration `0004_locale_lv`), so no row and no sort
 * order moves. Order here is the Postgres label order, so a value is appended
 * and never inserted — alphabetising this tuple would be a schema change.
 *
 * The set is the **production** one, because it is a database column: the
 * dev-only pseudo-locale of ADR-0046 §10 is a lens over `en`, not a language
 * an account can have, and is deliberately not a member.
 */
export const LOCALES = ["en", "lv"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * How tightly a data grid packs its rows (`D11.6`, ADR-0053 §2, ADR-0054 §6).
 *
 * **A mode, not a scale.** Two values exactly three apart in every number they
 * move — row height 44/34, cell padding 10/8, in-row badge 26/22 — because a
 * third rung would be a slider nobody can name, and the reference settled the
 * question as a mode (`docs/plan/0011-…` §The reference settled).
 *
 * It sits beside the theme and the locale rather than inside `grids` because
 * it is one fact about the account and not one about a grid: an operator who
 * likes tight rows likes them on every screen, and per-grid density would be
 * the same preference stored `n` times, drifting apart the moment one is
 * written by an older client.
 *
 * Declaration order is the sort order, as it is for every tuple here.
 */
export const GRID_DENSITIES = ["comfortable", "compact"] as const;
export type GridDensity = (typeof GRID_DENSITIES)[number];

/**
 * The value a principal has when they have never said otherwise.
 *
 * Declared here rather than only on the Postgres column, under the same
 * one-declaration rule as the tuples: `GET /settings` answers these for a
 * principal with **no row**, and the column defaults them for a row created by
 * a `PATCH` that named neither. Two spellings of "the default" is exactly the
 * drift ADR-0023 exists to prevent — and the drift would be invisible, because
 * both paths answer a valid resource and only the values differ.
 */
export const DEFAULT_THEME = "system" satisfies Theme;
export const DEFAULT_LOCALE = "en" satisfies Locale;
/**
 * Comfortable, and the grid falls back to this constant rather than to a
 * literal of its own — so a table rendered with no provider above it (a
 * package test, an app that has not wired settings yet) is comfortable for
 * one declared reason instead of two agreeing ones (ADR-0054 §6).
 */
export const DEFAULT_GRID_DENSITY = "comfortable" satisfies GridDensity;
