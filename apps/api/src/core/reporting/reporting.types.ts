/**
 * The error-reporting port (ADR-0066 §3).
 *
 * Off unless `ERROR_REPORTING_DSN` is set, and fired on **5xx only** — a
 * `400`, a `401` or a `409` is the API working, and reporting them buries the
 * crashes under validation failures.
 */

/**
 * What a reporter is given, and the whole of it.
 *
 * **No body, no query, no headers.** The body is where passwords are
 * (ADR-0066 §3, ADR-0005 §Redaction), a query string carries whatever a
 * client put in it, and a header carries the session cookie. What is here is
 * the same set of facts the log line already holds: enough to find the request
 * and the actor, and nothing that could be a credential.
 */
export interface ErrorReport {
  readonly requestId: string;
  /** The route **pattern** — never the raw path, for the ADR-0066 §2 reason. */
  readonly route: string;
  readonly method: string;
  readonly status: number;
  /** `null` for an unauthenticated request. */
  readonly principal: { readonly kind: string; readonly id: string } | null;
  /** The thrown value, for the stack. */
  readonly error: unknown;
}

export interface ErrorReporter {
  /**
   * Fire-and-forget, and synchronous by signature on purpose: the error
   * handler must write the response now, not after a third party has
   * acknowledged a report.
   */
  readonly report: (report: ErrorReport) => void;
}
