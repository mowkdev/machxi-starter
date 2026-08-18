import { afterEach, describe, expect, it, vi } from "vitest";

import { readSuperAdminCredentials } from "../tooling/env.js";

/**
 * ADR-0004 constrains `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`,
 * but the seed runner never passes through `core/config` — so the constraint
 * is enforced in `src/tooling/env.ts`, and this is where that is checked.
 *
 * `vi.stubEnv` wins over the root `.env`: dotenv does not override a variable
 * that is already set, which is the same property that lets a deployed
 * environment run these scripts with no `.env` file at all.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readSuperAdminCredentials", () => {
  it("returns both values when they are valid", () => {
    vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@machxi.local");
    vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "ChangeMe123!local");

    expect(readSuperAdminCredentials()).toStrictEqual({
      email: "admin@machxi.local",
      password: "ChangeMe123!local",
    });
  });

  it("reports both as absent so the seeder skips rather than inventing a fallback", () => {
    vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "");
    vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "");

    expect(readSuperAdminCredentials()).toStrictEqual({
      email: undefined,
      password: undefined,
    });
  });

  it("rejects an email that could never sign in", () => {
    vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "Super Admin");
    vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "ChangeMe123!local");

    expect(() => readSuperAdminCredentials()).toThrow(/SEED_SUPER_ADMIN_EMAIL/);
  });

  it("rejects a password below the ADR-0004 minimum instead of seeding a weak super admin", () => {
    vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@machxi.local");
    vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "short");

    expect(() => readSuperAdminCredentials()).toThrow(/at least 12 characters/);
  });

  it("names the length it got, without echoing the password", () => {
    vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@machxi.local");
    vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "hunter2");

    expect(() => readSuperAdminCredentials()).toThrow(/it is 7\./);
    expect(() => readSuperAdminCredentials()).not.toThrow(/hunter2/);
  });

  it("accepts exactly the minimum length", () => {
    vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@machxi.local");
    vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "123456789012");

    expect(readSuperAdminCredentials().password).toBe("123456789012");
  });
});
