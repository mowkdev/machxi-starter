import {
  registerBody,
  resendVerificationBody,
  verifyEmailBody,
  type AuthResource,
  type RegisterBody,
  type ResendVerificationBody,
  type UserPrincipalResource,
  type VerifyEmailBody,
} from "@repo/contracts";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { authResource } from "../support/auth.handlers";
import { setup } from "../support/client";
import { fail, ok } from "../support/envelope";
import { server } from "../support/server";

import { isApiClientError } from "../../api-error";
import { createApiClient } from "../../client";
import { createSessionStore } from "../../session-store";

/**
 * `src/flows/registration.ts` at the wire (`D20.7`, ADR-0067 §6, ADR-0071 §3).
 *
 * Moved here with the code when `client.ts` was split. See
 * `../client.test.ts` for why the real client runs against MSW rather than a
 * stub.
 */

describe("registration", () => {
  /**
   * `/api/v1/public`, which is the whole reason this block exists (`D15.6`,
   * ADR-0015, ADR-0067 §6).
   *
   * Registration is the one call in this package that leaves its client's
   * segment — it is the endpoint for somebody who has no population yet — and
   * a per-request `baseURL` is what takes it there. The handler is mounted on
   * the public address and nowhere else, so a client that sent it to
   * `/api/v1/admin` fails against `onUnhandledRequest: "error"` rather than
   * against an assertion somebody has to remember to write.
   */
  const PUBLIC_API = "http://api.test/api/v1/public";

  /** Where this block's client's *other* requests go, refresh among them. */
  const USER_API = "http://api.test/api/v1/user";

  const NEW_ACCOUNT: RegisterBody = {
    email: "new@machxi.local",
    password: "DevPassword!123",
    firstName: "Nina",
    lastName: "Newcomer",
  };

  /**
   * A `user`-segment client, because registration is one (`D15.6`).
   *
   * The file's own `setup` builds an `admin` client — the segment
   * `support/auth.handlers` answers on — and `register` refuses that outright,
   * which is the last case in this block.
   */
  const setupUser = () => {
    const store = createSessionStore();

    return {
      store,
      client: createApiClient({
        store,
        baseUrl: "http://api.test",
        segment: "user",
      }),
    };
  };

  it("posts to the public segment and leaves the store exactly as it found it", async () => {
    const { client, store } = setupUser();
    const seen: {
      body?: RegisterBody;
      transport?: string | null;
      authorization?: string | null;
    } = {};

    // A live session in the store, so the `Authorization` assertion below is
    // about the interceptor's rule rather than about an empty store.
    store.setSession({ accessToken: "a-session-already-here" });

    server.use(
      http.post(`${PUBLIC_API}/auth/register`, async ({ request }) => {
        seen.transport = request.headers.get("x-auth-transport");
        seen.authorization = request.headers.get("authorization");
        // The API's own schema, so a body this client builds wrongly throws
        // here rather than being quietly accepted (ADR-0036).
        seen.body = registerBody.parse(await request.json());

        // What the endpoint answers since ADR-0071 §3: no token, no principal,
        // nothing a client could mistake for a session.
        return ok({ accepted: true }, 202);
      }),
    );

    await expect(client.register(NEW_ACCOUNT)).resolves.toBeUndefined();

    expect(seen.body).toEqual(NEW_ACCOUNT);
    /*
     * `X-Auth-Transport: cookie` moved off this call with the session
     * (ADR-0029 §Opt-in): the header exists to put a refresh token in a cookie
     * instead of in the body, and there is now no token in either. Asserted at
     * the wire because nothing in the response can show it.
     */
    expect(seen.transport).toBeNull();
    // The credential is the password in the body; the bearer has no business
    // on a route that reads no principal.
    expect(seen.authorization).toBeNull();

    /*
     * **The session already in the store is untouched, and so is an empty
     * one.** This is the assertion the step exists for: hydrating from a `202`
     * would write `undefined` where the access token and the principal go —
     * not "no session" but a broken one, on a client that would then believe
     * it was signed in.
     */
    expect(store.getAccessToken()).toBe("a-session-already-here");
  });

  it("leaves the store alone when the address is taken", async () => {
    const { client, store } = setupUser();

    server.use(
      http.post(`${PUBLIC_API}/auth/register`, () => fail(409, "CONFLICT")),
    );

    await expect(client.register(NEW_ACCOUNT)).rejects.toSatisfy(
      isApiClientError,
    );

    // Half-writing a session over a refusal is the failure `redeemHandoff`
    // records for its own path; the rule is the same one endpoint along.
    expect(store.isAuthenticated()).toBe(false);
  });

  it("does not retry a 401 through a refresh nobody asked for", async () => {
    const { client, store } = setupUser();
    let refreshCalls = 0;

    server.use(
      /*
       * On the **user** segment, which is where this client's refresh would
       * actually go: the file's shared handlers answer `admin`, so counting
       * there would have left the assertion below true whether the refresh
       * happened or not.
       */
      http.post(`${USER_API}/auth/refresh`, () => {
        refreshCalls += 1;
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }),
      /*
       * Not something this API can answer — the public router mounts no guard
       * — but edge auth, a WAF or a staging reverse proxy in front of it can,
       * which is the same justification `/auth/csrf` is on the exclusion list
       * for. Left off it, an anonymous visitor on the sign-up screen would
       * have fired a refresh with no credential, been "signed out" of a
       * session they never had, and read the refresh's sentence over their
       * registration.
       */
      http.post(`${PUBLIC_API}/auth/register`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
    );

    await expect(client.register(NEW_ACCOUNT)).rejects.toMatchObject({
      // The registration's own failure, not the refresh's.
      code: "UNAUTHENTICATED",
    });

    expect(refreshCalls).toBe(0);
    expect(store.isAuthenticated()).toBe(false);
  });

  it("refuses to register from a client pinned to the admin segment", async () => {
    // No handler: a request that escaped would fail loudly against
    // `onUnhandledRequest: "error"` rather than being answered by accident.
    const { client, store } = setup();

    await expect(client.register(NEW_ACCOUNT)).rejects.toSatisfy(
      isApiClientError,
    );

    /*
     * The point is the *write*, not the request. The endpoint is public and
     * would answer anybody, so nothing on the server stops a `user` principal
     * being hydrated into the store an admin app's guards read — which makes
     * this the one place in the client that reads its own segment.
     */
    expect(store.isAuthenticated()).toBe(false);
  });
});

describe("address verification", () => {
  /**
   * ADR-0071 §3's pair, on the public segment beside registration (`D18.4`).
   *
   * The same `/api/v1/public` override registration established, so a client
   * that sent either to `/api/v1/user` would meet no handler and fail against
   * `onUnhandledRequest: "error"` rather than an assertion somebody has to
   * remember to write.
   */
  const PUBLIC_API = "http://api.test/api/v1/public";
  const USER_API = "http://api.test/api/v1/user";

  const VERIFIED: UserPrincipalResource = {
    kind: "user",
    id: "0198c1f0-0000-7000-8000-0000000000c3",
    email: "nina@machxi.local",
    firstName: "Nina",
    lastName: "Newcomer",
    roles: ["customer"],
  };

  const verifiedResource = (): AuthResource => ({
    ...authResource("access-verified"),
    principal: VERIFIED,
  });

  /** A `user`-segment client, because these are user-population flows. */
  const setupUser = () => {
    const store = createSessionStore();

    return {
      store,
      client: createApiClient({
        store,
        baseUrl: "http://api.test",
        segment: "user",
      }),
    };
  };

  it("asks for cookie transport, sends no bearer, and hydrates the store", async () => {
    const { client, store } = setupUser();
    const seen: {
      body?: VerifyEmailBody;
      transport?: string | null;
      authorization?: string | null;
    } = {};

    /*
     * A live session already in this browser — the ordinary case rather than
     * the exotic one, since a link is followed wherever the mail is read — so
     * the `Authorization` assertion below is about the interceptor's rule and
     * not about an empty store.
     */
    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(`${PUBLIC_API}/auth/verify-email`, async ({ request }) => {
        seen.transport = request.headers.get("x-auth-transport");
        seen.authorization = request.headers.get("authorization");
        // The API's own schema, so a body this client builds wrongly throws
        // here rather than being quietly accepted (ADR-0036).
        seen.body = verifyEmailBody.parse(await request.json());

        return ok(verifiedResource());
      }),
    );

    await expect(client.verifyEmail("a-live-link")).resolves.toMatchObject({
      principal: VERIFIED,
    });

    expect(seen.body).toEqual({ token: "a-live-link" });
    /*
     * The header registration lost and this call inherited (ADR-0029 §Opt-in,
     * ADR-0071 §3): without it the refresh token comes back in the body, no
     * cookie is set, and the account is signed in until the first reload —
     * having spent the one link it had. Invisible in the response, so it is
     * asserted at the wire.
     */
    expect(seen.transport).toBe("cookie");
    // The credential is the token in the body. Whoever already had this
    // browser has no business on the request that replaces them.
    expect(seen.authorization).toBeNull();

    expect(store.getPrincipal()).toEqual(VERIFIED);
    expect(store.getAccessToken()).toBe("access-verified");
    expect(store.getCsrfToken()).toBe("csrf-for-access-verified");
  });

  it("leaves the session already in the browser alone when the link is refused", async () => {
    const { client, store } = setupUser();

    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(`${PUBLIC_API}/auth/verify-email`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
    );

    await expect(client.verifyEmail("a-dead-link")).rejects.toSatisfy(
      isApiClientError,
    );

    // Half-writing an identity over a refusal is the failure `redeemHandoff`
    // records for its own path; the rule is the same one endpoint along.
    expect(store.getAccessToken()).toBe("somebody-elses-session");
  });

  it("does not retry a 401 through a refresh nobody asked for", async () => {
    const { client } = setupUser();
    let refreshCalls = 0;

    server.use(
      http.post(`${USER_API}/auth/refresh`, () => {
        refreshCalls += 1;
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }),
      http.post(`${PUBLIC_API}/auth/verify-email`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
    );

    /*
     * Every way the endpoint can fail answers one `401` (ADR-0071 §3), and
     * none of them is an expired access token. Off {@link
     * UNAUTHENTICATED_PATHS} the client would fire a refresh nobody asked for
     * and hand the caller the *refresh's* failure instead of the link's — and
     * `endSession` would fire over a session that may not even be this
     * person's.
     */
    await expect(client.verifyEmail("a-dead-link")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    expect(refreshCalls).toBe(0);
  });

  it("refuses to verify from a client pinned to the admin segment", async () => {
    // No handler: a request that escaped would fail loudly against
    // `onUnhandledRequest: "error"` rather than being answered by accident.
    const { client, store } = setup();

    await expect(client.verifyEmail("a-live-link")).rejects.toSatisfy(
      isApiClientError,
    );

    /*
     * The point is the *write*, not the request. The endpoint is public and
     * would answer anybody, so nothing on the server stops a `user` principal
     * being hydrated into the store an admin app's guards read.
     */
    expect(store.isAuthenticated()).toBe(false);
  });

  it("resends without a bearer, without cookie transport, and writes nothing", async () => {
    const { client, store } = setupUser();
    const seen: {
      body?: ResendVerificationBody;
      transport?: string | null;
      authorization?: string | null;
    } = {};

    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(
        `${PUBLIC_API}/auth/resend-verification`,
        async ({ request }) => {
          seen.transport = request.headers.get("x-auth-transport");
          seen.authorization = request.headers.get("authorization");
          seen.body = resendVerificationBody.parse(await request.json());

          // `202 { accepted: true }` for every address, known or not
          // (ADR-0020 §Enumeration).
          return ok({ accepted: true }, 202);
        },
      ),
    );

    await expect(
      client.resendVerification({ email: "nina@machxi.local", locale: "en" }),
    ).resolves.toBeUndefined();

    expect(seen.body).toEqual({ email: "nina@machxi.local", locale: "en" });
    // Nothing to put in a cookie: the answer carries no token at all.
    expect(seen.transport).toBeNull();
    expect(seen.authorization).toBeNull();
    expect(store.getAccessToken()).toBe("somebody-elses-session");
  });
});
