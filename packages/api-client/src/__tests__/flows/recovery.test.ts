import {
  forgotPasswordBody,
  resetPasswordBody,
  type ForgotPasswordBody,
  type ResetPasswordBody,
} from "@repo/contracts";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { API, PRINCIPAL } from "../support/auth.handlers";
import { setup } from "../support/client";
import { fail, ok } from "../support/envelope";
import { server } from "../support/server";

import { isApiClientError } from "../../api-error";

/**
 * `src/flows/recovery.ts` at the wire (`D20.7`, ADR-0071 §4).
 *
 * Moved here with the code when `client.ts` was split. See
 * `../client.test.ts` for why the real client runs against MSW rather than a
 * stub.
 */

describe("password recovery", () => {
  /**
   * ADR-0071 §4's pair, on **this client's own segment** (`D18.6`).
   *
   * That is the difference from every call above and it is the population
   * rule: `forgot` and `reset` are mounted beside each segment's `login`, so
   * `API` here — the `admin` segment this suite builds its clients with — is
   * where they are answered, and no override is needed or wanted. A staff
   * address asked for on a customer client reaches the customer segment and
   * mails nothing.
   */
  it("asks for a link on its own segment, with no bearer and no cookie header", async () => {
    const { client, store } = setup();
    const seen: {
      body?: ForgotPasswordBody;
      transport?: string | null;
      authorization?: string | null;
    } = {};

    /*
     * A live session in this browser: asking for a link while signed in is an
     * ordinary thing to do — somebody who cannot remember the password they
     * are about to change on another device — so the header assertions below
     * are about the interceptor's rule rather than about an empty store.
     */
    store.setSession({ accessToken: "a-live-session" });

    server.use(
      http.post(`${API}/auth/password/forgot`, async ({ request }) => {
        seen.transport = request.headers.get("x-auth-transport");
        seen.authorization = request.headers.get("authorization");
        // The API's own schema, so a body this client builds wrongly throws
        // here rather than being quietly accepted (ADR-0036).
        seen.body = forgotPasswordBody.parse(await request.json());

        // `202 { accepted: true }` for every address (ADR-0020 §Enumeration).
        return ok({ accepted: true }, 202);
      }),
    );

    await expect(
      client.forgotPassword({ email: "ada@machxi.local", locale: "en" }),
    ).resolves.toBeUndefined();

    expect(seen.body).toEqual({ email: "ada@machxi.local", locale: "en" });
    // Nothing to put in a cookie: the answer carries no token at all.
    expect(seen.transport).toBeNull();
    // The endpoint reads no principal, so a live bearer on it is a session
    // credential travelling where nothing looks at it.
    expect(seen.authorization).toBeNull();
    expect(store.getAccessToken()).toBe("a-live-session");
  });

  it("spends a link without starting a session", async () => {
    const { client, store } = setup();
    const seen: { body?: ResetPasswordBody; authorization?: string | null } =
      {};

    server.use(
      http.post(`${API}/auth/password/reset`, async ({ request }) => {
        seen.authorization = request.headers.get("authorization");
        seen.body = resetPasswordBody.parse(await request.json());

        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(
      client.resetPassword({
        token: "a-live-link",
        newPassword: "DevPassword!123",
      }),
    ).resolves.toBeUndefined();

    expect(seen.body).toEqual({
      token: "a-live-link",
      newPassword: "DevPassword!123",
    });
    expect(seen.authorization).toBeNull();
    /*
     * The link proved the mailbox, not the device (ADR-0071 §4): the endpoint
     * answers `204` and revokes every session the account had. A client that
     * wrote anything here would be claiming a session the server has just gone
     * out of its way not to issue.
     */
    expect(store.getAccessToken()).toBeNull();
    expect(store.getPrincipal()).toBeNull();
  });

  it("forgets the session this browser was holding", async () => {
    const { client, store, endedCalls } = setup();

    /*
     * The case the `/reset-password` route exists to allow: a link followed in
     * a browser that already holds a session (ADR-0071 §4). The endpoint
     * revokes **every** session of the account, this one included, so a client
     * that merely declined to *write* would sit on a token and a principal the
     * server has just killed — and the screen's landing on `/login` would be
     * bounced straight back by the `_auth` layout's authenticated-visitor
     * guard.
     */
    store.setSession({
      accessToken: "a-live-session",
      principal: PRINCIPAL,
      csrfToken: "a-live-csrf",
    });

    server.use(
      http.post(
        `${API}/auth/password/reset`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    await client.resetPassword({
      token: "a-live-link",
      newPassword: "DevPassword!123",
    });

    expect(store.getAccessToken()).toBeNull();
    expect(store.getPrincipal()).toBeNull();
    // The router is told, so the guards are asked again in the one place that
    // owns them (ADR-0049) rather than by a navigate inside `shared/api`.
    expect(endedCalls()).toBe(1);
  });

  it("does not answer a refused link with a refresh nobody asked for", async () => {
    const { client, store, endedCalls } = setup();
    let refreshCalls = 0;

    store.setSession({ accessToken: "a-live-session" });

    server.use(
      http.post(`${API}/auth/password/reset`, () =>
        fail(401, "UNAUTHENTICATED"),
      ),
      http.post(`${API}/auth/refresh`, () => {
        refreshCalls += 1;
        return fail(401, "AUTH_INVALID_REFRESH_TOKEN");
      }),
    );

    await expect(
      client.resetPassword({
        token: "a-dead-link",
        newPassword: "DevPassword!123",
      }),
    ).rejects.toSatisfy(isApiClientError);

    /*
     * The whole reason the pair joined {@link UNAUTHENTICATED_PATHS}. A `401`
     * here is a spent or expired link, never an expired access token — so
     * retrying it through a refresh would report the *refresh's* sentence over
     * the reset screen's own and end a session the refusal said nothing about.
     */
    expect(refreshCalls).toBe(0);
    expect(endedCalls()).toBe(0);
    expect(store.getAccessToken()).toBe("a-live-session");
  });
});
