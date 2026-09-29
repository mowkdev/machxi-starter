/**
 * The browser half of the error-reporting seam (ADR-0066 §3) — the factory
 * and the context's shape, moved here at `D22.1` (ADR-0077 §1) from both
 * apps' `shared/error-reporting`, where the two copies were identical.
 *
 * **What stays in each app is what binds something**: the DSN, read from the
 * app's own configuration, and `reporter.ts` — the one file a fork replaces —
 * reached through the `load` an app passes. The `import()` is written in the
 * app, so the adapter is a chunk of the app's build and a build that reports
 * nothing does not download it.
 */

/**
 * What the browser seam may carry alongside the error (ADR-0066 §3).
 *
 * The same discipline as the API's `ErrorReport`: named fields only, never a
 * bag of whatever was to hand. A form's values, a query string and the session
 * are all things a page has in scope and none of them belongs in a report.
 */
export interface ErrorContext {
  /** Where the boundary that caught it sits, e.g. `"app"` or `"route"`. */
  readonly boundary?: string;
  /** The route pattern, never the resolved path — an id is not a label. */
  readonly route?: string;
}

export type ErrorReporter = (error: unknown, context?: ErrorContext) => void;

/** The adapter module's shape: `reporter.ts` in each app. */
export interface ErrorReportAdapter {
  readonly report: (dsn: string, error: unknown, context: ErrorContext) => void;
}

/**
 * No DSN, no reporter, and **no adapter module ever evaluated** — `load` is
 * called inside the branch, on the first report. The load is memoised, so a
 * render loop that throws repeatedly does not start a second import.
 *
 * The DSN is a parameter so the selection can be tested from a literal
 * instead of from `import.meta.env` (ADR-0036).
 */
export const createErrorReporter = (
  dsn: string | undefined,
  load: () => Promise<ErrorReportAdapter>,
): ErrorReporter | undefined => {
  if (dsn === undefined) return undefined;

  let adapter: Promise<ErrorReportAdapter> | undefined;

  return (error: unknown, context: ErrorContext = {}): void => {
    adapter ??= load();

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
