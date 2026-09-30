import { sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "./client.js";

/**
 * Row-level security's half of tenant isolation (ADR-0067 §5, ADR-0078 §4 as
 * amended at `D29.4`).
 *
 * Every table in `TENANT_OWNED_TABLES` carries policies that read these
 * transaction-local settings, and admit a row only when one of them names it.
 * **Nothing is admitted by omission**: a transaction that places no setting
 * sees no tenant-owned row and can write none, so a repository query that
 * forgets its organization returns nothing rather than every tenant's rows.
 *
 * The settings are placed with `set_config(name, value, true)` — `SET LOCAL`'s
 * function form, which takes a bind parameter — so each lasts until the end of
 * the transaction that placed it and never leaks to the next borrower of a
 * pooled connection. The table owner, which runs the migrations and the
 * harness's truncate, is not subject to the policies (no `FORCE ROW LEVEL
 * SECURITY`); the application role always is (ADR-0061 §1).
 */

/** The setting names, said once — the policies and the writer both read them. */
export const TENANT_SETTINGS = {
  /** The organization a request acts in, placed once `requireMembership` has resolved it. */
  organizationId: "app.organization_id",
  /** The signed-in user — admits their own memberships and the invitations addressed to them. */
  userId: "app.user_id",
  /** The one secret-scoped read ADR-0067 §5 sanctions: an invitation by its token's hash. */
  invitationTokenHash: "app.invitation_token_hash",
  /**
   * An explicit, named widening: `staff` for the staff segment (ADR-0067 §3,
   * staff are above tenants), `system` for the seeders and the tooling.
   */
  unscoped: "app.tenant_unscoped",
} as const;

/** Who may read across tenants, and why — never implied, always named. */
export type TenantUnscopedReason = "staff" | "system";

/** What a transaction is scoped to. Every key is optional; an absent key places nothing. */
export interface TenantScope {
  readonly organizationId?: string | undefined;
  readonly userId?: string | undefined;
  readonly invitationTokenHash?: string | undefined;
  readonly unscoped?: TenantUnscopedReason | undefined;
}

/**
 * A setting's value inside a policy expression: `NULL` when unset **or reset**.
 *
 * `current_setting(…, true)` is `NULL` for a name this session never placed,
 * but a transaction-local value reverts to the empty string once its
 * transaction ends, so a pooled connection that served a scoped transaction
 * reads `''` afterwards. `nullif` makes both mean "unset", and keeps an empty
 * string from ever reaching a `::uuid` cast.
 */
export const tenantSetting = (
  name: (typeof TENANT_SETTINGS)[keyof typeof TENANT_SETTINGS],
): string => `nullif(current_setting('${name}', true), '')`;

/**
 * Places `scope` on the transaction `tx` belongs to, in one round trip.
 *
 * Called with an executor that **is** a transaction. On a bare pool the
 * setting would last for that one implicit statement and scope nothing, which
 * is why every tenant-owned read outside a caller's transaction opens one of
 * its own (the API's repositories say how).
 *
 * @returns without a round trip when `scope` names nothing.
 */
export const setTenantScope = async (
  tx: DbExecutor,
  scope: TenantScope,
): Promise<void> => {
  const placed: SQL[] = [];

  const place = (name: string, value: string | undefined): void => {
    if (value === undefined || value === "") return;
    placed.push(sql`set_config(${name}, ${value}, true)`);
  };

  place(TENANT_SETTINGS.organizationId, scope.organizationId);
  place(TENANT_SETTINGS.userId, scope.userId);
  place(TENANT_SETTINGS.invitationTokenHash, scope.invitationTokenHash);
  place(TENANT_SETTINGS.unscoped, scope.unscoped);

  if (placed.length === 0) return;

  await tx.execute(sql`select ${sql.join(placed, sql`, `)}`);
};

/**
 * Places `scope` on the transaction `tx` belongs to **and clears every setting
 * it does not name**, in one round trip (ADR-0078 §4 as amended at `D29.7`).
 *
 * The opener of a request's transaction calls this rather than
 * {@link setTenantScope}, which only adds: a value already on the session —
 * the `tenantUnscoped` startup parameter, or a `set_config(…, false)` somebody
 * ran on a pooled connection — would otherwise reach every transaction that
 * did not place that name itself. Writing `''` transaction-locally shadows it
 * until the transaction ends, and `tenantSetting` reads `''` as unset.
 *
 * Always makes the round trip, even for an empty scope: an empty scope is
 * exactly the case a session-level value would otherwise fill.
 */
export const replaceTenantScope = async (
  tx: DbExecutor,
  scope: TenantScope,
): Promise<void> => {
  const placed = (
    [
      [TENANT_SETTINGS.organizationId, scope.organizationId],
      [TENANT_SETTINGS.userId, scope.userId],
      [TENANT_SETTINGS.invitationTokenHash, scope.invitationTokenHash],
      [TENANT_SETTINGS.unscoped, scope.unscoped],
    ] as const
  ).map(([name, value]) => sql`set_config(${name}, ${value ?? ""}, true)`);

  await tx.execute(sql`select ${sql.join(placed, sql`, `)}`);
};
