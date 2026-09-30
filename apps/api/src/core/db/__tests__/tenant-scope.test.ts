import type { DbExecutor } from "@repo/db";
import { createLogger } from "@repo/logger";
import { describe, expect, it } from "vitest";

import { createRequestContext } from "../../context/index.js";
import {
  tenantScopeOf,
  withinTransaction,
  type RunInTransaction,
} from "../tenant-scope.js";

/**
 * What the tenant-owned tables' policies are told about a request (ADR-0067
 * §5, ADR-0078 §4 as amended at `D29.4`). The policies themselves are proved
 * against Postgres in `organizations.int.test.ts`; this is the mapping from
 * what the guards placed on the context to the settings.
 */

const context = () =>
  createRequestContext({
    requestId: "scope",
    logger: createLogger({ level: "silent" }),
  });

describe("tenantScopeOf", () => {
  it("places nothing outside a request or before a principal", () => {
    expect(tenantScopeOf(undefined)).toEqual({
      userId: undefined,
      organizationId: undefined,
    });
    expect(tenantScopeOf(context())).toEqual({
      userId: undefined,
      organizationId: undefined,
    });
  });

  it("scopes a user to themselves, and to the organization the guard resolved", () => {
    const ctx = context();

    ctx.principal = {
      kind: "user",
      id: "user-1",
      roles: ["customer"],
      sessionId: "s",
    };

    expect(tenantScopeOf(ctx)).toEqual({
      userId: "user-1",
      organizationId: undefined,
    });

    ctx.organization = { id: "org-1", slug: "acme", role: "member" };

    expect(tenantScopeOf(ctx)).toEqual({
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("names the staff segment's widening, and nothing narrower", () => {
    const ctx = context();

    ctx.principal = {
      kind: "staff",
      id: "staff-1",
      roles: ["super_admin"],
      sessionId: "s",
    };

    expect(tenantScopeOf(ctx)).toEqual({ unscoped: "staff" });
  });
});

describe("withinTransaction", () => {
  const CALLER = { caller: true } as unknown as DbExecutor;
  const OWN = { own: true } as unknown as DbExecutor;

  it("runs on the caller's transaction when there is one", async () => {
    let opened = 0;
    const transaction: RunInTransaction = (fn) => {
      opened += 1;

      return fn(OWN);
    };
    const within = withinTransaction(transaction);

    await expect(within(CALLER, (tx) => Promise.resolve(tx))).resolves.toBe(
      CALLER,
    );
    expect(opened).toBe(0);
  });

  it("opens a transaction of its own otherwise — never the bare pool", async () => {
    let opened = 0;
    const transaction: RunInTransaction = (fn) => {
      opened += 1;

      return fn(OWN);
    };
    const within = withinTransaction(transaction);

    await expect(within(undefined, (tx) => Promise.resolve(tx))).resolves.toBe(
      OWN,
    );
    expect(opened).toBe(1);
  });
});
