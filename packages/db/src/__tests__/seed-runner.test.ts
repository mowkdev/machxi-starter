import { describe, expect, it, vi } from "vitest";

import type { PasswordHasher } from "@repo/crypto";

import {
  baseSeeders,
  devSeeders,
  parseSeedArgs,
  runSeeders,
  selectSeeders,
} from "../../seeds/run.js";
import type { Db } from "../index.js";
import { superAdminSeeder } from "../../seeds/seeders/001-super-admin.js";
import type { Seeder } from "../../seeds/types.js";

/**
 * The runner's decisions — which seeders run, in what order, and when the
 * process refuses (ADR-0008 §Environment guardrails). What the seeders do to
 * a database is `seeds.int.test.ts`, against real Postgres.
 */

/**
 * A pool whose `transaction` hands the callback a marker object, so a case can
 * tell "the seeder was given the transaction" from "the seeder was given the
 * pool" (`D28.4`, `DB-09`).
 */
const TX = { transactionHandle: true } as unknown as Db;
const transaction = vi.fn(async (work: (tx: Db) => Promise<void>) => work(TX));

const noopContext = {
  db: { transaction } as unknown as Db,
  hasher: {} as PasswordHasher,
  env: {
    nodeEnv: "test",
    superAdminEmail: undefined,
    superAdminPassword: undefined,
  },
} as const;

describe("parseSeedArgs", () => {
  it("defaults to the baseline set", () => {
    expect(parseSeedArgs([])).toEqual({ dev: false });
  });

  it("recognises --dev anywhere in the arguments", () => {
    expect(parseSeedArgs(["--dev"]).dev).toBe(true);
    expect(parseSeedArgs(["--something", "--dev"]).dev).toBe(true);
  });

  it("does not treat a lookalike as the flag", () => {
    expect(parseSeedArgs(["--development"]).dev).toBe(false);
    expect(parseSeedArgs(["dev"]).dev).toBe(false);
  });
});

describe("selectSeeders", () => {
  it("runs only the baseline without --dev", () => {
    expect(selectSeeders({ dev: false }, "development")).toEqual(baseSeeders);
  });

  it("runs the baseline before the fixtures, so the super admin exists first", () => {
    expect(selectSeeders({ dev: true }, "development")).toEqual([
      ...baseSeeders,
      ...devSeeders,
    ]);
  });

  it("refuses fixtures in production — they carry a committed password", () => {
    expect(() => selectSeeders({ dev: true }, "production")).toThrow(
      /NODE_ENV=production/,
    );
  });

  it("still runs the baseline in production", () => {
    // The super admin is exactly what a production first-run needs; only the
    // fixtures are refused.
    expect(selectSeeders({ dev: false }, "production")).toEqual(baseSeeders);
  });
});

describe("runSeeders", () => {
  it("runs them in order and prefixes each log line with the seeder name", async () => {
    const order: string[] = [];
    const make = (name: string): Seeder => ({
      name,
      run: async ({ log }) => {
        order.push(name);
        log("hello");

        return Promise.resolve();
      },
    });

    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await runSeeders([make("a"), make("b")], noopContext);

    expect(order).toEqual(["a", "b"]);
    expect(write).toHaveBeenCalledWith("  a: hello\n");
    expect(write).toHaveBeenCalledWith("  b: hello\n");
  });

  it("runs each seeder inside a transaction of its own (ADR-0067 §2)", async () => {
    // The seed path is one of the user-creating paths, and "the personal
    // organization in the same transaction" holds for it only because the
    // runner opens one per seeder and hands the seeder the transaction rather
    // than the pool.
    transaction.mockClear();
    const given: Db[] = [];
    const make = (name: string): Seeder => ({
      name,
      run: async ({ db }) => {
        given.push(db as Db);

        return Promise.resolve();
      },
    });

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSeeders([make("a"), make("b")], noopContext);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(given).toHaveLength(2);
    for (const db of given) expect(db).toBe(TX);
  });

  it("stops at the first failure rather than continuing into a broken state", async () => {
    const later = vi.fn();

    await expect(
      runSeeders(
        [
          { name: "boom", run: () => Promise.reject(new Error("nope")) },
          { name: "later", run: later },
        ],
        noopContext,
      ),
    ).rejects.toThrow("nope");

    expect(later).not.toHaveBeenCalled();
  });
});

describe("superAdminSeeder", () => {
  it("skips without touching the database when the credentials are absent", async () => {
    // No hard-coded fallback (ADR-0008): a default super-admin password in a
    // public blueprint would be inherited by every deployment.
    const log = vi.fn();
    const db = new Proxy(
      {},
      {
        get: () => {
          throw new Error("the seeder must not query when it is skipping");
        },
      },
    ) as Db;

    await superAdminSeeder.run({
      db,
      hasher: {} as PasswordHasher,
      log,
      env: {
        nodeEnv: "test",
        superAdminEmail: undefined,
        superAdminPassword: undefined,
      },
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped"));
  });

  it("skips when only one of the two variables is set", async () => {
    const log = vi.fn();

    await superAdminSeeder.run({
      db: {} as Db,
      hasher: {
        hash: () => {
          throw new Error("must not hash when skipping");
        },
      } as unknown as PasswordHasher,
      log,
      env: {
        nodeEnv: "test",
        superAdminEmail: "admin@example.test",
        superAdminPassword: undefined,
      },
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped"));
  });
});
