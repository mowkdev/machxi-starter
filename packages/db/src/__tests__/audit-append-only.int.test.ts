import { sql as raw } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client.js";
import { auditEvents } from "../index.js";
import {
  readTestDatabaseUrl,
  readTestOwnerDatabaseUrl,
} from "../tooling/env.js";
import { migrateFreshTestDatabase } from "./helpers.int.js";

/**
 * `audit_events` is append-only in the database, twice over (ADR-0061 §2).
 *
 * [ADR-0058](../../../../docs/adr/0058-append-only-audit-log.md) enforced it
 * in code alone: one insert path and a lint rule banning the table's import
 * everywhere else. That stops a colleague. It does not stop an injection, a
 * `db:studio` session, a maintenance script, or a repository written by
 * someone who deleted a lint rule they found inconvenient — so migration
 * `0008` adds a `REVOKE` and a trigger, and this file is what proves both
 * exist on a database rebuilt from the committed migrations.
 *
 * **Two connections, and both matter.** The `REVOKE` is what the application
 * role hits, and it is the realistic attacker's path; the trigger is what the
 * *owner* hits, and that is where an accidental `DELETE FROM audit_events
 * WHERE …` at 3 a.m. actually comes from. A test on one connection would pass
 * with half the decision implemented.
 */

/** The application role — what the API connects as. */
let app: DbClient;
/** The owner role — what migrations, seeds and this package's tooling use. */
let owner: DbClient;

const ROW = {
  actorType: "staff",
  actorId: "00000000-0000-7000-8000-00000000f001",
  event: "audit.append_only.int",
} as const;

beforeAll(async () => {
  app = await migrateFreshTestDatabase();
  owner = createDb(readTestOwnerDatabaseUrl(), { max: 1, idleTimeout: 2 });

  // One row for both connections to fail to change. Inserted through the
  // application role on purpose: `INSERT` is the one write this table accepts,
  // and a `REVOKE` that had taken it too would be a different bug with the
  // same green test.
  await app.db.insert(auditEvents).values(ROW);
}, 60_000);

afterAll(async () => {
  await app.close();
  await owner.close();
});

/** The role a connection string authenticates as. */
const roleOf = (url: string): string => new URL(url).username;

/** `insufficient_privilege` — what a missing grant answers with. */
const INSUFFICIENT_PRIVILEGE = "42501";

/** `raise_exception` — what a plpgsql `RAISE EXCEPTION` answers with. */
const RAISE_EXCEPTION = "P0001";

/**
 * Asserts a rejection by SQLSTATE, and by message only where the message is
 * itself part of the decision.
 *
 * Drizzle wraps the driver error in one whose `message` is the failed SQL, so
 * `rejects.toThrow(/permission denied/)` passes for **any** failing query — it
 * would still pass if neither the grant nor the trigger existed. The driver's
 * own error is on `cause`, and its `code` is the only thing that distinguishes
 * "the database refused this" from "this query was a typo". The same reasoning
 * `schema.int.test.ts` gives for `expectUniqueViolation`.
 */
const expectRefusal = async (
  action: Promise<unknown>,
  expected: { code: string; message?: RegExp },
): Promise<void> => {
  await expect(action).rejects.toThrow();

  const error = await action.catch((caught: unknown) => caught);
  const cause = (error as { cause?: { code?: string; message?: string } })
    .cause;

  expect(cause?.code).toBe(expected.code);

  if (expected.message) {
    expect(cause?.message).toMatch(expected.message);
  }
};

/** Every `audit_events` row, counted on whichever connection is handed in. */
const rowCount = async (client: DbClient): Promise<number> => {
  const rows = await client.db.execute<{ count: string }>(
    raw`select count(*)::text as count from audit_events`,
  );

  return Number(rows[0]?.count);
};

describe("the application role", () => {
  it("connects as a role that is not the owner", async () => {
    // The premise of every assertion below, and the one that silently stops
    // being true if `DATABASE_URL_TEST` is copy-pasted from the owner's URL:
    // the table's owner is refused by the trigger but not by the grant, so
    // half of this file would be testing the other half's mechanism.
    //
    // Compared against the role named in the URL rather than a literal, so a
    // fork that renames the two roles renames them in one place.
    const rows = await app.db.execute<{ current_user: string }>(
      raw`select current_user`,
    );

    expect(rows[0]?.current_user).toBe(roleOf(readTestDatabaseUrl()));
    expect(rows[0]?.current_user).not.toBe(roleOf(readTestOwnerDatabaseUrl()));
  });

  it("may insert into audit_events, which is the one write it needs", async () => {
    await expect(
      app.db.insert(auditEvents).values({ ...ROW, event: "audit.insert.int" }),
    ).resolves.toBeDefined();
  });

  it("may not UPDATE audit_events — the grant refuses it", async () => {
    await expectRefusal(
      app.db.execute(
        raw`update audit_events set event = 'tampered' where event = ${ROW.event}`,
      ),
      { code: INSUFFICIENT_PRIVILEGE },
    );
  });

  it("may not DELETE from audit_events — the grant refuses it", async () => {
    await expectRefusal(
      app.db.execute(raw`delete from audit_events where event = ${ROW.event}`),
      { code: INSUFFICIENT_PRIVILEGE },
    );
  });

  it("may not TRUNCATE audit_events either", async () => {
    // The door a row-level trigger cannot close (ADR-0061 §2, amended): the
    // application role is kept out of it by never being granted `TRUNCATE`,
    // which is why the test harness truncates as the owner.
    await expectRefusal(app.db.execute(raw`truncate table audit_events`), {
      code: INSUFFICIENT_PRIVILEGE,
    });
  });

  it("still holds UPDATE and DELETE on an ordinary table", async () => {
    // The `REVOKE` has to be about this table and not about the role: a grant
    // that had taken every write would pass all four assertions above and
    // break the entire API.
    await expect(
      app.db.execute(raw`delete from sessions where refresh_token_hash = 'x'`),
    ).resolves.toBeDefined();
  });
});

describe("the owner role", () => {
  it("owns the table, so no grant stands between it and the rows", async () => {
    const rows = await owner.db.execute<{ current_user: string }>(
      raw`select current_user`,
    );

    expect(rows[0]?.current_user).toBe(roleOf(readTestOwnerDatabaseUrl()));
  });

  it("may not UPDATE audit_events — the trigger raises", async () => {
    // The message is asserted here and not above because it *is* the decision:
    // the trigger exists to say why, and an operator who hits it at 3 a.m.
    // should read "append-only" rather than a constraint name.
    await expectRefusal(
      owner.db.execute(
        raw`update audit_events set event = 'tampered' where event = ${ROW.event}`,
      ),
      { code: RAISE_EXCEPTION, message: /append-only/i },
    );
  });

  it("may not DELETE from audit_events — the trigger raises", async () => {
    await expectRefusal(
      owner.db.execute(
        raw`delete from audit_events where event = ${ROW.event}`,
      ),
      { code: RAISE_EXCEPTION, message: /append-only/i },
    );
  });

  it("leaves the row where it was after all of that", async () => {
    // The assertion the file exists for. Six refusals are worth nothing if one
    // of them half-succeeded.
    expect(await rowCount(owner)).toBe(await rowCount(app));
    expect(await rowCount(owner)).toBeGreaterThan(0);
  });
});

describe("the application role's connection string", () => {
  it("is not the owner's", () => {
    // Cheap, and it is the mistake that would make every assertion above
    // vacuous: one `.env.test` value copied over the other.
    expect(readTestDatabaseUrl()).not.toBe(readTestOwnerDatabaseUrl());
  });
});
