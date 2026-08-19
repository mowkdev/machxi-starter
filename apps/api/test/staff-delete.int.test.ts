import type { StaffRole } from "@repo/contracts";
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
import { resetAndSeed, superAdmin } from "./support/seed.js";

/**
 * `DELETE /api/v1/admin/staff/:id` — a hard delete (ADR-0028, ADR-0021).
 *
 * Its own file rather than another `describe` in `staff-admin.int.test.ts`,
 * because the interesting cases are destructive to the fixture every other
 * test signs in as: proving that the last active super admin survives means
 * arranging a table whose only active super admins are accounts this file
 * created, and that means deleting the seeded one on the way there.
 *
 * The rules under test are the three the ADR names plus the one the schema
 * provides: nobody deletes themselves, a super admin is protected from
 * everybody it outranks, an active super admin must survive, and the account's
 * sessions and role grants go with the row.
 */

const STAFF_BASE = "/api/v1/admin/staff";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("staff account deletion", () => {
  let harness: TestApp;
  let superAdminTokens: Tokens;
  let superAdminId: string;
  let adminTokens: Tokens;
  let adminId: string;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    superAdminTokens = await login(harness.app, "staff", superAdmin());

    const me = await supertest(harness.app)
      .get("/api/v1/admin/auth/me")
      .set("Authorization", bearer(superAdminTokens.accessToken))
      .expect(200);

    superAdminId = me.body.data.id as string;

    // The interesting caller: an `admin` who is not a super admin, so it does
    // not pass the guards below by the ADR-0019 bypass.
    const admin = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      {
        email: "delete.admin@machxi.local",
        firstName: "Ada",
        lastName: "Admin",
        roles: ["admin"],
      },
    );

    adminId = admin.id;
    adminTokens = await login(harness.app, "staff", {
      email: admin.email,
      password: NEW_ACCOUNT_PASSWORD,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  const remove = (token: string, id: string) =>
    request().delete(`${STAFF_BASE}/${id}`).set("Authorization", bearer(token));

  /** A staff member nobody else in the file touches, already signed in. */
  const freshStaff = async (
    email: string,
    roles: readonly StaffRole[] = ["editor"],
  ): Promise<{ id: string; tokens: Tokens }> => {
    const created = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      { email, roles: [...roles] },
    );

    return {
      id: created.id,
      tokens: await login(harness.app, "staff", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      }),
    };
  };

  describe("the ordinary case", () => {
    it("removes the row and answers 204 with no body", async () => {
      const { id } = await freshStaff("delete.me@machxi.local");

      const response = await remove(adminTokens.accessToken, id).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      // Gone, not hidden: `staff` has no `deleted_at`, so unlike a user this
      // answers 404 rather than a resource with a timestamp on it (ADR-0028).
      const after = await request()
        .get(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(404);

      expect(after.body.error.code).toBe("NOT_FOUND");
    });

    it("ends the deleted account's sessions in the same breath", async () => {
      // `sessions` has no foreign key to `staff` (ADR-0018), so nothing else
      // does this: the rows would be left behind, unusable in practice but
      // never revoked, and the audit trail would say nothing.
      const { id, tokens } = await freshStaff("delete.sessions@machxi.local");

      await request()
        .get("/api/v1/admin/profile")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      await remove(adminTokens.accessToken, id).expect(204);

      const after = await request()
        .get("/api/v1/admin/profile")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(after.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // The refresh token is no better than the access token it came with.
      const refreshed = await request()
        .post("/api/v1/admin/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(refreshed.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });

    it("releases the address, which a plain unique constraint would not", async () => {
      // `staff.email` is unqualified-unique, and the row is really gone, so
      // this needs no partial index — unlike `users` (ADR-0028).
      const email = "delete.reuse@machxi.local";
      const { id } = await freshStaff(email);

      await remove(adminTokens.accessToken, id).expect(204);

      const recreated = await createStaffMember(
        harness.app,
        superAdminTokens.accessToken,
        { email, roles: ["editor"] },
      );

      expect(recreated.id).not.toBe(id);
    });

    it("takes the role grants with the row", async () => {
      // `staff_roles.staff_id` is `on delete cascade`, so a second statement
      // would be redundant; what proves it is that the address can be reused
      // above without a foreign-key violation, and that the list no longer
      // shows the account here.
      const { id } = await freshStaff("delete.grants@machxi.local", [
        "editor",
        "manager",
      ]);

      await remove(adminTokens.accessToken, id).expect(204);

      const list = await request()
        .get(`${STAFF_BASE}?limit=100`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(200);

      expect(
        list.body.data.map((item: { id: string }) => item.id),
      ).not.toContain(id);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      const missing = await remove(adminTokens.accessToken, UNKNOWN_ID).expect(
        404,
      );

      expect(missing.body.error.code).toBe("NOT_FOUND");

      const malformed = await remove(
        adminTokens.accessToken,
        "not-a-uuid",
      ).expect(400);

      expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("the rules a guard cannot express (ADR-0028)", () => {
    it("refuses a staff member deleting themselves", async () => {
      const response = await remove(adminTokens.accessToken, adminId).expect(
        403,
      );

      expect(response.body.error.code).toBe("FORBIDDEN");

      // Refused, not partially applied: the account still works.
      await request()
        .get("/api/v1/admin/profile")
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(200);
    });

    it("refuses it however the id is spelled", async () => {
      // A UUID has more than one spelling: `z.uuid()` accepts uppercase and
      // Postgres matches it against the row, so a rule implemented as a string
      // comparison against the principal was bypassable until the D2.4 review
      // found it. `idSchema` now lower-cases on the way in, and the rule is
      // re-checked against the row inside the transaction.
      const shouted = adminId.toUpperCase();

      // The premise, asserted rather than assumed: a UUID that happened to be
      // all digits would make this test vacuous.
      expect(shouted).not.toBe(adminId);

      const response = await remove(adminTokens.accessToken, shouted).expect(
        403,
      );

      expect(response.body.error.code).toBe("FORBIDDEN");

      await request()
        .get("/api/v1/admin/profile")
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(200);
    });

    it("refuses a super admin deleting themselves, invariant or not", async () => {
      // The rule that outranks the invariant: the truthful answer is "you may
      // never do this", not "not right now".
      const response = await remove(
        superAdminTokens.accessToken,
        superAdminId,
      ).expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("refuses an admin deleting a super admin", async () => {
      // Deleting a super admin is the most complete removal of standing there
      // is, so it carries the guard that already covers disabling and forced
      // logout (ADR-0017 §Invariants).
      const response = await remove(
        adminTokens.accessToken,
        superAdminId,
      ).expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");

      await request()
        .get(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(200);
    });
  });

  /**
   * The last-active-super-admin invariant, which on *delete* is reachable only
   * from two directions at once.
   *
   * With one super admin left, the only caller entitled to delete them is
   * themselves, and self-deletion is refused first — so the sequential path to
   * "the last one" does not exist. What remains is the race the advisory lock
   * was taken for: two super admins deleting each other at the same instant,
   * each counting the other as the survivor. This describe block arranges a
   * table whose only active super admins are two accounts it created, which is
   * why it is last in the file and why the file is separate.
   */
  describe("the last active super admin", () => {
    it("survives two super admins deleting each other at once", async () => {
      const first = await freshStaff("race.one@machxi.local", ["super_admin"]);
      const second = await freshStaff("race.two@machxi.local", ["super_admin"]);

      // Leaves exactly two active super admins in the table: the seeded one
      // goes, deleted by an account that is not it and is not the last.
      await remove(first.tokens.accessToken, superAdminId).expect(204);

      const [a, b] = await Promise.all([
        remove(first.tokens.accessToken, second.id),
        remove(second.tokens.accessToken, first.id),
      ]);

      const statuses = [a.status, b.status].sort();

      // Exactly one delete lands. The loser's answer depends on where the
      // serialisation caught it — `409` when it reached the invariant, `401`
      // when its own session was revoked first — and either is a refusal.
      expect(statuses.filter((status) => status === 204)).toHaveLength(1);
      expect(statuses.some((status) => status === 409 || status === 401)).toBe(
        true,
      );

      const conflicted = [a, b].find((response) => response.status === 409);

      if (conflicted !== undefined) {
        expect(conflicted.body.error.code).toBe("STAFF_LAST_SUPER_ADMIN");
      }

      // The assertion that matters however the race resolved: a deployment is
      // never left with no super admin and no way back through the API. The
      // winner is whichever request landed, and it is asserted through its own
      // credentials — the seeded super admin's token died with its account.
      const survivorEmail =
        a.status === 204 ? "race.one@machxi.local" : "race.two@machxi.local";

      const survivorTokens = await login(harness.app, "staff", {
        email: survivorEmail,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const asSurvivor = await request()
        .get("/api/v1/admin/profile")
        .set("Authorization", bearer(survivorTokens.accessToken))
        .expect(200);

      expect(asSurvivor.body.data.roles).toContain("super_admin");
    });
  });
});
