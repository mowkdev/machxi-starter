import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  databaseUrlPassword,
  knownPublicDatabasePasswords,
  readOwnerDatabaseUrl,
  readSuperAdminCredentials,
} from "../tooling/env.js";

/**
 * ADR-0004 constrains `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`,
 * but the seed runner never passes through `core/config` — so the constraint
 * is enforced in `src/tooling/env.ts`, and this is where that is checked.
 *
 * `vi.stubEnv` wins over the root `.env`: `process.loadEnvFile` does not
 * override a variable that is already set, which is the same property that
 * lets a deployed environment run these scripts with no `.env` file at all —
 * and `loadEnvFile` below proves it rather than leaning on it.
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

  /**
   * The account this creates holds `super_admin`, which bypasses every staff
   * role check (ADR-0019), and `pnpm db:setup` is the documented deploy step —
   * so a committed password reaching production is worse than a committed
   * signing key, not better (ADR-0020 §Known-public secrets).
   */
  describe("committed passwords in production", () => {
    it.each([
      [".env.example", "ChangeMe123!local"],
      ["apps/api/.env.test", "TestSuperAdmin!123"],
    ])("refuses the value committed in %s", (_label, password) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@example.com");
      vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", password);

      expect(() => readSuperAdminCredentials()).toThrow(
        /committed in this repository/,
      );
      // The message names the variable and the reason, never the value.
      expect(() => readSuperAdminCredentials()).not.toThrow(
        new RegExp(password.replace(/[!]/g, "\\!")),
      );
    });

    it("accepts them outside production, which is what they are for", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@machxi.local");
      vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "ChangeMe123!local");

      expect(readSuperAdminCredentials().password).toBe("ChangeMe123!local");
    });

    it("accepts a real password in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SEED_SUPER_ADMIN_EMAIL", "admin@example.com");
      vi.stubEnv("SEED_SUPER_ADMIN_PASSWORD", "a-genuinely-private-value");

      expect(readSuperAdminCredentials().password).toBe(
        "a-genuinely-private-value",
      );
    });
  });
});

/**
 * ADR-0083 §5 as amended at `D35.4`: the owner's connection — what the migrate
 * image runs, and a role no policy binds — is refused a committed password in
 * production, as the API refuses one on `DATABASE_URL`.
 */
describe("readOwnerDatabaseUrl", () => {
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );

  it.each(knownPublicDatabasePasswords)(
    "refuses the committed password %s in production, without echoing it",
    (password) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(
        "DATABASE_URL_OWNER",
        `postgres://someone:${encodeURIComponent(password)}@db.internal:5432/app`,
      );

      expect(() => readOwnerDatabaseUrl()).toThrow(/DATABASE_URL_OWNER/);
      expect(() => readOwnerDatabaseUrl()).not.toThrow(`:${password}@`);
    },
  );

  it("refuses a URL with no password in production, since PGPASSWORD would fill it unseen", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL_OWNER", "postgres://machxi_owner@db.internal/app");

    expect(() => readOwnerDatabaseUrl()).toThrow(/DATABASE_URL_OWNER/);
  });

  it("reads a multi-host URL as postgres.js does, by its first host", () => {
    expect(
      databaseUrlPassword("postgres://o:machxi_owner@h1:5432,h2:5432/app"),
    ).toBe("machxi_owner");
    expect(databaseUrlPassword("postgres://o@h1:5432,h2:5432/app")).toBe("");
  });

  it("accepts the committed password outside production, and a real one in it", () => {
    const local = "postgres://machxi_owner:machxi_owner@localhost:5432/machxi";

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL_OWNER", local);
    expect(readOwnerDatabaseUrl()).toBe(local);

    const real = "postgres://machxi_owner:r3al-S3cret@db.internal/app";

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL_OWNER", real);
    expect(readOwnerDatabaseUrl()).toBe(real);
  });

  it.each([".env.example", "apps/api/.env.test", "docker/prod/.env.example"])(
    "lists every connection string's password in %s",
    (file) => {
      const passwords = [
        ...readFileSync(resolve(repoRoot, file), "utf8").matchAll(
          /^DATABASE_URL\w*=(.*)$/gm,
        ),
      ].map((match) => databaseUrlPassword((match[1] ?? "").trim()));

      expect(passwords.length).toBeGreaterThan(0);
      for (const password of passwords) {
        expect(knownPublicDatabasePasswords).toContain(password);
      }
    },
  );
});

/**
 * The loader itself (`D21.4`): Node's `process.loadEnvFile` in place of the
 * `dotenv` package, which the migrate and prune bundles would otherwise inline
 * into the API image. What the swap must keep is dotenv's precedence — the
 * environment wins over the file — because `DATABASE_URL=… pnpm db:migrate`
 * and a deployed job with injected variables both depend on it, and Node's
 * loader must not throw where the deployed image has no file at all.
 *
 * Each case imports a fresh module, because the loader loads once per process.
 */
describe("loadEnvFile", () => {
  const scratch = mkdtempSync(join(tmpdir(), "db-env-"));
  const file = join(scratch, ".env");

  // Both start unset. Stubbing them is also the cleanup: `unstubAllEnvs`
  // above restores each to its original absence, the loader's writes included.
  beforeEach(() => {
    vi.stubEnv("D21_4_FROM_SHELL", undefined);
    vi.stubEnv("D21_4_FROM_FILE", undefined);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** What the loader left in the environment — the one thing under test. */
  const env = (key: string): string | undefined =>
    // eslint-disable-next-line no-restricted-properties -- reads back what the loader wrote; nothing here configures anything (ADR-0004).
    process.env[key];

  const freshLoader = async () => {
    vi.resetModules();
    return (await import("../tooling/env.js")).loadEnvFile;
  };

  it("fills what the environment lacks and never overrides what it has", async () => {
    writeFileSync(
      file,
      "D21_4_FROM_SHELL=fromfile\nD21_4_FROM_FILE=fromfile\n",
    );
    vi.stubEnv("D21_4_FROM_SHELL", "fromshell");

    (await freshLoader())(file);

    expect(env("D21_4_FROM_SHELL")).toBe("fromshell");
    expect(env("D21_4_FROM_FILE")).toBe("fromfile");
  });

  it("is a no-op, not a crash, when there is no file — the deployed image's case", async () => {
    const loadEnvFile = await freshLoader();

    expect(() => loadEnvFile(join(scratch, "absent.env"))).not.toThrow();
    expect(env("D21_4_FROM_FILE")).toBeUndefined();
  });
});
