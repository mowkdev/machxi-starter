import { successEnvelopeSchema } from "@repo/contracts";
import { users } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createUserAccount,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { expectNoSecrets, userResourceSchema } from "./support/resources.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/user/profile` — a user acting on their own account (ADR-0019 §3).
 *
 * The ownership question this segment has to answer is answered structurally:
 * there is no `:id` anywhere below, so every handler reads the account from
 * `ctx.principal` and there is nothing for a caller to tamper with. What is
 * left to check is that the *shape* of the endpoints preserves that — the
 * profile body cannot carry `status` or `roles`, and the same resource comes
 * back here as on the admin segment so a client learns one shape (ADR-0012).
 */

const userEnvelope = successEnvelopeSchema(userResourceSchema);

const PROFILE = "/api/v1/user/profile";

describe("user profile", () => {
  let harness: TestApp;
  let staffTokens: Tokens;
  let customerTokens: Tokens;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    // The super admin is only here to create the accounts the destructive
    // tests below act on, so that the shared `customer` fixture keeps the
    // password every other file signs in with.
    staffTokens = await login(harness.app, "staff", superAdmin());
    customerTokens = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  /** An account nobody else in the file touches, already signed in. */
  const freshUser = async (
    email: string,
  ): Promise<{ id: string; tokens: Tokens }> => {
    const created = await createUserAccount(
      harness.app,
      staffTokens.accessToken,
      { email, firstName: "Fresh", lastName: "User" },
    );

    return {
      id: created.id,
      tokens: await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      }),
    };
  };

  describe("GET /api/v1/user/profile", () => {
    it("returns the caller's own account", async () => {
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(customerTokens.accessToken))
        .expect(200);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.email).toBe(FIXTURE_USERS.active);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
      expectNoSecrets(response.body);
    });

    it("forbids caching personal data", async () => {
      // The router mounts `no-store` over the whole profile: this response is
      // personal data and the one below it carries two passwords (ADR-0020).
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(customerTokens.accessToken))
        .expect("Cache-Control", "no-store")
        .expect(200);
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request().get(PROFILE).expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a staff token with 401, never 403", async () => {
      // ADR-0019 §1 again, in the other direction: a staff member has no
      // profile on this segment, and must not learn that the route exists.
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(staffTokens.accessToken))
        .expect(401);

      expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("PATCH /api/v1/user/profile", () => {
    const patch = (token: string, body: object) =>
      request().patch(PROFILE).set("Authorization", bearer(token)).send(body);

    it("updates the caller's own names", async () => {
      const { tokens } = await freshUser("patch.profile@machxi.local");

      const response = await patch(tokens.accessToken, {
        firstName: "Renamed",
        lastName: "Twice",
      }).expect(200);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.firstName).toBe("Renamed");
      expect(response.body.data.lastName).toBe("Twice");
    });

    it("clears a name when it is sent as null", async () => {
      const { tokens } = await freshUser("clear.profile.name@machxi.local");

      const response = await patch(tokens.accessToken, {
        firstName: null,
      }).expect(200);

      expect(response.body.data.firstName).toBeNull();
      // Only the field that was sent: `undefined` still means "leave it".
      expect(response.body.data.lastName).toBe("User");
    });

    it("rejects an empty patch", async () => {
      const response = await patch(customerTokens.accessToken, {}).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for status, so a user cannot re-enable themselves", async () => {
      // `updateProfileBody` is a strict object of two names. There is nothing
      // to reject at runtime because there is no field — the request fails as
      // an unknown key, which is the whole design (ADR-0019 §3).
      const response = await patch(customerTokens.accessToken, {
        status: "active",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for roles, so a user cannot promote themselves", async () => {
      const response = await patch(customerTokens.accessToken, {
        firstName: "Cleo",
        roles: ["customer"],
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request()
        .patch(PROFILE)
        .send({ firstName: "Anonymous" })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("POST /api/v1/user/profile/change-password", () => {
    const changePassword = (token: string, body: object) =>
      request()
        .post(`${PROFILE}/change-password`)
        .set("Authorization", bearer(token))
        .send(body);

    it("rotates the password, keeps this session and ends the others", async () => {
      const email = "rotates.password@machxi.local";
      const { tokens: first } = await freshUser(email);
      // A second device, signed in with the same credentials.
      const second = await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const nextPassword = "RotatedPassword!2026";

      const response = await changePassword(first.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: nextPassword,
      }).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      // The caller keeps the session they just proved they own; logging them
      // out of the device in their hand would be a worse experience for no
      // security gain.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(first.accessToken))
        .expect(200);

      // Every other session goes, because ending a session somebody else
      // controls is the reason a password gets changed.
      const other = await request()
        .get(PROFILE)
        .set("Authorization", bearer(second.accessToken))
        .expect(401);

      expect(other.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // And the credential itself actually changed.
      await login(harness.app, "user", { email, password: nextPassword });

      const withOldPassword = await request()
        .post("/api/v1/user/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(withOldPassword.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses a wrong current password with 403, not 401", async () => {
      // The session is valid and stays valid, so a 401 would be untrue about
      // the request and would send every client interceptor that reads 401 as
      // "the session died" to the login screen over a typo (ADR-0013).
      const { tokens } = await freshUser("wrong.current@machxi.local");

      const response = await changePassword(tokens.accessToken, {
        currentPassword: "definitely-not-the-password",
        newPassword: "SomethingElse!2026",
      }).expect(403);

      // Renamed in D2.3: the condition is a property of the credential check
      // and occurs in four endpoints across both populations (ADR-0027).
      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      // Refused, not partially applied: the old password still works.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      await login(harness.app, "user", {
        email: "wrong.current@machxi.local",
        password: NEW_ACCOUNT_PASSWORD,
      });
    });

    it("refuses a new password identical to the current one", async () => {
      const response = await changePassword(customerTokens.accessToken, {
        currentPassword: FIXTURE_PASSWORD,
        newPassword: FIXTURE_PASSWORD,
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map(
          (detail: { path: string }) => detail.path,
        ),
      ).toContain("newPassword");
    });

    it("holds the new password to the policy and the old one only to a bound", async () => {
      // `currentPassword` is a credential being verified, not a new one:
      // applying the policy to it would answer "is this long enough to be one
      // of ours?" before any credential check (ADR-0018).
      const response = await changePassword(customerTokens.accessToken, {
        currentPassword: "x",
        newPassword: "short",
      }).expect(400);

      const paths = response.body.error.details.map(
        (detail: { path: string }) => detail.path,
      );

      expect(paths).toContain("newPassword");
      expect(paths).not.toContain("currentPassword");
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      const response = await changePassword(customerTokens.accessToken, {
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "SomethingElse!2026",
        userId: "00000000-0000-4000-8000-000000000000",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request()
        .post(`${PROFILE}/change-password`)
        .send({
          currentPassword: FIXTURE_PASSWORD,
          newPassword: "SomethingElse!2026",
        })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("a soft-deleted account (ADR-0017)", () => {
    it("has no profile, even while its access token is still live", async () => {
      // `authenticate` verifies the session, not the account, so this is
      // reachable for as long as the token lives. The self view uses
      // `findById`, which excludes deleted rows: the profile is gone, and 404
      // is the honest answer — where the *admin* view of the same row is 200.
      const { id, tokens } = await freshUser("deleted.profile@machxi.local");

      await harness.db.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, id));

      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");

      const patched = await request()
        .patch(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .send({ firstName: "Ghost" })
        .expect(404);

      expect(patched.body.error.code).toBe("NOT_FOUND");

      // The admin segment still sees it, which is the pairing that makes the
      // 404 above a statement about ownership rather than about existence.
      await request()
        .get(`/api/v1/admin/users/${id}`)
        .set("Authorization", bearer(staffTokens.accessToken))
        .expect(200);
    });
  });
});
