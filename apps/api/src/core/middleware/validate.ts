import type { Request, RequestHandler } from "express";
import type { ZodIssue, ZodType, output } from "zod";

import { toValidationError } from "../errors/index.js";

/**
 * Request validation (ADR-0011).
 *
 * Parsed values land on `req.valid.{params,query,body}`; controllers never read
 * `req.body` or `req.query` directly, which is what guarantees that everything
 * a service sees has been through a schema. In Express 5 `req.query` is a
 * getter and cannot be reassigned, so a separate slot is not a preference but a
 * requirement.
 */

export interface ValidationSchemas {
  readonly params?: ZodType;
  readonly query?: ZodType;
  readonly body?: ZodType;
}

type Parsed<
  S extends ValidationSchemas,
  K extends keyof ValidationSchemas,
> = S[K] extends ZodType ? output<S[K]> : undefined;

/** What `req.valid` holds for a route validated with `S`. */
export interface Validated<S extends ValidationSchemas> {
  readonly params: Parsed<S, "params">;
  readonly query: Parsed<S, "query">;
  readonly body: Parsed<S, "body">;
}

/**
 * A request whose `valid` is typed by the schema its route mounted:
 *
 * ```ts
 * getById: async (req: ValidatedRequest<typeof getUserSchema>, res: Response) =>
 *   respond.ok(res, await svc.getById(req.ctx, req.valid.params.id))
 * ```
 */
export type ValidatedRequest<S extends ValidationSchemas> = Omit<
  Request,
  "valid"
> & { valid: Validated<S> };

/**
 * Parses the three request parts and throws a single `VALIDATION_ERROR`
 * carrying **every** issue found.
 *
 * All three are parsed even after one fails: a client that sent a bad id and a
 * bad body should learn both from one response instead of fixing them one
 * round trip at a time. Issue paths are not prefixed with `params`/`query`/
 * `body` — ADR-0013 defines `details[].path` as the field path the client
 * itself used.
 *
 * No try/catch and no async wrapper: Express 5 forwards both synchronous
 * throws and rejected promises to the error middleware (ADR-0003).
 */
export const validate = <S extends ValidationSchemas>(
  schemas: S,
): RequestHandler => {
  return (req, _res, next) => {
    const issues: ZodIssue[] = [];

    const parse = <T>(schema: ZodType<T> | undefined, value: unknown): T => {
      if (schema === undefined) return undefined as T;

      const result = schema.safeParse(value);

      if (result.success) return result.data;

      issues.push(...result.error.issues);

      return undefined as T;
    };

    const valid = {
      params: parse(schemas.params, req.params),
      query: parse(schemas.query, req.query),
      // `?? {}` because "no body" and "an empty body" are the same request as
      // far as a schema is concerned, and Express does not agree: `express.json`
      // leaves `req.body` undefined when nothing matched the content type, and
      // sets `{}` for an empty JSON document. Without this, whether a request
      // validates would depend on whether the client bothered to send
      // `Content-Type`. It became load-bearing with cookie transport
      // (ADR-0029): a browser refreshing from its cookie sends
      // `fetch(url, { method: "POST" })` — no body, no content type — and every
      // field of `refreshBody` is optional, so `{}` is exactly valid.
      //
      // A schema with required fields is unaffected except in its message: it
      // now reports which fields are missing rather than "expected object,
      // received undefined", which is the more useful of the two.
      body: parse(schemas.body, req.body ?? {}),
    };

    if (issues.length > 0) {
      throw toValidationError(issues);
    }

    req.valid = valid;
    next();
  };
};
