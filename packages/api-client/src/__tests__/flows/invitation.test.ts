import {
  lookupInvitationBody,
  type LookupInvitationBody,
} from "@repo/contracts";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { API } from "../support/auth.handlers";
import { fail, ok } from "../support/envelope";
import { server } from "../support/server";

import { createApiClient } from "../../client";
import { createSessionStore } from "../../session-store";

/**
 * `src/flows/invitation.ts`'s lookup at the wire (`D20.7`, ADR-0071 §5).
 *
 * Moved here with the code when `client.ts` was split. See
 * `../client.test.ts` for why the real client runs against MSW rather than a
 * stub.
 */

describe("the invitation link's lookup", () => {
  /**
   * ADR-0071 §5's unauthenticated read (`D18.8`).
   *
   * On the **public** segment, like `register` and the verification pair, and
   * for their reason: the caller is whoever opened the mail and may have no
   * account at all. A `user`-segment client is built here because the screen
   * that calls it is the customer app's.
   */
  const PUBLIC_API = "http://api.test/api/v1/public";

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

  it("posts the token to the public segment with no bearer and writes nothing", async () => {
    const { client, store } = setupUser();
    const seen: {
      body?: LookupInvitationBody;
      authorization?: string | null;
      transport?: string | null;
    } = {};

    /*
     * A live session in this browser: an invitation link is followed wherever
     * the mail is read, and very often that is a browser already signed in as
     * somebody — which is the whole reason the screen has a mismatch state. So
     * the header assertions are about the interceptor's rule rather than about
     * an empty store.
     */
    store.setSession({ accessToken: "somebody-elses-session" });

    server.use(
      http.post(`${PUBLIC_API}/invitations/lookup`, async ({ request }) => {
        seen.authorization = request.headers.get("authorization");
        seen.transport = request.headers.get("x-auth-transport");
        // The API's own schema, so a body this client builds wrongly throws
        // here rather than being quietly accepted (ADR-0036).
        seen.body = lookupInvitationBody.parse(await request.json());

        return ok({
          organizationName: "Globex",
          email: "invitee@machxi.local",
          role: "admin",
        });
      }),
    );

    await expect(client.lookupInvitation("a-live-link")).resolves.toEqual({
      organizationName: "Globex",
      email: "invitee@machxi.local",
      role: "admin",
    });

    expect(seen.body).toEqual({ token: "a-live-link" });
    /*
     * {@link UNAUTHENTICATED_PATHS}: the token is the credential and the route
     * reads no principal, so a bearer here would be a live session travelling
     * where nothing looks at it. Nothing is put in a cookie either — the
     * answer carries no session at all.
     */
    expect(seen.authorization).toBeNull();
    expect(seen.transport).toBeNull();
    expect(store.getAccessToken()).toBe("somebody-elses-session");
  });

  it("does not answer a dead link with a refresh nobody asked for", async () => {
    const { client, store } = setupUser();
    let refreshCalls = 0;

    store.setSession({ accessToken: "a-live-session" });

    server.use(
      http.post(`${PUBLIC_API}/invitations/lookup`, () =>
        fail(404, "NOT_FOUND"),
      ),
      http.post(`${API}/auth/refresh`, () => {
        refreshCalls += 1;
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }),
    );

    await expect(client.lookupInvitation("a-dead-link")).rejects.toMatchObject({
      status: 404,
    });

    /*
     * A `404` is not a `401`, so the retry path was never in question here —
     * what this asserts is that the refusal reaches the screen as itself, with
     * the session in the browser untouched. Unknown, accepted, declined,
     * revoked and expired are all this one answer (ADR-0071 §5).
     */
    expect(refreshCalls).toBe(0);
    expect(store.getAccessToken()).toBe("a-live-session");
  });
});
