import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { API, createAuthMockState } from "./support/auth.handlers";
import { EMPTY_PAGE, setup } from "./support/client";
import { fail, listOk } from "./support/envelope";
import { server } from "./support/server";

import { isApiClientError } from "../api-error";

/**
 * The single-flight refresh, at the wire (`D20.7`, ADR-0033, ADR-0036).
 *
 * Moved here with `refreshSession` itself when `client.ts` was split. These
 * are the cases that would go wrong silently: `src/session-lifecycle.ts` holds
 * exactly one `inflightRefresh`, and a cut that handed the response
 * interceptor a second copy would still pass every other test in the package
 * while turning one expired token into a reuse alarm (ADR-0018).
 *
 * See `./client.test.ts` for why the real client runs against MSW rather than
 * a stub.
 */

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
