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
  loginRole: "machxi_app",
  superuser: false,
  bypassRls: false,
  bypassingRolesHeld: [],
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

  it("names membership in a superuser or BYPASSRLS role, which is one SET ROLE away", () => {
    expect(
      rowLevelSecurityBypasses({
        ...BOUND,
        bypassingRolesHeld: ["platform_admin", "rds_superuser"],
      }),
    ).toEqual([
      "is a member of platform_admin, rds_superuser (superuser or BYPASSRLS)",
    ]);
  });

  it("names a login role switched at connect time", () => {
    // ADR-0083 §4, the fifth reason: `ALTER ROLE … SET role` or
    // `options=-c role=…` leaves every other question answered for the role
    // switched to, while the login it came from is one `SET ROLE NONE` away.
    expect(
      rowLevelSecurityBypasses({ ...BOUND, loginRole: "postgres" }),
    ).toEqual([
      'was switched to from the login role "postgres", one SET ROLE NONE away',
    ]);
  });

  it("names three owned tables and counts the rest", () => {
    expect(
      rowLevelSecurityBypasses({
        ...BOUND,
        ownedTables: [
          "drizzle.__drizzle_migrations",
          "public.account_tokens",
          "public.audit_events",
          "public.users",
        ],
      }),
    ).toEqual([
      "owns drizzle.__drizzle_migrations, public.account_tokens, public.audit_events and 1 more table",
    ]);
    expect(
      rowLevelSecurityBypasses({
        ...BOUND,
        ownedTables: [
          "public.a",
          "public.b",
          "public.c",
          "public.d",
          "public.e",
        ],
      }),
    ).toEqual(["owns public.a, public.b, public.c and 2 more tables"]);
  });
});

describe("assertRoleBoundByRowLevelSecurity", () => {
  it("lets a bound role through", async () => {
    await expect(
      assertRoleBoundByRowLevelSecurity(
        answering({
          role: "machxi_app",
          login_role: "machxi_app",
          superuser: false,
          bypass_rls: false,
          bypassing_roles_held: [],
          owned_tables: [],
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a superuser by name, with nothing but the role in the sentence", async () => {
    const refusal = assertRoleBoundByRowLevelSecurity(
      answering({
        role: "postgres",
        login_role: "postgres",
        superuser: true,
        bypass_rls: true,
        bypassing_roles_held: [],
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

  it("refuses a member of a bypassing role, and an owner of tables with no row-level security", async () => {
    await expect(
      assertRoleBoundByRowLevelSecurity(
        answering({
          role: "api",
          login_role: "api",
          superuser: false,
          bypass_rls: false,
          bypassing_roles_held: ["platform_admin"],
          owned_tables: ["public.users"],
        }),
      ),
    ).rejects.toThrow(
      /"api" is a member of platform_admin \(superuser or BYPASSRLS\), and owns public\.users, so row-level security would not bind it/,
    );
  });
});
