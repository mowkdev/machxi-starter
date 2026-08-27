import type { StaffPrincipalResource } from "@repo/contracts";
import { useSetPrincipal as useSetPrincipalUnpinned } from "@repo/api-client";

/**
 * The door onto the client's React bindings (`D9.1`, ADR-0051) — and the one
 * place in this slice that is more than a re-export.
 *
 * `ApiProvider`, `useApiClient` and `useSession` pass straight through. What
 * does not is `useSetPrincipal`, and the reason is the deliverable's whole
 * generalisation seen from the consuming end: **the package cannot know which
 * population it is serving, and this app can.**
 *
 * The shipped hook took a `StaffPrincipalResource` deliberately, on the D3.9
 * reasoning that this client is pinned to `/api/v1/admin`, so a `user`
 * principal cannot arrive and accepting one would let a caller swap the
 * population of a session that is by construction staff. That reasoning is
 * unchanged and the guarantee is unchanged; only its home moved. The package's
 * hook accepts `PrincipalResource` — correct there, where the segment is a
 * parameter — and this door narrows it back.
 *
 * **The narrowing is sound rather than a cast.** A function that accepts the
 * whole union already satisfies one that accepts a single member: every value
 * a caller can now pass was always acceptable. So the type below rejects a
 * `user` principal at every call site in this app, as it did before `D9.1`,
 * and no assertion is written anywhere to make that true.
 */
export {
  ApiProvider,
  useApiClient,
  useSession,
  type ApiContextValue,
  type SessionView,
} from "@repo/api-client";

export const useSetPrincipal = (): ((
  principal: StaffPrincipalResource,
) => void) => useSetPrincipalUnpinned();
