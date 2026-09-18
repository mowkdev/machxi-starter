import {
  impersonateBody,
  type AuthResource,
  type UserPrincipalResource,
} from "@repo/contracts";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { API, authResource } from "../support/auth.handlers";
import { setup } from "../support/client";
import { fail, ok } from "../support/envelope";
import { server } from "../support/server";

import { isApiClientError } from "../../api-error";
import { createApiClient } from "../../client";
import { createSessionStore } from "../../session-store";

/**
 * `src/flows/sign-in.ts`'s three calls (`D20.7`, ADR-0033, ADR-0057 §3).
 *
 * Moved here with the code when `client.ts` was split. See
 * `../client.test.ts` for why the real client runs against MSW rather than a
 * stub.
 */

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
