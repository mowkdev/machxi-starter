import type { Population } from "@repo/contracts";
import type { Request } from "express";

/**
 * The cookies this API sets, and the one thing it needs to do with an incoming
 * `Cookie` header (ADR-0029).
 *
 * Every *attribute* is a constant rather than configuration, on purpose: a
 * deployment that needs to change one is a deployment with a different
 * security model, and that is an ADR rather than an environment variable. The
 * **shape** of each name is a constant for the same reason.
 *
 * The brand inside the name is the one thing that is neither (ADR-0064 §1).
 * It is a fork-day value: every name below is derived from one `APP_ID`, which
 * defaults to {@link DEFAULT_APP_ID}, so this repository's own cookies are
 * byte-identical to the literals this file used to hold. Renaming a live
 * deployment signs every browser out, which ADR-0064 §2 records as the design
 * rather than as a hazard to mitigate.
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
const refreshCookieName = (appId: string): string =>
  `__Secure-${appId}.refresh`;

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
const csrfCookieNameFor = (appId: string, population: Population): string =>
  `__Host-${appId}.csrf.${population === "staff" ? "admin" : "user"}`;

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
const legacyCsrfCookieName = (appId: string): string => `__Host-${appId}.csrf`;

/**
 * A sign-in's authorization round trip with an external provider
 * (ADR-0072 §2, the delta on ADR-0029 at `D19.2`).
 *
 * `__Host-`, so no other origin can set or shadow it and it is scoped to this
 * host at `Path=/`. It is the one cookie in this file that is **not** a
 * session credential and **not** `SameSite=Strict`: it holds a signed
 * transaction — `state`, `nonce`, the PKCE verifier — for the ten minutes the
 * round trip lasts, and it has to ride the top-level navigation back from the
 * provider, which `Strict` would strip. Its attributes live beside the
 * controller that writes it; its name lives here, with the others it must
 * never collide with.
 */
const oidcCookieName = (appId: string): string => `__Host-${appId}.oidc`;

/**
 * The brand this repository ships with, and the default of `APP_ID`
 * (ADR-0064 §1).
 *
 * Stated here rather than only in the config schema for the reason the argon2
 * floors are taken from `@repo/crypto`: the value belongs beside the names it
 * builds, and a default that exists in two places is a default that will one
 * day exist in one. `core/config/schema.ts` reads it from here.
 */
export const DEFAULT_APP_ID = "machxi";

/**
 * The four names one deployment answers to, built once from its `APP_ID`.
 *
 * A bundle rather than three loose functions because two sides of the
 * dependency rule need them and neither may build its own: the auth
 * controller writes the cookies, `core/middleware/csrf.ts` reads them, and a
 * guard that derived a name from a second copy of the identifier is a guard
 * that can disagree with the writer. The container builds exactly one of
 * these and hands it to both (ADR-0009).
 */
export interface CookieNames {
  /** {@link refreshCookieName} for this deployment. */
  readonly refresh: string;
  /** This deployment's retired host-wide CSRF cookie (ADR-0056). */
  readonly legacyCsrf: string;
  /** This deployment's CSRF cookie for one population (ADR-0056). */
  readonly csrf: (population: Population) => string;
  /** {@link oidcCookieName} for this deployment (ADR-0072 §2). */
  readonly oidc: string;
}

export const createCookieNames = (appId: string): CookieNames =>
  Object.freeze({
    refresh: refreshCookieName(appId),
    legacyCsrf: legacyCsrfCookieName(appId),
    csrf: (population: Population) => csrfCookieNameFor(appId, population),
    oidc: oidcCookieName(appId),
  });

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
 * *first* one only. A name must match **exactly**, or `<app>.csrf` would also
 * answer for `evil.<app>.csrf`.
 *
 * And **a name that appears twice yields nothing**, which is the one that is a
 * security property rather than a correctness one. A `Cookie` header may
 * legitimately carry two cookies of the same name from different paths or
 * domains, ordered by descending path length (RFC 6265 §5.4) — so a sibling
 * subdomain that can set `Domain=example.com` cookies chooses which one a
 * first-match reader sees. For the CSRF cookie that hands the attacker both
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
