import {
  loginBody,
  type AuthResource,
  type ErrorCode,
  type UserPrincipalResource,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { CSRF_HEADER } from "@/shared/api/client";

import { fail, ok } from "./envelope";

/**
 * The `/user` segment's auth endpoints, as MSW answers them (ADR-0036 §The
 * load-bearing rule).
 *
 * Handlers are built from `@repo/contracts`, not hand-written: the request body
 * is parsed with `loginBody` — the schema the API validates with — and the
 * response goes through envelope builders typed against the contract. A
 * contract change therefore stops this compiling or starts it throwing, instead
 * of letting the suite certify against an API the frontend wishes it had.
 *
 * **The base URL is the difference from the admin's copy, and it is the whole
 * point of the app.** `/api/v1/user`, not `/api/v1/admin`: a handler mounted on
 * the wrong segment would answer requests this app never makes and let the real
 * ones fall through to `onUnhandledRequest: "error"` — which is the failure
 * mode worth having, because it is loud.
 *
 * `create*Handlers(state)` with no shared module state, per ADR-0036: a test
 * that needs a scripted scenario builds its own and `server.use(...)`es it, and
 * `resetHandlers()` puts the defaults back.
 *
 * **They refuse what the real endpoints refuse** (`D12.2`'s review). ADR-0036's
 * load-bearing rule is that a mock more permissive than the service certifies
 * the opposite of production, and the first version of this file was exactly
 * that on the two guarded routes: `/auth/refresh` and `/auth/logout` sit behind
 * the CSRF guard, and logout behind `authenticate("user")`, while the handlers
 * answered 200/204 to anything. A client that had stopped sending either header
 * would have passed every assertion here. Now it fails at the boundary.
 */

/** The CSRF guard the API puts on the two state-changing auth routes. */
const csrfChecked = (request: Request): Response | null =>
  request.headers.get(CSRF_HEADER) === null
    ? fail(403, "CSRF_TOKEN_INVALID")
    : null;

/** `authenticate("user")`, as far as a mock can see it: a bearer token. */
const authenticated = (request: Request): Response | null =>
  request.headers.get("Authorization")?.startsWith("Bearer ") === true
    ? null
    : fail(401, "UNAUTHENTICATED");

export const API = "http://api.test/api/v1/user";

/**
 * A customer, not an operator.
 *
 * `kind: "user"` and `roles: ["customer"]` — the only user role in v1
 * (ADR-0017), which is why ADR-0055 §3 gives this app no policy table: a
 * population with one role has nothing for `can()` to decide. The names are
 * `string | null` on this side of the union because the two tables differ on
 * exactly that point, and the fixture uses real ones so a screen that renders a
 * name has one to render.
 */
export const PRINCIPAL: UserPrincipalResource = {
  kind: "user",
  id: "0198c1f0-0000-7000-8000-0000000000c1",
  email: "customer@machxi.local",
  firstName: "Cara",
  lastName: "Customer",
  roles: ["customer"],
};

export const CREDENTIALS = {
  email: "customer@machxi.local",
  password: "DevPassword!123",
} as const;

export const authResource = (accessToken: string): AuthResource => ({
  accessToken,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
  // Present because the client asks for cookie transport; the refresh token is
  // absent for the same reason (ADR-0029 §Opt-in).
  csrfToken: `csrf-for-${accessToken}`,
  tokenType: "Bearer",
  principal: PRINCIPAL,
});

export interface AuthMockState {
  /** How many times `POST /auth/refresh` has been called. */
  refreshCalls: number;
  /** How many times `GET /auth/csrf` has been called. */
  csrfCalls: number;
  /** How many times `POST /auth/logout` has been called. */
  logoutCalls: number;
  /**
   * Whether a refresh cookie exists at all.
   *
   * `true` by default because most tests are about a returning visitor. Set
   * `false` for the case the boot sequence exists to handle and that had no
   * coverage until `D12.2`'s review: a **first-time visitor**, whose refresh is
   * refused and who must land anonymous rather than on an error screen —
   * `createBootstrap`'s other branch. MSW cannot see a `HttpOnly` cookie, so
   * this flag stands in for one; the cookie's own path scoping is the API's
   * integration tier's to assert, not a browser mock's.
   */
  hasRefreshCookie: boolean;
  /** When set, refresh answers this instead of succeeding. */
  refreshFailsWith?: { status: number; code: ErrorCode } | undefined;
}

export const createAuthMockState = (): AuthMockState => ({
  refreshCalls: 0,
  csrfCalls: 0,
  logoutCalls: 0,
  hasRefreshCookie: true,
});

export const createAuthHandlers = (state: AuthMockState) =>
  [
    http.get(`${API}/auth/csrf`, () => {
      state.csrfCalls += 1;
      return ok({ csrfToken: `bootstrap-csrf-${String(state.csrfCalls)}` });
    }),

    // Annotated `Response` because the resolver branches: MSW infers the body
    // type from the first `return`, and a handler that can answer either an
    // envelope or an error otherwise fails to type-check on the second.
    http.post(`${API}/auth/refresh`, ({ request }): Response => {
      const refused = csrfChecked(request);

      if (refused) return refused;

      state.refreshCalls += 1;

      if (state.refreshFailsWith) {
        return fail(state.refreshFailsWith.status, state.refreshFailsWith.code);
      }

      // No cookie, no rotation: the server has nothing to verify, and the
      // client turns this into "anonymous" rather than into a failure.
      if (!state.hasRefreshCookie) {
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }

      return ok(authResource(`access-${String(state.refreshCalls)}`));
    }),

    http.post(`${API}/auth/login`, async ({ request }): Promise<Response> => {
      // Parsed with the API's own schema: a request the server would reject
      // throws here rather than being quietly accepted by the mock.
      const body = loginBody.parse(await request.json());

      if (
        body.email !== CREDENTIALS.email ||
        body.password !== CREDENTIALS.password
      ) {
        return fail(401, "AUTH_INVALID_CREDENTIALS");
      }

      return ok(authResource("access-login"));
    }),

    http.post(`${API}/auth/logout`, ({ request }): Response => {
      const refused = csrfChecked(request) ?? authenticated(request);

      if (refused) return refused;

      state.logoutCalls += 1;
      return new Response(null, { status: 204 });
    }),
  ] as const satisfies readonly HttpHandler[];
