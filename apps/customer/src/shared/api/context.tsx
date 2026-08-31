import type { UserPrincipalResource } from "@repo/contracts";
import { useSetPrincipal as useSetPrincipalUnpinned } from "@repo/api-client";

/**
 * The door onto the client's React bindings (ADR-0051) — and the one place in
 * this slice that is more than a re-export.
 *
 * `ApiProvider`, `useApiClient` and `useSession` pass straight through. What
 * does not is `useSetPrincipal`, and it is the mirror of the narrowing
 * `apps/admin` writes: **the package cannot know which population it is
 * serving, and this app can.**
 *
 * This client is pinned to `/api/v1/user` (see `app/providers/session.tsx`), so
 * a `staff` principal cannot arrive over it, and accepting one would let a
 * caller swap the population of a session that is by construction a customer's.
 * The package's hook accepts `PrincipalResource` — correct there, where the
 * segment is a parameter — and this door narrows it back to the one member this
 * app can hold.
 *
 * **The narrowing is sound rather than a cast.** A function that accepts the
 * whole union already satisfies one that accepts a single member: every value a
 * caller can now pass was always acceptable. So the type below rejects a
 * `staff` principal at every call site in this app, and no assertion is written
 * anywhere to make that true.
 *
 * **`D12.1`'s bet, checked**: the two apps' narrowings differ only in which
 * member of the union they name, and neither needed the package to change. That
 * is `@repo/api-client` being segment-agnostic in the way ADR-0051 claimed,
 * confirmed by the second consumer rather than asserted by the first.
 */
export {
  ApiProvider,
  useApiClient,
  useSession,
  type ApiContextValue,
  type SessionView,
} from "@repo/api-client";

export const useSetPrincipal = (): ((
  principal: UserPrincipalResource,
) => void) => useSetPrincipalUnpinned();
