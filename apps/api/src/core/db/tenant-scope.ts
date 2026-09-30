import {
  setTenantScope,
  type Db,
  type DbExecutor,
  type TenantScope,
} from "@repo/db";

import { tryGetContext, type RequestContext } from "../context/index.js";

/**
 * What the tenant-owned tables' policies are told about the current request
 * (ADR-0067 §5, ADR-0078 §4 as amended at `D29.4`).
 *
 * Read from the request context, which is where the guards already put the
 * two facts: `authenticate` places the principal and `requireMembership` the
 * resolved organization (ADR-0067 §4). Nothing here decides anything — it
 * restates, for Postgres, what the guards decided for the code:
 *
 * - a **user** principal admits their own memberships and the invitations
 *   addressed to them (the principal-scoped class), and, once the membership
 *   guard has run, the organization they are acting in;
 * - a **staff** principal is above tenants (ADR-0067 §3) and says so by the
 *   named `staff` widening — staff never hold a membership, so there is
 *   nothing narrower to place;
 * - **no** context, or a context with no principal and no organization,
 *   places nothing, and the policies then admit nothing. A public route that
 *   reads a tenant-owned row places the one setting its read is scoped by
 *   (the invitation's token hash) or the organization it has just created.
 */
export const tenantScopeOf = (ctx: RequestContext | undefined): TenantScope => {
  const principal = ctx?.principal ?? null;

  if (principal?.kind === "staff") return { unscoped: "staff" };

  return {
    userId: principal?.id,
    organizationId: ctx?.organization?.id,
  };
};

/**
 * Opens a transaction on `db` and places the current request's scope on it
 * before `fn` runs — the `open` the composition root hands the transaction
 * helper, so **every** transaction a service opens carries the scope of the
 * request it runs in and none can forget to.
 *
 * The scope is read when the transaction opens, not when the helper is built:
 * the membership guard places the organization on the context mid-request,
 * and a transaction a service opens after it must see it.
 */
export const openInRequestScope =
  (db: Db) =>
  <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await setTenantScope(tx, tenantScopeOf(tryGetContext()));

      return fn(tx);
    });

/** What the composition root's transaction helper is — the runner a repository borrows. */
export type RunInTransaction = <T>(
  fn: (tx: DbExecutor) => Promise<T>,
) => Promise<T>;

/**
 * The executor rule for a repository over a tenant-owned table (ADR-0078 §4
 * as amended at `D29.4`): run on the caller's transaction when there is one —
 * which opened in the request's scope — and otherwise in a transaction of its
 * own, opened the same way.
 *
 * Never on the bare pool. A statement there carries no setting, so the
 * policies would show it nothing: the read that "forgot" a transaction would
 * look like an empty table rather than fail, which is the right answer for a
 * forgotten organization and the wrong one for a forgotten transaction.
 */
export const withinTransaction =
  (transaction: RunInTransaction) =>
  <T>(
    caller: DbExecutor | undefined,
    fn: (tx: DbExecutor) => Promise<T>,
  ): Promise<T> =>
    caller === undefined ? transaction(fn) : fn(caller);
