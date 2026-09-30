import { declaredErrorEnvelopeSchema } from "@repo/contracts";
import {
  organizationMemberships,
  organizations,
  personalOrganizationSlug,
  users,
} from "@repo/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import { FIXTURE_USERS, resetAndSeed } from "./support/seed.js";

/**
 * `POST /api/v1/public/auth/register` (ADR-0018 §Staff onboarding, amended
 * step 4, as ADR-0071 §3 supersedes its answer; ADR-0020 §Enumeration).
 *
 * Two things are being checked: that a registration creates an account nobody
 * can sign into until its address is proven, and that a *taken* address is
 * answered in a way that does not confirm it exists. What the mailed link
 * then does is `mail-flows.int.test.ts`'s claim — this file is about the
 * account and the conflict.
 */

const REGISTER = "/api/v1/public/auth/register";

describe("user self-registration", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("creates a pending account with the customer role and no session", async () => {
    const response = await request()
      .post(REGISTER)
      .send({
        email: "newcomer@machxi.local",
        password: "a-perfectly-fine-password",
        firstName: "New",
        lastName: "Comer",
      })
      .expect(202);

    expect(response.body.data).toEqual({ accepted: true });
    // The delta ADR-0071 §3 makes to ADR-0018, on the wire: nothing that could
    // authenticate anybody leaves this endpoint, on either transport.
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("accessToken");

    const [account] = await harness.db.db
      .select({ status: users.status, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, "newcomer@machxi.local"));

    expect(account).toMatchObject({
      status: "pending_verification",
      verifiedAt: null,
    });
  });

  it("places no cookie even for a client that asked for cookie transport", async () => {
    const response = await request()
      .post(REGISTER)
      .set("X-Auth-Transport", "cookie")
      .send({
        email: "cookie-newcomer@machxi.local",
        password: "a-perfectly-fine-password",
      })
      .expect(202);

    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses the new account's login until the address is proven", async () => {
    await request()
      .post(REGISTER)
      .send({
        email: "second-newcomer@machxi.local",
        password: "another-fine-password",
      })
      .expect(202);

    const response = await request()
      .post("/api/v1/user/auth/login")
      .send({
        email: "second-newcomer@machxi.local",
        password: "another-fine-password",
      })
      .expect(403);

    expect(response.body.error.code).toBe("AUTH_EMAIL_UNVERIFIED");
  });

  it("accepts a registration without names", async () => {
    // `users.first_name` is nullable, unlike `staff` (ADR-0017).
    await request()
      .post(REGISTER)
      .send({
        email: "anonymous@machxi.local",
        password: "a-perfectly-fine-password",
      })
      .expect(202);

    const [account] = await harness.db.db
      .select({ firstName: users.firstName })
      .from(users)
      .where(eq(users.email, "anonymous@machxi.local"));

    expect(account?.firstName).toBeNull();
  });

  it("answers a taken address with a conflict that does not name it", async () => {
    // Never `USER_EMAIL_TAKEN` — that code is reserved for the authenticated
    // `POST /admin/users`, where the caller is staff (ADR-0020 §Enumeration).
    const response = await request()
      .post(REGISTER)
      .send({
        email: FIXTURE_USERS.active,
        password: "a-perfectly-fine-password",
      })
      .expect(409);

    expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.error.code).toBe("CONFLICT");
    expect(JSON.stringify(response.body)).not.toContain(FIXTURE_USERS.active);
  });

  it("treats a taken address case-insensitively", async () => {
    await request()
      .post(REGISTER)
      .send({
        email: FIXTURE_USERS.active.toUpperCase(),
        password: "a-perfectly-fine-password",
      })
      .expect(409);
  });

  it("enforces the password policy, unlike login", async () => {
    // Login deliberately does *not* apply the policy (a short password there
    // must be a 401, not a 400); registration is where it belongs.
    const response = await request()
      .post(REGISTER)
      .send({ email: "shorty@machxi.local", password: "short" })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      response.body.error.details.map(
        (detail: { path: string }) => detail.path,
      ),
    ).toContain("password");
  });

  /* ── the personal organization (ADR-0067 §2) ────────────────────────────── */

  /** Every live organization, however many. */
  const liveOrganizationCount = async (): Promise<number> => {
    const [row] = await harness.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizations)
      .where(isNull(organizations.deletedAt));

    return row?.total ?? 0;
  };

  it("creates a personal organization owned by the new account", async () => {
    const email = "org-newcomer@machxi.local";

    await request()
      .post(REGISTER)
      .send({
        email,
        password: "a-perfectly-fine-password",
        firstName: "Orla",
        lastName: "Newcomer",
      })
      .expect(202);

    const [account] = await harness.db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    expect(account).toBeDefined();
    const userId = account?.id ?? "";

    const [organization] = await harness.db.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        kind: organizations.kind,
        createdBy: organizations.createdBy,
      })
      .from(organizations)
      .where(
        and(
          eq(organizations.createdBy, userId),
          isNull(organizations.deletedAt),
        ),
      );

    expect(organization).toMatchObject({
      kind: "personal",
      createdBy: userId,
      name: "Orla Newcomer",
      // Derived from the account's id, so no pasted URL carries an address
      // (ADR-0067 §2). The same derivation the backfill migration wrote in SQL.
      slug: personalOrganizationSlug(userId),
    });

    const memberships = await harness.asOwner((tx) =>
      tx
        .select({
          userId: organizationMemberships.userId,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .where(
          eq(organizationMemberships.organizationId, organization?.id ?? ""),
        ),
    );

    expect(memberships).toEqual([{ userId, role: "owner" }]);
  });

  it("leaves the organization count unchanged when a duplicate registration is refused", async () => {
    // Today this holds for a reason simpler than a rollback: the insert
    // returns `undefined` for a taken address and the transaction returns
    // before the organization is ever created. It is asserted anyway, and
    // that is the point — the day somebody reorders those two statements, or
    // moves the organization write ahead of the conflict check, this is what
    // catches the orphan organization a taken address would otherwise leave
    // behind on every attempt.
    const before = await liveOrganizationCount();

    await request()
      .post(REGISTER)
      .send({
        email: FIXTURE_USERS.active,
        password: "a-perfectly-fine-password",
      })
      .expect(409);

    expect(await liveOrganizationCount()).toBe(before);
  });

  it("forbids caching the response, which carries no tokens but names an account", async () => {
    await request()
      .post(REGISTER)
      .send({
        email: "cache-probe@machxi.local",
        password: "a-perfectly-fine-password",
      })
      .expect("Cache-Control", "no-store");
  });
});

describe("user self-registration, disabled by feature flag", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp({
      config: (config) => ({
        ...config,
        features: { ...config.features, userRegistration: false },
      }),
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("does not mount the route at all", async () => {
    // `ROUTE_NOT_FOUND`, not `403`: a 403 would confirm the feature exists and
    // is merely switched off for this deployment (ADR-0004).
    const response = await supertest(harness.app)
      .post(REGISTER)
      .send({
        email: "nobody@machxi.local",
        password: "a-perfectly-fine-password",
      })
      .expect(404);

    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
