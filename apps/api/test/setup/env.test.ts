import { describe, expect, it, vi } from "vitest";

import { loadTestEnv, readTestSuperuserUrl } from "./env.js";

/**
 * The lane's test database (ADR-0082 §3): `TEST_DB_LANE` moves every URL the
 * harness hands out from `<name>_test` to `<name>_<lane>_test`, after
 * `.env.test` loads, and moves nothing when it is unset. The expected names
 * are read from the committed file rather than spelled out, so a renamed
 * clone (`scripts/rename.mjs`) keeps the assertion.
 */

const databaseOf = (url: string): string => new URL(url).pathname.slice(1);

/** The committed family name — `machxi` for `machxi_test`. */
const family = (): string => {
  loadTestEnv();

  return databaseOf(process.env.DATABASE_URL_TEST ?? "").replace(/_test$/, "");
};

describe("loadTestEnv", () => {
  it("rewrites both test URLs to the lane database when TEST_DB_LANE is set", () => {
    vi.stubEnv("TEST_DB_LANE", "d29");

    const { databaseUrl, ownerDatabaseUrl } = loadTestEnv();
    const lane = `${family()}_d29_test`;

    expect(databaseOf(databaseUrl)).toBe(lane);
    expect(databaseOf(ownerDatabaseUrl)).toBe(lane);
    expect(databaseOf(readTestSuperuserUrl())).toBe(lane);
    // Only the database moves: the roles are still the file's two.
    expect(new URL(databaseUrl).username).toBe(
      new URL(process.env.DATABASE_URL_TEST ?? "").username,
    );
    expect(new URL(ownerDatabaseUrl).username).toBe(
      new URL(process.env.DATABASE_URL_TEST_OWNER ?? "").username,
    );
    // What the app and the tooling read is the lane's, and the `_TEST`
    // variables are left as the file wrote them, so nothing stacks the lane.
    expect(process.env.DATABASE_URL).toBe(databaseUrl);
    expect(process.env.DATABASE_URL_OWNER).toBe(ownerDatabaseUrl);
    expect(databaseOf(process.env.DATABASE_URL_TEST ?? "")).toBe(
      `${family()}_test`,
    );
  });

  it("leaves both URLs alone when TEST_DB_LANE is unset", () => {
    vi.stubEnv("TEST_DB_LANE", undefined);

    const { databaseUrl, ownerDatabaseUrl } = loadTestEnv();

    expect(databaseUrl).toBe(process.env.DATABASE_URL_TEST);
    expect(ownerDatabaseUrl).toBe(process.env.DATABASE_URL_TEST_OWNER);
    expect(readTestSuperuserUrl()).toBe(
      process.env.DATABASE_URL_TEST_SUPERUSER,
    );
    expect(process.env.DATABASE_URL).toBe(databaseUrl);
    expect(process.env.DATABASE_URL_OWNER).toBe(ownerDatabaseUrl);
  });

  it("refuses a lane that is set but empty", () => {
    vi.stubEnv("TEST_DB_LANE", "");

    expect(() => loadTestEnv()).toThrow(/TEST_DB_LANE is set but empty/);
  });

  it("refuses a lane that is not a branch slug", () => {
    vi.stubEnv("TEST_DB_LANE", "lane/D29");

    expect(() => loadTestEnv()).toThrow(/TEST_DB_LANE/);
  });
});
