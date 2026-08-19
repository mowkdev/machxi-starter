import { useNavigate } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { useApiClient } from "@/shared/api/context";
import { DropdownMenuItem } from "@/shared/ui";

/**
 * Ending the session, from wherever the shell puts it (ADR-0032: a feature is
 * an interaction that changes something).
 *
 * The navigation is explicit rather than left to the guard. Clearing the store
 * invalidates the router and `_dashboard` would bounce the operator anyway, but
 * relying on that would make "where does logout go?" an emergent property of
 * two other decisions instead of a stated one — and it would land them on
 * whatever `redirect` the guard computed rather than plainly on `/login`.
 */
export const LogoutMenuItem = () => {
  const client = useApiClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        event.preventDefault();
        setPending(true);
        // `logout` clears locally even when the request fails, so the session
        // is over either way. The `catch` is not a failure branch — it is
        // there because the rejection is re-thrown by design, and an offline
        // logout is the case this design deliberately supports, so leaving it
        // unhandled would report a working feature as a crash.
        void client
          .logout()
          .catch(() => undefined)
          .finally(() => {
            void navigate({ to: "/login", search: {} });
          });
      }}
    >
      <LogOutIcon />
      Sign out
    </DropdownMenuItem>
  );
};
