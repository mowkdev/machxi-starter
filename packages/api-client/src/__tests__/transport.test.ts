import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { API, authResource } from "./support/auth.handlers";
import { setup } from "./support/client";
import { fail, ok } from "./support/envelope";
import { server } from "./support/server";

/**
 * The response interceptor's own decisions (`D20.7`, ADR-0033 §Response
 * translation, ADR-0057 §Consequences).
 *
 * Moved here with `src/transport.ts` when `client.ts` was split: which codes
 * end a session, which are recoverable and how far, and what a failure that
 * arrives without an envelope becomes. Every one of them is invisible in any
 * component and wrong in a way that shows up as somebody logged out on a
 * Tuesday.
 *
 * See `./client.test.ts` for why the real client runs against MSW rather than
 * a stub.
 */

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

  it.each(["/auth/login", "/auth/password/forgot", "/auth/password/reset"])(
    "leaves the session alone when %s answers one",
    async (path) => {
      const { client, store, endedCalls } = setup();

      /*
       * A route whose credential is in the body carries no session, so a
       * terminal code from it says nothing about one in this browser (`D18.6`,
       * `security-reviewer`). The branch above read `!isLogin` and happened to
       * be {@link UNAUTHENTICATED_PATHS} when that list had one entry; it has
       * seven now, and the divergence would have signed a bystander out for
       * asking after a password.
       *
       * Not reachable from this API — each of these answers a single
       * indistinguishable code — but a proxy, a WAF or edge auth in front of it
       * can answer anything, which is the same reason `isCsrf` exists.
       */
      server.use(
        http.post(`${API}${path}`, () => fail(403, "AUTH_ACCOUNT_DISABLED")),
      );
      store.setSession({ accessToken: "somebody-elses-session" });

      await expect(client.instance.post(path, {})).rejects.toMatchObject({
        code: "AUTH_ACCOUNT_DISABLED",
      });

      expect(store.getAccessToken()).toBe("somebody-elses-session");
      expect(endedCalls()).toBe(0);
    },
  );
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
