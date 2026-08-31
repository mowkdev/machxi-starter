import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { useApiClient } from "@/shared/api/context";

export interface SignOut {
  /** Ends the session and lands on `/login`. Safe to call twice. */
  readonly signOut: () => void;
  /** True from the click until the navigation is under way. */
  readonly pending: boolean;
}

/**
 * Ending the session, from wherever the chrome puts the control (ADR-0049: a
 * feature is an interaction that changes something).
 *
 * **A hook rather than the admin's `LogoutMenuItem`, and the difference is not
 * cosmetic.** That component *is* a `DropdownMenuItem` — it decides its own
 * icon, its own label and its own surface — which was right when the account
 * menu was the only place an operator could sign out. This app's exit lives in
 * ADR-0053's slim popover (`D12.5`), and nothing renders it at `D12.2`; a
 * component with no host would be a guess about the surface, while the
 * behaviour is knowable now and is what the plan's step names. `D12.5` spends
 * this in one line.
 *
 * The navigation is explicit rather than left to the guard. Clearing the store
 * invalidates the router and `_dashboard` would bounce the customer anyway, but
 * relying on that would make "where does signing out go?" an emergent property
 * of two other decisions instead of a stated one — and it would land them on
 * whatever `redirect` the guard computed rather than plainly on `/login`.
 */
export const useSignOut = (): SignOut => {
  const client = useApiClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  const signOut = useCallback(() => {
    if (pending) return;

    setPending(true);

    /*
     * `logout` clears locally even when the request fails, so the session is
     * over either way. The `catch` is not a failure branch — the rejection is
     * re-thrown by design, and an offline sign-out is the case that design
     * deliberately supports, so leaving it unhandled would report a working
     * feature as a crash.
     */
    void client
      .logout()
      .catch(() => undefined)
      .finally(() => {
        void navigate({ to: "/login", search: {} });
      });
  }, [client, navigate, pending]);

  return { signOut, pending };
};
