import { createErrorReporter, type ErrorReporter } from "@repo/app-kit";

import { config } from "@/shared/config";

/**
 * The browser half of the error-reporting seam (ADR-0066 §3), bound to this
 * app (`D22.1`, ADR-0077 §1).
 *
 * The factory and the context's shape are `@repo/app-kit`'s since `D22.1`;
 * the two copies of them were identical. What is left here is what binds
 * something, and it is two values:
 *
 * - **The DSN.** `VITE_ERROR_REPORTING_DSN` is compile-time public like
 *   everything else in this app's configuration (ADR-0033), which is what a
 *   DSN is: an ingest address, not a credential.
 * - **The adapter.** `./reporter` is the one file a fork replaces, so it
 *   stays in the app. The `import()` below is handed to the factory and
 *   called inside the branch that checks the DSN, on the first report — so
 *   with no DSN the adapter module is never evaluated and its chunk is never
 *   downloaded.
 */

/**
 * `undefined` in a default build — the absence is what a caller branches on.
 *
 * Its consumer is the app's top-level error boundary (ADR-0062 §2).
 */
export const reportError: ErrorReporter | undefined = createErrorReporter(
  config.VITE_ERROR_REPORTING_DSN,
  () => import("./reporter.js"),
);

export type { ErrorContext, ErrorReporter } from "@repo/app-kit";
