import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createStaffApi, staffKeys } from "@/entities/staff";
import { runBulkAction, type BulkTarget } from "@/shared/api/bulk-outcome";
import { useApiClient } from "@/shared/api/context";
import { summariseBulk } from "@/shared/notifications/bulk-summary";
import { toast } from "@/shared/ui";

/**
 * Bulk delete as a client-side fan-out (ADR-0038 §Bulk delete).
 *
 * **`Promise.allSettled` over the existing per-row `DELETE /admin/staff/:id`,
 * and this changes nothing in `apps/api`.** The API offers no bulk endpoint and
 * that is not an omission: ADR-0028's deletion rules are per-row — the rank
 * rule, the last-super-admin invariant and the self-delete refusal are facts
 * about *one* row and *this* actor — so a transactional bulk delete would have
 * to invent all-or-nothing semantics the domain does not want. Eight lawful
 * deletions rolled back because a ninth was refused is a worse answer than
 * eight done and one explained.
 *
 * **The fan-out calls the plain API functions, not N mutation hooks**
 * (ADR-0034's hook/function split earning its keep), so there is exactly one
 * invalidation after everything settles rather than N refetch storms, and
 * exactly one outcome to report.
 *
 * **The summary toast is a named exception to ADR-0034's "no per-callsite
 * `toast()`"**, carried by ADR-0038 and scoped to aggregate outcomes: a mixed
 * result has no static wording, so it cannot ride `meta.success`. The *policy*
 * is untouched — every refusal sentence still comes from the one `ErrorCode`
 * map, and this composes them rather than writing any. If a second aggregate
 * operation ever appears, the `meta` typing should learn a summary shape and
 * this exception should be folded back into the convention.
 *
 * **The cost, stated:** N requests against the global limiter
 * (`300 / 15 min / IP`, ADR-0020) — fine at admin scale, where a selection is
 * tens of rows rather than thousands. A server-side bulk endpoint is the
 * recorded alternative and belongs to a future API deliverable.
 */
export const useBulkDeleteStaff = () => {
  const api = createStaffApi(useApiClient());
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targets: readonly BulkTarget[]) =>
      runBulkAction(targets, (id) => api.remove(id)),
    /*
     * No `meta.success`: the sentence is composed below, from what happened.
     * `errorToast` stays on, and it is not dead — `allSettled` never rejects,
     * so the only way here is the summary itself throwing, which is a bug and
     * should be visible rather than silent.
     */
    onSuccess: (outcome) => {
      /*
       * One invalidation, at the entity root rather than at `lists()`: the
       * deleted rows' `detail(id)` entries are as stale as the pages that held
       * them, and one prefix covers both. Every per-row mutation invalidates
       * the same two prefixes; this is the same rule with the loop moved.
       */
      void queryClient.invalidateQueries({ queryKey: staffKeys.all });

      // Staff are hard-deleted (ADR-0028), which is why the noun is this one's
      // and not the shared summariser's.
      const { tone, headline, description } = summariseBulk(
        outcome,
        "staff account",
      );

      toast[tone](headline, description === undefined ? {} : { description });
    },
  });
};
