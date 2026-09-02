import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "../client.js";
import {
  RETENTION_DAYS,
  pruneImpersonationHandoffs,
  pruneSessions,
} from "../prune-sessions.js";
import { impersonationHandoffs, sessions } from "../index.js";
import { truncateAllWithOwner } from "../testing.js";
import { readTestOwnerDatabaseUrl } from "../tooling/env.js";
import { migrateFreshTestDatabase } from "./helpers.int.js";

/**
 * `pnpm db:sessions:prune` (ADR-0018 §Cleanup).
 *
 * A deletion path deserves a test against a real database more than most: what
 * it must *not* do — remove a session that is still usable — is invisible in a
 * unit test with a fake, and expensive to discover in production.
 *
 * **Two tables since `D13.4`** (ADR-0057 §2): the same command sweeps
 * `impersonation_handoffs`, and the "must not" there is sharper still — a
 * handoff that is neither consumed nor expired is a support operator's
 * in-flight impersonation, and deleting it breaks a flow that is halfway
 * through.
 */

const PRINCIPAL_ID = "11111111-1111-7111-8111-111111111111";

let client: DbClient;

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const insert = async (
  label: string,
  values: { expiresAt: Date; revokedAt?: Date },
): Promise<void> => {
  await client.db.insert(sessions).values({
    principalType: "staff",
    principalId: PRINCIPAL_ID,
    refreshTokenHash: label,
    refreshTokenExpiresAt: values.expiresAt,
    revokedAt: values.revokedAt ?? null,
  });
};

const remaining = async (): Promise<string[]> => {
  const rows = await client.db
    .select({ hash: sessions.refreshTokenHash })
    .from(sessions);

  return rows.map((row) => row.hash).sort();
};

beforeAll(async () => {
  client = await migrateFreshTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  // The owner's connection: `TRUNCATE` is not in the application role's grant
  // and is deliberately left out of it (ADR-0061 §1), so emptying the database
  // between cases is harness work rather than something `client` can do.
  await truncateAllWithOwner(readTestOwnerDatabaseUrl());
});

describe("pruneSessions", () => {
  it("keeps a live session and one that only recently died", async () => {
    // The retention window is what makes the audit trail useful after a
    // logout: "which device was this, and when did it last appear".
    await insert("live", { expiresAt: days(7) });
    await insert("just-revoked", {
      expiresAt: days(7),
      revokedAt: days(-1),
    });

    const cutoff = days(-RETENTION_DAYS);

    expect(await pruneSessions(client.db, cutoff)).toBe(0);
    expect(await remaining()).toEqual(["just-revoked", "live"]);
  });

  it("removes a session whose refresh token expired before the cutoff", async () => {
    await insert("long-expired", { expiresAt: days(-RETENTION_DAYS - 1) });
    await insert("live", { expiresAt: days(7) });

    expect(await pruneSessions(client.db, days(-RETENTION_DAYS))).toBe(1);
    expect(await remaining()).toEqual(["live"]);
  });

  it("removes a session revoked before the cutoff even though it had not expired", async () => {
    // A logout on day one of a 30-day refresh token: the row is dead long
    // before `refresh_token_expires_at` passes, and retention is measured from
    // the revocation.
    await insert("long-revoked", {
      expiresAt: days(7),
      revokedAt: days(-RETENTION_DAYS - 1),
    });

    expect(await pruneSessions(client.db, days(-RETENTION_DAYS))).toBe(1);
    expect(await remaining()).toEqual([]);
  });

  it("is a no-op on an empty table", async () => {
    expect(await pruneSessions(client.db, days(-RETENTION_DAYS))).toBe(0);
  });

  it("leaves nothing behind for the principal it pruned", async () => {
    await insert("gone", { expiresAt: days(-RETENTION_DAYS - 1) });
    await pruneSessions(client.db, days(-RETENTION_DAYS));

    const rows = await client.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.principalId, PRINCIPAL_ID));

    expect(rows).toEqual([]);
  });
});

const STAFF_ID = "22222222-2222-7222-8222-222222222222";
const USER_ID = "33333333-3333-7333-8333-333333333333";

const insertHandoff = async (
  label: string,
  values: { expiresAt: Date; consumedAt?: Date },
): Promise<void> => {
  await client.db.insert(impersonationHandoffs).values({
    tokenHash: label,
    staffId: STAFF_ID,
    userId: USER_ID,
    expiresAt: values.expiresAt,
    consumedAt: values.consumedAt ?? null,
  });
};

const remainingHandoffs = async (): Promise<string[]> => {
  const rows = await client.db
    .select({ hash: impersonationHandoffs.tokenHash })
    .from(impersonationHandoffs);

  return rows.map((row) => row.hash).sort();
};

describe("pruneImpersonationHandoffs", () => {
  it("keeps a handoff that is still redeemable", async () => {
    // The one row this sweep must never touch: 60 seconds old at most, not yet
    // consumed, and somebody is mid-click on the link that carries it.
    await insertHandoff("redeemable", { expiresAt: days(1) });

    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS)),
    ).toBe(0);
    expect(await remainingHandoffs()).toEqual(["redeemable"]);
  });

  it("keeps a handoff that only recently died", async () => {
    // The audit-trail grace `RETENTION_DAYS` exists for, the same one a
    // revoked session gets: "was a handoff minted for this account last week"
    // is a question an incident asks.
    await insertHandoff("just-expired", { expiresAt: days(-1) });
    await insertHandoff("just-consumed", {
      expiresAt: days(-1),
      consumedAt: days(-1),
    });

    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS)),
    ).toBe(0);
    expect(await remainingHandoffs()).toEqual([
      "just-consumed",
      "just-expired",
    ]);
  });

  it("removes a handoff that expired before the cutoff", async () => {
    await insertHandoff("long-expired", {
      expiresAt: days(-RETENTION_DAYS - 1),
    });
    await insertHandoff("redeemable", { expiresAt: days(1) });

    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS)),
    ).toBe(1);
    expect(await remainingHandoffs()).toEqual(["redeemable"]);
  });

  it("removes a handoff consumed before the cutoff even with a later expiry", async () => {
    // Redeemed the moment it was minted, which is the ordinary case: the row
    // is dead long before any expiry the TTL could have written, and retention
    // is measured from whichever of the two came first.
    await insertHandoff("long-consumed", {
      expiresAt: days(1),
      consumedAt: days(-RETENTION_DAYS - 1),
    });

    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS)),
    ).toBe(1);
    expect(await remainingHandoffs()).toEqual([]);
  });

  it("is a no-op on an empty table", async () => {
    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS)),
    ).toBe(0);
  });

  it("leaves sessions alone, and the sessions sweep leaves handoffs alone", async () => {
    // Two statements, not one `delete … using`: a sweep that took both tables
    // in one predicate would be one `where` clause away from deleting a live
    // handoff because a session expired.
    await insert("long-expired", { expiresAt: days(-RETENTION_DAYS - 1) });
    await insertHandoff("redeemable", { expiresAt: days(1) });

    expect(await pruneSessions(client.db, days(-RETENTION_DAYS))).toBe(1);
    expect(await remainingHandoffs()).toEqual(["redeemable"]);

    await insert("live", { expiresAt: days(7) });
    await insertHandoff("long-expired", {
      expiresAt: days(-RETENTION_DAYS - 1),
    });

    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS)),
    ).toBe(1);
    expect(await remaining()).toEqual(["live"]);
  });
});
