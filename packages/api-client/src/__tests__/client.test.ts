import {
  impersonateBody,
  registerBody,
  type AuthResource,
  type Page,
  type RegisterBody,
  type UserPrincipalResource,
} from "@repo/contracts";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  API,
  authResource,
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "./support/auth.handlers";
import { fail, listOk, ok } from "./support/envelope";
import { server } from "./support/server";

import { isApiClientError } from "../api-error";
import { createBootstrap } from "../bootstrap";
import { createApiClient } from "../client";
import { createSessionStore } from "../session-store";

/**
 * The ADR-0033 plumbing, at the HTTP boundary (ADR-0036 §What must be covered).
 *
 * These are the behaviours that are invisible in any component and wrong in
 * ways that only show up as a user logged out on a Tuesday, so MSW intercepts
 * the wire and the *real* client runs — its interceptors, its header
 * attachment, its single-flight refresh. A test that stubbed `client.get` would
 * prove the stub.
 */

/** `Page<T>` in full, so the handler answers the shape ADR-0014 defines. */
const EMPTY_PAGE: Page<never> = {
  items: [],
  offset: 0,
  limit: 20,
  total: 0,
  sort: [],
  filters: {},
};

const setup = (state: AuthMockState = createAuthMockState()) => {
  const store = createSessionStore();
  let sessionEndedCalls = 0;
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    // The suite's own choice since `D9.1`, not the app's only one: the client
    // is segment-parameterised now, and `admin` is what `support/auth.handlers`
    // answers on. Every assertion below is about behaviour the two segments
    // share, so the value matters only in that it must match the handlers.
    segment: "admin",
    onSessionEnded: () => {
      sessionEndedCalls += 1;
    },
  });

  server.use(...createAuthHandlers(state));

  return {
    store,
    client,
    state,
    bootstrap: createBootstrap(client),
    endedCalls: () => sessionEndedCalls,
  };
};

describe("boot sequence", () => {
  it("fetches a CSRF token, refreshes, and hydrates the store", async () => {
    const { bootstrap, store, state } = setup();

    await expect(bootstrap()).resolves.toBe("authenticated");

    expect(state.csrfCalls).toBe(1);
    expect(state.refreshCalls).toBe(1);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getPrincipal()?.email).toBe("admin@machxi.local");
    // The refresh response's rotated token replaces the bootstrap's.
    expect(store.getCsrfToken()).toBe("csrf-for-access-1");
  });

  it("lands anonymous when the visitor has no session", async () => {
    const state = createAuthMockState();
    state.refreshFailsWith = { status: 401, code: "AUTH_TOKEN_INVALID" };
    const { bootstrap, store } = setup(state);

    // Not an error to report: a first-time visitor has no cookie, and the
    // correct answer is "not signed in" rather than a failure.
    await expect(bootstrap()).resolves.toBe("anonymous");
    expect(store.isAuthenticated()).toBe(false);
  });

  it("rejects rather than reporting anonymous when the API is unreachable", async () => {
    const { bootstrap } = setup();
    server.use(http.get(`${API}/auth/csrf`, () => Response.error()));

    // A failed bootstrap is not "no session" — it is "no API", and sending an
    // operator to a login screen that cannot work either would be worse.
    await expect(bootstrap()).rejects.toSatisfy(isApiClientError);
  });

  it("sends the CSRF token as a header on refresh and nowhere else", async () => {
    const { client, store } = setup();
    const seen: Record<string, string | null> = {};

    server.use(
      http.post(`${API}/auth/refresh`, ({ request }) => {
        seen.refresh = request.headers.get("x-csrf-token");
        return ok({ csrfToken: "unused" });
      }),
      http.get(`${API}/staff`, ({ request }) => {
        seen.staff = request.headers.get("x-csrf-token");
        seen.authorization = request.headers.get("authorization");
        return listOk(EMPTY_PAGE);
      }),
    );

    store.setSession({ accessToken: "token-a", csrfToken: "csrf-a" });
    await client.instance.post("/auth/refresh", {});
    await client.instance.get("/staff");

    // Exactly the set `core/middleware/csrf.ts` guards (ADR-0029 §CSRF).
    expect(seen.refresh).toBe("csrf-a");
    expect(seen.staff).toBeNull();
    expect(seen.authorization).toBe("Bearer token-a");
  });
});

describe("single-flight refresh", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("shares one refresh between every caller that meets a 401", async () => {
    const { client, store, state } = setup();
    let attempts = 0;

    server.use(
      // `: Response` because the resolver branches — MSW infers the body
      // type from the first `return`, so a handler answering either an error or
      // a success envelope needs the widened annotation.
      http.get(`${API}/staff`, (): Response => {
        attempts += 1;
        // The first three callers meet the expired token; their retries carry
        // the new one and succeed.
        return attempts <= 3
          ? fail(401, "AUTH_TOKEN_EXPIRED")
          : listOk(EMPTY_PAGE);
      }),
    );

    store.setSession({ accessToken: "expired", csrfToken: "csrf" });

    await Promise.all([
      client.instance.get("/staff"),
      client.instance.get("/staff"),
      client.instance.get("/staff"),
    ]);

    // The whole point: three concurrent 401s, one refresh. Without it, refresh
    // rotation turns the other two into replays of a just-rotated token, which
    // is reuse detection and a revoked session (ADR-0018).
    expect(state.refreshCalls).toBe(1);
    expect(store.getAccessToken()).toBe("access-1");
  });

  it("retries a request once and no more", async () => {
    const { client, store, endedCalls } = setup();
    let attempts = 0;

    server.use(
      http.get(`${API}/staff`, () => {
        attempts += 1;
        return fail(401, "AUTH_TOKEN_EXPIRED");
      }),
    );

    store.setSession({ accessToken: "expired", csrfToken: "csrf" });

    await expect(client.instance.get("/staff")).rejects.toSatisfy(
      isApiClientError,
    );

    // A second 401 after a fresh token is not staleness, and looping on it is
    // how an outage becomes a request storm.
    expect(attempts).toBe(2);
    expect(store.isAuthenticated()).toBe(false);
    expect(endedCalls()).toBe(1);
  });

  it("does not recurse when refresh itself answers 401", async () => {
    const state = createAuthMockState();
    state.refreshFailsWith = { status: 401, code: "AUTH_TOKEN_INVALID" };
    const { client, store, endedCalls } = setup(state);

    store.setSession({ accessToken: "expired", csrfToken: "csrf" });

    await expect(client.instance.post("/auth/refresh", {})).rejects.toSatisfy(
      isApiClientError,
    );

    expect(state.refreshCalls).toBe(1);
    expect(store.isAuthenticated()).toBe(false);
    expect(endedCalls()).toBe(1);
  });
});

describe("terminal auth codes", () => {
  it.each([
    "AUTH_REFRESH_REUSED",
    "AUTH_SESSION_REVOKED",
    "AUTH_ACCOUNT_DISABLED",
  ] as const)("ends the session on %s", async (code) => {
    const { client, store, endedCalls } = setup();

    server.use(http.get(`${API}/staff`, () => fail(401, code)));
    store.setSession({ accessToken: "token", csrfToken: "csrf" });

    await expect(client.instance.get("/staff")).rejects.toMatchObject({ code });

    // The dead-cookie states of ADR-0029 §Consequences: the server killed the
    // session but could not clear the browser's cookie, so a retry only
    // replays a dead thirty-day credential.
    expect(store.isAuthenticated()).toBe(false);
    expect(endedCalls()).toBe(1);
  });
});

describe("CSRF_TOKEN_INVALID is recoverable", () => {
  it("re-bootstraps and retries once, and the session survives", async () => {
    const { client, store, state } = setup();
    let attempts = 0;

    server.use(
      http.post(`${API}/auth/logout-all`, (): Response => {
        attempts += 1;
        // Stale on the first attempt, accepted once the client has
        // re-bootstrapped — the two-tab race, with no attacker in sight.
        return attempts === 1
          ? fail(403, "CSRF_TOKEN_INVALID")
          : new Response(null, { status: 204 });
      }),
    );

    store.setSession({ accessToken: "token", csrfToken: "stale" });

    await client.instance.post("/auth/logout-all");

    expect(attempts).toBe(2);
    expect(state.csrfCalls).toBe(1);
    expect(store.getCsrfToken()).toBe("bootstrap-csrf-1");
    // The point of the D3.2 amendment: this used to end the session.
    expect(store.isAuthenticated()).toBe(true);
  });

  it("recovers on refresh itself, without deadlocking the single flight", async () => {
    /*
     * ADR-0036 names this case by endpoint, and it is the one with a hazard the
     * others do not have: the retry is issued from *inside* the promise
     * `inflightRefresh` is holding, so a naive implementation either deadlocks
     * awaiting itself or rotates twice.
     */
    const { client, store, state } = setup();
    let attempts = 0;

    server.use(
      http.post(`${API}/auth/refresh`, (): Response => {
        attempts += 1;
        state.refreshCalls += 1;

        return attempts === 1
          ? fail(403, "CSRF_TOKEN_INVALID")
          : ok(authResource("access-after-rebootstrap"));
      }),
    );

    store.setSession({ accessToken: "token", csrfToken: "stale" });

    await client.refreshSession();

    expect(state.refreshCalls).toBe(2);
    expect(state.csrfCalls).toBe(1);
    expect(store.getAccessToken()).toBe("access-after-rebootstrap");
    expect(store.isAuthenticated()).toBe(true);
  });

  it("ends the session on a second failure", async () => {
    const { client, store, endedCalls } = setup();
    let attempts = 0;

    server.use(
      http.post(`${API}/auth/logout-all`, () => {
        attempts += 1;
        return fail(403, "CSRF_TOKEN_INVALID");
      }),
    );

    store.setSession({ accessToken: "token", csrfToken: "stale" });

    await expect(
      client.instance.post("/auth/logout-all"),
    ).rejects.toMatchObject({ code: "CSRF_TOKEN_INVALID" });

    // A shadowed duplicate cookie survives any number of re-bootstraps, so the
    // retry is bounded at one and the loop the terminal list prevents stays
    // prevented.
    expect(attempts).toBe(2);
    expect(store.isAuthenticated()).toBe(false);
    expect(endedCalls()).toBe(1);
  });
});

describe("failures without an envelope", () => {
  it("still rejects with an ApiClientError", async () => {
    const { client } = setup();

    server.use(http.get(`${API}/staff`, () => Response.error()));

    // The invariant ADR-0033 §Consequences left to this step: callers get one
    // failure type, or the abstraction is not one.
    await expect(client.instance.get("/staff")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 0,
    });
  });

  it("rejects with the envelope's code when there is one", async () => {
    const { client } = setup();

    server.use(
      http.get(`${API}/staff`, () => fail(403, "FORBIDDEN", "Not for you")),
    );

    await expect(client.instance.get("/staff")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Not for you",
      status: 403,
    });
  });
});

describe("logout", () => {
  it("clears the session even when the request fails", async () => {
    const { client, store, endedCalls } = setup();

    server.use(http.post(`${API}/auth/logout`, () => Response.error()));
    store.setSession({ accessToken: "token", csrfToken: "csrf" });

    await expect(client.logout()).rejects.toSatisfy(isApiClientError);

    // A client that cannot reach the API must still end what it controls; the
    // server-side session dies at its TTL.
    expect(store.isAuthenticated()).toBe(false);
    expect(endedCalls()).toBe(1);
  });
});

describe("the impersonation exchange", () => {
  /**
   * `/api/v1/user`, because the route registers on that segment only
   * (ADR-0057 §3): an admin-segment twin would be a way to turn a URL fragment
   * into a staff session, so a suite that exercised one would be certifying
   * the thing the design refuses.
   */
  const USER_API = "http://api.test/api/v1/user";

  const CUSTOMER: UserPrincipalResource = {
    kind: "user",
    id: "0198c1f0-0000-7000-8000-0000000000c1",
    email: "customer@machxi.local",
    firstName: "Cara",
    lastName: "Customer",
    roles: ["customer"],
    impersonatedBy: {
      id: "0198c1f0-0000-7000-8000-0000000000a1",
      email: "operator@machxi.local",
    },
  };

  const IMPERSONATED: AuthResource = {
    ...authResource("access-impersonated"),
    principal: CUSTOMER,
  };

  const setupUser = () => {
    const store = createSessionStore();
    let sessionEndedCalls = 0;

    return {
      store,
      client: createApiClient({
        store,
        baseUrl: "http://api.test",
        segment: "user",
        onSessionEnded: () => {
          sessionEndedCalls += 1;
        },
      }),
      endedCalls: () => sessionEndedCalls,
    };
  };

  it("posts the token, asks for cookie transport, and hydrates the store", async () => {
    const { client, store } = setupUser();
    const seen: { token?: string; transport?: string | null } = {};

    server.use(
      http.post(`${USER_API}/auth/impersonate`, async ({ request }) => {
        seen.transport = request.headers.get("x-auth-transport");
        // The API's own schema, so a body this client builds wrongly throws
        // here rather than being quietly accepted (ADR-0036).
        seen.token = impersonateBody.parse(await request.json()).token;

        return ok(IMPERSONATED);
      }),
    );

    await expect(client.redeemHandoff("a-handoff")).resolves.toEqual(
      IMPERSONATED,
    );

    expect(seen.token).toBe("a-handoff");
    /*
     * The header ADR-0057 §3 makes the difference between a session and a
     * screenful of one: without it the API answers with a body-borne refresh
     * token and sets no cookie, so the exchange looks like it worked until the
     * first reload. Nothing in the response says which happened, which is why
     * the assertion is on the request.
     */
    expect(seen.transport).toBe("cookie");

    expect(store.isAuthenticated()).toBe(true);
    expect(store.getCsrfToken()).toBe("csrf-for-access-impersonated");
    expect(store.getPrincipal()).toEqual(CUSTOMER);
  });

  it("does not chase a refused exchange with a refresh", async () => {
    const { client, store, endedCalls } = setupUser();
    let refreshCalls = 0;

    server.use(
      http.post(`${USER_API}/auth/impersonate`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
      http.post(`${USER_API}/auth/refresh`, () => {
        refreshCalls += 1;
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }),
    );

    /*
     * The caller is handed the exchange's own failure. Left off the
     * "never recurse on this" list, the `401` would be read as an expired
     * access token, a refresh nobody asked for would go out, and the rejection
     * would carry *its* code instead — with `endSession` firing over a session
     * that never existed.
     */
    await expect(client.redeemHandoff("a-dead-handoff")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });

    expect(refreshCalls).toBe(0);
    expect(endedCalls()).toBe(0);
    expect(store.isAuthenticated()).toBe(false);
  });

  it("leaves the store alone when the exchange is refused", async () => {
    const { client, store } = setupUser();

    server.use(
      http.post(`${USER_API}/auth/impersonate`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
    );

    /*
     * The pre-existing real customer session ADR-0057 §3 declines to disturb:
     * a refused exchange must not half-write an identity over it. Seeded with
     * a **principal** as well as a token, because "must not overwrite an
     * identity" is not asserted by a store that never held one — the first
     * draft of this case checked `getPrincipal()` was null when it had always
     * been null (`D13.7`'s review).
     */
    const resident: UserPrincipalResource = {
      kind: "user",
      id: "0198c1f0-0000-7000-8000-0000000000c2",
      email: "someone.else@machxi.local",
      firstName: "Sam",
      lastName: "Someone",
      roles: ["customer"],
    };

    store.setSession({
      accessToken: "already-signed-in",
      csrfToken: "csrf-a",
      principal: resident,
    });

    await expect(client.redeemHandoff("a-dead-handoff")).rejects.toSatisfy(
      isApiClientError,
    );

    expect(store.getAccessToken()).toBe("already-signed-in");
    expect(store.getCsrfToken()).toBe("csrf-a");
    expect(store.getPrincipal()).toEqual(resident);
  });
});

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

describe("an unrecognised code degrades to its status family", () => {
  /*
   * ADR-0015 makes a new error code additive, so an already-shipped bundle
   * *will* meet a code its `ErrorCode` union does not contain — D13's
   * `AUTH_IMPERSONATION_REFUSED` was the next one, which is why this landed at
   * `D13.1`, before the code existed (ADR-0057 §Consequences). `D13.3` then
   * declared it, so the codes below are invented: a test of "this build does
   * not know it" has to use a code the build genuinely does not know, or it
   * quietly stops testing anything the day the placeholder ships.
   *
   * The property is the one `@repo/contracts`' `errors.ts` already states in
   * as many words: an unrecognised code is "a generic failure of whatever HTTP
   * status carried it". Until `D13.1` the client said the opposite — the
   * envelope's `code` was a closed enum, so an unknown one failed the parse,
   * the whole response stopped being an envelope, and a refusal the server
   * delivered perfectly well was reported as an unreachable service.
   *
   * The cast is the test saying "a code this build does not know": the state
   * the type system cannot express, because the union *is* this build's.
   */
  it("reports an unknown code on a 403 as the forbidden-family generic", async () => {
    const { client } = setup();

    server.use(
      http.get(`${API}/staff`, () =>
        fail(
          403,
          "AUTH_SOMETHING_A_LATER_DELIVERABLE_ADDS" as "FORBIDDEN",
          "That is not allowed while impersonating",
        ),
      ),
    );

    await expect(client.instance.get("/staff")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("keeps the status family for a conflict it has never heard of", async () => {
    const { client } = setup();

    server.use(
      http.get(`${API}/staff`, () =>
        fail(409, "SOMETHING_NEW_FROM_THE_FUTURE" as "CONFLICT"),
      ),
    );

    await expect(client.instance.get("/staff")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("still reports a body that is not an envelope as a transport failure", async () => {
    const { client } = setup();

    // The boundary the widening must not erode: a proxy's HTML is not an
    // envelope with an unfamiliar code, and calling its status family a
    // refusal would put words in a server's mouth.
    server.use(
      http.get(
        `${API}/staff`,
        () => new HttpResponse("<html>gateway</html>", { status: 502 }),
      ),
    );

    await expect(client.instance.get("/staff")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 502,
    });
  });
});
