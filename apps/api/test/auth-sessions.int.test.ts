import type { UserResource } from "@repo/contracts";
import { sessions } from "@repo/db";
import { asc, eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/core/config/index.js";
import { bearer, login } from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * The per-principal session cap (ADR-0073 §3), end to end.
 *
 * What the 2026-09-13 review found is that nothing bounded the `sessions`
 * table except an operator remembering to run `db:sessions:prune`: a person
 * signing in from a new browser every week accumulated rows forever, and every
 * one of them was a live credential. The cap answers that **at the mint** —
 * the eleventh sign-in revokes the oldest rather than refusing the new one,
 * because a person whose device was stolen is signing in from the replacement.
 *
 * Only this file can prove it. The unit suite's fake `sessions` has no
 * `created_at` and no transaction, and all three properties that matter are
 * properties of the real table: the **order** the excess is taken in, that an
 * impersonated row is neither counted nor chosen (ADR-0074 §4, the delta on
 * ADR-0073 §3), and that `0` means what it says.
 *
 * `apps/api/.env.test` sets `AUTH_MAX_SESSIONS_PER_PRINCIPAL=0`, so the rest
 * of the suite — which signs one fixture in dozens of times — is uncapped;
 * every app below states its own number, exactly as the limiter tests do.
 */

const CAP = 10;

const withCap = (max: number) => ({
  config: (config: AppConfig): AppConfig => ({
    ...config,
    auth: { ...config.auth, maxSessionsPerPrincipal: max },
  }),
});

const CUSTOMER = {
  email: FIXTURE_USERS.active,
  password: FIXTURE_PASSWORD,
} as const;

/**
 * Every session row of one account, oldest first — the order the cap reasons
 * about, and the reason this is a database read rather than an endpoint call:
 * a revoked row is exactly what no API surface returns.
 */
const rowsFor = (harness: TestApp, principalId: string) =>
  harness.db.db
    .select()
    .from(sessions)
    .where(eq(sessions.principalId, principalId))
    .orderBy(asc(sessions.createdAt), asc(sessions.id));

/** The customer fixture's id, read the way an operator would. */
const customerId = async (
  harness: TestApp,
  adminToken: string,
): Promise<string> => {
  const response = await supertest(harness.app)
    .get("/api/v1/admin/users")
    .set("Authorization", bearer(adminToken))
    .expect(200);

  const row = (response.body.data as UserResource[]).find(
    (candidate) => candidate.email === CUSTOMER.email,
  );

  if (row === undefined) throw new Error("the customer fixture is not seeded");

  return row.id;
};

describe("a principal at the cap", () => {
  let harness: TestApp;
  let principalId: string;

  beforeAll(async () => {
    harness = createTestApp(withCap(CAP));
    await resetAndSeed({ hasher: harness.hasher });

    const admin = await login(harness.app, "staff", superAdmin());

    principalId = await customerId(harness, admin.accessToken);

    // Eleven sign-ins, sequentially, so `created_at` orders them: the cap is
    // about which one is oldest, and a concurrent burst would be asserting
    // against the connection pool's scheduling instead.
    for (let device = 0; device < CAP + 1; device += 1) {
      await login(harness.app, "user", CUSTOMER);
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  it("keeps ten live and revokes the oldest as `session_cap`", async () => {
    const rows = await rowsFor(harness, principalId);

    expect(rows).toHaveLength(CAP + 1);

    const live = rows.filter((row) => row.revokedAt === null);

    expect(live).toHaveLength(CAP);

    // The **oldest**, and nothing else. Revoking the newest would sign the
    // person out of the device they are holding, which is the failure mode
    // ADR-0073 §3 rejects by name.
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[0]?.revokedReason).toBe("session_cap");
    expect(rows.slice(1).every((row) => row.revokedAt === null)).toBe(true);
  });

  it("leaves the session that was just minted usable", async () => {
    // The obvious way to get this wrong is to count the new row and then
    // include it in the excess: the cap would then end the sign-in that
    // triggered it, and a person at the cap could never sign in again.
    const fresh = await login(harness.app, "user", CUSTOMER);

    await supertest(harness.app)
      .get("/api/v1/user/auth/me")
      .set("Authorization", bearer(fresh.accessToken))
      .expect(200);

    const live = (await rowsFor(harness, principalId)).filter(
      (row) => row.revokedAt === null,
    );

    expect(live).toHaveLength(CAP);
  });
});

describe("an impersonated session under the cap", () => {
  let harness: TestApp;
  let principalId: string;

  /**
   * Two, not ten: what is under test is the **choice** the cap makes when the
   * oldest live row is an impersonated one, and the smallest number that can
   * express it is the clearest.
   */
  const SMALL_CAP = 2;

  beforeAll(async () => {
    harness = createTestApp(withCap(SMALL_CAP));
    await resetAndSeed({ hasher: harness.hasher });

    const admin = await login(harness.app, "staff", superAdmin());

    principalId = await customerId(harness, admin.accessToken);

    // First, so it is the account's **oldest** live session — the row the cap
    // would reach for if it did not know better (ADR-0057 §4).
    const minted = await supertest(harness.app)
      .post(`/api/v1/admin/users/${principalId}/impersonate`)
      .set("Authorization", bearer(admin.accessToken))
      .expect(200);

    await supertest(harness.app)
      .post("/api/v1/user/auth/impersonate")
      .send({ token: minted.body.data.token })
      .expect(200);

    // Three ordinary sign-ins. Counting only the customer's own, the third is
    // the one that takes the account over a cap of two; counting the
    // impersonated row as well, the second would already have.
    await login(harness.app, "user", CUSTOMER);
    await login(harness.app, "user", CUSTOMER);
    await login(harness.app, "user", CUSTOMER);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("is neither counted toward the cap nor the one revoked", async () => {
    const rows = await rowsFor(harness, principalId);

    expect(rows).toHaveLength(4);

    const impersonated = rows.filter(
      (row) => row.impersonatedByStaffId !== null,
    );

    expect(impersonated).toHaveLength(1);

    // Not counted (`SEC-09`): one revocation, not two. Had the impersonated
    // row counted, the second sign-in would have taken the account over the
    // line and the third over it again — two of the customer's own devices
    // signed out to make room for a session a support operator opened.
    const revoked = rows.filter((row) => row.revokedAt !== null);

    expect(revoked).toHaveLength(1);
    expect(rows[1]?.revokedAt).not.toBeNull();
    expect(rows[1]?.revokedReason).toBe("session_cap");

    // Never chosen: it is the oldest live row and it survives. A support
    // operator's session ends on its own fixed clock (ADR-0057 §4).
    expect(impersonated[0]?.revokedAt).toBeNull();
  });
});

describe("the cap turned off", () => {
  let harness: TestApp;
  let principalId: string;

  beforeAll(async () => {
    harness = createTestApp(withCap(0));
    await resetAndSeed({ hasher: harness.hasher });

    const admin = await login(harness.app, "staff", superAdmin());

    principalId = await customerId(harness, admin.accessToken);

    for (let device = 0; device < 4; device += 1) {
      await login(harness.app, "user", CUSTOMER);
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  it("revokes nothing at `0`", async () => {
    // `0` is uncapped (ADR-0073 §3) — the behaviour a deployment that would
    // rather run `db:sessions:prune` alone keeps, and the reason the schema
    // allows a zero where every other count here is positive.
    const rows = await rowsFor(harness, principalId);

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.revokedAt === null)).toBe(true);
  });
});
