import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import type { DbExecutor } from "@repo/db";

import {
  assertRoleBoundByRowLevelSecurity,
  createDb,
  readRoleRowLevelSecurity,
  isRowLevelSecurityRefusal,
  type DbClient,
} from "../src/core/db/index.js";
import { loadConfig } from "../src/core/config/index.js";
import { loadTestEnv, readTestSuperuserUrl } from "./setup/env.js";

/**
 * The boot refusal against a real database (ADR-0078 §4 as amended at
 * `D29.7`): the check `main.ts` runs in production before the port opens,
 * asked as the two roles this repository has. The application role is what
 * the API connects as and the policies bind; the owner runs the migrations,
 * owns every table and is bound by none of them. The follow-up's two cases
 * build the roles a deployment could be handed by mistake — a member of a
 * `BYPASSRLS` role, the owner of a table with no row-level security — as the
 * cluster superuser, inside a transaction that is rolled back, so the roles,
 * the schema and the table never outlive the case.
 *
 * `SET LOCAL ROLE` is itself the fifth reason (ADR-0083 §4): the throwaway
 * role runs under the superuser's login, so every case built that way is
 * refused for the switch as well, and the fifth reason's own case is a role
 * that is clean in every other respect.
 */

/** Rolls the probe's transaction back once its assertions have run. */
const ROLLBACK = Symbol("rollback");

/** A cluster-unique suffix: roles are cluster-wide, and runs may overlap. */
const suffix = (): string => randomBytes(4).toString("hex");

/** The login the throwaway roles are switched to from — the cluster superuser. */
const superuserLogin = (): string =>
  decodeURIComponent(new URL(readTestSuperuserUrl()).username);

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

  /**
   * Runs `probe` as `role` — created by `setup` in the same superuser
   * transaction, then `SET LOCAL ROLE` — and rolls everything back.
   */
  const asThrowawayRole = async (
    setup: string[],
    role: string,
    probe: (tx: DbExecutor) => Promise<void>,
  ): Promise<void> => {
    const superuser = connect(readTestSuperuserUrl());

    await superuser.db
      .transaction(async (tx) => {
        for (const statement of setup) await tx.execute(sql.raw(statement));
        await tx.execute(sql.raw(`set local role ${role}`));
        await probe(tx);
        throw ROLLBACK;
      })
      .catch((caught: unknown) => {
        if (caught !== ROLLBACK) throw caught;
      });
  };

  it("lets the application role through", async () => {
    const app = connect(loadConfig().db.url);

    const role = await readRoleRowLevelSecurity(app.db);

    expect(role.loginRole).toBe(role.role);
    await expect(readRoleRowLevelSecurity(app.db)).resolves.toMatchObject({
      superuser: false,
      bypassRls: false,
      bypassingRolesHeld: [],
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
        "drizzle.__drizzle_migrations",
        "public.organization_invitations",
        "public.organization_memberships",
        "public.users",
      ]),
    );

    const refusal = assertRoleBoundByRowLevelSecurity(owner.db);

    await expect(
      refusal.catch((caught: unknown) => isRowLevelSecurityRefusal(caught)),
    ).resolves.toBe(true);
    await expect(refusal).rejects.toThrow(
      /owns drizzle\.__drizzle_migrations, public\.account_tokens, public\.audit_events and \d+ more tables.*refusing to start/,
    );
  });

  it("refuses a role that is only a member of a BYPASSRLS role", async () => {
    // The attributes are not inherited, so the role's own row reads clean:
    // what gives it away is the membership — one `SET ROLE` from skipping
    // every policy.
    const bypassing = `rls_probe_bypass_${suffix()}`;
    const member = `rls_probe_member_${suffix()}`;

    await asThrowawayRole(
      [
        `create role ${bypassing} nologin bypassrls`,
        `create role ${member} nologin`,
        `grant ${bypassing} to ${member}`,
      ],
      member,
      async (tx) => {
        await expect(readRoleRowLevelSecurity(tx)).resolves.toMatchObject({
          role: member,
          superuser: false,
          bypassRls: false,
          bypassingRolesHeld: [bypassing],
          ownedTables: [],
        });
        await expect(assertRoleBoundByRowLevelSecurity(tx)).rejects.toThrow(
          `"${member}" is a member of ${bypassing} (superuser or BYPASSRLS), and was switched to from the login role "${superuserLogin()}", one SET ROLE NONE away, so row-level security would not bind it`,
        );
      },
    );
  });

  it("refuses the owner of a table whose row-level security is not on yet", async () => {
    // The code-first release across `0019`: the owner's tables carry no flag
    // yet, and an API connected as the owner must not boot on that account.
    const owner = `rls_probe_owner_${suffix()}`;
    const schema = `rls_probe_${suffix()}`;

    await asThrowawayRole(
      [
        `create role ${owner} nologin`,
        `create schema ${schema}`,
        `create table ${schema}.ledger (id integer)`,
        `alter table ${schema}.ledger owner to ${owner}`,
      ],
      owner,
      async (tx) => {
        await expect(readRoleRowLevelSecurity(tx)).resolves.toMatchObject({
          role: owner,
          bypassingRolesHeld: [],
          ownedTables: [`${schema}.ledger`],
        });
        await expect(assertRoleBoundByRowLevelSecurity(tx)).rejects.toThrow(
          `"${owner}" owns ${schema}.ledger, and was switched to from the login role "${superuserLogin()}", one SET ROLE NONE away, so row-level security would not bind it`,
        );
      },
    );
  });

  it("refuses a connection whose session user is not its current user", async () => {
    // ADR-0083 §4's fifth reason. The role switched to is clean in every
    // other respect — no attribute, no membership, no table — so this is the
    // only reason it is refused; the login it came from (here the cluster
    // superuser) is one `SET ROLE NONE` away, and none of the other four
    // questions was asked about it.
    const switched = `rls_probe_switched_${suffix()}`;

    await asThrowawayRole(
      [`create role ${switched} nologin`],
      switched,
      async (tx) => {
        await expect(readRoleRowLevelSecurity(tx)).resolves.toMatchObject({
          role: switched,
          loginRole: superuserLogin(),
          superuser: false,
          bypassRls: false,
          bypassingRolesHeld: [],
          ownedTables: [],
        });
        await expect(assertRoleBoundByRowLevelSecurity(tx)).rejects.toThrow(
          `The database role "${switched}" was switched to from the login role "${superuserLogin()}", one SET ROLE NONE away, so row-level security would not bind it`,
        );
      },
    );
  });
});
