import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "../client.js";
import { RETENTION_DAYS, pruneSessions } from "../prune-sessions.js";
import { sessions } from "../index.js";
import { truncateAll } from "../testing.js";
import { migrateFreshTestDatabase } from "./helpers.int.js";

/**
 * `pnpm db:sessions:prune` (ADR-0018 §Cleanup).
 *
 * A deletion path deserves a test against a real database more than most: what
 * it must *not* do — remove a session that is still usable — is invisible in a
 * unit test with a fake, and expensive to discover in production.
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
  await truncateAll(client.db);
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
