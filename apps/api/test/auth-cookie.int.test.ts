import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  cookieValue,
  setCookie,
  setCookies,
} from "./support/transport.js";

/**
 * The properties cookie transport has that `body` transport cannot have
 * (ADR-0029).
 *
 * `auth.int.test.ts` proves the *flows* are identical on both transports,
 * which is the claim that matters most. What is left is everything that is
 * true only because a cookie is involved: the CSRF check, the clearing on
 * logout, rotation rewriting the cookie, and the fact that the two populations
 * cannot reach each other's cookies. Those have no `body` counterpart, so they
 * are not an axis — they are their own file.
 */

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

describe.each(CASES)("$name cookie transport", (population) => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  /** Signs in on cookie transport and returns what the browser would hold. */
  const signIn = async () => {
    const response = await request()
      .post(`${population.base}/login`)
      .set(TRANSPORT_HEADER, "cookie")
      .send(population.credentials())
      .expect(200);

    const refresh = cookieValue(response, REFRESH_COOKIE) ?? "";
    const csrf = cookieValue(response, CSRF_COOKIE) ?? "";

    return {
      accessToken: response.body.data.accessToken as string,
      refresh,
      csrf,
      cookies: [`${REFRESH_COOKIE}=${refresh}`, `${CSRF_COOKIE}=${csrf}`],
    } as const;
  };

  describe("the CSRF double-submit (ADR-0029 §CSRF)", () => {
    it("refuses a cookie-driven refresh with no X-CSRF-Token", async () => {
      // `SameSite=Strict` already stops a cross-*site* request carrying the
      // cookie. This is the same-site half — a compromised subdomain — which
      // `SameSite` does not cover and a server-side check does.
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [...session.cookies])
        .expect(403);

      expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
    });

    it("refuses a wrong X-CSRF-Token", async () => {
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [...session.cookies])
        .set(CSRF_HEADER, "not-the-token")
        .expect(403);

      expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
    });

    it("refuses the header alone, without the cookie it must match", async () => {
      // Half of a double-submit is not a submit: an attacker who can set a
      // header cannot read the cookie, which is the whole asymmetry.
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [`${REFRESH_COOKIE}=${session.refresh}`])
        .set(CSRF_HEADER, session.csrf)
        .expect(403);

      expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
    });

    it("guards logout and logout-all as well", async () => {
      for (const path of ["logout", "logout-all"]) {
        const session = await signIn();

        const response = await request()
          .post(`${population.base}/${path}`)
          .set("Authorization", `Bearer ${session.accessToken}`)
          .set("Cookie", [...session.cookies])
          .expect(403);

        expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
      }
    });

    it("leaves a body-transport caller alone, stale cookie and all", async () => {
      // The rule is "is this request *relying* on the cookie", not "is a
      // cookie attached": a client that sent its own token is not cookie-driven
      // and owes no header. Without this, a browser that switched transports
      // would be locked out by its own leftovers.
      const cookieSession = await signIn();

      const bodyLogin = await request()
        .post(`${population.base}/login`)
        .send(population.credentials())
        .expect(200);

      await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [...cookieSession.cookies])
        .send({ refreshToken: bodyLogin.body.data.refreshToken })
        .expect(200);
    });
  });

  describe("the cookies themselves", () => {
    it("rotates the cookie on every refresh, CSRF token included", async () => {
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [...session.cookies])
        .set(CSRF_HEADER, session.csrf)
        .expect(200);

      // The refresh token rotates (ADR-0018) and the CSRF token goes with it,
      // so a stolen CSRF value is worth one rotation.
      expect(cookieValue(response, REFRESH_COOKIE)).not.toBe(session.refresh);
      expect(cookieValue(response, CSRF_COOKIE)).not.toBe(session.csrf);
      expect(response.body.data.refreshToken).toBeUndefined();
    });

    it("clears both on logout, so the browser stops sending a dead token", async () => {
      // Otherwise every subsequent refresh spends a `RATE_LIMIT_REFRESH_MAX`
      // failure on a value the server has already revoked.
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/logout`)
        .set("Authorization", `Bearer ${session.accessToken}`)
        .set("Cookie", [...session.cookies])
        .set(CSRF_HEADER, session.csrf)
        .expect(204);

      const cleared = setCookies(response);

      expect(cleared).toHaveLength(2);

      for (const name of [REFRESH_COOKIE, CSRF_COOKIE]) {
        const cookie = setCookie(response, name);

        expect(cookie).toBeDefined();
        // Cleared with the attributes it was set with, or the browser keeps
        // the original: a cookie is identified by name, domain **and** path.
        expect(cookie).toContain(`Path=${population.base}`);
        expect(cookieValue(response, name)).toBeUndefined();
      }
    });

    it("clears them for a caller that never had any", async () => {
      // Unconditional, because clearing nothing is free and the alternative is
      // a branch that has to be right.
      const login = await request()
        .post(`${population.base}/login`)
        .send(population.credentials())
        .expect(200);

      const response = await request()
        .post(`${population.base}/logout`)
        .set("Authorization", `Bearer ${login.body.data.accessToken}`)
        .expect(204);

      expect(setCookies(response)).toHaveLength(2);
    });

    it("never sets a cookie for a body-transport caller", async () => {
      const response = await request()
        .post(`${population.base}/login`)
        .send(population.credentials())
        .expect(200);

      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.body.data.refreshToken).toEqual(expect.any(String));
    });
  });

  describe("what the refresh endpoint accepts", () => {
    it("answers 400 when neither the body nor a cookie carries a token", async () => {
      // Not a `401`: nothing was presented, so nothing was rejected.
      const response = await request()
        .post(`${population.base}/refresh`)
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map(
          (detail: { path: string }) => detail.path,
        ),
      ).toContain("refreshToken");
    });

    it("prefers the body when a client sends both", async () => {
      // A client that names its credential gets what it asked for, even with a
      // stale cookie attached.
      const session = await signIn();

      const bodyLogin = await request()
        .post(`${population.base}/login`)
        .send(population.credentials())
        .expect(200);

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [...session.cookies])
        .set(CSRF_HEADER, session.csrf)
        .send({ refreshToken: bodyLogin.body.data.refreshToken })
        .expect(200);

      // The body token rotated, so the response carries its successor rather
      // than a cookie — this request was not on cookie transport.
      expect(response.body.data.refreshToken).toEqual(expect.any(String));
    });
  });
});

/**
 * The segment separation of ADR-0019 §1, expressed in the browser.
 *
 * `Path` keeps a browser from ever sending one population's refresh cookie to
 * the other's endpoints. That is a browser behaviour, so the server-side half
 * is asserted too: a staff refresh token presented to the user segment is
 * simply an unknown token there.
 */
describe("cookie transport across the two segments", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("scopes each population's cookies to its own path", async () => {
    const staff = await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .set(TRANSPORT_HEADER, "cookie")
      .send(superAdmin())
      .expect(200);

    const user = await supertest(harness.app)
      .post("/api/v1/user/auth/login")
      .set(TRANSPORT_HEADER, "cookie")
      .send({ email: FIXTURE_USERS.active, password: FIXTURE_PASSWORD })
      .expect(200);

    expect(setCookie(staff, REFRESH_COOKIE)).toContain(
      "Path=/api/v1/admin/auth",
    );
    expect(setCookie(user, REFRESH_COOKIE)).toContain("Path=/api/v1/user/auth");
  });

  it("refuses a staff refresh cookie presented to the user segment", async () => {
    const staff = await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .set(TRANSPORT_HEADER, "cookie")
      .send(superAdmin())
      .expect(200);

    const refresh = cookieValue(staff, REFRESH_COOKIE) ?? "";
    const csrf = cookieValue(staff, CSRF_COOKIE) ?? "";

    const response = await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .set("Cookie", [`${REFRESH_COOKIE}=${refresh}`, `${CSRF_COOKIE}=${csrf}`])
      .set(CSRF_HEADER, csrf)
      .expect(401);

    // Indistinguishable from a token that never existed, which is the point:
    // the difference must not be learnable (ADR-0019 §1).
    expect(response.body.error.code).toBe("AUTH_INVALID_REFRESH_TOKEN");
  });
});
