import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { KNOWN_PUBLIC_SECRETS } from "../schema.js";

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

const readSecret = (file: string): string | undefined =>
  /^JWT_ACCESS_SECRET=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim();

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
