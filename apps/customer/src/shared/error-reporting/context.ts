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
