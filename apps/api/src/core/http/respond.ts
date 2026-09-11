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

  /**
   * `202` — taken, and the effect happens out of band (ADR-0071 §3, §4).
   *
   * The mail flows' answer where a `201` would be a lie and a `204` would
   * throw away the envelope: registration has created nothing the caller may
   * act on yet, and `resend-verification` may have done nothing at all. What
   * the caller does next is read a mailbox.
   */
  accepted: <T>(res: Response, data: T): void => {
    respond.ok(res, data, 202);
  },

  /** `200` with a page; fills `meta.pagination`, `meta.sort`, `meta.filters`. */
  list: <T>(res: Response, page: Page<T>): void => {
    res.status(200).json(listEnvelope(requestIdOf(res), page));
  },

  /** `204` with no body — logout, delete, actions without a result. */
  noContent: (res: Response): void => {
    res.status(204).end();
  },

  /**
   * `302` to another origin — the one answer in this API that is a
   * navigation rather than a resource (ADR-0072 §2).
   *
   * The provider's callback is reached by a browser following a redirect from
   * Google, so whatever it answers is what a person sees: an envelope would be
   * JSON on a bare page. It answers every outcome, success and refusal alike,
   * by sending the browser on to the customer app with the result in the URL
   * **fragment**, which no server log and no `Referer` header carries. A
   * helper here rather than `res.redirect` in the controller for `respond`'s
   * own reason: the ways a controller may answer are the list in this file.
   */
  redirect: (res: Response, location: string): void => {
    res.redirect(302, location);
  },
} as const;
