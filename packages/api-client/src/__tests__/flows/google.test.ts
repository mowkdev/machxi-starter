import {
  federatedExchangeBody,
  federatedStartBody,
  type FederatedExchangeBody,
  type UserPrincipalResource,
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
 * `src/flows/google.ts` at the wire (`D20.7`, ADR-0072 §2).
 *
 * Moved here with the code when `client.ts` was split. See
 * `../client.test.ts` for why the real client runs against MSW rather than a
 * stub.
 */

describe("signing in with Google", () => {
  /**
   * ADR-0072 §2's start and exchange, on the public segment (`D19.3`). The
   * callback is a navigation from Google to the API and never passes through
   * this client.
   */
  const PUBLIC_API = "http://api.test/api/v1/public";
  const USER_API = "http://api.test/api/v1/user";
  const AUTHORIZATION_URL =
    "https://accounts.google.com/o/oauth2/v2/auth?state=s&nonce=n";

  const GOOGLE_USER: UserPrincipalResource = {
    kind: "user",
    id: "0198c1f0-0000-7000-8000-0000000000c9",
    email: "gina@gmail.com",
    firstName: "Gina",
    lastName: null,
    roles: ["customer"],
  };

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

  it("starts with a JSON body, no bearer and no transport, and writes nothing", async () => {
    const { client, store } = setupUser();
    const seen: {
      body?: unknown;
      contentType?: string | null;
      transport?: string | null;
      authorization?: string | null;
    } = {};

    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(`${PUBLIC_API}/auth/google/start`, async ({ request }) => {
        seen.contentType = request.headers.get("content-type");
        seen.transport = request.headers.get("x-auth-transport");
        seen.authorization = request.headers.get("authorization");
        seen.body = federatedStartBody.parse(await request.json());

        return ok({ authorizationUrl: AUTHORIZATION_URL });
      }),
    );

    await expect(client.startGoogleSignIn({ locale: "lv" })).resolves.toEqual({
      authorizationUrl: AUTHORIZATION_URL,
    });

    expect(seen.body).toEqual({ locale: "lv" });
    /*
     * The API refuses a start that is not `application/json` (ADR-0072 §2 as
     * amended at `D19.2`), because a cross-site form can post `text/plain`
     * without a preflight. Asserted at the wire, since a client that sent a
     * string body would be refused only in production.
     */
    expect(seen.contentType).toMatch(/^application\/json/);
    expect(seen.transport).toBeNull();
    expect(seen.authorization).toBeNull();
    expect(store.getAccessToken()).toBe("somebody-elses-session");
  });

  it("exchanges with the browser's cookies, on cookie transport, and hydrates the store", async () => {
    const { client, store } = setupUser();
    const seen: {
      body?: FederatedExchangeBody;
      credentials?: RequestCredentials;
      transport?: string | null;
      authorization?: string | null;
    } = {};

    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(`${PUBLIC_API}/auth/google/exchange`, async ({ request }) => {
        seen.credentials = request.credentials;
        seen.transport = request.headers.get("x-auth-transport");
        seen.authorization = request.headers.get("authorization");
        seen.body = federatedExchangeBody.parse(await request.json());

        return ok({
          ...authResource("access-google"),
          principal: GOOGLE_USER,
        });
      }),
    );

    await expect(
      client.exchangeGoogleSignIn("a-handoff"),
    ).resolves.toMatchObject({ principal: GOOGLE_USER });

    expect(seen.body).toEqual({ token: "a-handoff" });
    /*
     * The handoff is bound to the browser the callback answered (ADR-0072 §2
     * as amended at `D19.2`): the binding is a cookie on the API's origin, so
     * an exchange sent without credentials carries none and every sign-in
     * answers `401`. MSW reports an XHR's `withCredentials` as the request's
     * credentials mode, which is what this reads.
     */
    expect(seen.credentials).toBe("include");
    expect(seen.transport).toBe("cookie");
    expect(seen.authorization).toBeNull();

    expect(store.getPrincipal()).toEqual(GOOGLE_USER);
    expect(store.getAccessToken()).toBe("access-google");
    expect(store.getCsrfToken()).toBe("csrf-for-access-google");
  });

  it("leaves the session alone, and fires no refresh, when the exchange is refused", async () => {
    const { client, store } = setupUser();
    let refreshCalls = 0;

    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(`${USER_API}/auth/refresh`, () => {
        refreshCalls += 1;
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }),
      http.post(`${PUBLIC_API}/auth/google/exchange`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
    );

    await expect(
      client.exchangeGoogleSignIn("a-dead-handoff"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    // A spent or unbound handoff is not an expired access token.
    expect(refreshCalls).toBe(0);
    expect(store.getAccessToken()).toBe("somebody-elses-session");
  });

  it("refuses to exchange from a client pinned to the admin segment", async () => {
    // No handler: a request that escaped would fail against
    // `onUnhandledRequest: "error"` rather than being answered by accident.
    const { client, store } = setup();

    await expect(client.exchangeGoogleSignIn("a-handoff")).rejects.toSatisfy(
      isApiClientError,
    );
    expect(store.isAuthenticated()).toBe(false);
  });
});
