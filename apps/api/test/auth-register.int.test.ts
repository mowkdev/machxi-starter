import { errorEnvelopeSchema } from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import { FIXTURE_USERS, resetAndSeed } from "./support/seed.js";

/**
 * `POST /api/v1/public/auth/register` (ADR-0018 §Staff onboarding, amended
 * step 4; ADR-0020 §Enumeration).
 *
 * Two things are being checked: that a registration signs the new account in
 * without a second round trip, and that a *taken* address is answered in a way
 * that does not confirm it exists.
 */

const REGISTER = "/api/v1/public/auth/register";

describe("user self-registration", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("creates the account, grants the customer role and signs it in", async () => {
    const response = await request()
      .post(REGISTER)
      .send({
        email: "newcomer@machxi.local",
        password: "a-perfectly-fine-password",
        firstName: "New",
        lastName: "Comer",
      })
      .expect(201);

    expect(response.body.data.principal).toMatchObject({
      kind: "user",
      email: "newcomer@machxi.local",
      firstName: "New",
      roles: ["customer"],
    });

    // The returned pair works immediately — that is what the 201 body is for.
    await request()
      .get("/api/v1/user/auth/me")
      .set("Authorization", `Bearer ${response.body.data.accessToken}`)
      .expect(200);
  });

  it("lets the new account log in with the password it chose", async () => {
    await request()
      .post(REGISTER)
      .send({
        email: "second-newcomer@machxi.local",
        password: "another-fine-password",
      })
      .expect(201);

    await request()
      .post("/api/v1/user/auth/login")
      .send({
        email: "second-newcomer@machxi.local",
        password: "another-fine-password",
      })
      .expect(200);
  });

  it("accepts a registration without names", async () => {
    // `users.first_name` is nullable, unlike `staff` (ADR-0017).
    const response = await request()
      .post(REGISTER)
      .send({
        email: "anonymous@machxi.local",
        password: "a-perfectly-fine-password",
      })
      .expect(201);

    expect(response.body.data.principal.firstName).toBeNull();
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

    expect(errorEnvelopeSchema.safeParse(response.body).success).toBe(true);
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

  it("forbids caching the response that carries the tokens", async () => {
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
