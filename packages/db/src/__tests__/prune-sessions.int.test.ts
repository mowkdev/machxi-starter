import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "../client.js";
import {
  RETENTION_DAYS,
  pruneAccountTokens,
  pruneImpersonationHandoffs,
  pruneSessions,
} from "../prune-sessions.js";
import { accountTokens, impersonationHandoffs, sessions } from "../index.js";
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
 * **Three tables since `D18.1`.** `impersonation_handoffs` joined at `D13.4`
 * (ADR-0057 §2) and `account_tokens` here (ADR-0071 §1), and the "must not"
 * sharpens with each: a handoff that is neither consumed nor expired is a
 * support operator's in-flight impersonation, and a live token row is
 * somebody's unopened mail — the link in it is the only way back into an
 * account whose password they have forgotten.
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

  it("clears a backlog larger than one batch, and counts all of it", async () => {
    /*
     * The loop of ADR-0060 §The session prune, batched, proved rather than
     * assumed. A batch size of one turns three dead rows into three
     * statements; a function that ran its `DELETE` once would return 1 and
     * leave two rows behind, which is exactly the failure a table that has
     * never been pruned would produce with the old single-statement sweep.
     */
    await insert("dead-1", { expiresAt: days(-RETENTION_DAYS - 1) });
    await insert("dead-2", { expiresAt: days(-RETENTION_DAYS - 2) });
    await insert("dead-3", { expiresAt: days(-RETENTION_DAYS - 3) });
    await insert("alive", { expiresAt: days(1) });

    expect(await pruneSessions(client.db, days(-RETENTION_DAYS), 1)).toBe(3);
    expect(await remaining()).toEqual(["alive"]);
  });

  it("stops on the first short batch rather than looping forever", async () => {
    await insert("dead", { expiresAt: days(-RETENTION_DAYS - 1) });

    // Two rows would fit in the batch and one matches, so the first pass is
    // already short: the loop must return without asking again.
    expect(await pruneSessions(client.db, days(-RETENTION_DAYS), 2)).toBe(1);
    expect(await remaining()).toEqual([]);
  });

  it("refuses a batch size that would make the loop spin", async () => {
    // `limit 0` deletes nothing and `0 < 0` is false, so the loop would never
    // reach its exit. Refused where it is cheap to say so.
    await expect(
      pruneSessions(client.db, days(-RETENTION_DAYS), 0),
    ).rejects.toThrow(/positive integer/);
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

  it("clears a handoff backlog larger than one batch", async () => {
    await insertHandoff("spent-1", { expiresAt: days(-RETENTION_DAYS - 1) });
    await insertHandoff("spent-2", { expiresAt: days(-RETENTION_DAYS - 2) });
    await insertHandoff("live", { expiresAt: days(1) });

    expect(
      await pruneImpersonationHandoffs(client.db, days(-RETENTION_DAYS), 1),
    ).toBe(2);
    expect(await remainingHandoffs()).toEqual(["live"]);
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

const insertToken = async (
  label: string,
  values: { expiresAt: Date; consumedAt?: Date },
): Promise<void> => {
  await client.db.insert(accountTokens).values({
    purpose: "reset_password",
    principalType: "user",
    principalId: USER_ID,
    tokenHash: label,
    expiresAt: values.expiresAt,
    consumedAt: values.consumedAt ?? null,
  });
};

const remainingTokens = async (): Promise<string[]> => {
  const rows = await client.db
    .select({ hash: accountTokens.tokenHash })
    .from(accountTokens);

  return rows.map((row) => row.hash).sort();
};

describe("pruneAccountTokens", () => {
  it("keeps a live token and one that only recently died", async () => {
    // The row this sweep must never touch: unopened mail, and the only way
    // back into an account whose password its owner has forgotten. The second
    // is the audit-trail grace `RETENTION_DAYS` exists for — "was a reset link
    // sent to this address last week" is a question an incident asks.
    await insertToken("live", { expiresAt: days(1) });
    await insertToken("just-consumed", {
      expiresAt: days(-1),
      consumedAt: days(-1),
    });

    expect(await pruneAccountTokens(client.db, days(-RETENTION_DAYS))).toBe(0);
    expect(await remainingTokens()).toEqual(["just-consumed", "live"]);
  });

  it("removes a token consumed before the cutoff", async () => {
    // The ordinary case: redeemed minutes after the mint, so the row is dead
    // long before any expiry the TTL wrote, and retention is measured from
    // whichever of the two came first.
    await insertToken("long-consumed", {
      expiresAt: days(1),
      consumedAt: days(-RETENTION_DAYS - 1),
    });
    await insertToken("live", { expiresAt: days(1) });

    expect(await pruneAccountTokens(client.db, days(-RETENTION_DAYS))).toBe(1);
    expect(await remainingTokens()).toEqual(["live"]);
  });

  it("removes a token that expired before the cutoff, unopened", async () => {
    await insertToken("long-expired", {
      expiresAt: days(-RETENTION_DAYS - 1),
    });

    expect(await pruneAccountTokens(client.db, days(-RETENTION_DAYS))).toBe(1);
    expect(await remainingTokens()).toEqual([]);
  });

  it("is a no-op on an empty table", async () => {
    expect(await pruneAccountTokens(client.db, days(-RETENTION_DAYS))).toBe(0);
  });

  it("clears a token backlog larger than one batch", async () => {
    await insertToken("spent-1", { expiresAt: days(-RETENTION_DAYS - 1) });
    await insertToken("spent-2", { expiresAt: days(-RETENTION_DAYS - 2) });
    await insertToken("live", { expiresAt: days(1) });

    expect(await pruneAccountTokens(client.db, days(-RETENTION_DAYS), 1)).toBe(
      2,
    );
    expect(await remainingTokens()).toEqual(["live"]);
  });

  it("leaves the other two tables alone", async () => {
    // Three statements, not one: a sweep that took every credential table in
    // one predicate would be one `where` clause away from deleting a live
    // reset link because a session expired.
    await insert("live", { expiresAt: days(7) });
    await insertHandoff("redeemable", { expiresAt: days(1) });
    await insertToken("long-expired", {
      expiresAt: days(-RETENTION_DAYS - 1),
    });

    expect(await pruneAccountTokens(client.db, days(-RETENTION_DAYS))).toBe(1);
    expect(await remaining()).toEqual(["live"]);
    expect(await remainingHandoffs()).toEqual(["redeemable"]);
  });
});
