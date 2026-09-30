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
    // `D14.3` added the third, and the most dangerous of them: this one is the
    // checklist for a **production** compose deployment, and `docs/deploy.md`
    // documents copying it as the way to try the images locally.
    ["docker/prod/.env.example", resolve(repoRoot, "docker/prod/.env.example")],
  ])("lists the key in %s as publicly known", (_label, file) => {
    const secret = readSecret(file);

    expect(secret).toBeDefined();
    expect(KNOWN_PUBLIC_SECRETS).toContain(secret);
  });

  it("keeps the committed files' keys distinct", () => {
    // A test that verified a token signed with the documented placeholder
    // would also pass against a deployment that never changed it.
    const secrets = [
      readSecret(resolve(repoRoot, ".env.example")),
      readSecret(resolve(apiDir, ".env.test")),
      readSecret(resolve(repoRoot, "docker/prod/.env.example")),
    ];

    expect(new Set(secrets).size).toBe(secrets.length);
  });

  it.each([".env.example", "apps/api/.env.test", "docker/prod/.env.example"])(
    "lists any value %s commits for the ring or the codec's key",
    (label) => {
      // ADR-0078 §2: `JWT_ACCESS_SECRET_PREVIOUS` still verifies tokens and
      // `OIDC_TRANSACTION_SECRET` signs the sign-in transaction, so a value
      // committed for either is public exactly as a signing key is. The files
      // ship both commented out; one that ships a value must list it.
      const file =
        label === "apps/api/.env.test"
          ? resolve(apiDir, ".env.test")
          : resolve(repoRoot, label);

      for (const key of [
        "JWT_ACCESS_SECRET_PREVIOUS",
        "OIDC_TRANSACTION_SECRET",
      ]) {
        const value = readVariable(file, key);

        if (value !== undefined && value !== "") {
          expect(KNOWN_PUBLIC_SECRETS).toContain(value);
        }
      }
    },
  );

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
