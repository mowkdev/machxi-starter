import { config } from "@/shared/config";

import type { ErrorContext } from "./context.js";

/**
 * The browser half of the error-reporting seam (ADR-0066 §3).
 *
 * The API's shape, mirrored: no DSN, no reporter, and **no adapter module ever
 * evaluated** — the `import()` below lives inside the branch, so a build that
 * reports nothing does not download the chunk. The load is memoised, so a
 * render loop that throws repeatedly does not start a second import.
 *
 * `VITE_ERROR_REPORTING_DSN` is compile-time public like everything else in
 * this app's configuration (ADR-0033), which is what a DSN is: an ingest
 * address, not a credential.
 */

export type ErrorReporter = (error: unknown, context?: ErrorContext) => void;

/**
 * Exported separately from {@link reportError} so the selection can be tested
 * from a literal instead of from `import.meta.env` (ADR-0036).
 */
export const createErrorReporter = (
  dsn: string | undefined,
): ErrorReporter | undefined => {
  if (dsn === undefined) return undefined;

  let adapter: Promise<typeof import("./reporter.js")> | undefined;

  return (error: unknown, context: ErrorContext = {}): void => {
    adapter ??= import("./reporter.js");

    // `.catch` **after** `.then`, not `then(onFulfilled, onRejected)`: the
    // two-argument form leaves a `report` that throws as an unhandled
    // rejection, which is the one failure mode a seam whose job is to survive
    // a thrown render must not have. Every failure is swallowed — a chunk that
    // will not load and an adapter that explodes alike.
    void adapter
      .then(({ report }) => {
        report(dsn, error, context);
      })
      .catch(() => undefined);
  };
};

/**
 * `undefined` in a default build — the absence is what a caller branches on.
 *
 * Its consumer is the app's top-level error boundary, which arrives with
 * `@repo/app-kit` at `D14.8` (ADR-0062 §1). The seam ships first because it is
 * this record's decision; wiring it to a boundary is that record's.
 */
export const reportError: ErrorReporter | undefined = createErrorReporter(
  config.VITE_ERROR_REPORTING_DSN,
);

export type { ErrorContext } from "./context.js";
