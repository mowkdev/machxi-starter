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
  CSRF_HEADER,
  LEGACY_CSRF_COOKIE,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  cookieValue,
  csrfCookie,
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
  /** This population's CSRF cookie and no other (ADR-0056). */
  const CSRF_COOKIE = csrfCookie(population.name);

  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
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

    it("refuses a request whose CSRF cookie was shadowed", async () => {
      // A sibling subdomain can set a `Domain=` cookie of the same name, and
      // RFC 6265 orders the header so the attacker's copy can come first.
      // `readCookie` fails closed on a duplicate, so the double-submit cannot
      // be satisfied by a value the attacker chose.
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [`${CSRF_COOKIE}=attacker-chosen`, ...session.cookies])
        .set(CSRF_HEADER, "attacker-chosen")
        .expect(403);

      expect(response.body.error.code).toBe("CSRF_TOKEN_INVALID");
    });

    it("refuses a request whose refresh cookie was shadowed", async () => {
      // The same defence on the credential itself: a planted refresh cookie
      // would otherwise be session fixation, since the shadow keeps winning
      // every rotation.
      const session = await signIn();

      const response = await request()
        .post(`${population.base}/refresh`)
        .set("Cookie", [
          `${REFRESH_COOKIE}=attacker-session`,
          ...session.cookies,
        ])
        .set(CSRF_HEADER, session.csrf)
        // No refresh cookie survives the duplicate, so nothing was presented.
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("hands the client the CSRF token in the body as well", async () => {
      // The cookie is what a page re-reads after a reload; this is what an app
      // served from a different host than the API uses, since it can never
      // read the API's cookies (ADR-0029 §CSRF, amended D2.5).
      const response = await request()
        .post(`${population.base}/login`)
        .set(TRANSPORT_HEADER, "cookie")
        .send(population.credentials())
        .expect(200);

      expect(response.body.data.csrfToken).toBe(
        cookieValue(response, CSRF_COOKIE),
      );
    });

    it("omits the CSRF token from a body-transport response", async () => {
      const response = await request()
        .post(`${population.base}/login`)
        .send(population.credentials())
        .expect(200);

      expect(response.body.data.csrfToken).toBeUndefined();
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

      // Cleared with the attributes each was set with, or the browser keeps
      // the original: a cookie is identified by name, domain **and** path.
      expect(setCookie(response, REFRESH_COOKIE)).toContain(
        `Path=${population.base}`,
      );
      expect(setCookie(response, CSRF_COOKIE)).toContain("Path=/");

      for (const name of [REFRESH_COOKIE, CSRF_COOKIE]) {
        expect(setCookie(response, name)).toBeDefined();
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
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
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
    const csrf = cookieValue(staff, csrfCookie("staff")) ?? "";

    const response = await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      // The CSRF value is presented under the *user* population's name, so
      // the double-submit passes and the assertion below is about the refresh
      // token rather than about ADR-0056's split. Sending it under the staff
      // name would answer `403` for a different and less interesting reason.
      .set("Cookie", [
        `${REFRESH_COOKIE}=${refresh}`,
        `${csrfCookie("user")}=${csrf}`,
      ])
      .set(CSRF_HEADER, csrf)
      .expect(401);

    // Indistinguishable from a token that never existed, which is the point:
    // the difference must not be learnable (ADR-0019 §1).
    expect(response.body.error.code).toBe("AUTH_INVALID_REFRESH_TOKEN");
  });
});

/**
 * The CSRF cookie split (ADR-0056, `D12.12`), from D12's finding 6.
 *
 * Until this deliverable exactly one SPA could hold a session against an API
 * host, so one host-wide `__Host-machxi.csrf` was always the rotating client's
 * own. With the admin panel and the customer app open at once it was not: an
 * admin refresh overwrote the value the customer app was holding in memory,
 * costing it a re-bootstrap — and a second `403` inside that window is a
 * forced sign-out caused by another tab's traffic.
 *
 * These are the cases that only exist because two populations are signed in at
 * the same time, which is why they sit outside the per-population `describe`
 * above: each one needs **both** sessions.
 */
describe("two populations signed in at once", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  /** One population's cookie session, as a browser would hold it. */
  const signIn = async (population: "staff" | "user") => {
    const base =
      population === "staff" ? "/api/v1/admin/auth" : "/api/v1/user/auth";

    const response = await request()
      .post(`${base}/login`)
      .set(TRANSPORT_HEADER, "cookie")
      .send(
        population === "staff"
          ? superAdmin()
          : { email: FIXTURE_USERS.active, password: FIXTURE_PASSWORD },
      )
      .expect(200);

    const refresh = cookieValue(response, REFRESH_COOKIE) ?? "";
    const csrf = cookieValue(response, csrfCookie(population)) ?? "";

    /*
     * Asserted here rather than left to fall out of a later case, because it
     * is what makes every case below discriminating: an implementation that
     * still wrote the one shared `__Host-machxi.csrf` would leave this empty,
     * and a `not.toBe(...)` further down would then pass on two `undefined`s
     * without noticing the split had been reverted.
     */
    expect(csrf, `${population} login must set its own CSRF cookie`).not.toBe(
      "",
    );
    expect(refresh, `${population} login must set the refresh cookie`).not.toBe(
      "",
    );

    return { base, accessToken: response.body.data.accessToken, refresh, csrf };
  };

  /**
   * What the browser sends: **both** CSRF cookies, because both are at
   * `Path=/`, and only the acting population's refresh cookie, because that
   * one is path-scoped (ADR-0029's `authCookiePath`).
   */
  const bothCookies = (
    acting: { refresh: string },
    staffCsrf: string,
    userCsrf: string,
  ) => [
    `${REFRESH_COOKIE}=${acting.refresh}`,
    `${csrfCookie("staff")}=${staffCsrf}`,
    `${csrfCookie("user")}=${userCsrf}`,
  ];

  it("leaves the other population's CSRF cookie untouched on refresh", async () => {
    // The finding itself. Before ADR-0056 this response rewrote the one
    // shared cookie, and the other app's in-memory token was stale from here
    // on.
    const staffSession = await signIn("staff");
    const userSession = await signIn("user");

    const refreshed = await request()
      .post("/api/v1/admin/auth/refresh")
      .set(
        "Cookie",
        bothCookies(staffSession, staffSession.csrf, userSession.csrf),
      )
      .set(CSRF_HEADER, staffSession.csrf)
      .expect(200);

    expect(cookieValue(refreshed, csrfCookie("staff"))).not.toBe(
      staffSession.csrf,
    );
    expect(setCookie(refreshed, csrfCookie("user"))).toBeUndefined();

    // And the same the other way round, because a fix that only ran in one
    // direction would be a fix for one app.
    const userRefreshed = await request()
      .post("/api/v1/user/auth/refresh")
      .set(
        "Cookie",
        bothCookies(userSession, staffSession.csrf, userSession.csrf),
      )
      .set(CSRF_HEADER, userSession.csrf)
      .expect(200);

    expect(cookieValue(userRefreshed, csrfCookie("user"))).not.toBe(
      userSession.csrf,
    );
    expect(setCookie(userRefreshed, csrfCookie("staff"))).toBeUndefined();
  });

  it("clears only its own population's cookies on logout and logout-all", async () => {
    for (const path of ["logout", "logout-all"]) {
      const staffSession = await signIn("staff");
      const userSession = await signIn("user");

      const response = await request()
        .post(`/api/v1/admin/auth/${path}`)
        .set("Authorization", `Bearer ${staffSession.accessToken}`)
        .set(
          "Cookie",
          bothCookies(staffSession, staffSession.csrf, userSession.csrf),
        )
        .set(CSRF_HEADER, staffSession.csrf)
        .expect(204);

      // Two `Set-Cookie`s and no third: the refresh cookie and the admin's own
      // CSRF cookie. The customer app, signed in in another tab, sees nothing.
      expect(setCookies(response)).toHaveLength(2);
      expect(cookieValue(response, csrfCookie("staff"))).toBeUndefined();
      expect(setCookie(response, csrfCookie("staff"))).toBeDefined();
      expect(setCookie(response, csrfCookie("user"))).toBeUndefined();
    }
  });

  it("accepts each population's own token and refuses the other's", async () => {
    const staffSession = await signIn("staff");
    const userSession = await signIn("user");

    // The other population's token, presented to a segment that is holding
    // both cookies. It is a real token, freshly issued, and it is still not
    // this segment's — which is the double-submit reading its own cookie.
    const refused = await request()
      .post("/api/v1/admin/auth/refresh")
      .set(
        "Cookie",
        bothCookies(staffSession, staffSession.csrf, userSession.csrf),
      )
      .set(CSRF_HEADER, userSession.csrf)
      .expect(403);

    expect(refused.body.error.code).toBe("CSRF_TOKEN_INVALID");

    // Its own is accepted from exactly the same cookie header, so the refusal
    // above is about the token and not about the second cookie being present.
    await request()
      .post("/api/v1/admin/auth/refresh")
      .set(
        "Cookie",
        bothCookies(staffSession, staffSession.csrf, userSession.csrf),
      )
      .set(CSRF_HEADER, staffSession.csrf)
      .expect(200);
  });

  it("retires the legacy host-wide cookie on the first response that writes its own", async () => {
    // A browser signed in before the split holds `__Host-machxi.csrf` at
    // `Path=/` with the refresh token's `Max-Age`, and nothing else would ever
    // remove it (ADR-0056 §Decision).
    const session = await signIn("staff");

    const response = await request()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", [
        `${REFRESH_COOKIE}=${session.refresh}`,
        `${csrfCookie("staff")}=${session.csrf}`,
        `${LEGACY_CSRF_COOKIE}=${session.csrf}`,
      ])
      .set(CSRF_HEADER, session.csrf)
      .expect(200);

    expect(setCookie(response, LEGACY_CSRF_COOKIE)).toBeDefined();
    expect(cookieValue(response, LEGACY_CSRF_COOKIE)).toBeUndefined();

    /*
     * With the attributes it was set with, the same point the logout case
     * above makes — and sharper here (`D12.12` security review): a
     * `__Host-`-prefixed `Set-Cookie` **without** `Secure` is rejected
     * outright by the browser, so a clear that lost the attribute would be a
     * silent no-op and the emptiness assertion above would stay green.
     */
    const cleared = setCookie(response, LEGACY_CSRF_COOKIE);

    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("Secure");
    expect(cleared).toMatch(/Expires=/i);

    // Three: the rotated refresh cookie, the admin's own CSRF cookie, and this.
    expect(setCookies(response)).toHaveLength(3);
  });

  it("costs nothing for a browser that never held the legacy cookie", async () => {
    // The guard is that the request presented it, so the migration is one
    // `Set-Cookie` once per browser rather than one on every login forever.
    const session = await signIn("staff");

    const response = await request()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", [
        `${REFRESH_COOKIE}=${session.refresh}`,
        `${csrfCookie("staff")}=${session.csrf}`,
      ])
      .set(CSRF_HEADER, session.csrf)
      .expect(200);

    expect(setCookie(response, LEGACY_CSRF_COOKIE)).toBeUndefined();
    expect(setCookies(response)).toHaveLength(2);
  });
});
