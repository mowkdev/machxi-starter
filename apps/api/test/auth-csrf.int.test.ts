import { successEnvelopeSchema } from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { AppConfig } from "../src/core/config/index.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";
import {
  CSRF_HEADER,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  cookieValue,
  csrfCookie,
  setCookie,
  setCookies,
} from "./support/transport.js";

/**
 * `GET /auth/csrf` — the bootstrap endpoint (ADR-0030).
 *
 * The endpoint exists so that an app served from a different host than the API
 * can start a session after a reload, which is the one thing ADR-0029's cookie
 * transport could not do. Three claims carry that, and each is asserted below:
 * the cookie is set with the attributes ADR-0029 gives it, the body echoes the
 * same value, and the call is free — unauthenticated, and charged to nothing a
 * legitimate client needs later.
 *
 * The last two are the ones worth writing down. The auth routers carry no
 * guard matrix, unlike the admin resource routers (ADR-0019), so "this route
 * is deliberately unauthenticated" has nowhere to live except here; and "it
 * does not spend the refresh budget" is invisible in the routing table,
 * because it is a limiter that is *absent*.
 */

/*
 * `CsrfResource` as the wire sees it — the whole contract of the endpoint, and
 * small enough that asserting it exactly is worth more than asserting a shape.
 */
const csrfEnvelope = successEnvelopeSchema(
  z.object({ csrfToken: z.string().min(1) }),
);

/*
 * `randomToken(32)` is 32 bytes of CSPRNG output as unpadded base64url — 43
 * characters. Asserting the shape rather than "not empty" is the difference
 * between a test that notices `randomToken(16)`, a counter or a timestamp and
 * one that does not: unguessability is the whole security property of the
 * value.
 */
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const CASES = [
  {
    name: "staff",
    base: "/api/v1/admin/auth",
    credentials: superAdmin,
  },
  {
    name: "user",
    base: "/api/v1/user/auth",
    credentials: () => ({
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    }),
  },
] as const;

describe.each(CASES)("$name GET /auth/csrf", (population) => {
  /** This segment bootstraps its own population's cookie (ADR-0056). */
  const CSRF_COOKIE = csrfCookie(population.name);

  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const csrf = () => supertest(harness.app).get(`${population.base}/csrf`);

  it("answers the standard envelope with the token", async () => {
    const response = await csrf().expect(200);

    expect(csrfEnvelope.safeParse(response.body).success).toBe(true);
    expect(response.body.data).toEqual({ csrfToken: expect.any(String) });
    expect(response.body.data.csrfToken).toMatch(CSRF_TOKEN);
  });

  it("sets the CSRF cookie and nothing else", async () => {
    const response = await csrf().expect(200);

    // No refresh cookie: this endpoint issues no credential, so there is
    // nothing for a CSRF token to defend yet.
    expect(setCookies(response)).toHaveLength(1);
    expect(setCookie(response, REFRESH_COOKIE)).toBeUndefined();
    expect(setCookie(response, CSRF_COOKIE)).toBeDefined();
  });

  it("sets it with the attributes ADR-0029 gives it", async () => {
    const cookie = setCookie(await csrf().expect(200), CSRF_COOKIE);

    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    // Readable by the client, which is the entire double-submit mechanism.
    expect(cookie).not.toContain("HttpOnly");

    // Durable rather than a session cookie, and specifically the refresh
    // token's TTL — `Max-Age=` alone would pass for `Max-Age=1`, which is the
    // bug this is here to catch (ADR-0030 §What it does, amended D3.2).
    expect(cookie).toContain(
      `Max-Age=${String(harness.config.auth.refreshTtlSec)}`,
    );
  });

  it("returns the same value it put in the cookie", async () => {
    const response = await csrf().expect(200);

    // The load-bearing assertion of the whole endpoint: a cross-host app can
    // never read the cookie, so the body copy is the only one it will see, and
    // a mismatch would be a 403 that looks like a client bug.
    expect(response.body.data.csrfToken).toBe(
      cookieValue(response, CSRF_COOKIE),
    );
  });

  it("mints a token for a caller that presents none", async () => {
    const first = await csrf().expect(200);
    const second = await csrf().expect(200);

    // Two cookie-less callers are two clients, and each needs its own value.
    expect(second.body.data.csrfToken).not.toBe(first.body.data.csrfToken);
    expect(cookieValue(second, CSRF_COOKIE)).toBe(second.body.data.csrfToken);
  });

  it("echoes the token of a caller that already has one", async () => {
    // The endpoint is unauthenticated and takes no input, so a page the
    // operator never meant to visit can cause their browser to call it. A
    // bootstrap that rotated unconditionally would let that page invalidate a
    // signed-in operator's token and turn their next refresh into a `403`.
    // Echoing makes an unintended call a no-op (ADR-0030, amended D3.2).
    const first = await csrf().expect(200);
    const held = first.body.data.csrfToken as string;

    const second = await csrf()
      .set("Cookie", [`${CSRF_COOKIE}=${held}`])
      .expect(200);

    expect(second.body.data.csrfToken).toBe(held);
    // Re-sent rather than left alone, so the `Max-Age` window keeps sliding
    // for a client that is still active.
    expect(cookieValue(second, CSRF_COOKIE)).toBe(held);
  });

  it("mints rather than echoing when the cookie is ambiguous", async () => {
    // `readCookie` fails closed on a duplicate name (ADR-0029), and minting is
    // the right way round: the client ends up holding one unambiguous value it
    // can actually echo, instead of a shadowed one it cannot.
    const response = await csrf()
      .set("Cookie", [`${CSRF_COOKIE}=aaa`, `${CSRF_COOKIE}=bbb`])
      .expect(200);

    expect(response.body.data.csrfToken).toMatch(CSRF_TOKEN);
    expect(response.body.data.csrfToken).not.toBe("aaa");
    expect(response.body.data.csrfToken).not.toBe("bbb");
  });

  it("still rotates on login, which is where rotation is worth having", async () => {
    // The invariant ADR-0029 set: every response that sets the refresh cookie
    // issues a fresh CSRF token beside it, so a leaked one is worth exactly
    // one rotation. Only the bootstrap became idempotent.
    const held = (await csrf().expect(200)).body.data.csrfToken as string;

    const login = await supertest(harness.app)
      .post(`${population.base}/login`)
      .set(TRANSPORT_HEADER, "cookie")
      .set("Cookie", [`${CSRF_COOKIE}=${held}`])
      .send(population.credentials())
      .expect(200);

    expect(cookieValue(login, CSRF_COOKIE)).not.toBe(held);
  });

  it("is never cacheable", async () => {
    // Router-wide `noStore` (ADR-0020), and a requirement here rather than an
    // inherited nicety: a cached body would hand back a token whose
    // `Set-Cookie` never reached the browser.
    const response = await csrf().expect(200);

    expect(response.headers["cache-control"]).toContain("no-store");
  });

  /*
   * The guard-matrix record ADR-0030 §Consequences asks for. The auth routers
   * have no matrix of their own, so "unauthenticated" is stated here or
   * nowhere — and the next reader finds a decision instead of an omission.
   */
  describe("is deliberately unauthenticated", () => {
    it("answers with no Authorization header at all", async () => {
      await csrf().expect(200);
    });

    it("answers even when the bearer token is garbage", async () => {
      // It cannot do otherwise and still be useful: bootstrap runs at the one
      // moment the client is certain to hold no valid access token.
      await csrf().set("Authorization", "Bearer not-a-token").expect(200);
    });
  });

  it("issues a token the refresh check accepts", async () => {
    // End to end, the way ADR-0030 §The client protocol describes it:
    // bootstrap first, then refresh with the token it handed back — no
    // `document.cookie` read anywhere in between.
    const login = await supertest(harness.app)
      .post(`${population.base}/login`)
      .set(TRANSPORT_HEADER, "cookie")
      .send(population.credentials())
      .expect(200);

    const refreshCookie = cookieValue(login, REFRESH_COOKIE);
    const bootstrap = await csrf().expect(200);
    const token = bootstrap.body.data.csrfToken as string;

    await supertest(harness.app)
      .post(`${population.base}/refresh`)
      .set(TRANSPORT_HEADER, "cookie")
      .set("Cookie", [
        `${REFRESH_COOKIE}=${refreshCookie ?? ""}`,
        `${CSRF_COOKIE}=${token}`,
      ])
      .set(CSRF_HEADER, token)
      .expect(200);
  });
});

/**
 * The bootstrap after ADR-0056, which reversed the claim this describe used to
 * make.
 *
 * It read "GET /auth/csrf is host-wide": one `__Host-machxi.csrf` at `Path=/`,
 * so a browser held exactly one whatever it was signed into, and the two routes
 * existed for symmetry rather than because the tokens differed. That was true
 * of the cookie ADR-0029 shipped and is the property D12's finding 6 turned out
 * to be a defect — the sharing *was* the collision. Each route now bootstraps
 * its own population, so the two routes exist for a reason.
 */
describe("GET /auth/csrf is per population", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("writes only its own segment's cookie", async () => {
    const fromAdmin = await supertest(harness.app)
      .get("/api/v1/admin/auth/csrf")
      .expect(200);

    expect(setCookie(fromAdmin, csrfCookie("staff"))).toBeDefined();
    expect(setCookie(fromAdmin, csrfCookie("user"))).toBeUndefined();

    const fromUser = await supertest(harness.app)
      .get("/api/v1/user/auth/csrf")
      .expect(200);

    expect(setCookie(fromUser, csrfCookie("user"))).toBeDefined();
    expect(setCookie(fromUser, csrfCookie("staff"))).toBeUndefined();
  });

  it("echoes its own cookie and ignores the other population's", async () => {
    // Both are at `Path=/`, so a browser signed into both apps presents both
    // here. Bootstrapping the admin segment must not read — and therefore must
    // not re-issue — the customer app's token.
    const held = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const response = await supertest(harness.app)
      .get("/api/v1/admin/auth/csrf")
      .set("Cookie", [`${csrfCookie("user")}=${held}`])
      .expect(200);

    expect(response.body.data.csrfToken).not.toBe(held);
    expect(setCookie(response, csrfCookie("user"))).toBeUndefined();

    /*
     * The positive half, and the one that makes this case discriminating
     * (`D12.12` security review): both assertions above are satisfied by the
     * *pre-split* code too — one shared cookie would also mint something other
     * than `held` and also write no `…csrf.user`. What only the split makes
     * true is that the value went into the **admin's own name**, which is
     * `undefined` against a string on a revert.
     */
    expect(cookieValue(response, csrfCookie("staff"))).toBe(
      response.body.data.csrfToken,
    );
  });

  it("bootstraps a segment whose sibling is already signed in, without disturbing it", async () => {
    // The end-to-end shape of the fix: the customer app is signed in, the
    // admin panel boots and bootstraps, and the customer's token survives
    // it — no re-bootstrap, and no `403` window to be caught by.
    const login = await supertest(harness.app)
      .post("/api/v1/user/auth/login")
      .set(TRANSPORT_HEADER, "cookie")
      .send({ email: FIXTURE_USERS.active, password: FIXTURE_PASSWORD })
      .expect(200);

    const userCsrf = cookieValue(login, csrfCookie("user")) ?? "";

    await supertest(harness.app)
      .get("/api/v1/admin/auth/csrf")
      .set("Cookie", [`${csrfCookie("user")}=${userCsrf}`])
      .expect(200);

    await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .set(TRANSPORT_HEADER, "cookie")
      .set("Cookie", [
        `${REFRESH_COOKIE}=${cookieValue(login, REFRESH_COOKIE) ?? ""}`,
        `${csrfCookie("user")}=${userCsrf}`,
      ])
      .set(CSRF_HEADER, userCsrf)
      .expect(200);
  });
});

describe("GET /auth/csrf and the refresh limiter", () => {
  const REFRESH_MAX = 2;

  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp({
      config: (config: AppConfig): AppConfig => ({
        ...config,
        rateLimit: { ...config.rateLimit, refreshMax: REFRESH_MAX },
      }),
    });
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const badRefresh = () =>
    supertest(harness.app)
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken: "not-a-real-token" });

  it("does not spend the refresh budget", async () => {
    // ADR-0030 §Rate limiting. The limiter is keyed on IP alone, so if the
    // bootstrap were charged to it, any page could exhaust a visitor's budget
    // by calling this endpoint — and on cookie transport a locked-out browser
    // has no token in JavaScript to retry with.
    for (let call = 0; call < REFRESH_MAX * 3; call += 1) {
      await supertest(harness.app).get("/api/v1/admin/auth/csrf").expect(200);
    }

    // Still 401 rather than 429: the budget is untouched, and what spends it
    // is a rejected token (ADR-0029 §Consequences, D2.5).
    await badRefresh().expect(401);
  });

  it("keeps answering once that budget is gone", async () => {
    // A browser that hit the limit must still be able to recover the token it
    // needs to try again, or the limiter turns a slow retry into a dead
    // session.
    // `REFRESH_MAX + 1` rather than `REFRESH_MAX`, so this holds whatever the
    // test above already spent: over-spending an exhausted budget is free.
    for (let call = 0; call < REFRESH_MAX + 1; call += 1) {
      await badRefresh();
    }

    await badRefresh().expect(429);
    await supertest(harness.app).get("/api/v1/admin/auth/csrf").expect(200);
  });
});
