import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createOrganizationsApi,
  organizationsKeys,
} from "@/entities/organization";
import { runBulkAction, type BulkTarget } from "@/shared/api/bulk-outcome";
import { useApiClient } from "@/shared/api/context";
import { summariseBulk } from "@/shared/grid/bulk-summary";
import { useKeyT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import { toast } from "@/shared/ui";

/**
 * Bulk delete as a client-side fan-out (ADR-0038 §Bulk delete).
 *
 * **`Promise.allSettled` over the existing per-row `DELETE /organizations/:id`, and
 * this needs nothing in `apps/api`.** Deletion rules are per row — facts about
 * *one* row and *this* actor — so a transactional bulk delete would have to
 * invent all-or-nothing semantics the domain does not want. Eight lawful
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
 * map, and this composes them rather than writing any.
 *
 * **The cost, stated:** N requests against the global limiter (ADR-0020) — fine
 * at admin scale, where a selection is tens of rows rather than thousands.
 */
export const useBulkDeleteOrganizations = () => {
  const api = createOrganizationsApi(useApiClient());
  const queryClient = useQueryClient();
  const t = useKeyT();
  const messageForError = useMessageForError();

  return useMutation({
    mutationFn: (targets: readonly BulkTarget[]) =>
      runBulkAction(targets, (id) => api.remove(id), messageForError),
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
       * them, and one prefix covers both.
       */
      void queryClient.invalidateQueries({ queryKey: organizationsKeys.all });

      const { tone, headline, description } = summariseBulk(
        outcome,
        "organizations:noun",
        t,
      );

      toast[tone](headline, description === undefined ? {} : { description });
    },
  });
};
