import {
  loginBody,
  type AuthResource,
  type ErrorCode,
  type PrincipalResource,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { fail, ok } from "./envelope";

/**
 * The auth endpoints, as MSW answers them (ADR-0036 §The load-bearing rule).
 *
 * Handlers are built from `@repo/contracts`, not hand-written: the request body
 * is parsed with `loginBody` — the schema the API validates with — and the
 * response goes through envelope builders typed against the contract. A
 * contract change therefore stops this compiling or starts it throwing, instead
 * of letting the suite certify against an API the frontend wishes it had.
 *
 * `create*Handlers(state)` with no shared module state, per ADR-0036: a test
 * that needs a scripted scenario builds its own and `server.use(...)`es it, and
 * `resetHandlers()` puts the defaults back.
 *
 * **This package's copy** (`D9.1`, ADR-0051), unchanged from the admin's apart
 * from the segment in `API` being spelled out as this suite's choice rather
 * than the app's only one: the client is segment-parameterised now, and these
 * handlers answer the `admin` segment because that is the segment the tests
 * construct their clients with. See `./server` for why the harness is
 * duplicated rather than shared.
 */

export const API = "http://api.test/api/v1/admin";

export const PRINCIPAL: PrincipalResource = {
  kind: "staff",
  id: "0198c1f0-0000-7000-8000-000000000001",
  email: "admin@machxi.local",
  firstName: "Ada",
  lastName: "Admin",
  roles: ["super_admin"],
};

export const CREDENTIALS = {
  email: "admin@machxi.local",
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
  /** When set, refresh answers this instead of succeeding. */
  refreshFailsWith?: { status: number; code: ErrorCode } | undefined;
}

export const createAuthMockState = (): AuthMockState => ({
  refreshCalls: 0,
  csrfCalls: 0,
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
    http.post(`${API}/auth/refresh`, (): Response => {
      state.refreshCalls += 1;

      if (state.refreshFailsWith) {
        return fail(state.refreshFailsWith.status, state.refreshFailsWith.code);
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

    http.post(`${API}/auth/logout`, () => new Response(null, { status: 204 })),
  ] as const satisfies readonly HttpHandler[];
