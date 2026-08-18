import type { RequestContext } from "../core/context/index.js";

/**
 * Express request augmentation (ADR-0010, ADR-0011).
 *
 * `ctx` is attached by the context middleware and is present on every request
 * that reaches a router — the middleware sits second in the chain, above every
 * route (ADR-0011), so it is typed as required rather than optional.
 *
 * `valid` holds what `validate()` parsed. Its type is the one deliberate `any`
 * in the code base, and the reason is assignability, not laziness: a controller
 * is declared as `(req: ValidatedRequest<typeof schema>, res) => …` so it can
 * read `req.valid.body.email` with full types, and Express's `RequestHandler`
 * checks its parameter contravariantly under `strictFunctionTypes`. A narrower
 * type here (`unknown`, or a union) would make every such controller
 * unassignable to `Router.post`, and the alternative — casting inside each
 * controller — moves the same unsoundness somewhere it is easier to forget.
 * The guarantee is structural instead: nothing reads `req.valid` except through
 * `ValidatedRequest<S>`, whose `S` is the schema the route actually mounted.
 */
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the note above.
      valid: any;
    }
  }
}

export {};
