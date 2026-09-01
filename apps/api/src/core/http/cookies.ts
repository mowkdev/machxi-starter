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
 * The double-submit CSRF token of one population (ADR-0056, superseding
 * ADR-0029 on this name and nothing else).
 *
 * Deliberately **not** `httpOnly`: the client has to read it to echo it back
 * in `X-CSRF-Token`, which is the entire mechanism. It carries no authority on
 * its own — it proves only that the sender could read a cookie for this
 * origin, which a cross-site attacker cannot.
 *
 * `__Host-`, unlike its sibling, and both halves of that prefix's contract are
 * wanted here rather than tolerated. `Path=/` is what makes the cookie
 * *readable*: `document.cookie` returns only cookies whose path matches the
 * **document's** URL, so an app at `/dashboard` could never see a token scoped
 * to `/api/v1/admin/auth` — the version this shipped with in D2.5 was
 * unreadable by any real browser, and the check it guards could only ever have
 * failed. Host-only is what makes it unshadowable by a sibling subdomain,
 * which is the attacker `csrf.ts` names as its reason to exist.
 *
 * Sending a non-secret token on every request to this host is the cost, and it
 * is the normal shape of a CSRF cookie.
 *
 * **One per population, and the prefix survives it.** `__Host-` constrains
 * `Path` and `Domain`, not the name, so both cookies keep `Path=/` and the
 * full guarantee. Until D12 exactly one SPA could hold a session against an
 * API host, so a single host-wide cookie was every client's own; with the
 * admin panel and the customer app open at once, one app's rotation stranded
 * the other's in-memory token and a second `403` inside that window was a
 * forced sign-out caused by another tab (D12's finding 6). Splitting the name
 * is the whole fix: the two apps stop sharing mutable state.
 *
 * The suffix is the **segment** word rather than the population word —
 * `admin`, not `staff` — for the same reason {@link authCookiePath} is
 * spelled in segments: what a person debugging this reads beside it is a URL.
 */
export const csrfCookieName = (population: "staff" | "user"): string =>
  population === "staff"
    ? "__Host-machxi.csrf.admin"
    : "__Host-machxi.csrf.user";

/**
 * The one host-wide cookie ADR-0029 shipped, retired by ADR-0056.
 *
 * Kept as a constant rather than deleted because a browser that was signed in
 * before the split still holds it, and nothing else would ever remove it: it
 * is `__Host-` at `Path=/` with the refresh token's `Max-Age`, so it would sit
 * there for a month being sent on every request. Every response that writes or
 * clears a population's cookie clears this one too — but only when the
 * request actually presented it, so the migration costs one `Set-Cookie` once
 * rather than one on every login forever.
 */
export const LEGACY_CSRF_COOKIE = "__Host-machxi.csrf";

/** `__Host-` requires it, and readability by the app's own pages needs it. */
export const CSRF_COOKIE_PATH = "/";

/** Where the client echoes the population's CSRF cookie back. */
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
 * to the first `=`, the value everything after it. Three details are worth
 * stating because they are what a naive implementation gets wrong.
 *
 * A value may contain `=` — base64 padding does — so the split is on the
 * *first* one only. A name must match **exactly**, or `machxi.csrf` would also
 * answer for `evil.machxi.csrf`.
 *
 * And **a name that appears twice yields nothing**, which is the one that is a
 * security property rather than a correctness one. A `Cookie` header may
 * legitimately carry two cookies of the same name from different paths or
 * domains, ordered by descending path length (RFC 6265 §5.4) — so a sibling
 * subdomain that can set `Domain=example.com` cookies chooses which one a
 * first-match reader sees. For `machxi.csrf` that hands the attacker both
 * halves of the double-submit; for the refresh cookie it is session fixation,
 * with the shadow winning every subsequent rotation because the API's own
 * cookie is host-only at a shorter path. `__Secure-` does not help: it
 * constrains the scheme, not the host. Failing closed does — the request is
 * answered as though no cookie were present, which for a real client is a
 * re-login and for the attacker is nothing.
 */
export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;

  if (header === undefined) return undefined;

  let found: string | undefined;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");

    if (separator === -1) continue;

    if (pair.slice(0, separator).trim() !== name) continue;

    // Seen twice: somebody is shadowing, and neither value can be trusted to
    // be ours.
    if (found !== undefined) return undefined;

    const value = pair.slice(separator + 1).trim();

    // `res.cookie` percent-encodes on the way out, so this reverses it. A
    // malformed sequence would throw, and a cookie the client mangled is a
    // cookie this API does not have — but the loop continues, so a malformed
    // duplicate cannot hide a second one.
    try {
      found = decodeURIComponent(value);
    } catch {
      found = "";
    }
  }

  return found === "" ? undefined : found;
};
