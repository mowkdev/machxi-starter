import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * Segment isolation (ADR-0015, ADR-0017, ADR-0019 §1, ADR-0021).
 *
 * The rule the whole two-population design rests on: a credential minted for
 * one segment must be worth nothing on the other. It is enforced three times
 * over — the router mounts `authenticate(population)`, the JWT's `aud` differs
 * per population, and the session row records which population it belongs to —
 * and this file checks the outcome rather than any one mechanism.
 *
 * Every failure is **401, never 403** (ADR-0019 §1): a 403 would tell the
 * wrong population that the route exists.
 */
describe("segment isolation", () => {
  let harness: TestApp;
  let staffTokens: { accessToken: string; refreshToken: string };
  let userTokens: { accessToken: string; refreshToken: string };

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });

    const staffLogin = await supertest(harness.app)
      .post("/api/v1/admin/auth/login")
      .send(superAdmin())
      .expect(200);

    const userLogin = await supertest(harness.app)
      .post("/api/v1/user/auth/login")
      .send({ email: FIXTURE_USERS.active, password: FIXTURE_PASSWORD })
      .expect(200);

    staffTokens = staffLogin.body.data;
    userTokens = userLogin.body.data;
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("refuses a user access token on the admin segment", async () => {
    const response = await request()
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${userTokens.accessToken}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refuses a staff access token on the user segment", async () => {
    const response = await request()
      .get("/api/v1/user/auth/me")
      .set("Authorization", `Bearer ${staffTokens.accessToken}`)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refuses a user refresh token on the admin segment", async () => {
    // Indistinguishable from an unknown token, so the difference cannot be
    // used to learn that the token is real but belongs elsewhere.
    const response = await request()
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken: userTokens.refreshToken })
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_INVALID_REFRESH_TOKEN");
  });

  it("refuses a staff refresh token on the user segment", async () => {
    const response = await request()
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: staffTokens.refreshToken })
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_INVALID_REFRESH_TOKEN");
  });

  it("leaves the rejected token working on its own segment", async () => {
    // The point of the four assertions above is isolation, not breakage.
    await request()
      .get("/api/v1/user/auth/me")
      .set("Authorization", `Bearer ${userTokens.accessToken}`)
      .expect(200);

    await request()
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${staffTokens.accessToken}`)
      .expect(200);
  });

  describe("unknown paths inside a guarded segment", () => {
    /**
     * Since step 9 the guarded segments mount `authenticate()` as router-level
     * middleware, above the resource routers. Express runs that for every
     * request entering the router — matched or not — so an unmatched path
     * answers the guard rather than the not-found handler.
     *
     * That is the behaviour we want, and it is the same rule as the rest of
     * this file: the API does not tell an unauthenticated caller which admin
     * paths exist. The diagnostic is not lost, only earned — a caller who has
     * proved who they are still gets `ROUTE_NOT_FOUND`.
     *
     * The unguarded `/api/v1/public` segment answers `404` to everyone, which
     * `envelope.int.test.ts` asserts.
     */
    it.each(["admin", "user"])(
      "answers an anonymous caller 401 on /%s, not 404",
      async (segment) => {
        const response = await request()
          .get(`/api/v1/${segment}/does-not-exist`)
          .expect(401);

        // Not `ROUTE_NOT_FOUND`, and deliberately the same answer a bad token
        // gets: neither says whether the path is real.
        expect(response.body.error.code).not.toBe("ROUTE_NOT_FOUND");
      },
    );

    it("answers an authenticated staff caller ROUTE_NOT_FOUND", async () => {
      const response = await request()
        .get("/api/v1/admin/does-not-exist")
        .set("Authorization", `Bearer ${staffTokens.accessToken}`)
        .expect(404);

      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("answers an authenticated user caller ROUTE_NOT_FOUND", async () => {
      const response = await request()
        .get("/api/v1/user/does-not-exist")
        .set("Authorization", `Bearer ${userTokens.accessToken}`)
        .expect(404);

      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("still answers the wrong population 401, not 404", async () => {
      // Both mechanisms point the same way: an unknown path and a wrong-
      // population token are indistinguishable from outside.
      await request()
        .get("/api/v1/admin/does-not-exist")
        .set("Authorization", `Bearer ${userTokens.accessToken}`)
        .expect(401);
    });
  });

  it("does not let a staff account log in on the user segment", async () => {
    // Separate tables, so the address simply is not there — and the answer is
    // the same one a wrong password gets (ADR-0017 §Invariants).
    const response = await request()
      .post("/api/v1/user/auth/login")
      .send(superAdmin())
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("does not let a user account log in on the admin segment", async () => {
    const response = await request()
      .post("/api/v1/admin/auth/login")
      .send({ email: FIXTURE_USERS.active, password: FIXTURE_PASSWORD })
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("does not expose the auth endpoints on the public segment", async () => {
    // `/public/auth` carries registration and nothing else; login lives behind
    // the segment that says which population it belongs to (ADR-0015).
    await request()
      .post("/api/v1/public/auth/login")
      .send(superAdmin())
      .expect(404);

    await request().get("/api/v1/public/auth/me").expect(404);
  });
});
