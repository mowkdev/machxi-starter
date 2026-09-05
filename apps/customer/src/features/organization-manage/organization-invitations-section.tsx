import { zodResolver } from "@hookform/resolvers/zod";
import {
  createInvitationBody,
  type CreateInvitationBody,
  type InvitationResource,
  type OrganizationResource,
} from "@repo/contracts";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";

import {
  InvitationFormInput,
  invitationFields,
  useInviteToOrganization,
  useOrganizationInvitations,
  useRevokeInvitation,
} from "@/entities/organization";
import { AppFormDialog } from "@/shared/form/app-form-dialog";
import {
  applyServerErrors,
  schemaFieldRules,
} from "@/shared/form/server-errors";
import { dateTimeFormat, useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

/**
 * An organization's pending invitations, and the surface that creates one
 * (ADR-0067 §2, §6).
 *
 * **This is how a second member arrives**, and it is the operator's choice at
 * scoping rather than the recommendation: staff adding members is the admin
 * segment's path, and on this one an owner or an admin names an *address*.
 * Naming an address and not an account is what makes the flow enumeration-safe
 * by construction (ADR-0020 §Enumeration) — creating an invitation looks no
 * user up, so it cannot answer differently for an address that has an account.
 *
 * **No email is sent, and the section says so** (`invitations.description`).
 * D15 ships the flow without the delivery: the row is minted with its token and
 * nothing reads it, and the mail deliverable fills one marked call. A surface
 * that implied a message had gone out would be the client lying about the
 * system on the system's behalf.
 *
 * The whole section is behind `owner` or `admin`, which is where the API puts
 * all three routes; the settings page decides whether to mount it at all, so
 * this component never renders a control it knows would be refused.
 */

const INVITATIONS_QUERY = {
  offset: 0,
  limit: 50,
  sort: [{ field: "createdAt", direction: "desc" }],
  filters: [],
  count: true,
} as const;

/**
 * An instant in the app's locale and the customer's timezone (ADR-0046 §5).
 *
 * A module constant because `dateTimeFormat` caches on its argument, and an
 * object built inline would key that cache on a fresh identity every render.
 * The formatter is resolved per call rather than captured, which is what makes
 * a locale switch move these dates without a reload.
 */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

const day = (value: string): string =>
  dateTimeFormat(DATE_OPTIONS).format(new Date(value));

const InviteDialog = ({
  onClose,
  organizationId,
}: {
  readonly onClose: () => void;
  readonly organizationId: string;
}) => {
  const { t } = useT("organizations");
  const invite = useInviteToOrganization(organizationId);
  const messageForError = useMessageForError();

  const form = useForm<CreateInvitationBody>({
    resolver: zodResolver(createInvitationBody),
    defaultValues: { email: "", role: "member" },
    disabled: invite.isPending,
  });

  const onSubmit = async (values: CreateInvitationBody) => {
    try {
      await invite.mutateAsync(values);
      form.reset();
      onClose();
    } catch (error) {
      applyServerErrors(error, form.setError, {
        /*
         * `ORGANIZATION_INVITATION_PENDING` is a `409` with no `details` — the
         * conflict is about the address rather than about a zod issue — and the
         * question it answers is "which box do I change?".
         */
        codeFields: { ORGANIZATION_INVITATION_PENDING: "email" },
        fields: Object.keys(invitationFields),
        messageForError,
        rules: schemaFieldRules(createInvitationBody, form.getValues()),
      });
    }
  };

  return (
    <AppFormDialog
      description={t("invitations.invite.description")}
      fields={invitationFields}
      form={form}
      isPending={invite.isPending}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={onSubmit}
      open
      submitLabel={t("invitations.invite.submit")}
      title={t("invitations.invite.title")}
      /*
       * `action` and not `create`: an invitation is a sub-resource with its own
       * lifetime rather than an attribute of the organization, which is the
       * same line `changePasswordFields` sits on with respect to the profile
       * (ADR-0035's variants, amended at `D3.7`).
       */
      variant="action"
    >
      <InvitationFormInput fieldName="email" />
      <InvitationFormInput fieldName="role" />
    </AppFormDialog>
  );
};

export const OrganizationInvitationsSection = ({
  organization,
}: {
  readonly organization: OrganizationResource;
}) => {
  const { t } = useT("organizations");
  const { t: tCommon } = useT("common");

  const invitations = useOrganizationInvitations(
    organization.id,
    INVITATIONS_QUERY,
  );
  const revoke = useRevokeInvitation(organization.id);

  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<InvitationResource | null>(null);

  const onRevoke = useCallback(() => {
    if (revoking === null) return;

    revoke.mutate(revoking.id, {
      onSuccess: () => {
        setRevoking(null);
      },
    });
  }, [revoke, revoking]);

  const rows = invitations.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("invitations.title")}</CardTitle>
        <CardDescription>{t("invitations.description")}</CardDescription>
        <CardAction>
          <Button
            onClick={() => {
              setInviting(true);
            }}
            variant="outline"
          >
            {t("invitations.invite.action")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invitations.columns.email")}</TableHead>
              <TableHead>{t("invitations.columns.role")}</TableHead>
              <TableHead>{t("invitations.columns.expires")}</TableHead>
              <TableHead className="text-end">
                {t("invitations.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.isError ? (
              // The failed-read branch every list in this app carries: an empty
              // table and a failed one look identical, and only one of them is
              // news (`D15.4`'s finding).
              <TableRow>
                <TableCell colSpan={4}>{t("invitations.error")}</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>{t("invitations.empty")}</TableCell>
              </TableRow>
            ) : (
              rows.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-mono">
                    {invitation.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {t(`members.role.${invitation.role}` as const)}
                    </Badge>
                  </TableCell>
                  <TableCell>{day(invitation.expiresAt)}</TableCell>
                  <TableCell className="text-end">
                    <Button
                      disabled={revoke.isPending}
                      onClick={() => {
                        setRevoking(invitation);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {t("invitations.revoke.action")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {inviting ? (
        <InviteDialog
          onClose={() => {
            setInviting(false);
          }}
          organizationId={organization.id}
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        open={revoking !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("invitations.revoke.title", {
                email: revoking?.email ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("invitations.revoke.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={(event) => {
                event.preventDefault();
                onRevoke();
              }}
            >
              {t("invitations.revoke.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
