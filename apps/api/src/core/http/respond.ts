import type { Page } from "@repo/contracts";
import type { Response } from "express";

import { listEnvelope, successEnvelope } from "./envelope.js";

/**
 * The only way a controller may write a successful response (ADR-0012).
 *
 * A `no-restricted-syntax` rule forbids `res.json` / `res.send` outside
 * `core/http`, so an ad hoc body cannot be emitted by accident. Errors are not
 * here on purpose: controllers throw, and the error middleware is the single
 * writer of the error envelope (ADR-0013).
 *
 * Each helper takes only `res`, reading the request id from `res.req.ctx`
 * (ADR-0010), which is what keeps controllers one-liners.
 */

const requestIdOf = (res: Response): string => res.req.ctx.requestId;

export const respond = {
  /** `200` (or another 2xx) with a single resource. */
  ok: <T>(res: Response, data: T, status = 200): void => {
    res.status(status).json(successEnvelope(requestIdOf(res), data));
  },

  /** `201` after a create. */
  created: <T>(res: Response, data: T): void => {
    respond.ok(res, data, 201);
  },

  /** `200` with a page; fills `meta.pagination`, `meta.sort`, `meta.filters`. */
  list: <T>(res: Response, page: Page<T>): void => {
    res.status(200).json(listEnvelope(requestIdOf(res), page));
  },

  /** `204` with no body — logout, delete, actions without a result. */
  noContent: (res: Response): void => {
    res.status(204).end();
  },
} as const;
