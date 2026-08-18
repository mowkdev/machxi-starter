import { apiConfig } from "@repo/eslint-config/api";

/**
 * The ADR-0002 lint-rules table, applied to this app. The rules themselves
 * live in `@repo/eslint-config/api` so a second Express app would inherit the
 * same architecture checks rather than a copy of them.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default apiConfig({ tsconfigRootDir: import.meta.dirname });
