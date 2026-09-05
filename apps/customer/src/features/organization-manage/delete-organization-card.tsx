import type { OrganizationResource } from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { useDeleteOrganization } from "@/entities/organization";
import { useT } from "@/shared/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

/**
 * `DELETE /user/orgs/:orgId` — an owner removing a tenant (ADR-0067 §2).
 *
 * **An owner, never an admin**: deleting the tenant is the one thing ownership
 * does not delegate, which is why the route carries `requireMembership("owner")`
 * and the settings screen mounts this card only for an owner.
 *
 * **A personal organization refuses it outright**, and the card says so instead
 * of offering a button that answers `409`: exactly one exists per account, it is
 * soft-deleted inside the account's own deletion, and there is no state in which
 * pressing this would have worked. The card still renders, because "you cannot
 * delete this one and here is why" is information a customer who came looking
 * for the control needs.
 *
 * The deletion is soft on the server — the row is hidden and the address is
 * released — and from here it is simply gone, which is why this navigates out
 * of the organization it just removed rather than leaving the browser on a slug
 * that no longer resolves.
 */
export const DeleteOrganizationCard = ({
  organization,
}: {
  readonly organization: OrganizationResource;
}) => {
  const { t } = useT("organizations");
  const { t: tCommon } = useT("common");
  const navigate = useNavigate();
  const deleteOrganization = useDeleteOrganization(organization.id);

  const [confirming, setConfirming] = useState(false);
  const isPersonal = organization.kind === "personal";

  const onDelete = useCallback(() => {
    deleteOrganization.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        void navigate({ to: "/" });
      },
    });
  }, [deleteOrganization, navigate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("danger.title")}</CardTitle>
        <CardDescription>{t("danger.description")}</CardDescription>
        {isPersonal ? null : (
          <CardAction>
            {/*
             * The one destructive control on this screen. The warning is
             * carried by the button that opens the ceremony and by the
             * dialog's copy — the account area's deletion card sets the same
             * pattern, for the same reason.
             */}
            <Button
              onClick={() => {
                setConfirming(true);
              }}
              variant="destructive"
            >
              {t("danger.action")}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground">
          {isPersonal ? t("danger.personalNote") : t("danger.description")}
        </p>
      </CardContent>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
        open={confirming}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("danger.confirmTitle", { name: organization.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("danger.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteOrganization.isPending}
              onClick={(event) => {
                // Closing is `onSuccess`'s, so a refusal leaves the dialog open
                // with the toast beside it rather than vanishing on a failure.
                event.preventDefault();
                onDelete();
              }}
            >
              {t("danger.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
