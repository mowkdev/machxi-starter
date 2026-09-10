import {
  forgotPasswordBody,
  impersonateBody,
  loginBody,
  registerBody,
  resendVerificationBody,
  resetPasswordBody,
  verifyEmailBody,
  type AuthResource,
  type ErrorCode,
  type ForgotPasswordBody,
  type ImpersonatorResource,
  type RegisterBody,
  type ResendVerificationBody,
  type ResetPasswordBody,
  type UserPrincipalResource,
} from "@repo/contracts";
import { http, type HttpHandler } from "msw";

import { CSRF_HEADER, TRANSPORT_HEADER } from "@/shared/api/client";

import { impersonator } from "@/test/principals";

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
 * The one segment this app talks to that is not its own (`D15.6`, ADR-0015).
 *
 * Registration is mounted on `/api/v1/public` because it is the endpoint for
 * somebody who has no population yet, so a handler on `API` would answer a
 * request this app never makes and let the real one fall through to
 * `onUnhandledRequest: "error"` — the loud failure worth having, and the
 * reason the base URL is spelled out rather than derived.
 */
export const PUBLIC_API = "http://api.test/api/v1/public";

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

/**
 * The staff member behind an impersonated session (`D13.7`, ADR-0057 §4).
 *
 * **The fixture from `test/principals`, not a second copy of it** — the one
 * correction `D13.7`'s review made to this file. `PRINCIPAL` here and
 * `userPrincipal()` there already differ by id, and two literal operator
 * addresses would have made "the banner names the operator the API sent" true
 * by coincidence across two suites rather than by construction: the banner
 * suite reads the store fixture and the exchange suite reads this one, so they
 * have to be the same value or they prove nothing together.
 */
export const IMPERSONATOR: ImpersonatorResource = impersonator();

/** The same customer, seen through an impersonated session. */
export const IMPERSONATED_PRINCIPAL: UserPrincipalResource = {
  ...PRINCIPAL,
  impersonatedBy: IMPERSONATOR,
};

/** The handoff the admin panel would have put in the URL fragment. */
export const HANDOFF_TOKEN = "handoff-token-from-the-fragment";

/** The confirmation link's token, as the mailed link would carry it. */
export const VERIFICATION_TOKEN = "verification-token-from-the-fragment";

/** The recovery link's token, as the mailed link would carry it (`D18.6`). */
export const RESET_TOKEN = "reset-token-from-the-fragment";

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
  /**
   * The tokens `POST /auth/impersonate` has been offered, in order (`D13.7`).
   *
   * A list rather than a count, because what a test has to be able to see is
   * *which* value left the address bar — the fragment is the credential, and a
   * screen that posted the wrong half of it would still produce one call.
   */
  impersonateCalls: string[];
  /**
   * Whether the exchange asked for cookie transport (ADR-0029 §Opt-in).
   *
   * Recorded rather than enforced, for the reason the API does not enforce it
   * either: an exchange without the header is a valid request that answers
   * with a body-borne refresh token and sets no cookie. That is precisely the
   * failure `COOKIE_TRANSPORT_PATHS` exists to prevent and precisely the one
   * that is invisible in a response, so the mock records the fact and a test
   * asserts it.
   */
  impersonateAskedForCookies: boolean;
  /** How many times `GET /auth/csrf` has been called. */
  csrfCalls: number;
  /** How many times `POST /auth/logout` has been called. */
  logoutCalls: number;
  /**
   * The bodies `POST /public/auth/register` has been offered, in order
   * (`D15.6`).
   *
   * Bodies rather than a count, for the reason `impersonateCalls` holds
   * tokens: what a test has to be able to see is *what left the form* — the
   * two optional names in particular, which have to be absent rather than
   * empty (ADR-0017's nullable columns, `registerBody`'s `min(1)`).
   */
  registerCalls: RegisterBody[];
  /**
   * Whether registration asked for cookie transport (ADR-0029 §Opt-in).
   *
   * Recorded rather than enforced, exactly as the exchange's twin is: a
   * request without the header is valid and answers with a body-borne refresh
   * token and no cookie, which is invisible in the response and would leave a
   * newly created account signed in only until the first reload.
   */
  registerAskedForCookies: boolean;
  /**
   * The tokens `POST /public/auth/verify-email` has been offered, in order
   * (`D18.4`, ADR-0071 §3).
   *
   * A list rather than a count, for the reason `impersonateCalls` is one: what
   * a test has to be able to see is *which* value left the address bar — the
   * fragment is the credential, and a screen that posted the wrong half of it
   * would still produce one call.
   */
  verifyEmailCalls: string[];
  /**
   * Whether the confirmation asked for cookie transport (ADR-0029 §Opt-in).
   *
   * Recorded rather than enforced, exactly as its two siblings are: a request
   * without the header is valid and answers with a body-borne refresh token
   * and no cookie, which is invisible in the response and would leave a
   * just-verified account signed in only until the first reload — having spent
   * the one link it had.
   */
  verifyEmailAskedForCookies: boolean;
  /**
   * The bodies `POST /public/auth/resend-verification` has been offered.
   *
   * Bodies rather than a count, because the address and the locale are both
   * the point: the endpoint answers `202` whatever it is handed (ADR-0020
   * §Enumeration), so what left the form is the only thing a test can see.
   */
  resendVerificationCalls: ResendVerificationBody[];
  /**
   * The bodies `POST /user/auth/password/forgot` has been offered (`D18.6`).
   *
   * Bodies rather than a count, because the address and the locale are both
   * the point and the *answer* is not: the endpoint says `202` whatever it is
   * handed (ADR-0020 §Enumeration), so what left the form is the only thing a
   * test can see.
   */
  forgotPasswordCalls: ForgotPasswordBody[];
  /**
   * The bodies `POST /user/auth/password/reset` has been offered (`D18.6`).
   *
   * The token as well as the password, because the token is what the screen
   * had to carry out of the URL fragment without rendering, storing or
   * mangling it — a screen that posted the wrong half of it would still
   * produce one call.
   */
  resetPasswordCalls: ResetPasswordBody[];
  /**
   * Addresses that already belong to an account.
   *
   * The refusal is the generic `409 CONFLICT` ADR-0020 §Enumeration requires —
   * never `USER_EMAIL_TAKEN`, which would confirm the address. A mock that
   * answered the sharper code would let this app grow a branch the API can
   * never take.
   */
  takenEmails: string[];
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
  impersonateCalls: [],
  impersonateAskedForCookies: false,
  registerCalls: [],
  registerAskedForCookies: false,
  verifyEmailCalls: [],
  verifyEmailAskedForCookies: false,
  resendVerificationCalls: [],
  forgotPasswordCalls: [],
  resetPasswordCalls: [],
  takenEmails: [CREDENTIALS.email],
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

    /*
     * Self-registration (`D15.6`, ADR-0067 §6, ADR-0018 §Staff onboarding).
     *
     * **On `PUBLIC_API`, and that is the assertion the mount makes**: a client
     * that sent this to its own segment would find no handler and fail loudly
     * rather than being quietly answered.
     *
     * The response is `202 { accepted: true }` and **no session** since
     * ADR-0071 §3: the account is created `pending_verification` and the
     * confirmation link is what signs a device in. A mock that still answered
     * `201` with an `AuthResource` would be a mock that can only ever confirm
     * behaviour the API no longer has — every test built on it would pass
     * against a response nobody sends.
     *
     * A taken address still answers the generic `409 CONFLICT`, because that
     * is unchanged (ADR-0020 §Enumeration).
     */
    http.post(
      `${PUBLIC_API}/auth/register`,
      async ({ request }): Promise<Response> => {
        state.registerAskedForCookies =
          request.headers.get(TRANSPORT_HEADER) === "cookie";

        // The API's own schema: a body this app builds wrongly throws here.
        const body = registerBody.parse(await request.json());

        state.registerCalls.push(body);

        if (state.takenEmails.includes(body.email))
          return fail(409, "CONFLICT");

        state.takenEmails.push(body.email);

        // `202` with a constant body, which is what the endpoint answers: no
        // token, no principal, nothing a client could mistake for a session.
        return ok({ accepted: true }, 202);
      },
    ),

    /*
     * The confirmation link, spent (`D18.4`, ADR-0071 §3).
     *
     * **On `PUBLIC_API` and mounted whatever the registration flag says**,
     * which is how the API registers it: an address can reach
     * `pending_verification` without self-registration, and a link already in
     * a mailbox must not stop working because sign-ups were closed.
     *
     * It answers **login's body** — the person has just proven the address and
     * the device that opened the link is signed in — and **one
     * indistinguishable `401` for every refusal**, which is the whole of §3's
     * discipline: an unknown token, a consumed one, an expired one and an
     * account that can no longer be activated all answer the same thing. A
     * mock that distinguished them would let this app grow a branch the API
     * can never take.
     */
    http.post(
      `${PUBLIC_API}/auth/verify-email`,
      async ({ request }): Promise<Response> => {
        state.verifyEmailAskedForCookies =
          request.headers.get(TRANSPORT_HEADER) === "cookie";

        const body = verifyEmailBody.parse(await request.json());

        state.verifyEmailCalls.push(body.token);

        if (body.token !== VERIFICATION_TOKEN)
          return fail(401, "UNAUTHENTICATED");

        return ok(authResource("access-verified"));
      },
    ),

    /*
     * "Send me the link again" (`D18.4`, ADR-0071 §3).
     *
     * `202 { accepted: true }` for **every** address — known, unknown, already
     * active — because the answer must not be an oracle (ADR-0020
     * §Enumeration). A mock that refused a stranger's address would let this
     * app render a distinction the API refuses to make.
     */
    http.post(
      `${PUBLIC_API}/auth/resend-verification`,
      async ({ request }): Promise<Response> => {
        const body = resendVerificationBody.parse(await request.json());

        state.resendVerificationCalls.push(body);

        return ok({ accepted: true }, 202);
      },
    ),

    /*
     * "Email me a recovery link" (`D18.6`, ADR-0071 §4).
     *
     * **On `API`, this app's own segment**, which is where the API mounts it —
     * beside `login`, so the population comes from the route and never from a
     * field. A handler on `PUBLIC_API` would answer a request this app never
     * makes and let the real one fall through to `onUnhandledRequest: "error"`.
     *
     * `202 { accepted: true }` for **every** address — a live account's, a
     * stranger's, a disabled one's — because the answer must not be an oracle
     * (ADR-0020 §Enumeration). A mock that refused one of them would let this
     * app render a distinction the API refuses to make.
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
     * expired, or minted on the other segment — for the reason `verify-email`
     * answers one: the caller is an anonymous holder of a URL fragment.
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

    /*
     * The exchange (`D13.7`, ADR-0057 §3).
     *
     * Unauthenticated and CSRF-free, exactly as `auth.routes.ts` registers it:
     * the handoff token is the credential, and the request leans on no cookie
     * for anything to prove intent about. Modelled with the API's own schema,
     * so a body this app builds wrongly throws here.
     *
     * **One indistinguishable `401` for every refusal**, which is the whole of
     * §3's amendment: an unknown token, a consumed one, an expired one, a
     * disabled target and a deleted operator all answer the same thing. A mock
     * that distinguished them would let a client grow a branch the API can
     * never take.
     */
    http.post(
      `${API}/auth/impersonate`,
      async ({ request }): Promise<Response> => {
        state.impersonateAskedForCookies =
          request.headers.get(TRANSPORT_HEADER) === "cookie";

        const body = impersonateBody.parse(await request.json());

        state.impersonateCalls.push(body.token);

        if (body.token !== HANDOFF_TOKEN) return fail(401, "UNAUTHENTICATED");

        return ok({
          ...authResource("access-impersonated"),
          principal: IMPERSONATED_PRINCIPAL,
        });
      },
    ),

    http.post(`${API}/auth/logout`, ({ request }): Response => {
      const refused = csrfChecked(request) ?? authenticated(request);

      if (refused) return refused;

      state.logoutCalls += 1;
      return new Response(null, { status: 204 });
    }),
  ] as const satisfies readonly HttpHandler[];
