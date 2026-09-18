import { http } from "msw";
import { describe, expect, it } from "vitest";

import { API, createAuthMockState } from "./support/auth.handlers";
import { EMPTY_PAGE, setup } from "./support/client";
import { listOk, ok } from "./support/envelope";
import { server } from "./support/server";

import { isApiClientError } from "../api-error";

/**
 * The ADR-0033 plumbing, at the HTTP boundary (ADR-0036 §What must be covered).
 *
 * These are the behaviours that are invisible in any component and wrong in
 * ways that only show up as a user logged out on a Tuesday, so MSW intercepts
 * the wire and the *real* client runs — its interceptors, its header
 * attachment, its single-flight refresh. A test that stubbed `client.get` would
 * prove the stub.
 */

/*
 * **What is left here after `D20.7`.** The file held the whole of the ADR-0033
 * suite until `client.ts` was split; the cases moved with the code they test —
 * the interceptors' recovery to `transport.test.ts`, the single flight to
 * `session-lifecycle.test.ts`, and the twelve flows to `flows/`. The boot
 * sequence stays, because it is the one block that asserts on the *composed*
 * client: two requests, three modules, and a store that ends up hydrated.
 *
 * The fixture every one of those files builds its client with is
 * `./support/client`.
 */

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
