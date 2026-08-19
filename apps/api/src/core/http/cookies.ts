import type { Request } from "express";

/**
 * The cookies this API sets, and the one thing it needs to do with an incoming
 * `Cookie` header (ADR-0029).
 *
 * Both names and every attribute are constants rather than configuration, on
 * purpose: a deployment that needs to change them is a deployment with a
 * different security model, and that is an ADR rather than an environment
 * variable.
 *
 * The names live in `core` rather than in the auth module because two things
 * need them and they sit on opposite sides of the dependency rule: the auth
 * controller writes the cookies, and `core/middleware/csrf.ts` reads them.
 * Core may not import a module (ADR-0009), so the shared constant goes here.
 */

/**
 * The refresh token, when the client asked for cookie transport.
 *
 * `__Secure-` and not `__Host-`, which is the stronger prefix: `__Host-`
 * requires `Path=/`, and that would attach a thirty-day credential to every
 * request the browser makes to this API. `__Secure-` still guarantees the
 * cookie cannot be set over plain HTTP, which is the property worth having,
 * and it leaves the path scope free — see {@link authCookiePath}.
 */
export const REFRESH_COOKIE = "__Secure-machxi.refresh";

/**
 * The double-submit CSRF token (ADR-0029 §CSRF).
 *
 * Deliberately **not** `httpOnly`: the client has to read it to echo it back
 * in `X-CSRF-Token`, which is the entire mechanism. It carries no authority on
 * its own — it proves only that the sender could read a cookie for this
 * origin, which a cross-site attacker cannot.
 *
 * No `__Secure-` prefix, because it is not a credential and the prefix would
 * only make the name longer.
 */
export const CSRF_COOKIE = "machxi.csrf";

/** Where the client echoes {@link CSRF_COOKIE} back. */
export const CSRF_HEADER = "x-csrf-token";

/** How a client asks for cookie transport (ADR-0029 §Opt-in, not inference). */
export const TRANSPORT_HEADER = "x-auth-transport";

/**
 * The path both cookies are scoped to, per population.
 *
 * A browser signed into both populations holds two refresh cookies that are
 * never sent to each other's endpoints — the ADR-0019 §1 segment separation
 * expressed in the browser rather than only in the router, and it costs
 * nothing. It also means no request outside `/auth` ever carries the refresh
 * token, so an XSS cannot read it *and* an unrelated endpoint cannot log it.
 */
export const authCookiePath = (population: "staff" | "user"): string =>
  population === "staff" ? "/api/v1/admin/auth" : "/api/v1/user/auth";

/**
 * Reads one cookie from the request's `Cookie` header.
 *
 * Written out rather than taking a dependency on `cookie-parser`: this API
 * reads exactly two cookies, both of which it set itself, both base64url
 * values that need no unescaping. A parser package would add a runtime
 * dependency and a types package, and would attach a `req.cookies` object that
 * nothing else wants.
 *
 * RFC 6265 §4.2.1 is the whole grammar: pairs separated by `; `, the name up
 * to the first `=`, the value everything after it. Two details are worth
 * stating because they are what a naive `split("=")` gets wrong — a value may
 * contain `=` (base64 padding does), and a name must match **exactly**, or
 * `machxi.csrf` would also match a cookie called `evil.machxi.csrf`.
 */
export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;

  if (header === undefined) return undefined;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");

    if (separator === -1) continue;

    if (pair.slice(0, separator).trim() !== name) continue;

    const value = pair.slice(separator + 1).trim();

    // `res.cookie` percent-encodes on the way out, so this reverses it. A
    // malformed sequence would throw, and a cookie the client mangled is a
    // cookie this API does not have.
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
};
