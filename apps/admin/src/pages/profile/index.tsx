import { useState } from "react";

import { useProfile } from "@/entities/profile";
import {
  ChangePasswordDialog,
  ProfileDetailsForm,
} from "@/features/profile-manage";
import { RolesList, StatusBadge } from "@/shared/grid/cells";
import { dateTime } from "@/shared/grid/formatters";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  QueryError,
  Separator,
  Skeleton,
} from "@/shared/ui";

/**
 * The caller's own account (`D3.9`; ADR-0027, ADR-0035).
 *
 * Thin composition, as a page must be (ADR-0032): one entity query, two
 * features, and the arrangement between them. Everything it renders is
 * `GET /admin/profile` — **not** the principal in the session store. The two
 * agree today and are not the same thing: the store holds session identity,
 * refreshed at session boundaries, while this is the account read fresh, and it
 * is the only source that carries `status`, `lastLoginAt` and `createdAt` at
 * all (ADR-0033 §The session store).
 *
 * The split between the two cards is ADR-0027's, not a layout preference. Names
 * are an attribute of the account and go on a form over `PATCH /profile`; a
 * password is an action with side effects on every device the operator owns,
 * which is why it is a sub-resource on the API and why it gets its own card,
 * its own copy about what it does, and a dialog rather than a box on this form.
 */

const Summary = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

export const ProfilePage = () => {
  const profile = useProfile();
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>
            Your name is the only thing you can change here. Email, roles and
            status are somebody else&apos;s to set — an operator who could
            promote themselves would not need the guard that stops them.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {profile.data === undefined && profile.error !== null ? (
            /*
             * The panel ADR-0034 requires wherever a silent query renders
             * (amended D3.7): this screen has no table for it to sit inside,
             * so it takes the place of the summary itself.
             */
            <QueryError
              error={profile.error}
              onRetry={() => {
                void profile.refetch();
              }}
            />
          ) : profile.data === undefined ? (
            <div className="flex flex-col gap-4" aria-hidden>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <Summary label="Email">{profile.data.email}</Summary>
                {/*
                 * The grid's own renderers, not a second pair (D3.9 review).
                 * They are resource-agnostic by ADR-0035's rule — `statusBadge`
                 * colours an enum label, `rolesList` renders string badges, and
                 * neither knows what a staff member is — so a screen with no
                 * table on it is still entitled to the vocabulary. The
                 * hand-rolled version this replaces had already drifted:
                 * `invited` read destructive here and secondary in the grid.
                 */}
                <Summary label="Status">
                  <StatusBadge value={profile.data.status} />
                </Summary>
                <Summary label="Roles">
                  <RolesList value={profile.data.roles} />
                </Summary>
                <Summary label="Last sign-in">
                  {/* This session's own sign-in, so it is never `null` here —
                      the formatter still handles it, because the type says it
                      can be and a page is not the place to argue with a
                      contract. */}
                  {dateTime(profile.data.lastLoginAt)}
                </Summary>
              </dl>

              <Separator className="my-6" />

              <ProfileDetailsForm profile={profile.data} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing it signs out every other session and leaves this one signed
            in.
          </CardDescription>
          <CardAction>
            <Button
              onClick={() => {
                setChangingPassword(true);
              }}
              variant="outline"
            >
              Change password
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-muted-foreground">
            {/*
             * ADR-0027 §Staff self-service, stated where it is felt rather than
             * left for an operator to discover: the current password is
             * required even though this browser holds a valid session, the
             * other sessions end because ending them is what a password change
             * is for, and this one survives because it is the one already
             * proven to belong to whoever is typing.
             */}
            You will be asked for your current password. Your other devices stay
            signed out until they use the new one.
          </p>
        </CardContent>
      </Card>

      {changingPassword ? (
        <ChangePasswordDialog
          onClose={() => {
            setChangingPassword(false);
          }}
        />
      ) : null}
    </div>
  );
};
