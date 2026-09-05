import type { OrganizationResource } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { useRecordNavigation } from "@/shared/grid/record-navigation";
import type { RowAction } from "@/shared/grid/types";
import { useT } from "@/shared/i18n";
import type { GridCapabilities } from "@/shared/resource/types";

import type { OrganizationActionHandler } from "./types";

/**
 * The row menu, as data the grid reads through `table.options.meta`
 * (ADR-0035 §Row actions).
 *
 * The split this exists to keep: the entity's config says *there is an actions
 * column*, this feature says *what the actions do*, and neither knows about the
 * other. That is what keeps the config free of functions and therefore
 * diffable, mergeable and snapshottable.
 *
 * **The menu speaks two languages** (ADR-0040): `edit` is a *navigation* — it
 * puts the record in the URL, so the surface it opens is reload-restorable and
 * Back closes it — while `delete` reports through `onAction` into the page's own
 * state, because a destruction prompt must not be deep-linkable.
 *
 * **Nothing here is disabled by a rule the API owns.** `RowAction.isDisabled`
 * exists and is deliberately unused: whether this row may be deleted depends on
 * state this app does not hold. Offering the action and rendering the server's
 * answer is honest; greying out one case and silently mishandling the rest is
 * not (ADR-0042).
 */
export const useOrganizationRowActions = (
  onAction: OrganizationActionHandler,
  /*
   * Required, and explicitly nullable rather than optional. With
   * `capabilities?` a call site that forgot the argument would silently drop
   * every gated action — which is the failure direction ADR-0042 calls the
   * worse one, made the default behaviour of a typo. `| undefined` keeps "this
   * resource declares nothing" expressible.
   */
  capabilities: GridCapabilities | undefined,
): readonly RowAction<OrganizationResource>[] => {
  const { t } = useT("organizations");
  const navigate = useNavigate();
  const { openState } = useRecordNavigation();

  return useMemo(() => {
    const actions: RowAction<OrganizationResource>[] = [];

    if (capabilities?.canEdit === true)
      actions.push({
        key: "edit",
        label: t("actions.edit"),
        onSelect: (organization) => {
          /*
           * The record's URL is the record's alone (ADR-0044): the list's page
           * and filters ride along as **history state**, so closing returns the
           * operator to the view they were reading and "look at this one" is a
           * link to a record.
           */
          void navigate({
            to: "/organizations/$organizationId",
            params: { organizationId: organization.id },
            state: openState,
          });
        },
      });

    if (capabilities?.canDelete === true)
      actions.push({
        key: "delete",
        label: t("actions.delete"),
        destructive: true,
        onSelect: (organization) => {
          onAction({ kind: "delete", organization });
        },
      });

    return actions;
  }, [capabilities, navigate, onAction, openState, t]);
};
