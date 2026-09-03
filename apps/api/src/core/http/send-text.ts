import type { Response } from "express";

/**
 * The one response body in this API that is not the envelope (ADR-0012, as
 * carried by ADR-0066 §2).
 *
 * It lives here, beside `respond` and `sendErrorEnvelope`, for the reason the
 * lint rule exists: `core/http` is the only directory allowed to write a body,
 * and `/metrics` needs one. It is not an exception to the envelope so much as
 * evidence of what the envelope is *for* — a JSON API's resources, under
 * `/api/v1`. A Prometheus exposition is a wire format somebody else defined,
 * consumed by a scraper that has never heard of `data`, `meta` or `requestId`,
 * and wrapping it would make it unparseable by every client that exists.
 *
 * Nothing else may use this. If a second caller ever appears, it needs its own
 * decision, not this helper's convenience.
 */
export const sendText = (
  res: Response,
  contentType: string,
  body: string,
): void => {
  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.end(body);
};
