import { sql } from "drizzle-orm";

import type { DbExecutor } from "@repo/db";

/**
 * The boot refusal for a role row-level security does not bind (ADR-0078 §4
 * as amended at `D29.7`, and its follow-up).
 *
 * The tenant-owned tables' policies (migration `0019`) are the database's half
 * of tenant isolation, and Postgres skips every one of them for three kinds of
 * role: a superuser, a role with `BYPASSRLS`, and the table's owner (or a role
 * that inherits the owner's privileges) — there is no `FORCE ROW LEVEL
 * SECURITY`, deliberately, so that the owner can migrate and truncate. A role
 * that is a member of any of the three is one `SET ROLE` away from the same,
 * so it counts as well. This
 * repository's API connects as the application role, which is none of them
 * (ADR-0061 §1), but a fork that points `DATABASE_URL` at the owner, or a
 * managed platform whose default user is privileged, would lose every policy
 * **silently**: the application would keep working and isolate nothing.
 *
 * So the process asks the database who it is before binding the port, and
 * refuses to start in production when the answer is any of them.
 * Development and test are exempt by the caller (`main.ts`), not here: the
 * check is a statement about a deployment.
 */

/** What the database says about the role this connection runs as. */
export interface RoleRowLevelSecurity {
  readonly role: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  /**
   * The superuser and `BYPASSRLS` roles this role is a member of, other than
   * itself — each one `SET ROLE` away from skipping every policy.
   */
  readonly bypassingRolesHeld: readonly string[];
  /**
   * Every ordinary or partitioned table outside the system schemas that this
   * role owns, or is a member of the owner of, schema-qualified — whatever its
   * row-level-security flag, since a flag turned on later (migration `0019`
   * applied under a running process) does not bind the owner either.
   */
  readonly ownedTables: readonly string[];
}

/** How many owned tables the refusal names before it counts the rest. */
const NAMED_TABLES = 3;

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
  if (role.bypassingRolesHeld.length > 0) {
    reasons.push(
      `is a member of ${role.bypassingRolesHeld.join(", ")} (superuser or BYPASSRLS)`,
    );
  }
  if (role.ownedTables.length > 0) {
    const named = role.ownedTables.slice(0, NAMED_TABLES).join(", ");
    const rest = role.ownedTables.length - NAMED_TABLES;

    reasons.push(
      rest > 0
        ? `owns ${named} and ${String(rest)} more table${rest === 1 ? "" : "s"}`
        : `owns ${named}`,
    );
  }

  return reasons;
};

/**
 * Reads the connection's own role: its two attributes, the superuser and
 * `BYPASSRLS` roles it is a member of, and every ordinary or partitioned table
 * outside the system schemas whose owner it is or could become
 * (`pg_has_role(…, 'MEMBER')`).
 *
 * `MEMBER` rather than `USAGE`, in both places: Postgres honours an inherited
 * attribute or ownership, and a non-inheriting member is one `SET ROLE` away
 * from the same. A superuser is left out of the membership list because
 * `pg_has_role` answers true for it on every role and it is refused already.
 *
 * Ownership is counted **whatever the table's row-level-security flag**
 * (the `D29.7` follow-up): before `0019` is applied no table has the flag, so a
 * probe that read it would wave the owner through on the code-first release
 * and keep it serving once the migration landed. The application role owns
 * nothing at all (ADR-0061 §1; `docs/deploy.md`) — the migrations table in
 * schema `drizzle` is the owner's too — so any owned table is the mistake. The
 * search path is not consulted, so a role whose `search_path` names another
 * schema is not waved through. The system schemas are left out — `pg_catalog`,
 * `information_schema`, the TOAST schemas and the per-session temporary ones,
 * whose tables no tenant's rows live in.
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
          select array_agg(o.rolname::text order by o.rolname)
          from pg_roles o
          where (o.rolsuper or o.rolbypassrls)
            and o.rolname <> current_user
            and not r.rolsuper
            and pg_has_role(current_user, o.oid, 'MEMBER')
        ),
        '{}'::text[]
      ) as bypassing_roles_held,
      coalesce(
        (
          select array_agg(
            format('%I.%I', n.nspname, c.relname)
            order by n.nspname, c.relname
          )
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p')
            and n.nspname not in ('pg_catalog', 'information_schema')
            and n.nspname !~ '^pg_(toast|temp_)'
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
    bypassing_roles_held: string[];
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
    bypassingRolesHeld: row.bypassing_roles_held,
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
