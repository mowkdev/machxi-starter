import {
  ORGANIZATION_ROLES,
  type MembershipResource,
  type OrganizationResource,
  type OrganizationRole,
} from "@repo/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import {
  useLeaveOrganization,
  useOrganizationMembers,
  useRemoveOrganizationMember,
  useSetOrganizationMemberRole,
} from "@/entities/organization";
import { useSession } from "@/shared/api/context";
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
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

/**
 * The members of one organization, on its settings screen (ADR-0067 §4, §6).
 *
 * **A plain table and not `@repo/grid`**, which ADR-0055 §5 keeps for the first
 * domain entity: a grid is URL state, preferences, a column control, selection
 * and a pager, and a members list is one organization's handful of people. The
 * admin's copy of this section made the same call for the same reason.
 *
 * **What the caller may do is read off their own membership**, which the API put
 * on the resource for exactly this (`OrganizationResource.role`): an owner moves
 * roles, an owner or an admin removes somebody, and anybody may leave. **The API
 * remains the authority** — every one of those is a guard on the route
 * (`organizations.routes.ts`) and this app mounts no policy table at all
 * (ADR-0055 §3) — so what the role decides here is only whether a control that
 * would certainly be refused is offered at all.
 *
 * **Removal and leaving are one endpoint and two interactions.** The API keeps
 * them one write with one invariant, the last owner being refused either way;
 * the difference is that the person leaving loses the screen they are standing
 * on, which is why this section has two confirmations and two hooks.
 */

/** The one page this section asks for. Small by nature (ADR-0060's altitude). */
const MEMBERS_QUERY = {
  offset: 0,
  limit: 50,
  sort: [{ field: "createdAt", direction: "desc" }],
  filters: [],
  count: true,
} as const;

/** What a row is called when the account has no name on it (ADR-0017). */
const displayName = (member: MembershipResource): string =>
  [member.firstName, member.lastName].filter(Boolean).join(" ").trim() ||
  member.email;

export const OrganizationMembersSection = ({
  organization,
}: {
  readonly organization: OrganizationResource;
}) => {
  const { t } = useT("organizations");
  // A second binding rather than a prefixed key: `useT` types keys against the
  // namespace it was given, so `common:` from this one is not a key at all.
  const { t: tCommon } = useT("common");
  const navigate = useNavigate();
  const { principal } = useSession();

  /*
   * The caller's own id, which two things on this table turn on: which row is
   * marked "You" and offered Leave rather than Remove, and which id the leave
   * removes. It is nullable in the session snapshot (`AppSidebar` says why), so
   * it is read once and every use of it is guarded rather than defaulted — a
   * review finding: an empty-string fallback here builds `.../members/` and
   * puts a malformed path one refactor away.
   */
  const principalId = principal?.id;

  const members = useOrganizationMembers(organization.id, MEMBERS_QUERY);
  const setRole = useSetOrganizationMemberRole(organization.id);
  const removeMember = useRemoveOrganizationMember(organization.id);
  const leave = useLeaveOrganization(organization.id);

  const [removing, setRemoving] = useState<MembershipResource | null>(null);
  const [leaving, setLeaving] = useState(false);

  const mayMoveRoles = organization.role === "owner";
  const mayRemoveOthers =
    organization.role === "owner" || organization.role === "admin";

  const onRemove = useCallback(() => {
    if (removing === null) return;

    removeMember.mutate(removing.userId, {
      onSuccess: () => {
        setRemoving(null);
      },
    });
  }, [removeMember, removing]);

  const onLeave = useCallback(() => {
    if (principalId === undefined) return;

    leave.mutate(principalId, {
      onSuccess: () => {
        setLeaving(false);
        /*
         * Out of the organization that was just left, and to the signed-in
         * home rather than to another one: which organization to land in is a
         * choice this app has no basis to make for somebody, and the switcher
         * is one click away on the screen they arrive at.
         */
        void navigate({ to: "/" });
      },
    });
  }, [leave, navigate, principalId]);

  const rows = members.data?.items ?? [];
  const pending =
    setRole.isPending || removeMember.isPending || leave.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("members.title")}</CardTitle>
        <CardDescription>{t("members.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("members.columns.name")}</TableHead>
              <TableHead>{t("members.columns.email")}</TableHead>
              <TableHead>{t("members.columns.role")}</TableHead>
              <TableHead className="text-end">
                {t("members.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isError ? (
              /*
               * Not `members.empty`, and the distinction is `D15.4`'s review
               * finding carried across the segment: a `404` from an
               * organization somebody just left, a `5xx` or a dropped
               * connection would otherwise render as "this organization has
               * nobody in it" — a silent failure the client manufactured.
               */
              <TableRow>
                <TableCell colSpan={4}>{t("members.error")}</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>{t("members.empty")}</TableCell>
              </TableRow>
            ) : (
              rows.map((member) => {
                const isSelf = member.userId === principalId;

                return (
                  <TableRow key={member.userId}>
                    <TableCell>
                      {displayName(member)}
                      {isSelf ? (
                        <Badge className="ml-2" variant="outline">
                          {t("members.you")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono">{member.email}</TableCell>
                    <TableCell>
                      {mayMoveRoles ? (
                        <Select
                          disabled={pending}
                          onValueChange={(role) => {
                            setRole.mutate({
                              role: role as OrganizationRole,
                              userId: member.userId,
                            });
                          }}
                          value={member.role}
                        >
                          <SelectTrigger
                            aria-label={t("members.changeRole.action")}
                            size="sm"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ORGANIZATION_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {t(`members.role.${role}` as const)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">
                          {t(`members.role.${member.role}` as const)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {isSelf ? (
                        <Button
                          disabled={pending}
                          onClick={() => {
                            setLeaving(true);
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {t("members.leave.action")}
                        </Button>
                      ) : mayRemoveOthers ? (
                        <Button
                          disabled={pending}
                          onClick={() => {
                            setRemoving(member);
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {t("members.remove.action")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={removing !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("members.remove.title", {
                name: removing === null ? "" : displayName(removing),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("members.remove.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMember.isPending}
              onClick={(event) => {
                // The dialog closes on its own action and the mutation has to
                // outlive it: closing is `onSuccess`'s, so a refusal —
                // `ORGANIZATION_LAST_OWNER`, most of all — leaves the dialog
                // open with the toast beside it.
                event.preventDefault();
                onRemove();
              }}
            >
              {t("members.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setLeaving(false);
        }}
        open={leaving}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("members.leave.title", { name: organization.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("members.leave.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={leave.isPending}
              onClick={(event) => {
                event.preventDefault();
                onLeave();
              }}
            >
              {t("members.leave.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
