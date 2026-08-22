import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createUserApi, userKeys } from "@/entities/user";
import { runBulkAction, type BulkTarget } from "@/shared/api/bulk-outcome";
import { useApiClient } from "@/shared/api/context";
import { useT } from "@/shared/i18n";
import { summariseBulk } from "@/shared/notifications/bulk-summary";
import { useMessageForError } from "@/shared/notifications/messages";
import { toast } from "@/shared/ui";

/**
 * The users fan-out (ADR-0038), the staff one with two identifiers changed —
 * and **not shared with it**, because ADR-0032 allows no sideways import
 * between features. What the two genuinely share is in `shared/api`:
 * `summariseBulkOutcome` and the `BulkTarget` shape. What differs is what
 * should differ — the endpoint, and the sentence a refusal is reported with.
 *
 * The refusal codes differ too, which is the point of surfacing them per item:
 * a soft-deleted account answers `409 USER_DELETED` to a repeat delete
 * (ADR-0028), where the staff fan-out meets the rank rule and
 * `STAFF_LAST_SUPER_ADMIN`. Neither is pre-guessed here — the API refuses and
 * the ADR-0034 map supplies the sentence.
 */
export const useBulkDeleteUsers = () => {
  const api = createUserApi(useApiClient());
  const queryClient = useQueryClient();
  const { t } = useT("grid");
  const messageForError = useMessageForError();

  return useMutation({
    mutationFn: (targets: readonly BulkTarget[]) =>
      runBulkAction(targets, (id) => api.remove(id), messageForError),
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });

      const { tone, headline, description } = summariseBulk(
        outcome,
        "user account",
        t,
      );

      toast[tone](headline, description === undefined ? {} : { description });
    },
  });
};
