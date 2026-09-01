import { createLogger } from "@repo/logger";
import { describe, expect, it, vi } from "vitest";

import type { DbExecutor } from "../../db/index.js";
import { createRequestContext, type Principal } from "../../context/index.js";
import { isAppError } from "../../errors/index.js";
import {
  createAudit,
  identitiesFromPrincipal,
  type AuditEventRow,
  type AuditRepository,
} from "../index.js";

/**
 * The writer's two disciplines and its one rule (ADR-0058).
 *
 * The rule is the identity mapping — actor is the human, acting-as is the
 * account — and the disciplines are what a caller gets to choose: a lifecycle
 * write that fails the operation, and a trail write that cannot.
 */

const createFakeRepository = () => {
  const rows: { row: AuditEventRow; tx: DbExecutor | undefined }[] = [];
  let fail: Error | undefined;

  const repository: AuditRepository = {
    insert: (row, tx) => {
      if (fail !== undefined) return Promise.reject(fail);

      rows.push({ row, tx });

      return Promise.resolve();
    },
  };

  return {
    repository,
    rows,
    failWith: (error: Error) => {
      fail = error;
    },
  } as const;
};

const createContext = (principal: Principal | null) => {
  const logger = createLogger({ level: "silent", name: "audit-test" });
  const ctx = createRequestContext({
    requestId: "req-1",
    logger,
    ip: "203.0.113.7",
    userAgent: "vitest",
  });

  ctx.principal = principal;

  return ctx;
};

const staffPrincipal: Principal = {
  kind: "staff",
  id: "staff-1",
  roles: ["admin"],
  sessionId: "session-1",
};

const impersonatedPrincipal: Principal = {
  kind: "user",
  id: "user-9",
  roles: ["customer"],
  sessionId: "session-2",
  impersonatedBy: "staff-1",
};

describe("identitiesFromPrincipal", () => {
  it("makes an ordinary principal its own actor, with no acting-as", () => {
    expect(identitiesFromPrincipal(staffPrincipal)).toEqual({
      actor: { type: "staff", id: "staff-1" },
    });
  });

  it("puts the staff member on the actor and the customer on the acting-as", () => {
    // The branch `D13.2`'s trip wire existed to force (ADR-0058). Written the
    // other way round it would compile, pass the gate, and answer "everything
    // this operator did" with nothing at all.
    expect(identitiesFromPrincipal(impersonatedPrincipal)).toEqual({
      actor: { type: "staff", id: "staff-1" },
      actingAs: { type: "user", id: "user-9" },
    });
  });

  it("leaves a customer signed in as themselves their own actor", () => {
    expect(
      identitiesFromPrincipal({
        kind: "user",
        id: "user-9",
        roles: ["customer"],
        sessionId: "session-3",
      }),
    ).toEqual({ actor: { type: "user", id: "user-9" } });
  });
});

describe("a row derived from an impersonated principal", () => {
  it("carries both identities without the call site naming either", async () => {
    // What `refuseImpersonated` and the mutation trail both rely on: they pass
    // no `identities`, and the row is still attributable to the human.
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });

    await audit.record(createContext(impersonatedPrincipal), {
      event: "impersonation.refused",
    });

    expect(fake.rows[0]?.row).toMatchObject({
      actorType: "staff",
      actorId: "staff-1",
      actingAsType: "user",
      actingAsId: "user-9",
    });
  });
});

describe("audit.record", () => {
  it("stamps the request onto the row and derives the actor from the principal", async () => {
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });

    await audit.record(createContext(staffPrincipal), {
      event: "impersonation.minted",
      data: { targetUserId: "user-9" },
    });

    const [written] = fake.rows;

    expect(written?.row).toMatchObject({
      actorType: "staff",
      actorId: "staff-1",
      actingAsType: null,
      actingAsId: null,
      event: "impersonation.minted",
      requestId: "req-1",
      ip: "203.0.113.7",
      userAgent: "vitest",
      data: { targetUserId: "user-9" },
    });
  });

  it("takes explicit identities where there is no principal to derive from", async () => {
    // `impersonation.exchanged` is served unauthenticated — the handoff token
    // is the credential — so both identities come off the consumed row.
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });

    await audit.record(createContext(null), {
      event: "impersonation.exchanged",
      identities: {
        actor: { type: "staff", id: "staff-1" },
        actingAs: { type: "user", id: "user-9" },
      },
    });

    expect(fake.rows[0]?.row).toMatchObject({
      actorType: "staff",
      actorId: "staff-1",
      actingAsType: "user",
      actingAsId: "user-9",
    });
  });

  it("passes the caller's transaction straight through", async () => {
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });
    const tx = { marker: "tx" } as unknown as DbExecutor;

    await audit.record(
      createContext(staffPrincipal),
      { event: "impersonation.minted" },
      tx,
    );

    expect(fake.rows[0]?.tx).toBe(tx);
  });

  it("drops acting-as when it is the actor", async () => {
    // ADR-0058 sets acting-as only when the two differ, and the writer makes
    // that an invariant of the row: a row claiming an impersonation that never
    // happened is a false answer to the only question the table is asked.
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });

    await audit.record(createContext(null), {
      event: "user.updated",
      identities: {
        actor: { type: "user", id: "user-9" },
        actingAs: { type: "user", id: "user-9" },
      },
    });

    expect(fake.rows[0]?.row).toMatchObject({
      actorId: "user-9",
      actingAsType: null,
      actingAsId: null,
    });
  });

  it("caps the user agent, which is attacker-controlled and never pruned", async () => {
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });
    const ctx = createContext(staffPrincipal);

    await audit.record(
      { ...ctx, userAgent: "u".repeat(2_000) },
      { event: "impersonation.minted" },
    );

    expect(fake.rows[0]?.row.userAgent).toHaveLength(512);
  });

  it("refuses to write a row it cannot attribute", async () => {
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });

    const error = await audit
      .record(createContext(null), { event: "impersonation.minted" })
      .catch((caught: unknown) => caught);

    expect(isAppError(error) && error.code).toBe("INTERNAL_ERROR");
    expect(fake.rows).toHaveLength(0);
  });

  it("propagates a failed insert, so the caller's transaction rolls back", async () => {
    const fake = createFakeRepository();

    fake.failWith(new Error("insert failed"));

    const audit = createAudit({ repository: fake.repository });

    await expect(
      audit.record(createContext(staffPrincipal), {
        event: "impersonation.minted",
      }),
    ).rejects.toThrow("insert failed");
  });
});

describe("audit.trail", () => {
  it("writes without the caller waiting for it", async () => {
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });

    // No `await`: the signature returns void precisely so a caller cannot.
    audit.trail(createContext(staffPrincipal), { event: "user.updated" });

    await vi.waitFor(() => {
      expect(fake.rows).toHaveLength(1);
    });
    expect(fake.rows[0]?.tx).toBeUndefined();
  });

  it("logs a failed write and does not throw", async () => {
    const fake = createFakeRepository();

    fake.failWith(new Error("insert failed"));

    const audit = createAudit({ repository: fake.repository });
    const ctx = createContext(staffPrincipal);
    const logged = vi.spyOn(ctx.logger, "error");

    expect(() => {
      audit.trail(ctx, { event: "user.updated" });
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "user.updated",
          // Both identities on the failure line: ADR-0058's fallback is that a
          // lost trail row degrades to the logs, and a line naming only the
          // event degrades to neither.
          actor: { type: "staff", id: "staff-1" },
          actingAs: null,
        }),
        "audit trail write failed",
      );
    });
  });

  it("logs only the head of a driver error, never the row it carried", async () => {
    // Drizzle's query errors put the statement *and its parameters* in the
    // message, and the parameters of this insert are the audit row. Redaction
    // does not reach pino's `err` serialiser, so the writer truncates instead.
    const fake = createFakeRepository();

    fake.failWith(
      new Error(
        `Failed query: insert into "audit_events" …\nparams: staff-1,{"secret":"leaked"}`,
      ),
    );

    const audit = createAudit({ repository: fake.repository });
    const ctx = createContext(staffPrincipal);
    const logged = vi.spyOn(ctx.logger, "error");

    audit.trail(ctx, { event: "user.updated" });

    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalled();
    });

    const [fields] = logged.mock.calls[0] ?? [];

    expect(JSON.stringify(fields)).not.toContain("leaked");
    expect(fields).toMatchObject({
      error: 'Failed query: insert into "audit_events" …',
    });
  });

  it("drops an unattributable row rather than throwing behind a sent response", () => {
    const fake = createFakeRepository();
    const audit = createAudit({ repository: fake.repository });
    const ctx = createContext(null);
    const logged = vi.spyOn(ctx.logger, "error");

    audit.trail(ctx, { event: "user.updated" });

    expect(fake.rows).toHaveLength(0);
    expect(logged).toHaveBeenCalledWith(
      { event: "user.updated" },
      "audit trail row has no actor",
    );
  });
});
