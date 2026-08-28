import { useCallback, useMemo } from "react";

import { useSession } from "@repo/api-client";
import type { GridCapabilities } from "@repo/resource";

import { can, type CanFn, type ResourcePolicy } from "./can";
import { allowedCapabilities } from "./capabilities";

/**
 * The bound half of ADR-0042: `can` with the principal already applied.
 *
 * **It reads the principal from the session store, through `useSession`**
 * (ADR-0033) — never `document.cookie`, never storage, never a decoded access
 * token. `useSession` deliberately exposes `{ principal, isAuthenticated }` and
 * not the tokens, and this needs nothing more: the roles are on the principal.
 *
 * Those roles are the *account's* rather than the token's claims after D3.9's
 * `useSetPrincipal`, and the two can disagree. Through the API the window is one
 * request — ADR-0017 revokes the subject's sessions in the same transaction that
 * changes their roles. Out of band there is no window, only an unbounded gap:
 * the super-admin seeder grants with `onConflictDoNothing` and revokes nothing,
 * so a re-run of `pnpm db:setup` leaves the database's roles a superset of a
 * live session's claims for as long as that session lives. The consequence is a
 * stale `true` — an affordance offered and then refused — and it is accepted
 * rather than mechanised because the API still refuses and the operator still
 * gets a message (ADR-0042 §Consequences).
 */
/*
 * **The policy arrives as an argument, and each app's door binds it once**
 * (`D9.6`, ADR-0051). A hook rather than a factory returning one: a factory
 * would put the `useSession` call inside a closure the rules-of-hooks lint
 * cannot follow, and a hook that takes its data is the same seam without that
 * cost. `apps/admin/src/shared/auth` re-exports this with `RESOURCE_POLICY`
 * already applied, so no call site in that app changed.
 */
export const useCan = <TResource extends string, TAction extends string>(
  policy: ResourcePolicy<TResource, TAction>,
): CanFn<TAction, TResource> => {
  const { principal } = useSession();

  return useCallback(
    (action: TAction, resource: TResource) =>
      can(policy, principal, action, resource),
    [policy, principal],
  );
};

/**
 * One line per screen, and everything downstream reads the narrowed block.
 *
 * Memoised on the config block and the predicate because `AppGrid` takes the
 * result as a prop: a fresh object each render would defeat the memoisation the
 * column builders and the table options depend on.
 */
export const useAllowedCapabilities = <TResource extends string>(
  /*
   * Typed over `"create" | "delete"` rather than over the caller's whole action
   * union, for the reason {@link allowedCapabilities} is (`D9.6`): those are
   * the two questions this asks. A policy declared over a *wider* union is
   * assignable here — every row is `Partial`, so the wider table simply has
   * more optional keys — which is what lets an app pass `RESOURCE_POLICY`
   * unchanged and still have the narrowing say what it needs.
   */
  policy: ResourcePolicy<TResource, "create" | "delete">,
  capabilities: GridCapabilities | undefined,
  resource: TResource,
): GridCapabilities | undefined => {
  const canFn = useCan(policy);

  return useMemo(
    () => allowedCapabilities(capabilities, canFn, resource),
    [capabilities, canFn, resource],
  );
};
