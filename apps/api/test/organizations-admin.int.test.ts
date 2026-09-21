import { listEnvelopeSchema, successEnvelopeSchema } from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { z } from "zod";

import {
  bearer,
  createStaffMember,
  createUserAccount,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/admin/organizations` end to end (ADR-0067 §3, ADR-0019, ADR-0021).
 *
 * The tenant base as **staff** see it, which is the half of ADR-0067 §3 worth
 * a suite of its own: staff are never members, so nothing here resolves a
 * membership, no request is answered `404` for want of one, and every
 * organization is visible — soft-deleted ones included.
 *
 * The guard shape is the users resource's exactly: `admin` or `manager` to
 * read, every writing route narrowed back to `admin`. That narrowing is what
 * the matrix below is for.
 */

const BASE = "/api/v1/admin/organizations";

const organizationResourceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(["personal", "team"]),
  role: z.null(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

const organizationEnvelope = successEnvelopeSchema(organizationResourceSchema);
const organizationListEnvelope = listEnvelopeSchema(organizationResourceSchema);

describe("admin organization administration", () => {
  let harness: TestApp;
  let adminTokens: Tokens;
  let managerTokens: Tokens;
  let customerId: string;
  let acmeId: string;

  const request = () => supertest(harness.app);

  const asAdmin = (path: string) =>
    request().get(path).set("Authorization", bearer(adminTokens.accessToken));

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });

    const superAdminTokens = await login(harness.app, "staff", superAdmin());

    const admin = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      { email: "org.admin@machxi.local", roles: ["admin"] },
    );

    adminTokens = await login(harness.app, "staff", {
      email: admin.email,
      password: NEW_ACCOUNT_PASSWORD,
    });

    managerTokens = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.manager,
      password: FIXTURE_PASSWORD,
    });

    const customer = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const me = await request()
      .get("/api/v1/user/auth/me")
      .set("Authorization", bearer(customer.accessToken))
      .expect(200);

    customerId = me.body.data.id as string;

    const listed = await asAdmin(`${BASE}?filter[slug][eq]=acme`).expect(200);

    acmeId = listed.body.data[0].id as string;
  });

  afterAll(async () => {
    await harness.close();
  });

  /* ── the guard matrix (ADR-0019 §2) ────────────────────────────────────── */

  describe("the guard on every route", () => {
    const asManager = (call: supertest.Test) =>
      call.set("Authorization", bearer(managerTokens.accessToken));

    it("lets a manager read the tenant base", async () => {
      await asManager(request().get(BASE)).expect(200);
      await asManager(request().get(`${BASE}/${acmeId}`)).expect(200);
      await asManager(request().get(`${BASE}/${acmeId}/memberships`)).expect(
        200,
      );
    });

    it("refuses a manager every write", async () => {
      // A manager reads the tenant base and does not reshape it (ADR-0067 §3,
      // revised) — the users resource's rule, applied to the tenant.
      await asManager(request().post(BASE))
        .send({ name: "Nope", slug: "nope", ownerId: customerId })
        .expect(403);

      await asManager(request().patch(`${BASE}/${acmeId}`))
        .send({ name: "Renamed by a manager" })
        .expect(403);

      await asManager(request().delete(`${BASE}/${acmeId}`)).expect(403);

      await asManager(request().post(`${BASE}/${acmeId}/memberships`))
        .send({ userId: customerId, role: "member" })
        .expect(403);

      await asManager(
        request().patch(`${BASE}/${acmeId}/memberships/${customerId}`),
      )
        .send({ role: "admin" })
        .expect(403);

      await asManager(
        request().delete(`${BASE}/${acmeId}/memberships/${customerId}`),
      ).expect(403);
    });

    it("refuses a customer principal on the admin segment", async () => {
      const customer = await login(harness.app, "user", {
        email: FIXTURE_USERS.active,
        password: FIXTURE_PASSWORD,
      });

      // `401`, not `403`: a wrong-population token must not learn which admin
      // routes exist (ADR-0019 §1).
      await request()
        .get(BASE)
        .set("Authorization", bearer(customer.accessToken))
        .expect(401);
    });
  });

  /* ── the resource ──────────────────────────────────────────────────────── */

  describe("GET /api/v1/admin/organizations", () => {
    it("returns the list envelope, every row with a null role", async () => {
      const response = await asAdmin(BASE).expect(200);

      expect(organizationListEnvelope.safeParse(response.body).success).toBe(
        true,
      );
      // Staff are never members, so the field is `null` rather than absent:
      // one resource shape on both segments (ADR-0012, ADR-0067 §3).
      expect(
        (response.body.data as { role: unknown }[]).every(
          (row) => row.role === null,
        ),
      ).toBe(true);
    });

    it("searches name and slug with q", async () => {
      const response = await asAdmin(`${BASE}?q=acme`).expect(200);

      expect(
        (response.body.data as { slug: string }[]).some(
          (row) => row.slug === "acme",
        ),
      ).toBe(true);
    });

    it("lists a soft-deleted organization only when the query asks about deletedAt", async () => {
      const created = await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          name: "Soon Gone",
          slug: "soon-gone",
          ownerId: customerId,
        })
        .expect(201);

      await request()
        .delete(`${BASE}/${created.body.data.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(204);

      const defaultScope = await asAdmin(BASE).expect(200);

      expect(
        (defaultScope.body.data as { id: string }[]).some(
          (row) => row.id === created.body.data.id,
        ),
      ).toBe(false);

      // The default scope steps aside rather than combining, or an
      // allow-listed filter would return nothing forever (the `users`
      // reading, ADR-0028).
      const asked = await asAdmin(
        `${BASE}?filter[deletedAt][null]=false`,
      ).expect(200);

      expect(
        (asked.body.data as { id: string }[]).some(
          (row) => row.id === created.body.data.id,
        ),
      ).toBe(true);
    });
  });

  describe("GET /api/v1/admin/organizations/:id", () => {
    it("opens a soft-deleted organization, the users reading", async () => {
      const created = await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ name: "Openable", slug: "openable", ownerId: customerId })
        .expect(201);

      await request()
        .delete(`${BASE}/${created.body.data.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(204);

      // `200`, not `404`: an admin who can list deleted rows must be able to
      // open one, and a `404` for a row they were just shown is the worse lie.
      const response = await asAdmin(`${BASE}/${created.body.data.id}`).expect(
        200,
      );

      expect(organizationEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.deletedAt).toEqual(expect.any(String));
    });

    it("answers 404 for an id nothing holds", async () => {
      const response = await asAdmin(
        `${BASE}/00000000-0000-4000-8000-000000000000`,
      ).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /api/v1/admin/organizations", () => {
    it("creates a team organization owned by the named account", async () => {
      const response = await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ name: "Staff Made", slug: "staff-made", ownerId: customerId })
        .expect(201);

      expect(response.body.data).toMatchObject({
        slug: "staff-made",
        kind: "team",
        createdBy: customerId,
        role: null,
      });

      const members = await asAdmin(
        `${BASE}/${response.body.data.id}/memberships`,
      ).expect(200);

      expect(members.body.data).toHaveLength(1);
      expect(members.body.data[0]).toMatchObject({
        userId: customerId,
        role: "owner",
      });
    });

    it("refuses an owner id nothing holds, rather than raising a 500", async () => {
      const response = await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          name: "Ownerless",
          slug: "ownerless",
          ownerId: "00000000-0000-4000-8000-000000000000",
        })
        .expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("refuses a taken slug", async () => {
      await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ name: "Second Acme", slug: "acme", ownerId: customerId })
        .expect(409);
    });
  });

  describe("the memberships sub-resource (ADR-0067 §3)", () => {
    it("adds a member by user id, changes their role and removes them", async () => {
      const org = await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ name: "Staffed", slug: "staffed", ownerId: customerId })
        .expect(201);

      const joiner = await createUserAccount(
        harness.app,
        adminTokens.accessToken,
        { email: "staff.added@machxi.local" },
      );

      // **By user id**, not by address: staff already list accounts, so there
      // is nothing here to enumerate (ADR-0067 §3, revised).
      await request()
        .post(`${BASE}/${org.body.data.id}/memberships`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ userId: joiner.id, role: "member" })
        .expect(204);

      await request()
        .patch(`${BASE}/${org.body.data.id}/memberships/${joiner.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ role: "admin" })
        .expect(204);

      const members = await asAdmin(
        `${BASE}/${org.body.data.id}/memberships`,
      ).expect(200);

      expect(
        (members.body.data as { userId: string; role: string }[]).find(
          (row) => row.userId === joiner.id,
        )?.role,
      ).toBe("admin");

      await request()
        .delete(`${BASE}/${org.body.data.id}/memberships/${joiner.id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(204);
    });

    it("refuses removing the last owner, staff or not", async () => {
      const org = await request()
        .post(BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ name: "Sole", slug: "sole-owner", ownerId: customerId })
        .expect(201);

      // The invariant is the organization's, not the caller's: staff are above
      // the tenants and still may not leave one without an owner.
      const response = await request()
        .delete(`${BASE}/${org.body.data.id}/memberships/${customerId}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(409);

      expect(response.body.error.code).toBe("ORGANIZATION_LAST_OWNER");
    });

    it("refuses adding a member to a personal organization", async () => {
      // Staff are above the tenants and still may not put a second person into
      // an organization whose whole shape is one member (ADR-0067 §2).
      const listed = await asAdmin(`${BASE}?filter[kind][eq]=personal`).expect(
        200,
      );

      const response = await request()
        .post(`${BASE}/${listed.body.data[0].id}/memberships`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ userId: customerId, role: "member" })
        .expect(409);

      expect(response.body.error.code).toBe("ORGANIZATION_PERSONAL_CLOSED");
    });

    it("answers 404 for an organization id nothing holds, rather than an empty page", async () => {
      // Nothing has proved this organization exists — there is no
      // `requireMembership` on this segment — so the list must not answer
      // `200` with nothing while `GET /:id` on the same prefix answers `404`.
      const response = await asAdmin(
        `${BASE}/00000000-0000-4000-8000-000000000000/memberships`,
      ).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("refuses a user id nothing holds", async () => {
      const response = await request()
        .post(`${BASE}/${acmeId}/memberships`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          userId: "00000000-0000-4000-8000-000000000000",
          role: "member",
        })
        .expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("DELETE /api/v1/admin/organizations/:id", () => {
    it("refuses a personal organization, as the user segment does", async () => {
      const listed = await asAdmin(`${BASE}?filter[kind][eq]=personal`).expect(
        200,
      );

      const response = await request()
        .delete(`${BASE}/${listed.body.data[0].id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(409);

      expect(response.body.error.code).toBe(
        "ORGANIZATION_PERSONAL_UNDELETABLE",
      );
    });
  });
});
