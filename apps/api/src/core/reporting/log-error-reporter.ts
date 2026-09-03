import type { Logger } from "@repo/logger";

import type { ErrorReport, ErrorReporter } from "./reporting.types.js";

/**
 * The adapter this repository ships, and **the one file a fork replaces**
 * (ADR-0066 §3, amended `D14.6`).
 *
 * It writes one structured line per 5xx at `error` level, tagged
 * `reported: true`, so a deployment with a DSN and no vendor SDK still gets
 * the seam's behaviour — the set of facts a reporter is given, visible where
 * the logs already go.
 *
 * A fork that wants Sentry (or Bugsnag, or Rollbar) changes this file and
 * nothing else: `init({ dsn })` at the top of the factory, `captureException`
 * in `report`. It is loaded through a dynamic `import()` from the branch in
 * `index.ts`, so a deployment with no DSN never executes it — which is the
 * property that matters once the module holds an SDK whose import installs
 * global instrumentation.
 *
 * The DSN is taken and deliberately never logged: it is a credential.
 */
export interface LogErrorReporterDeps {
  readonly dsn: string;
  readonly logger: Logger;
}

export const createLogErrorReporter = ({
  logger,
}: LogErrorReporterDeps): ErrorReporter => ({
  report: (report: ErrorReport): void => {
    logger.error(
      {
        err: report.error,
        reported: true,
        requestId: report.requestId,
        route: report.route,
        method: report.method,
        status: report.status,
        principal: report.principal,
      },
      "error reported",
    );
  },
});
