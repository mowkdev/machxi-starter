import { sql } from "drizzle-orm";

import type { DbExecutor } from "@repo/db";

/**
 * The boot refusal for a role row-level security does not bind (ADR-0078 §4
 * as amended at `D29.7`).
 *
 * The tenant-owned tables' policies (migration `0019`) are the database's half
 * of tenant isolation, and Postgres skips every one of them for three kinds of
 * role: a superuser, a role with `BYPASSRLS`, and the table's owner (or a role
 * that inherits the owner's privileges) — there is no `FORCE ROW LEVEL
 * SECURITY`, deliberately, so that the owner can migrate and truncate. This
 * repository's API connects as the application role, which is none of them
 * (ADR-0061 §1), but a fork that points `DATABASE_URL` at the owner, or a
 * managed platform whose default user is privileged, would lose every policy
 * **silently**: the application would keep working and isolate nothing.
 *
 * So the process asks the database who it is before binding the port, and
 * refuses to start in production when the answer is one of the three.
 * Development and test are exempt by the caller (`main.ts`), not here: the
 * check is a statement about a deployment.
 */

/** What the database says about the role this connection runs as. */
export interface RoleRowLevelSecurity {
  readonly role: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  /**
   * The tables under row-level security that this role owns, or is a member
   * of the owner of — the case the policies do not bind.
   */
  readonly ownedTables: readonly string[];
}

/**
 * Why `role` would not be bound by the tenant tables' policies, one clause
 * each — empty when it would be.
 */
export const rowLevelSecurityBypasses = (
  role: RoleRowLevelSecurity,
): string[] => {
  const reasons: string[] = [];

  if (role.superuser) reasons.push("is a superuser");
  if (role.bypassRls) reasons.push("has BYPASSRLS");
  if (role.ownedTables.length > 0) {
    reasons.push(`owns ${role.ownedTables.join(", ")}`);
  }

  return reasons;
};

/**
 * Reads the connection's own role: its two attributes, and every table under
 * row-level security, in any schema, whose owner it is or could become
 * (`pg_has_role(…, 'MEMBER')`). Postgres skips a policy for the owner and for
 * a role that inherits the owner's privileges; `MEMBER` also counts a
 * non-inheriting member, which is one `SET ROLE` away from the same, and the
 * search path is not consulted, so a role whose `search_path` names another
 * schema is not waved through.
 *
 * Reads by the row-level-security flag rather than by the tenant-owned list,
 * because the list is the test tier's (`@repo/db/testing`) and the flag is
 * what the database itself acts on; `schema.int.test.ts` proves every listed
 * table has it on.
 */
export const readRoleRowLevelSecurity = async (
  db: DbExecutor,
): Promise<RoleRowLevelSecurity> => {
  const rows = (await db.execute(sql`
    select
      r.rolname::text as role,
      r.rolsuper as superuser,
      r.rolbypassrls as bypass_rls,
      coalesce(
        (
          select array_agg(c.relname::text order by c.relname)
          from pg_class c
          where c.relkind in ('r', 'p')
            and c.relrowsecurity
            and pg_has_role(current_user, c.relowner, 'MEMBER')
        ),
        '{}'::text[]
      ) as owned_tables
    from pg_roles r
    where r.rolname = current_user
  `)) as unknown as {
    role: string;
    superuser: boolean;
    bypass_rls: boolean;
    owned_tables: string[];
  }[];

  const [row] = rows;

  if (row === undefined) {
    throw new Error("the connection's role is not in pg_roles");
  }

  return {
    role: row.role,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    ownedTables: row.owned_tables,
  };
};

/**
 * The refusal's mark — so `main.ts` can tell the sentence from a driver error
 * that happened while asking, and let only the sentence reach stderr.
 */
const REFUSAL = "ROLE_BYPASSES_ROW_LEVEL_SECURITY";

/** Whether `error` is the refusal {@link assertRoleBoundByRowLevelSecurity} throws. */
export const isRowLevelSecurityRefusal = (error: unknown): error is Error =>
  error instanceof Error && (error as { code?: unknown }).code === REFUSAL;

/**
 * Rejects, with a sentence an operator can act on, when the connection's role
 * is not bound by row-level security.
 *
 * The sentence names the role and the reason and no credential or host, which
 * is what `main.ts` lets reach stderr.
 */
export const assertRoleBoundByRowLevelSecurity = async (
  db: DbExecutor,
): Promise<void> => {
  const role = await readRoleRowLevelSecurity(db);
  const reasons = rowLevelSecurityBypasses(role);

  if (reasons.length === 0) return;

  throw Object.assign(
    new Error(
      `The database role "${role.role}" ${reasons.join(", and ")}, so row-level security would not bind it and every tenant-owned table would be readable across tenants; refusing to start. Connect DATABASE_URL as the application role (docs/deploy.md).`,
    ),
    { code: REFUSAL },
  );
};
