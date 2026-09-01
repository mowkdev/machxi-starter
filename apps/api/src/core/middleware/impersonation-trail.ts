import type { RequestHandler } from "express";

import type { Audit } from "../audit/index.js";

/**
 * One audit row per **mutating** request served under impersonation
 * (ADR-0057 §6, ADR-0058 §v1 write points).
 *
 * ADR-0057 §5 lets an impersonator do everything the customer can do —
 * profile edits, settings writes, whatever the customer app grows next — bar
 * that section's three takeover-enabling operations, and the price of the
 * permission is that each allowed one lands in the audit table with both
 * identities on it. Reads are logged and not audited: they are the bulk of the
 * traffic and the least of the questions an incident asks.
 *
 * A request may therefore carry **two** rows, and that is deliberate rather
 * than incidental: the exit is a `POST /user/auth/logout` that finishes `204`,
 * so it is both a lifecycle event (`impersonation.ended`, transactional) and a
 * mutating request served under impersonation. The event names are what
 * separate them, and an integration case pins the pair — special-casing one
 * path inside a middleware whose whole value is that it has no special cases
 * would be the worse trade.
 *
 * **Written after the response, on the trail discipline.** The row is not part
 * of the operation's transaction and must never fail it: by the time this
 * fires the client already has its answer, and `Audit.trail` returns `void`
 * precisely so nobody can `await` it back into the request. A lost row
 * degrades to the completion log line, which carries both identities too
 * (ADR-0057 §6).
 *
 * It is mounted once, globally, rather than per router. That is the decision:
 * an impersonated principal only ever exists on the user segment, so a
 * per-router mount would buy nothing and cost the one thing that matters here
 * — that no route can be added later that quietly escapes the trail.
 */

/** Methods that can change something. `GET`, `HEAD` and `OPTIONS` cannot. */
const MUTATING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Only requests the API actually **served**.
 *
 * A `4xx` was refused and changed nothing, so a row for it would be a record
 * of an operation that did not happen — and the one `4xx` worth recording, an
 * excluded operation attempted, has its own event (`impersonation.refused`,
 * written by `refuseImpersonated`) rather than being smuggled in here as a
 * mutation. A `5xx` is likewise not evidence that anything landed.
 */
const wasServed = (statusCode: number): boolean => statusCode < 400;

/**
 * The path as the client sent it, without the query string.
 *
 * `originalUrl` because Express rewrites `req.url` to the mount-relative path
 * while a sub-router dispatches; without the query because redaction matches
 * object keys and a credential inside a URL string is invisible to it — the
 * reasoning `http-logger.ts` gives for the access line, applied to the one
 * table nothing ever prunes (ADR-0005, ADR-0058).
 */
const requestPath = (req: { readonly originalUrl: string }): string =>
  req.originalUrl.split("?")[0] ?? req.originalUrl;

export const createImpersonationTrail = ({
  audit,
}: {
  readonly audit: Audit;
}): RequestHandler => {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();

      return;
    }

    /** Whether this request is one the trail is about, decided at the end. */
    const isImpersonated = (): boolean => {
      const { principal } = req.ctx;

      return (
        principal?.kind === "user" && principal.impersonatedBy !== undefined
      );
    };

    // `close` fires on an aborted response where `finish` never does, and the
    // pair is how ADR-0058's promise is kept honest: the trail "degrades to
    // the logs rather than to nothing", and a mutation that committed while
    // the client's socket died would otherwise degrade to neither — no row,
    // and no line saying so. It is not audited, because an aborted response is
    // not evidence that anything landed; it is logged, because it might have.
    res.on("close", () => {
      if (res.writableEnded || !isImpersonated()) return;

      req.ctx.logger.error(
        { method: req.method, path: requestPath(req) },
        "impersonated mutation left no audit row: the response never finished",
      );
    });

    // `finish`, not the end of the handler: the principal is on `req.ctx` by
    // then (`authenticate` runs further down the chain than this middleware
    // does), and the status is the one that actually went out rather than the
    // one a handler intended.
    res.on("finish", () => {
      if (!isImpersonated() || !wasServed(res.statusCode)) return;

      audit.trail(req.ctx, {
        event: "impersonation.mutation",
        // The route and its outcome, and nothing off the body: a profile patch
        // carries personal data and this is the one table nothing prunes
        // (ADR-0058). `originalUrl` because Express rewrites `req.url` while a
        // sub-router dispatches, and without the query string for the reason
        // the access log drops it (ADR-0005).
        data: {
          method: req.method,
          path: requestPath(req),
          statusCode: res.statusCode,
        },
      });
    });

    next();
  };
};
