import type { ApiError } from "@repo/contracts";
import type { Response } from "express";

import { errorEnvelope } from "./envelope.js";

/**
 * Writes an error envelope.
 *
 * **Only `core/middleware/error-handler.ts` may call this.** It lives in
 * `core/http` because that is where the `res.json` lint rule (ADR-0012) allows
 * a response to be written, and it is kept out of `respond` so that a
 * controller reaching for an error response finds nothing to reach for —
 * controllers throw, and one middleware decides the wire format (ADR-0013).
 */
export const sendErrorEnvelope = (
  res: Response,
  status: number,
  requestId: string,
  error: ApiError,
): void => {
  res.status(status).json(errorEnvelope(requestId, error));
};
