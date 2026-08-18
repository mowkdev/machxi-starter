import {
  errorEnvelopeSchema,
  listEnvelopeSchema,
  successEnvelopeSchema,
} from "@repo/contracts";
import { users } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createStaffMember,
  createUserAccount,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { expectNoSecrets, userResourceSchema } from "./support/resources.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/admin/users` end to end (ADR-0019, ADR-0021).
 *
 * The resource where the guard is *not* uniform, which is the whole reason it
 * is worth enumerating separately from `/admin/staff`: the segment mounts it
 * behind `authorize("admin", "manager")` so a manager may read the customer
 * base, and the router narrows the three writing routes back to `admin`. Both
 * halves run, so a route can only ever narrow the mount — and the matrix below
 * is what proves the narrowing is where it is claimed to be.
 */

const userEnvelope = successEnvelopeSchema(userResourceSchema);
const userListEnvelope = listEnvelopeSchema(userResourceSchema);

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const USERS_BASE = "/api/v1/admin/users";

describe("admin user administration", () => {
  let harness: TestApp;
  let adminTokens: Tokens;
  let managerTokens: Tokens;
  let editorTokens: Tokens;
  let userTokens: Tokens;
  let customerId: string;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    const superAdminTokens = await login(harness.app, "staff", superAdmin());

    // There is no seeded plain `admin`, and a `super_admin` would pass every
    // guard by bypass rather than by role — which is exactly what this file
    // must not lean on when it asserts that a manager is refused.
    const admin = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      {
        email: "admin.fixture@machxi.local",
        firstName: "Ada",
        lastName: "Admin",
        roles: ["admin"],
      },
    );

    adminTokens = await login(harness.app, "staff", {
      email: admin.email,
      password: NEW_ACCOUNT_PASSWORD,
    });
    managerTokens = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.manager,
      password: FIXTURE_PASSWORD,
    });
    editorTokens = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.editor,
      password: FIXTURE_PASSWORD,
    });
    userTokens = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const me = await supertest(harness.app)
      .get("/api/v1/user/auth/me")
      .set("Authorization", bearer(userTokens.accessToken))
      .expect(200);

    customerId = me.body.data.id as string;
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  const asAdmin = (path: string) =>
    request().get(path).set("Authorization", bearer(adminTokens.accessToken));

  describe("the guard on every route (ADR-0019)", () => {
    const READ_ROUTES = [
      { method: "get", path: USERS_BASE },
      { method: "get", path: `${USERS_BASE}/${UNKNOWN_ID}` },
    ] as const;

    const WRITE_ROUTES = [
      { method: "post", path: USERS_BASE },
      { method: "patch", path: `${USERS_BASE}/${UNKNOWN_ID}` },
      { method: "post", path: `${USERS_BASE}/${UNKNOWN_ID}/sessions/revoke` },
    ] as const;

    const ROUTES = [...READ_ROUTES, ...WRITE_ROUTES];

    const call = (route: (typeof ROUTES)[number]) =>
      route.method === "get"
        ? request().get(route.path)
        : route.method === "post"
          ? request().post(route.path)
          : request().patch(route.path);

    it.each(ROUTES)(
      "$method $path refuses a caller with no credentials",
      async (route) => {
        const response = await call(route).expect(401);

        expect(response.body.error.code).toBe("UNAUTHENTICATED");
      },
    );

    it.each(ROUTES)(
      "$method $path refuses a user token with 401, never 403",
      async (route) => {
        // ADR-0019 §1. The customer whose own record this endpoint manages is
        // still the wrong population for the admin segment, and must not be
        // able to tell a 403 (route exists) from a 401.
        const response = await call(route)
          .set("Authorization", bearer(userTokens.accessToken))
          .expect(401);

        expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
      },
    );

    it.each(ROUTES)("$method $path refuses an editor", async (route) => {
      const response = await call(route)
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(errorEnvelopeSchema.safeParse(response.body).success).toBe(true);
    });

    it.each(WRITE_ROUTES)(
      "$method $path refuses a manager, who may only read",
      async (route) => {
        const response = await call(route)
          .set("Authorization", bearer(managerTokens.accessToken))
          .expect(403);

        expect(response.body.error.code).toBe("FORBIDDEN");
      },
    );
  });

  describe("GET /api/v1/admin/users", () => {
    it("returns the customer base to an admin", async () => {
      const response = await asAdmin(USERS_BASE).expect(200);

      expect(userListEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
      expect(
        response.body.data.map((item: { email: string }) => item.email),
      ).toContain(FIXTURE_USERS.active);
    });

    it("returns it to a manager", async () => {
      const response = await request()
        .get(USERS_BASE)
        .set("Authorization", bearer(managerTokens.accessToken))
        .expect(200);

      expect(userListEnvelope.safeParse(response.body).success).toBe(true);
    });

    it("never puts a password hash on the wire", async () => {
      const response = await asAdmin(USERS_BASE).expect(200);

      expectNoSecrets(response.body);
    });

    it("forbids caching the customer base", async () => {
      // `no-store` is mounted on the whole resource, not on the list route:
      // every response here is somebody's personal data, and it must not sit
      // in a shared proxy's cache (ADR-0020).
      await asAdmin(USERS_BASE).expect("Cache-Control", "no-store").expect(200);
      await asAdmin(`${USERS_BASE}/${customerId}`)
        .expect("Cache-Control", "no-store")
        .expect(200);
    });
  });

  describe("GET /api/v1/admin/users/:id", () => {
    it("returns one account to a manager", async () => {
      const response = await request()
        .get(`${USERS_BASE}/${customerId}`)
        .set("Authorization", bearer(managerTokens.accessToken))
        .expect(200);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.email).toBe(FIXTURE_USERS.active);
      expect(response.body.data.roles).toEqual(["customer"]);
    });

    it("answers 404 for a well-formed id that no row has", async () => {
      const response = await asAdmin(`${USERS_BASE}/${UNKNOWN_ID}`).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const response = await asAdmin(`${USERS_BASE}/not-a-uuid`).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/v1/admin/users", () => {
    it("creates an account and defaults its role to customer", async () => {
      const response = await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "created.by.admin@machxi.local",
          password: NEW_ACCOUNT_PASSWORD,
          firstName: "Cara",
        })
        .expect(201);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      // v1 has exactly one user role, so `roles` is optional on create and the
      // service supplies it — an account with none could do nothing.
      expect(response.body.data.roles).toEqual(["customer"]);
      expect(response.body.data.status).toBe("active");
      expect(response.body.data.lastName).toBeNull();
      expectNoSecrets(response.body);
    });

    it("hands over an account that can sign in on the user segment", async () => {
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "signs.in@machxi.local" },
      );

      const tokens = await login(harness.app, "user", {
        email: created.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const me = await request()
        .get("/api/v1/user/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      expect(me.body.data.id).toBe(created.id);
    });

    it("accepts an explicit status", async () => {
      const response = await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "pending.by.admin@machxi.local",
          password: NEW_ACCOUNT_PASSWORD,
          status: "pending_verification",
        })
        .expect(201);

      expect(response.body.data.status).toBe("pending_verification");
    });

    it("names the conflict when the email is taken", async () => {
      const response = await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: FIXTURE_USERS.active,
          password: NEW_ACCOUNT_PASSWORD,
        })
        .expect(409);

      expect(response.body.error.code).toBe("USER_EMAIL_TAKEN");
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      const response = await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "strict@machxi.local",
          password: NEW_ACCOUNT_PASSWORD,
          isAdmin: true,
        })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("reports which fields are wrong", async () => {
      const response = await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ email: "not-an-email", password: "short" })
        .expect(400);

      const paths = response.body.error.details.map(
        (detail: { path: string }) => detail.path,
      );

      expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
    });
  });

  describe("PATCH /api/v1/admin/users/:id", () => {
    const patch = (id: string, body: object) =>
      request()
        .patch(`${USERS_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send(body);

    it("updates the profile", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        {
          email: "patch.target@machxi.local",
          firstName: "Original",
          lastName: "Name",
        },
      );

      const response = await patch(target.id, { firstName: "Renamed" }).expect(
        200,
      );

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.firstName).toBe("Renamed");
      expect(response.body.data.lastName).toBe("Name");
    });

    it("clears a name when it is sent as null", async () => {
      // `null` is not `undefined`: the column is nullable, so "unset it" is a
      // legal request that a two-valued patch could not express (ADR-0017).
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "clear.name@machxi.local", firstName: "Temporary" },
      );

      const response = await patch(target.id, { firstName: null }).expect(200);

      expect(response.body.data.firstName).toBeNull();
    });

    it("rejects an empty patch", async () => {
      const response = await patch(customerId, {}).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a field the schema does not carry", async () => {
      const response = await patch(customerId, {
        email: "moved@machxi.local",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("answers 404 for an unknown id", async () => {
      const response = await patch(UNKNOWN_ID, { firstName: "Ghost" }).expect(
        404,
      );

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const response = await patch("not-a-uuid", {
        firstName: "Ghost",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("ends the live sessions of an account it disables", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "about.to.be.disabled@machxi.local" },
      );

      const tokens = await login(harness.app, "user", {
        email: target.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      await patch(target.id, { status: "disabled" }).expect(200);

      const afterDisable = await request()
        .get("/api/v1/user/profile")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(afterDisable.body.error.code).toBe("AUTH_SESSION_REVOKED");

      const refreshed = await request()
        .post("/api/v1/user/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(refreshed.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });
  });

  describe("POST /api/v1/admin/users/:id/sessions/revoke", () => {
    const revoke = (id: string) =>
      request()
        .post(`${USERS_BASE}/${id}/sessions/revoke`)
        .set("Authorization", bearer(adminTokens.accessToken));

    it("answers 204 with no body and kills the target's access token", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "revoke.target@machxi.local" },
      );

      const tokens = await login(harness.app, "user", {
        email: target.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const response = await revoke(target.id).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      const afterRevoke = await request()
        .get("/api/v1/user/profile")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(afterRevoke.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });

    it("is idempotent — a second call is still 204", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "revoke.twice@machxi.local" },
      );

      await revoke(target.id).expect(204);
      await revoke(target.id).expect(204);
    });

    it("answers 404 for an unknown id", async () => {
      const response = await revoke(UNKNOWN_ID).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const response = await revoke("not-a-uuid").expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("a soft-deleted account (ADR-0017)", () => {
    it("is still readable by id, and says that it is deleted", async () => {
      // `findAnyById`, not `findById`: an admin who can list deleted accounts
      // must be able to open one, and answering 404 for a row they were just
      // shown would be the worse lie.
      //
      // `deletedAt` rides along on the resource (ADR-0012, amended step 9).
      // It was excluded at first, but `USER_STATUSES` has no `deleted` member,
      // so with the field withheld this response was indistinguishable from a
      // live account — the admin screen `findAnyById` exists for could not be
      // built.
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "soft.deleted@machxi.local" },
      );

      // No endpoint sets it: soft deletion arrives with the delete endpoint,
      // and the read path it changes exists now.
      await harness.db.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, target.id));

      const response = await asAdmin(`${USERS_BASE}/${target.id}`).expect(200);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.id).toBe(target.id);
      expect(response.body.data.deletedAt).toEqual(expect.any(String));
    });

    it("is reported as live by a resource that is not deleted", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "still.here@machxi.local" },
      );

      const response = await asAdmin(`${USERS_BASE}/${target.id}`).expect(200);

      expect(response.body.data.deletedAt).toBeNull();
    });
  });
});
