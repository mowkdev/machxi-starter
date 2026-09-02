import { auditEvents } from "@repo/db";
import { truncateAllWithOwner } from "@repo/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSystemContext } from "../src/core/context/index.js";
import type { AuditIdentities } from "../src/core/audit/index.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { loadTestEnv } from "./setup/env.js";

/**
 * The audit writer against real Postgres (ADR-0058, ADR-0021).
 *
 * The unit suite proves the mapping and the two disciplines against a fake
 * repository; only this file can prove the parts that are the database's:
 * that migration `0006` really created the table on a run that replayed every
 * migration from nothing, that a **lifecycle** row rolls back with the
 * operation it records, and that a committed one comes back out of `jsonb`
 * and the enum columns as it went in.
 *
 * There is no endpoint here to drive, deliberately — ADR-0058 ships no read
 * surface in v1 and the first writer arrives at `D13.4`. The writer is
 * exercised through the container, which is the wiring `createApp` is handed.
 */

let harness: TestApp;

const identities: AuditIdentities = {
  // The impersonation shape: a staff member acting, a customer's account
  // serving. Ids that no row owns, on purpose — an audit row carries no
  // foreign key precisely so it survives the deletion of both.
  actor: { type: "staff", id: "00000000-0000-7000-8000-0000000000a1" },
  actingAs: { type: "user", id: "00000000-0000-7000-8000-0000000000b2" },
};

const ctx = () => createSystemContext("audit-int", harness.logger);

const allRows = () => harness.db.db.select().from(auditEvents);

beforeAll(async () => {
  harness = createTestApp();
  // The owner's connection, because the application role has no `TRUNCATE` on
  // this table by decision (ADR-0061 §1–§2) — see `truncateAllWithOwner`.
  await truncateAllWithOwner(loadTestEnv().ownerDatabaseUrl);
});

afterAll(async () => {
  await harness.close();
});

describe("migration 0006", () => {
  it("creates audit_events with the four indexes it now carries", async () => {
    const rows = (await harness.db.db.execute(
      sql`select indexname from pg_indexes
          where schemaname = 'public' and tablename = 'audit_events'
          order by indexname`,
    )) as unknown as { indexname: string }[];

    expect(rows.map((row) => row.indexname)).toEqual([
      // Two since `0010_list_indexes` (ADR-0060 §4): the subject index, for
      // "everything done **to** this account", and `occurred_at` alone, for
      // the retention job ADR-0058 leaves to the deployment.
      "audit_events_acting_as_idx",
      "audit_events_actor_idx",
      "audit_events_event_idx",
      "audit_events_occurred_at_idx",
      "audit_events_pkey",
    ]);
  });

  it("puts no foreign key on the table (ADR-0058)", async () => {
    const rows = (await harness.db.db.execute(
      sql`select conname from pg_constraint
          where conrelid = 'audit_events'::regclass and contype = 'f'`,
    )) as unknown as { conname: string }[];

    expect(rows).toEqual([]);
  });
});

describe("audit.record", () => {
  it("rolls back with the transaction it was written in", async () => {
    // The lifecycle discipline, stated as a property of the database rather
    // than of a convention: an operation that cannot be audited does not
    // happen, and an operation that does not happen is not audited either.
    await expect(
      harness.db.db.transaction(async (tx) => {
        await harness.container.audit.record(
          ctx(),
          { event: "impersonation.minted", identities },
          tx,
        );

        throw new Error("the mint failed after the audit row was written");
      }),
    ).rejects.toThrow("the mint failed");

    await expect(allRows()).resolves.toEqual([]);
  });

  it("round-trips actor, acting-as and data once the transaction commits", async () => {
    await harness.db.db.transaction(async (tx) => {
      await harness.container.audit.record(
        ctx(),
        {
          event: "impersonation.exchanged",
          identities,
          data: { handoffId: "handoff-1", expiresInSec: 900 },
        },
        tx,
      );
    });

    const rows = await allRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "staff",
      actorId: identities.actor.id,
      actingAsType: "user",
      actingAsId: identities.actingAs?.id,
      event: "impersonation.exchanged",
      requestId: "system:audit-int",
      // `jsonb` gives back what it was given — the numbers included, which is
      // the half a text column would have quietly turned into strings.
      data: { handoffId: "handoff-1", expiresInSec: 900 },
    });
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
    expect(rows[0]?.ip).toBeNull();
    expect(rows[0]?.userAgent).toBeNull();
  });

  it("leaves acting-as null when the actor is the account", async () => {
    await harness.container.audit.record(ctx(), {
      event: "impersonation.refused",
      identities: { actor: identities.actor },
    });

    const rows = await allRows();
    const refusal = rows.find((row) => row.event === "impersonation.refused");

    expect(refusal?.actingAsType).toBeNull();
    expect(refusal?.actingAsId).toBeNull();
  });
});
