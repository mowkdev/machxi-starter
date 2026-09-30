import { describe, expect, it } from "vitest";

import {
  assertRoleBoundByRowLevelSecurity,
  isRowLevelSecurityRefusal,
  rowLevelSecurityBypasses,
  type RoleRowLevelSecurity,
} from "../role-check.js";
import type { DbExecutor } from "@repo/db";

/**
 * The decision half of the boot refusal (ADR-0078 §4 as amended at `D29.7`).
 * The query half is proved against Postgres in `database-role.int.test.ts`.
 */

const BOUND: RoleRowLevelSecurity = {
  role: "machxi_app",
  superuser: false,
  bypassRls: false,
  ownedTables: [],
};

/** An executor whose one query answers with `row`, as the driver would. */
const answering = (row: Record<string, unknown>): DbExecutor =>
  ({ execute: () => Promise.resolve([row]) }) as unknown as DbExecutor;

describe("rowLevelSecurityBypasses", () => {
  it("finds nothing for a role the policies bind", () => {
    expect(rowLevelSecurityBypasses(BOUND)).toEqual([]);
  });

  it("names each of the three ways past the policies", () => {
    expect(rowLevelSecurityBypasses({ ...BOUND, superuser: true })).toEqual([
      "is a superuser",
    ]);
    expect(rowLevelSecurityBypasses({ ...BOUND, bypassRls: true })).toEqual([
      "has BYPASSRLS",
    ]);
    expect(
      rowLevelSecurityBypasses({
        ...BOUND,
        ownedTables: ["organization_invitations", "organization_memberships"],
      }),
    ).toEqual(["owns organization_invitations, organization_memberships"]);
  });
});

describe("assertRoleBoundByRowLevelSecurity", () => {
  it("lets a bound role through", async () => {
    await expect(
      assertRoleBoundByRowLevelSecurity(
        answering({
          role: "machxi_app",
          superuser: false,
          bypass_rls: false,
          owned_tables: [],
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a superuser by name, with nothing but the role in the sentence", async () => {
    const refusal = assertRoleBoundByRowLevelSecurity(
      answering({
        role: "postgres",
        superuser: true,
        bypass_rls: true,
        owned_tables: [],
      }),
    );

    await expect(
      refusal.catch((caught: unknown) => isRowLevelSecurityRefusal(caught)),
    ).resolves.toBe(true);
    await expect(refusal).rejects.toThrow(
      /"postgres" is a superuser, and has BYPASSRLS/,
    );
  });
});
