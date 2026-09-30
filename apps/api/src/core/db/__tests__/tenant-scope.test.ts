import { TENANT_SETTINGS, type Db, type DbExecutor } from "@repo/db";
import { createLogger } from "@repo/logger";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { createRequestContext, runWithContext } from "../../context/index.js";
import {
  openInRequestScope,
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

  it("scopes a user to themselves, and then to the organization the guard resolved alone", () => {
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

    // D29.7: the principal is left out once an organization is placed, so a
    // forgotten scope cannot reach the caller's own rows elsewhere.
    expect(tenantScopeOf(ctx)).toEqual({ organizationId: "org-1" });
  });

  it("a staff principal places only its route's organization", () => {
    // ADR-0083 §2: staff carry no widening. Under no organization route a
    // staff request places nothing — not even its own id as a user's — and
    // under `/admin/organizations/:id` it places that organization alone.
    const ctx = context();

    ctx.principal = {
      kind: "staff",
      id: "staff-1",
      roles: ["super_admin"],
      sessionId: "s",
    };

    expect(tenantScopeOf(ctx)).toStrictEqual({ organizationId: undefined });

    ctx.routeOrganizationId = "org-2";

    expect(tenantScopeOf(ctx)).toStrictEqual({ organizationId: "org-2" });
  });
});

describe("openInRequestScope", () => {
  /**
   * A pool whose transaction hands `fn` an executor that records what it was
   * asked to run, rendered to the text and bind parameters Postgres receives.
   */
  const recordingDb = () => {
    const ran: { sql: string; params: unknown[] }[] = [];
    const dialect = new PgDialect();
    const tx = {
      execute: (query: SQL) => {
        ran.push(dialect.sqlToQuery(query));

        return Promise.resolve([]);
      },
    } as unknown as DbExecutor;
    const db = {
      transaction: <T>(fn: (inner: DbExecutor) => Promise<T>) => fn(tx),
    } as unknown as Db;

    return { db, ran };
  };

  /** The value each setting was given, by name, from `set_config`'s bind pairs. */
  const placed = (params: readonly unknown[]): Record<string, unknown> => {
    const pairs: Record<string, unknown> = {};

    for (let at = 0; at < params.length; at += 2) {
      pairs[String(params[at])] = params[at + 1];
    }

    return pairs;
  };

  it("a transaction clears every setting it does not place", async () => {
    // D29.7: a value already on the session — a startup parameter, a
    // session-level `set_config` — must not reach a request's transaction, so
    // the opener writes all four settings, `''` for each one it does not
    // place. A user acting in an organization names two of them.
    const ctx = context();

    ctx.principal = {
      kind: "user",
      id: "user-1",
      roles: ["customer"],
      sessionId: "s",
    };
    ctx.organization = { id: "org-1", slug: "acme", role: "member" };

    const { db, ran } = recordingDb();

    await runWithContext(ctx, () =>
      openInRequestScope(db)(() => Promise.resolve()),
    );

    expect(ran).toHaveLength(1);
    expect(ran[0]?.sql.match(/set_config\(/g)).toHaveLength(4);
    expect(placed(ran[0]?.params ?? [])).toEqual({
      [TENANT_SETTINGS.organizationId]: "org-1",
      [TENANT_SETTINGS.userId]: tenantScopeOf(ctx).userId ?? "",
      [TENANT_SETTINGS.invitationTokenHash]: "",
      [TENANT_SETTINGS.unscoped]: "",
    });
  });

  it("still clears every setting when there is no request at all", async () => {
    // The empty scope is the case a session-level value would otherwise
    // fill, so it is not skipped as "nothing to place".
    const { db, ran } = recordingDb();

    await openInRequestScope(db)(() => Promise.resolve());

    expect(ran).toHaveLength(1);
    expect(placed(ran[0]?.params ?? [])).toEqual({
      [TENANT_SETTINGS.organizationId]: "",
      [TENANT_SETTINGS.userId]: "",
      [TENANT_SETTINGS.invitationTokenHash]: "",
      [TENANT_SETTINGS.unscoped]: "",
    });
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
