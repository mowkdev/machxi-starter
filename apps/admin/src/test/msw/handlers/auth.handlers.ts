import {
  forgotPasswordBody,
  loginBody,
  resetPasswordBody,
  type AuthResource,
  type ErrorCode,
  type ForgotPasswordBody,
  type PrincipalResource,
  type ResetPasswordBody,
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

/** The recovery link's token, as the mailed link would carry it (`D18.6`). */
export const RESET_TOKEN = "reset-token-from-the-fragment";

export interface AuthMockState {
  /** How many times `POST /auth/refresh` has been called. */
  refreshCalls: number;
  /** How many times `GET /auth/csrf` has been called. */
  csrfCalls: number;
  /**
   * The bodies `POST /admin/auth/password/forgot` has been offered (`D18.6`).
   *
   * Bodies rather than a count, because the address and the locale are both
   * the point and the *answer* is not: the endpoint says `202` whatever it is
   * handed (ADR-0020 §Enumeration), so what left the form is the only thing a
   * test can see.
   */
  forgotPasswordCalls: ForgotPasswordBody[];
  /**
   * The bodies `POST /admin/auth/password/reset` has been offered (`D18.6`).
   *
   * The token as well as the password, because the token is what the screen
   * had to carry out of the URL fragment without rendering, storing or
   * mangling it — a screen that posted the wrong half of it would still
   * produce one call.
   */
  resetPasswordCalls: ResetPasswordBody[];
  /** When set, refresh answers this instead of succeeding. */
  refreshFailsWith?: { status: number; code: ErrorCode } | undefined;
}

export const createAuthMockState = (): AuthMockState => ({
  refreshCalls: 0,
  csrfCalls: 0,
  forgotPasswordCalls: [],
  resetPasswordCalls: [],
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

    /*
     * "Email me a recovery link" (`D18.6`, ADR-0071 §4).
     *
     * **On `API`, this app's own segment**, which is where the API mounts it —
     * beside `login`, so the population comes from the route and never from a
     * field, and a customer's address asked for here reaches the staff table
     * and finds nothing.
     *
     * `202 { accepted: true }` for **every** address, because the answer must
     * not be an oracle (ADR-0020 §Enumeration) — and on this segment an oracle
     * would enumerate the people who can administer the deployment. A mock
     * that refused a stranger's address would let this app render a
     * distinction the API refuses to make.
     */
    http.post(
      `${API}/auth/password/forgot`,
      async ({ request }): Promise<Response> => {
        const body = forgotPasswordBody.parse(await request.json());

        state.forgotPasswordCalls.push(body);

        return ok({ accepted: true }, 202);
      },
    ),

    /*
     * The recovery link, spent (`D18.6`, ADR-0071 §4).
     *
     * **`204` and no session**, which is the half of §4 a mock can get wrong
     * invisibly: the link proved the mailbox and not the device, and the
     * endpoint revokes every session the account had. A mock that answered an
     * `AuthResource` here would let this app grow a landing the API can never
     * produce.
     *
     * **One indistinguishable `401` for every refusal** — unknown, consumed,
     * expired, or minted on the other segment — because the caller is an
     * anonymous holder of a URL fragment.
     */
    http.post(
      `${API}/auth/password/reset`,
      async ({ request }): Promise<Response> => {
        const body = resetPasswordBody.parse(await request.json());

        state.resetPasswordCalls.push(body);

        if (body.token !== RESET_TOKEN) return fail(401, "UNAUTHENTICATED");

        return new Response(null, { status: 204 });
      },
    ),

    http.post(`${API}/auth/logout`, () => new Response(null, { status: 204 })),
  ] as const satisfies readonly HttpHandler[];
