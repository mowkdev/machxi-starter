import {
  ORGANIZATION_ROLES,
  type MembershipResource,
  type OrganizationRole,
} from "@repo/contracts";
import { useCallback, useState } from "react";

import {
  useAddOrganizationMember,
  useOrganizationMembers,
  useRemoveOrganizationMember,
  useSetOrganizationMemberRole,
} from "@/entities/organization";
import { useCan } from "@/shared/auth";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
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
 * The members of one organization, on its record page (ADR-0067 §3, ADR-0044).
 *
 * **The first record surface in this app with a sub-resource**, and it is
 * deliberately not a second grid. `@repo/grid` is a screen's worth of
 * machinery — URL state, preferences, a column control, selection, a pager —
 * and a members list is one organization's handful of people beside the form
 * that names it. A grid here would put a second set of list params in a URL
 * that ADR-0044 says carries only the record.
 *
 * So it is a plain table with four operations and no fifth: list, add by user
 * id, change a role, remove. The API offers exactly those on the sub-resource
 * (`D15.3`), and the section offers exactly those — the boundary is the same
 * on both sides rather than a subset somebody has to keep in step.
 *
 * `can("update", "organizations")` gates all three writes together, which is
 * the policy row's own shape: the sub-resource's routes carry the same
 * `authorize("admin")` as the resource's writes, so a manager reads this table
 * and touches nothing in it (ADR-0042, ADR-0067 §3).
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
  organizationId,
}: {
  readonly organizationId: string;
}) => {
  const { t } = useT("organizations");
  // A second binding rather than a prefixed key: `useT` types keys against the
  // namespace it was given, so `common:` from this one is not a key at all.
  const { t: tCommon } = useT("common");
  const can = useCan();
  const mayWrite = can("update", "organizations");

  const members = useOrganizationMembers(organizationId, MEMBERS_QUERY);
  const addMember = useAddOrganizationMember(organizationId);
  const setRole = useSetOrganizationMemberRole(organizationId);
  const removeMember = useRemoveOrganizationMember(organizationId);

  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState("");
  const [newRole, setNewRole] = useState<OrganizationRole>("member");
  const [removing, setRemoving] = useState<MembershipResource | null>(null);

  const closeAdd = useCallback(() => {
    setAdding(false);
    setUserId("");
    setNewRole("member");
  }, []);

  const onAdd = useCallback(() => {
    addMember.mutate({ userId, role: newRole }, { onSuccess: closeAdd });
  }, [addMember, userId, newRole, closeAdd]);

  const onRemove = useCallback(() => {
    if (removing === null) return;

    removeMember.mutate(removing.userId, {
      onSuccess: () => {
        setRemoving(null);
      },
    });
  }, [removeMember, removing]);

  const rows = members.data?.items ?? [];
  const pending =
    addMember.isPending || setRole.isPending || removeMember.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("members.title")}</CardTitle>
        <CardDescription>{t("members.description")}</CardDescription>
        {mayWrite ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t("members.add.action")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("members.columns.name")}</TableHead>
              <TableHead>{t("members.columns.email")}</TableHead>
              <TableHead>{t("members.columns.role")}</TableHead>
              {mayWrite ? (
                <TableHead className="text-end">
                  {t("members.remove.action")}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isError ? (
              /*
               * Not `members.empty`, which is the finding this branch exists
               * for: a `404` from a concurrently deleted organization, a `5xx`
               * or a dropped connection would otherwise render as "this
               * organization has no members" — a silent failure manufactured
               * by the client, which is exactly what ADR-0042 calls worse than
               * the defect it was written to remove.
               */
              <TableRow>
                <TableCell colSpan={mayWrite ? 4 : 3}>
                  {tCommon("record.errorTitle")}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={mayWrite ? 4 : 3}>
                  {t("members.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>{displayName(member)}</TableCell>
                  <TableCell className="font-mono">{member.email}</TableCell>
                  <TableCell>
                    {mayWrite ? (
                      <Select
                        value={member.role}
                        disabled={pending}
                        onValueChange={(role) => {
                          setRole.mutate({
                            userId: member.userId,
                            role: role as OrganizationRole,
                          });
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={t("members.changeRole.action")}
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
                  {mayWrite ? (
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setRemoving(member);
                        }}
                      >
                        {t("members.remove.action")}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!open) closeAdd();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("members.add.title")}</DialogTitle>
            <DialogDescription>
              {t("members.add.description")}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="member-user-id">
              {t("members.add.userId")}
            </FieldLabel>
            <Input
              id="member-user-id"
              value={userId}
              disabled={addMember.isPending}
              onChange={(event) => {
                setUserId(event.target.value);
              }}
            />
            <FieldDescription>
              {t("members.add.userIdDescription")}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="member-role">
              {t("members.add.role")}
            </FieldLabel>
            <Select
              value={newRole}
              disabled={addMember.isPending}
              onValueChange={(role) => {
                setNewRole(role as OrganizationRole);
              }}
            >
              <SelectTrigger id="member-role">
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
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={closeAdd}>
              {tCommon("actions.cancel")}
            </Button>
            <Button
              onClick={onAdd}
              disabled={userId.trim() === "" || addMember.isPending}
            >
              {t("members.add.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
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
              onClick={(event) => {
                // The dialog closes on its own action, and the mutation has to
                // outlive it: closing is `onSuccess`'s, so a refusal leaves the
                // dialog open with the toast beside it.
                event.preventDefault();
                onRemove();
              }}
              disabled={removeMember.isPending}
            >
              {t("members.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
