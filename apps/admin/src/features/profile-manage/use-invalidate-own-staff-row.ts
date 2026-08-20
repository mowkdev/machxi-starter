import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { staffKeys } from "@/entities/staff";

/**
 * The acting operator is also a row in `/admin/staff`, and both writes on this
 * screen change it (ADR-0034 §Invalidation, amended D3.7 and D3.9).
 *
 * The rule's own test is "does the response of any cached query change because
 * of this write?", and for a profile edit it plainly does: the names on the
 * staff row are the ones just changed, and a password change stamps `updatedAt`
 * on the same row — the exact sibling case the D3.7 amendment says invalidates.
 *
 * **It lives in the feature because that is the layer allowed to see both
 * entities.** ADR-0032 lets an entity import from `shared` and nowhere else, so
 * `entities/profile` genuinely cannot reach `staffKeys` — but a *feature* may
 * import any entity slice, and this one already composes the profile's hooks.
 * A cross-entity invalidation vocabulary would be a decision; this is three
 * lines at the layer the dependency rule already permits.
 *
 * The `all` prefix rather than `lists()` plus `detail(id)`: it is one row, only
 * *active* queries refetch, and no staff query is mounted on this screen — so
 * the precise version would buy nothing and cost the id.
 */
export const useInvalidateOwnStaffRow = (): (() => void) => {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: staffKeys.all });
  }, [queryClient]);
};
