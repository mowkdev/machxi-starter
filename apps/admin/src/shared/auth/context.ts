import { useCallback, useMemo } from "react";

import { useSession } from "@/shared/api/context";
import type { GridCapabilities } from "@/shared/resource/types";

import { can, type CanFn } from "./can";
import { allowedCapabilities } from "./capabilities";
import type { ResourceAction, ResourceName } from "./policy";

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
export const useCan = (): CanFn => {
  const { principal } = useSession();

  return useCallback(
    (action: ResourceAction, resource: ResourceName) =>
      can(principal, action, resource),
    [principal],
  );
};

/**
 * One line per screen, and everything downstream reads the narrowed block.
 *
 * Memoised on the config block and the predicate because `AppGrid` takes the
 * result as a prop: a fresh object each render would defeat the memoisation the
 * column builders and the table options depend on.
 */
export const useAllowedCapabilities = (
  capabilities: GridCapabilities | undefined,
  resource: ResourceName,
): GridCapabilities | undefined => {
  const canFn = useCan();

  return useMemo(
    () => allowedCapabilities(capabilities, canFn, resource),
    [capabilities, canFn, resource],
  );
};
