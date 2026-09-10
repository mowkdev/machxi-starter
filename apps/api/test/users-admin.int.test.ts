import {
  declaredErrorEnvelopeSchema,
  listEnvelopeSchema,
  successEnvelopeSchema,
} from "@repo/contracts";
import {
  accountTokens,
  auditEvents,
  organizationMemberships,
  organizations,
  personalOrganizationSlug,
  users,
} from "@repo/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createStaffMember,
  createUserAccount,
  listQueryString,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { registerVerified } from "./support/mail.js";
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
  /** The only caller `POST /:id/email` admits (ADR-0071 §7). */
  let superAdminTokens: Tokens;
  let managerTokens: Tokens;
  let editorTokens: Tokens;
  let userTokens: Tokens;
  let customerId: string;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    superAdminTokens = await login(harness.app, "staff", superAdmin());

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

  /* ── the tenant side of the account (ADR-0067 §2) ─────────────────────────── */

  /** Every live organization, however many. */
  const liveOrganizationCount = async (): Promise<number> => {
    const [row] = await harness.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizations)
      .where(isNull(organizations.deletedAt));

    return row?.total ?? 0;
  };

  /** The account's personal organization, live or not. */
  const personalOrganizationOf = async (userId: string) => {
    const [row] = await harness.db.db
      .select({ id: organizations.id, deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(
        and(
          eq(organizations.createdBy, userId),
          eq(organizations.kind, "personal"),
        ),
      );

    return row;
  };

  describe("the guard on every route (ADR-0019)", () => {
    const READ_ROUTES = [
      { method: "get", path: USERS_BASE },
      { method: "get", path: `${USERS_BASE}/${UNKNOWN_ID}` },
    ] as const;

    const WRITE_ROUTES = [
      { method: "post", path: USERS_BASE },
      { method: "patch", path: `${USERS_BASE}/${UNKNOWN_ID}` },
      { method: "post", path: `${USERS_BASE}/${UNKNOWN_ID}/sessions/revoke` },
      { method: "post", path: `${USERS_BASE}/${UNKNOWN_ID}/password` },
      { method: "delete", path: `${USERS_BASE}/${UNKNOWN_ID}` },
    ] as const;

    /**
     * The routes a plain `admin` is refused too (ADR-0071 §7).
     *
     * Listed apart from {@link WRITE_ROUTES} rather than added to it, because
     * the only assertion that differs is the one about an `admin` — every
     * other row of the matrix says the same thing about both lists.
     */
    const SUPER_ADMIN_ROUTES = [
      { method: "post", path: `${USERS_BASE}/${UNKNOWN_ID}/email` },
    ] as const;

    const ROUTES = [...READ_ROUTES, ...WRITE_ROUTES, ...SUPER_ADMIN_ROUTES];

    const call = (route: (typeof ROUTES)[number]) =>
      route.method === "get"
        ? request().get(route.path)
        : route.method === "post"
          ? request().post(route.path)
          : route.method === "delete"
            ? request().delete(route.path)
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
      expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
        true,
      );
    });

    it.each([...WRITE_ROUTES, ...SUPER_ADMIN_ROUTES])(
      "$method $path refuses a manager, who may only read",
      async (route) => {
        const response = await call(route)
          .set("Authorization", bearer(managerTokens.accessToken))
          .expect(403);

        expect(response.body.error.code).toBe("FORBIDDEN");
      },
    );

    it.each(SUPER_ADMIN_ROUTES)(
      "$method $path refuses a plain admin (ADR-0071 §7)",
      async (route) => {
        // The one narrowing in this router that goes past `admin`. The
        // refusal is the guard's own `FORBIDDEN`, before any body is parsed —
        // so an `admin` cannot use the endpoint to learn anything either.
        const response = await call(route)
          .set("Authorization", bearer(adminTokens.accessToken))
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

      /*
       * The address is **asserted** by the staff member who typed it
       * (ADR-0071 §3): they are the authority a confirmation link would be
       * asking, so the stamp lands with the row and nothing is mailed. It is
       * checked against the column rather than the resource because the
       * resource deliberately does not carry it — what the invariant needs is
       * that no `active` user exists with an empty stamp.
       */
      const [account] = await harness.db.db
        .select({ verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, "created.by.admin@machxi.local"));

      expect(account?.verifiedAt).not.toBeNull();
      expect(harness.mail).toHaveLength(0);
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

    it("creates a personal organization owned by the new account", async () => {
      // The second of the three paths ADR-0067 §2 names, and it must produce
      // exactly what registration's does — the same derivation, the same
      // `owner` membership, in the same transaction as the account.
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "org.by.admin@machxi.local", firstName: "Ozzy" },
      );

      const [organization] = await harness.db.db
        .select({
          id: organizations.id,
          slug: organizations.slug,
          kind: organizations.kind,
        })
        .from(organizations)
        .where(
          and(
            eq(organizations.createdBy, created.id),
            isNull(organizations.deletedAt),
          ),
        );

      expect(organization).toMatchObject({
        kind: "personal",
        slug: personalOrganizationSlug(created.id),
      });

      const memberships = await harness.db.db
        .select({
          userId: organizationMemberships.userId,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .where(
          eq(organizationMemberships.organizationId, organization?.id ?? ""),
        );

      expect(memberships).toEqual([{ userId: created.id, role: "owner" }]);
    });

    it("leaves the organization count unchanged when a duplicate is refused", async () => {
      // The register path's twin, and true today for the same simpler reason:
      // the insert conflicts and the transaction returns before the
      // organization is created. Asserted so that a reordering cannot leave an
      // orphan organization behind a `409`.
      const before = await liveOrganizationCount();

      await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: FIXTURE_USERS.active,
          password: NEW_ACCOUNT_PASSWORD,
        })
        .expect(409);

      expect(await liveOrganizationCount()).toBe(before);
    });

    it("accepts an explicit status, and leaves an unproven address unstamped", async () => {
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

      // The one create that asserts nothing: an admin deliberately making an
      // account that has proven nothing, which is the row the verification
      // flow exists to move (ADR-0071 §3). A stamp here would make the column
      // disagree with the status on exactly that row.
      const [account] = await harness.db.db
        .select({ verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, "pending.by.admin@machxi.local"));

      expect(account?.verifiedAt).toBeNull();
    });

    it("stamps the address when a patch moves an account to active", async () => {
      /*
       * The third path into `active`, beside the link and `create` — an
       * operator clearing a stuck account from the grid — and the one that
       * would otherwise produce `status = 'active'` with an empty
       * `email_verified_at` (`D18.3`'s `security-reviewer`). ADR-0067 §5's
       * address-match acceptance and D19's linking rule read `status` alone,
       * so a row that broke the invariant would turn an address somebody
       * merely typed into proof of a mailbox.
       */
      const email = "stuck.then.cleared@machxi.local";

      await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email,
          password: NEW_ACCOUNT_PASSWORD,
          status: "pending_verification",
        })
        .expect(201);

      const [before] = await harness.db.db
        .select({ id: users.id, verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, email));

      expect(before?.verifiedAt).toBeNull();

      await request()
        .patch(`${USERS_BASE}/${before?.id ?? ""}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "active" })
        .expect(200);

      const [after] = await harness.db.db
        .select({ verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, email));

      expect(after?.verifiedAt).not.toBeNull();
    });

    it("leaves an existing stamp alone when an account is re-enabled", async () => {
      // `coalesce`, not an overwrite: the column records when the address was
      // proven, not when the account was last switched back on.
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "disabled.then.enabled@machxi.local" },
      );

      const [created] = await harness.db.db
        .select({ verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, target.id));

      await request()
        .patch(`${USERS_BASE}/${target.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "disabled" })
        .expect(200);

      await request()
        .patch(`${USERS_BASE}/${target.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "active" })
        .expect(200);

      const [reenabled] = await harness.db.db
        .select({ verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, target.id));

      expect(reenabled?.verifiedAt).toEqual(created?.verifiedAt);
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

  /**
   * `DELETE /api/v1/admin/users/:id` — soft deletion (ADR-0028).
   *
   * The write half of the read path D1 built: `deleted_at`, `findAnyById` and
   * the `deletedAt` filter all described states the API could not produce
   * until now. What the tests below are really checking is that the two halves
   * agree — the row stays readable where the ADR says it must, stops being
   * writable where it says it must, and releases its address, which is the
   * whole reason the unique index became partial.
   */
  describe("DELETE /api/v1/admin/users/:id", () => {
    const remove = (token: string, id: string) =>
      request()
        .delete(`${USERS_BASE}/${id}`)
        .set("Authorization", bearer(token));

    it("soft-deletes: 204, the row survives, and it is disabled", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "delete.me@machxi.local" },
      );

      const response = await remove(adminTokens.accessToken, target.id).expect(
        204,
      );

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      // `GET` still answers `200`, on purpose: an admin who can list deleted
      // accounts must be able to open one, and a `404` for a row they were
      // just shown is the worse lie.
      const after = await asAdmin(`${USERS_BASE}/${target.id}`).expect(200);

      expect(userEnvelope.safeParse(after.body).success).toBe(true);
      expect(after.body.data.deletedAt).toEqual(expect.any(String));
      // `status` is written too, so it stays truthful on its own: an
      // active-and-deleted account would satisfy `filter[status][eq]=active`.
      expect(after.body.data.status).toBe("disabled");
    });

    it("soft-deletes the account's personal organization in the same transaction", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "delete.with.org@machxi.local" },
      );

      const before = await personalOrganizationOf(target.id);

      expect(before?.deletedAt).toBeNull();

      await remove(adminTokens.accessToken, target.id).expect(204);

      const [row] = await harness.db.db
        .select({
          deletedAt: organizations.deletedAt,
        })
        .from(organizations)
        .where(eq(organizations.id, before?.id ?? ""));

      // Stamped, and with the account's own timestamp: the two writes are one
      // commit (ADR-0067 §2), so there is no window in which a closed account
      // still has a live organization.
      expect(row?.deletedAt).toBeInstanceOf(Date);

      const [account] = await harness.db.db
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, target.id));

      expect(row?.deletedAt?.toISOString()).toBe(
        account?.deletedAt?.toISOString(),
      );

      // The membership survives the soft delete — nothing cascades on it —
      // which is why every read of it joins `organizations` and filters
      // `deleted_at` rather than trusting the row's absence.
      const memberships = await harness.db.db
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, before?.id ?? ""));

      expect(memberships).toHaveLength(1);
    });

    it("ends every session and refuses the credential afterwards", async () => {
      const email = "delete.sessions@machxi.local";
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );
      const tokens = await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      await remove(adminTokens.accessToken, target.id).expect(204);

      const profile = await request()
        .get("/api/v1/user/profile")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(profile.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // And the account cannot come back through the front door: `findByEmail`
      // filters `deleted_at is null`, so this is indistinguishable from an
      // unknown address (ADR-0020 §Enumeration).
      const relogin = await request()
        .post("/api/v1/user/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(relogin.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("releases the address, so the same person can come back", async () => {
      // The support answer this endpoint exists to make possible, and the one
      // thing the plain unique constraint made impossible (ADR-0028).
      const email = "delete.rejoin@machxi.local";
      const first = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      await remove(adminTokens.accessToken, first.id).expect(204);

      const second = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      expect(second.id).not.toBe(first.id);
      expect(second.deletedAt).toBeNull();

      // Two rows, one address, at most one live — which is exactly what the
      // partial index permits and what every read already tolerated.
      const both = await asAdmin(
        `${USERS_BASE}?${listQueryString({
          "filter[email]": email,
          "filter[deletedAt][null]": "false",
          limit: 10,
        })}`,
      ).expect(200);

      expect(both.body.data).toHaveLength(1);
      expect(both.body.data[0].id).toBe(first.id);
    });

    it("answers a duplicate registration CONFLICT, not 500", async () => {
      // The load-bearing line of the step: `onConflictDoNothing` has to name
      // the partial index, or the insert matches no index at all, the unique
      // violation escapes, and this answers `500` (ADR-0028).
      const email = "delete.conflict@machxi.local";

      await createUserAccount(harness.app, adminTokens.accessToken, { email });

      const conflict = await request()
        .post(USERS_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(409);

      expect(conflict.body.error.code).toBe("USER_EMAIL_TAKEN");
    });

    it("lets a self-registered address be registered again after deletion", async () => {
      // The public path, which answers a plain `CONFLICT` rather than naming
      // the address (ADR-0020 §Enumeration) — and must therefore not answer it
      // for an address whose only holder is deleted.
      const email = "delete.reregister@machxi.local";

      const registered = await registerVerified(
        harness,
        email,
        NEW_ACCOUNT_PASSWORD,
      );

      await remove(adminTokens.accessToken, registered.id).expect(204);

      // `202` rather than the `409 CONFLICT` a live holder would earn: the
      // partial unique index released the address (ADR-0028).
      await request()
        .post("/api/v1/public/auth/register")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(202);
    });

    it("refuses a second delete with 409 USER_DELETED", async () => {
      const target = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "delete.twice@machxi.local" },
      );

      await remove(adminTokens.accessToken, target.id).expect(204);

      const again = await remove(adminTokens.accessToken, target.id).expect(
        409,
      );

      expect(again.body.error.code).toBe("USER_DELETED");
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

    describe("a deleted account is read-only", () => {
      let deletedId: string;

      beforeAll(async () => {
        const target = await createUserAccount(
          harness.app,
          adminTokens.accessToken,
          { email: "delete.readonly@machxi.local" },
        );

        deletedId = target.id;
        await remove(adminTokens.accessToken, deletedId).expect(204);
      });

      it("refuses PATCH, so nothing can be active and deleted at once", async () => {
        const response = await request()
          .patch(`${USERS_BASE}/${deletedId}`)
          .set("Authorization", bearer(adminTokens.accessToken))
          .send({ status: "active" })
          .expect(409);

        expect(response.body.error.code).toBe("USER_DELETED");

        const after = await asAdmin(`${USERS_BASE}/${deletedId}`).expect(200);

        expect(after.body.data.status).toBe("disabled");
        expect(after.body.data.deletedAt).toEqual(expect.any(String));
      });

      it("refuses a session revoke", async () => {
        const response = await request()
          .post(`${USERS_BASE}/${deletedId}/sessions/revoke`)
          .set("Authorization", bearer(adminTokens.accessToken))
          .expect(409);

        expect(response.body.error.code).toBe("USER_DELETED");
      });

      it("refuses a password reset", async () => {
        const response = await request()
          .post(`${USERS_BASE}/${deletedId}/password`)
          .set("Authorization", bearer(adminTokens.accessToken))
          .send({
            password: "ResetByAnAdmin!2026",
            currentPassword: NEW_ACCOUNT_PASSWORD,
          })
          .expect(409);

        expect(response.body.error.code).toBe("USER_DELETED");
      });

      it("still reads, and still shows up when the list asks about deletion", async () => {
        await asAdmin(`${USERS_BASE}/${deletedId}`).expect(200);

        const listed = await asAdmin(
          `${USERS_BASE}?${listQueryString({
            "filter[deletedAt][null]": "false",
            limit: 100,
          })}`,
        ).expect(200);

        expect(
          listed.body.data.map((item: { id: string }) => item.id),
        ).toContain(deletedId);

        // And is hidden from the default scope, which is what makes "the
        // account is gone" true on the screen where it matters.
        const defaultScope = await asAdmin(`${USERS_BASE}?limit=100`).expect(
          200,
        );

        expect(
          defaultScope.body.data.map((item: { id: string }) => item.id),
        ).not.toContain(deletedId);
      });
    });
  });

  /**
   * `POST /api/v1/admin/users/:id/password` — the administrative reset
   * (ADR-0027 §Administrative reset).
   *
   * The acting staff member's own password is in the body, and the subject's
   * is in nothing at all: that asymmetry is the endpoint. What is asserted
   * here is the pair of properties a unit test cannot show — that the new
   * credential really signs in, and that every session the subject held is
   * gone by the time the response arrives.
   */
  describe("POST /api/v1/admin/users/:id/password", () => {
    const RESET_PASSWORD = "ResetByAnAdmin!2026";

    const setPassword = (id: string, body: object) =>
      request()
        .post(`${USERS_BASE}/${id}/password`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send(body);

    /** A customer nobody else in the file touches, already signed in. */
    const freshCustomer = async (email: string) => {
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      return {
        id: created.id,
        tokens: await login(harness.app, "user", {
          email,
          password: NEW_ACCOUNT_PASSWORD,
        }),
      };
    };

    it("sets the password, ends every session, and the new one signs in", async () => {
      const email = "reset.me@machxi.local";
      const { id, tokens } = await freshCustomer(email);

      const response = await setPassword(id, {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      // No exception for anybody: the subject proved nothing, and the
      // plausible reason for a reset is that the account is compromised.
      const after = await request()
        .get("/api/v1/user/profile")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(after.body.error.code).toBe("AUTH_SESSION_REVOKED");

      await login(harness.app, "user", { email, password: RESET_PASSWORD });

      const withOldPassword = await request()
        .post("/api/v1/user/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(withOldPassword.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses an actor who cannot re-present their own password", async () => {
      // ADR-0027 rule 1, and the reason the endpoint has a body at all: a
      // stolen admin access token must not be enough to take over an account.
      const email = "reset.refused@machxi.local";
      const { id } = await freshCustomer(email);

      const response = await setPassword(id, {
        password: RESET_PASSWORD,
        currentPassword: "not-the-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      // Refused, not partially applied.
      await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });
    });

    it("answers the same 403 for an id that does not exist", async () => {
      // The actor is checked before the subject, so a caller who cannot use
      // the endpoint cannot use it to learn which ids are real either.
      const response = await setPassword(UNKNOWN_ID, {
        password: RESET_PASSWORD,
        currentPassword: "not-the-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
    });

    it("answers 404 for an unknown id once the actor verifies", async () => {
      const response = await setPassword(UNKNOWN_ID, {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("holds the new password to the policy and the actor's only to a bound", async () => {
      const response = await setPassword(customerId, {
        password: "short",
        currentPassword: "x",
      }).expect(400);

      const paths = response.body.error.details.map(
        (detail: { path: string }) => detail.path,
      );

      expect(paths).toContain("password");
      expect(paths).not.toContain("currentPassword");
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      const response = await setPassword(customerId, {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: RESET_PASSWORD,
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const response = await setPassword("not-a-uuid", {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  /**
   * `POST /api/v1/admin/users/:id/email` — a super admin setting a customer's
   * address outright (ADR-0071 §7).
   *
   * The administrative counterpart of §6, and the difference is the point:
   * nothing is mailed and nothing is confirmed, because the operator is the
   * authority a confirmation link would be asking. The address counts as
   * **asserted** the moment it is written.
   */
  describe("POST /api/v1/admin/users/:id/email", () => {
    const SUPER_ADMIN_PASSWORD = superAdmin().password;

    const setEmail = (id: string, body: object, token?: Tokens) =>
      request()
        .post(`${USERS_BASE}/${id}/email`)
        .set("Authorization", bearer((token ?? superAdminTokens).accessToken))
        .send(body);

    const rowOf = async (id: string) => {
      const [row] = await harness.db.db
        .select({
          email: users.email,
          status: users.status,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, id));

      return row;
    };

    it("sets the address, stamps it asserted, and audits both addresses", async () => {
      const before = "set.email.before@machxi.local";
      const after = "set.email.after@machxi.local";
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: before },
      );

      const response = await setEmail(created.id, {
        email: after,
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(204);

      expect(response.text).toBe("");

      const row = await rowOf(created.id);

      expect(row?.email).toBe(after);
      // Asserted, which is what keeps §3's invariant true of this path too:
      // every `active` user has a proven address.
      expect(row?.emailVerifiedAt).not.toBeNull();

      // The new address is the one that signs in.
      await login(harness.app, "user", {
        email: after,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const [audited] = await harness.db.db
        .select({
          actorType: auditEvents.actorType,
          actingAsId: auditEvents.actingAsId,
          data: auditEvents.data,
        })
        .from(auditEvents)
        .where(eq(auditEvents.event, "account.email_changed"))
        .orderBy(desc(auditEvents.occurredAt));

      expect(audited).toMatchObject({
        // The acting operator, never the customer: the request ran as the
        // super admin, so `acting_as` stays empty and the subject rides in
        // the row's data (ADR-0058, ADR-0071 §7).
        actorType: "staff",
        actingAsId: null,
        data: {
          subjectType: "user",
          subjectId: created.id,
          previousEmail: before,
          newEmail: after,
        },
      });
    });

    it("refuses a plain admin with 403 and changes nothing", async () => {
      const email = "set.email.admin.refused@machxi.local";
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      const response = await setEmail(
        created.id,
        { email: "nope@machxi.local", currentPassword: NEW_ACCOUNT_PASSWORD },
        adminTokens,
      ).expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
      expect((await rowOf(created.id))?.email).toBe(email);
    });

    it("refuses a super admin who cannot re-present their own password", async () => {
      const email = "set.email.password.refused@machxi.local";
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      const response = await setEmail(created.id, {
        email: "still.nope@machxi.local",
        currentPassword: "not-the-super-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
      expect((await rowOf(created.id))?.email).toBe(email);
    });

    it("answers the same 403 for an id that does not exist", async () => {
      // The actor is verified before the subject is read, so the endpoint is
      // no enumeration oracle for somebody who cannot use it (ADR-0027).
      const response = await setEmail(UNKNOWN_ID, {
        email: "unknown.subject@machxi.local",
        currentPassword: "not-the-super-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
    });

    it("answers 409 for an address a live account already holds", async () => {
      const email = "set.email.conflict@machxi.local";
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      const response = await setEmail(created.id, {
        email: FIXTURE_USERS.active,
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(409);

      expect(response.body.error.code).toBe("USER_EMAIL_TAKEN");
      expect((await rowOf(created.id))?.email).toBe(email);
    });

    it("counts the subject's own address as taken", async () => {
      // §6's rule read on the administrative half: the address is held by a
      // live account — this one — so "already taken" is truthful, and a change
      // to nothing would write an audit row about nothing.
      const email = "set.email.same@machxi.local";
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email },
      );

      const response = await setEmail(created.id, {
        email,
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(409);

      expect(response.body.error.code).toBe("USER_EMAIL_TAKEN");
    });

    it("moves a pending_verification account's address without stamping it", async () => {
      // `POST /admin/users`'s own split (ADR-0071 §3): a row that has proven
      // nothing keeps a null stamp, so `email_verified_at` never disagrees
      // with the one status the verification flow exists to move — while the
      // address itself is corrected, so a resend reaches the right mailbox.
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        {
          email: "set.email.pending@machxi.local",
          status: "pending_verification",
        },
      );

      // Stamped by hand, which `PATCH /:id { status: "pending_verification" }`
      // on a proven account really does leave behind (`D18.10`'s
      // `security-reviewer`): the column is written unconditionally, so this
      // path must **clear** it rather than skip the write and keep a stamp an
      // address the account no longer holds once earned.
      await harness.db.db
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, created.id));

      await setEmail(created.id, {
        email: "set.email.pending.new@machxi.local",
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(204);

      const row = await rowOf(created.id);

      expect(row?.email).toBe("set.email.pending.new@machxi.local");
      expect(row?.status).toBe("pending_verification");
      expect(row?.emailVerifiedAt).toBeNull();
    });

    it("refuses a soft-deleted account with 409 USER_DELETED", async () => {
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "set.email.deleted@machxi.local" },
      );

      await request()
        .delete(`${USERS_BASE}/${created.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(204);

      const response = await setEmail(created.id, {
        email: "set.email.deleted.new@machxi.local",
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(409);

      expect(response.body.error.code).toBe("USER_DELETED");
    });

    it("spends every live link the account holds", async () => {
      /*
       * `D18.10`'s `security-reviewer`. The first draft superseded
       * `change_email` alone, and the two purposes it left live are the sharper
       * ones: a `verify_email` link mailed to the old mailbox activates the row
       * *and* stamps the corrected address proven *and* issues a session, and
       * a `reset_password` one sets a password on an account this endpoint
       * deliberately does not sign out. Both were addressed to the mailbox the
       * correction exists to stop trusting.
       */
      const created = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        {
          email: "set.email.links@machxi.local",
          status: "pending_verification",
        },
      );

      // A verification link to the mailbox that is about to be replaced.
      await request()
        .post("/api/v1/public/auth/resend-verification")
        .send({ email: "set.email.links@machxi.local", locale: "en" })
        .expect(202);

      const live = async (): Promise<number> => {
        const [row] = await harness.db.db
          .select({ total: sql<number>`count(*)::int` })
          .from(accountTokens)
          .where(
            and(
              eq(accountTokens.principalId, created.id),
              isNull(accountTokens.consumedAt),
            ),
          );

        return row?.total ?? 0;
      };

      expect(await live()).toBeGreaterThan(0);

      await setEmail(created.id, {
        email: "set.email.links.new@machxi.local",
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(204);

      expect(await live()).toBe(0);
    });

    it("rejects an unknown field and a malformed address", async () => {
      const unknownField = await setEmail(customerId, {
        email: "fine@machxi.local",
        currentPassword: SUPER_ADMIN_PASSWORD,
        newEmail: "fine@machxi.local",
      }).expect(400);

      expect(unknownField.body.error.code).toBe("VALIDATION_ERROR");

      const malformed = await setEmail(customerId, {
        email: "not-an-address",
        currentPassword: SUPER_ADMIN_PASSWORD,
      }).expect(400);

      expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
