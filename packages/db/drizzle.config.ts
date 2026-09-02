import { defineConfig } from "drizzle-kit";

import { readOwnerDatabaseUrl } from "./src/tooling/env.js";

/**
 * `drizzle-kit` configuration (ADR-0006, ADR-0008).
 *
 * Only two commands use it: `db:generate`, which diffs `src/schema` against the
 * committed migrations and writes the next SQL file, and `db:studio`. Applying
 * migrations is `src/migrate.ts`, never `drizzle-kit push` — the committed SQL
 * is the reviewed artefact.
 *
 * **The owner's connection** (ADR-0061 §1): both commands are DDL tools —
 * `studio` can alter and drop — and the application role the API connects as
 * has no DDL at all.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // The same rule the runtime client uses (ADR-0006): TS properties are
  // camelCase, physical columns are snake_case. If these two ever disagree,
  // `generate` writes a migration renaming every column in the database.
  casing: "snake_case",
  dbCredentials: { url: readOwnerDatabaseUrl() },
  strict: true,
  verbose: true,
});
