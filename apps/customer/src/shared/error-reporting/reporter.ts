import type { ErrorContext } from "@repo/app-kit";

/**
 * **The one file a fork replaces** (ADR-0066 §3, amended `D14.6`).
 *
 * This repository ships **no vendor SDK**, in either app or in the API: a
 * starter that picks Sentry for every project it is copied into is the exact
 * coupling the mail port of §1 exists to avoid, and a browser SDK is a
 * dependency whose bytes the bundle budget would carry in every fork that does
 * not use it. So the seam ships and the vendor does not.
 *
 * Wiring one up is this file and nothing else:
 *
 * ```ts
 * import { init, captureException } from "@sentry/react";
 *
 * let started = false;
 *
 * export const report = (dsn: string, error: unknown, context: ErrorContext) => {
 *   if (!started) { init({ dsn }); started = true; }
 *   captureException(error, { extra: { ...context } });
 * };
 * ```
 *
 * It is reached through a dynamic `import()` from `index.ts`, inside the
 * branch that checks the DSN, so a build with no DSN never loads this chunk —
 * which is the property that starts to matter the moment the module above
 * holds an SDK that installs global handlers when it is imported.
 *
 * The default implementation does nothing on purpose. A `console.error` would
 * be duplicate noise beside the boundary that already caught the error (and is
 * banned by ADR-0002's lint rules), and inventing a wire format to POST at a
 * DSN that expects a vendor's would be a delivery that silently fails.
 */
export const report = (
  _dsn: string,
  _error: unknown,
  _context: ErrorContext,
): void => {
  // Intentionally empty — see above.
};
