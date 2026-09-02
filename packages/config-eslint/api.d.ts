import type { Linter } from "eslint";

/**
 * Types for `api.js`, which is JavaScript like every other file in this
 * package (an ESLint flat config is loaded by ESLint, not compiled).
 *
 * It exists for one consumer: the enumeration test in `packages/db` that diffs
 * {@link RESTRICTED_SCHEMA_TABLE_IMPORTS} against the schema's own table
 * exports (ADR-0061 §4). A test that reads a hand-maintained list has to be
 * able to import it, and importing an untyped module under `strict` is an
 * error rather than an inconvenience.
 */

/** The API's rule set — the lint half of the ADRs (ADR-0002 §Lint rules). */
export declare const apiConfig: (options: {
  tsconfigRootDir: string;
}) => Linter.Config[];

/**
 * Every table `@repo/db` exports from its package root, by export name, as
 * banned from services and controllers (ADR-0009) — and, for `auditEvents`,
 * from everything but its one writer (ADR-0058).
 */
export declare const RESTRICTED_SCHEMA_TABLE_IMPORTS: readonly string[];
