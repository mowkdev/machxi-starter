import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  KNOWN_PUBLIC_SECRETS,
  KNOWN_PUBLIC_SEED_PASSWORDS,
} from "../schema.js";

/**
 * Every signing key committed to this repository must be listed in
 * `KNOWN_PUBLIC_SECRETS`, so that production startup refuses it (ADR-0004).
 *
 * The list is what makes the refusal work, and a list is exactly the kind of
 * thing that goes stale: someone adds a fourth env file with a fourth working
 * dummy key, nothing fails, and the key is accepted in production. This test is
 * the thing that fails instead.
 */

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const repoRoot = resolve(apiDir, "../..");

const readVariable = (file: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.*)$`, "m")
    .exec(readFileSync(file, "utf8"))?.[1]
    ?.trim();

const readSecret = (file: string): string | undefined =>
  readVariable(file, "JWT_ACCESS_SECRET");

describe("committed signing keys", () => {
  it.each([
    [".env.example", resolve(repoRoot, ".env.example")],
    ["apps/api/.env.test", resolve(apiDir, ".env.test")],
  ])("lists the key in %s as publicly known", (_label, file) => {
    const secret = readSecret(file);

    expect(secret).toBeDefined();
    expect(KNOWN_PUBLIC_SECRETS).toContain(secret);
  });

  it("keeps the two files' keys distinct", () => {
    // A test that verified a token signed with the documented placeholder
    // would also pass against a deployment that never changed it.
    expect(readSecret(resolve(repoRoot, ".env.example"))).not.toBe(
      readSecret(resolve(apiDir, ".env.test")),
    );
  });

  it("only lists keys that would otherwise pass the length rule", () => {
    for (const secret of KNOWN_PUBLIC_SECRETS) {
      expect(secret.length).toBeGreaterThanOrEqual(32);
    }
  });
});

/**
 * The same rule for the seeded super admin's password (ADR-0008, ADR-0020).
 *
 * A worse consequence than a signing key, if anything: the account it creates
 * holds `super_admin`, which bypasses every staff role check (ADR-0019), and
 * `pnpm db:setup` is the documented deploy step.
 */
describe("committed seed passwords", () => {
  it.each([
    [".env.example", resolve(repoRoot, ".env.example")],
    ["apps/api/.env.test", resolve(apiDir, ".env.test")],
  ])("lists the seed password in %s as publicly known", (_label, file) => {
    const password = readVariable(file, "SEED_SUPER_ADMIN_PASSWORD");

    expect(password).toBeDefined();
    expect(KNOWN_PUBLIC_SEED_PASSWORDS).toContain(password);
  });

  it("only lists passwords that would otherwise pass the length rule", () => {
    for (const password of KNOWN_PUBLIC_SEED_PASSWORDS) {
      expect(password.length).toBeGreaterThanOrEqual(12);
    }
  });
});
