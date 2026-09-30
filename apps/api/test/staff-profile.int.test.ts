import { successEnvelopeSchema } from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createStaffMember,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { expectNoSecrets, staffResourceSchema } from "./support/resources.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/admin/profile` — a staff member acting on their own account
 * (ADR-0027, ADR-0019 §3).
 *
 * The asymmetry ADR-0027 was written to remove: `/api/v1/user/profile` has
 * existed since step 9 and staff had nothing equivalent, so an operator's
 * initial password was permanent. This file is the mirror of
 * `user-profile.int.test.ts`, and the two things it checks that the other
 * cannot are that the route carries **no** role guard — an `editor` must reach
 * it, since every staff role may change its own password — and that the
 * profile body has no field through which a role or a status could be
 * smuggled.
 */

const staffEnvelope = successEnvelopeSchema(staffResourceSchema);

const PROFILE = "/api/v1/admin/profile";

describe("staff profile", () => {
  let harness: TestApp;
  let superAdminTokens: Tokens;
  let editorTokens: Tokens;
  let userTokens: Tokens;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });

    // The super admin is only here to create the accounts the destructive
    // tests act on, so the shared fixtures keep the password every other file
    // signs in with.
    superAdminTokens = await login(harness.app, "staff", superAdmin());
    editorTokens = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.editor,
      password: FIXTURE_PASSWORD,
    });
    userTokens = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  /** A staff account nobody else in the file touches, already signed in. */
  const freshStaff = async (
    email: string,
  ): Promise<{ id: string; tokens: Tokens }> => {
    const created = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      { email, firstName: "Fresh", lastName: "Operator", roles: ["editor"] },
    );

    return {
      id: created.id,
      tokens: await login(harness.app, "staff", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      }),
    };
  };

  describe("GET /api/v1/admin/profile", () => {
    it("returns the caller's own account", async () => {
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect(200);

      expect(staffEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.email).toBe(FIXTURE_STAFF.editor);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
      expectNoSecrets(response.body);
    });

    it("admits an editor, who is refused everywhere else in the segment", async () => {
      // The whole reason this router carries no `authorize`: every staff role
      // may read its own account and change its own password, and there is no
      // `:id` for the caller to point somewhere else (ADR-0019 §3).
      await request()
        .get("/api/v1/admin/staff")
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect(403);

      await request()
        .get(PROFILE)
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect(200);
    });

    it("forbids caching personal data", async () => {
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect("Cache-Control", "no-store")
        .expect(200);
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request().get(PROFILE).expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a user token with 401, never 403", async () => {
      // ADR-0019 §1: a customer has no profile on this segment and must not
      // learn that the route exists.
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(userTokens.accessToken))
        .expect(401);

      expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("PATCH /api/v1/admin/profile", () => {
    const patch = (token: string, body: object) =>
      request().patch(PROFILE).set("Authorization", bearer(token)).send(body);

    it("updates the caller's own names", async () => {
      const { tokens } = await freshStaff("patch.staff.profile@machxi.local");

      const response = await patch(tokens.accessToken, {
        firstName: "Renamed",
        lastName: "Twice",
      }).expect(200);

      expect(staffEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.firstName).toBe("Renamed");
      expect(response.body.data.lastName).toBe("Twice");
    });

    it("leaves the field that was not sent alone", async () => {
      const { tokens } = await freshStaff("patch.one.name@machxi.local");

      const response = await patch(tokens.accessToken, {
        firstName: "Only",
      }).expect(200);

      expect(response.body.data.firstName).toBe("Only");
      expect(response.body.data.lastName).toBe("Operator");
    });

    it("refuses null, because the staff columns are NOT NULL", async () => {
      // Where `/api/v1/user/profile` accepts `null` to clear a name, this does
      // not: the two tables differ exactly there (ADR-0017).
      const response = await patch(editorTokens.accessToken, {
        firstName: null,
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an empty patch", async () => {
      const response = await patch(editorTokens.accessToken, {}).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for roles, so an editor cannot promote itself", async () => {
      // This is what makes an unguarded router safe. The body is a strict
      // object of two names, so the escalation fails as an unknown key rather
      // than as a rule somebody has to remember to write.
      const response = await patch(editorTokens.accessToken, {
        roles: ["super_admin"],
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");

      const after = await request()
        .get(PROFILE)
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect(200);

      expect(after.body.data.roles).toEqual(["editor"]);
    });

    it("has no field for status, so a staff member cannot re-enable itself", async () => {
      const response = await patch(editorTokens.accessToken, {
        status: "active",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for email, which is its own flow", async () => {
      const response = await patch(editorTokens.accessToken, {
        email: "renamed@machxi.local",
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

  describe("POST /api/v1/admin/profile/change-password", () => {
    const changePassword = (token: string, body: object) =>
      request()
        .post(`${PROFILE}/change-password`)
        .set("Authorization", bearer(token))
        .send(body);

    it("rotates the password, keeps this session and ends the others", async () => {
      const email = "rotates.staff.password@machxi.local";
      const { tokens: first } = await freshStaff(email);
      // A second device, signed in with the same credentials.
      const second = await login(harness.app, "staff", {
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

      // The caller keeps the session they just proved they own.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(first.accessToken))
        .expect(200);

      const other = await request()
        .get(PROFILE)
        .set("Authorization", bearer(second.accessToken))
        .expect(401);

      expect(other.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // And the credential itself actually changed — the gap ADR-0027 opened
      // with: until now, a staff password was written once and never again.
      await login(harness.app, "staff", { email, password: nextPassword });

      const withOldPassword = await request()
        .post("/api/v1/admin/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(withOldPassword.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses a wrong current password with 403, not 401", async () => {
      const email = "wrong.staff.current@machxi.local";
      const { tokens } = await freshStaff(email);

      const response = await changePassword(tokens.accessToken, {
        currentPassword: "definitely-not-the-password",
        newPassword: "SomethingElse!2026",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      // Refused, not partially applied: the session lives and so does the old
      // password.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      await login(harness.app, "staff", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });
    });

    it("is open to an editor, like every other staff role", async () => {
      const email = "editor.changes.own@machxi.local";
      const { tokens } = await freshStaff(email);

      await changePassword(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: "EditorRotated!2026",
      }).expect(204);

      await login(harness.app, "staff", {
        email,
        password: "EditorRotated!2026",
      });
    });

    it("refuses a new password identical to the current one", async () => {
      const response = await changePassword(editorTokens.accessToken, {
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
      const response = await changePassword(editorTokens.accessToken, {
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
      const response = await changePassword(editorTokens.accessToken, {
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "SomethingElse!2026",
        staffId: "00000000-0000-4000-8000-000000000000",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("forbids caching a request that carries two passwords", async () => {
      await request()
        .post(`${PROFILE}/change-password`)
        .set("Authorization", bearer(editorTokens.accessToken))
        .send({ currentPassword: "x", newPassword: "short" })
        .expect("Cache-Control", "no-store")
        .expect(400);
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
});
