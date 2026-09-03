import type { Logger } from "@repo/logger";

import type { ErrorReport, ErrorReporter } from "./reporting.types.js";

/**
 * Builds the reporter, or nothing at all (ADR-0066 §3).
 *
 * `undefined` when no DSN is configured, and the absence is what the error
 * handler branches on: no DSN, no reporter, and **no adapter module ever
 * evaluated**. The `import()` below is inside the branch for that reason — a
 * fork that swaps `log-error-reporter.ts` for a vendor SDK gets a deployment
 * where "reporting is off" means the SDK's global instrumentation was never
 * installed, not that it was installed and told to stay quiet.
 *
 * The load is lazy rather than eager so that a process which never fails never
 * pays for it, and it happens **once**: the promise is memoised, so a burst of
 * 5xx does not start a second import.
 */

export interface CreateErrorReporterDeps {
  /** `ERROR_REPORTING_DSN`, absent when the deployment reports nothing. */
  readonly dsn: string | undefined;
  readonly logger: Logger;
}

export const createErrorReporter = ({
  dsn,
  logger,
}: CreateErrorReporterDeps): ErrorReporter | undefined => {
  if (dsn === undefined) return undefined;

  let adapter: Promise<ErrorReporter> | undefined;

  const load = async (): Promise<ErrorReporter> => {
    const { createLogErrorReporter } = await import("./log-error-reporter.js");

    return createLogErrorReporter({ dsn, logger });
  };

  return {
    report: (report: ErrorReport): void => {
      adapter ??= load();

      // Nothing awaits this, and every failure is swallowed into one log line:
      // a reporter that throws — a bad DSN, a network the SDK cannot reach —
      // must not be able to break the one handler whose job is to stop
      // failures from leaking (ADR-0013).
      //
      // `.catch` **after** `.then`, not `then(onFulfilled, onRejected)`: the
      // two-argument form leaves a throwing `report` as an unhandled
      // rejection, and an unhandled rejection is a process exit under Node's
      // default policy — the error handler would then be the thing that took
      // the API down.
      void adapter
        .then((reporter) => {
          reporter.report(report);
        })
        .catch((error: unknown) => {
          logger.warn({ err: error }, "error reporter unavailable");
        });
    },
  };
};

export {
  createLogErrorReporter,
  type LogErrorReporterDeps,
} from "./log-error-reporter.js";
export type { ErrorReport, ErrorReporter } from "./reporting.types.js";
