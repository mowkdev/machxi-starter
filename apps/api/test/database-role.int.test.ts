import { afterAll, describe, expect, it } from "vitest";

import {
  assertRoleBoundByRowLevelSecurity,
  createDb,
  readRoleRowLevelSecurity,
  isRowLevelSecurityRefusal,
  type DbClient,
} from "../src/core/db/index.js";
import { loadConfig } from "../src/core/config/index.js";
import { loadTestEnv } from "./setup/env.js";

/**
 * The boot refusal against a real database (ADR-0078 §4 as amended at
 * `D29.7`): the check `main.ts` runs in production before the port opens,
 * asked as the two roles this repository has. The application role is what
 * the API connects as and the policies bind; the owner runs the migrations,
 * owns every table and is bound by none of them.
 */

describe("the database role check at boot", () => {
  const opened: DbClient[] = [];

  const connect = (url: string): DbClient => {
    const client = createDb(url, { max: 1, idleTimeout: 1 });

    opened.push(client);

    return client;
  };

  afterAll(async () => {
    await Promise.all(opened.map((client) => client.close()));
  });

  it("lets the application role through", async () => {
    const app = connect(loadConfig().db.url);

    await expect(readRoleRowLevelSecurity(app.db)).resolves.toMatchObject({
      superuser: false,
      bypassRls: false,
      ownedTables: [],
    });
    await expect(
      assertRoleBoundByRowLevelSecurity(app.db),
    ).resolves.toBeUndefined();
  });

  it("the API refuses a role that bypasses row-level security", async () => {
    // The owner is the realistic mistake — a fork that points `DATABASE_URL`
    // at the migrating role — and the one no attribute gives away: it is not
    // a superuser and holds no BYPASSRLS, it simply owns the policed tables.
    const owner = connect(loadTestEnv().ownerDatabaseUrl);

    const role = await readRoleRowLevelSecurity(owner.db);

    expect(role.ownedTables).toEqual(
      expect.arrayContaining([
        "organization_invitations",
        "organization_memberships",
      ]),
    );

    const refusal = assertRoleBoundByRowLevelSecurity(owner.db);

    await expect(
      refusal.catch((caught: unknown) => isRowLevelSecurityRefusal(caught)),
    ).resolves.toBe(true);
    await expect(refusal).rejects.toThrow(
      /owns organization_invitations, organization_memberships.*refusing to start/,
    );
  });
});
