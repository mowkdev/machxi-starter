import { useState } from "react";

import {
  useAcceptInvitation,
  useDeclineInvitation,
  useMyInvitations,
} from "@/entities/organization";
import { dateTimeFormat, useT } from "@/shared/i18n";
import { Button, Separator, Skeleton, Spinner } from "@/shared/ui";

/**
 * The invitations addressed to the signed-in customer (`D15.5`, ADR-0067 §4).
 *
 * **Self-scoped, and that is why it is in the account area** rather than on an
 * organization's screen: what selects these rows is the caller's address, read
 * from their account and never from the request, and the caller is by
 * definition not a member of the organizations offering them. ADR-0053's rule
 * for sections is what places it — one `/account` family, one card per fact.
 *
 * **Accepting is what turns an offer into a membership**, and the organization
 * comes back with the `200` so the switcher has it without a second request
 * (the entity hook invalidates both lists). It deliberately does not navigate:
 * a customer may have been invited to several, and moving the page out from
 * under the second offer to celebrate the first is the surface deciding
 * something it was not asked.
 *
 * **Accepting is refused under impersonation and declining is not** (ADR-0067
 * §8): joining somebody's account to a third party's tenant is the takeover the
 * exclusion list exists to prevent, while ending an offer creates nothing. The
 * refusal is the API's — this app renders whatever code comes back through the
 * error catalogue, which is what `AUTH_IMPERSONATION_REFUSED` is for.
 */

/** An instant in the app's locale and the customer's timezone (ADR-0046 §5). */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

const day = (value: string): string =>
  dateTimeFormat(DATE_OPTIONS).format(new Date(value));

export const InvitationInbox = () => {
  const { t } = useT("organizations");
  const invitations = useMyInvitations();
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();

  /*
   * Which row is being answered, so the spinner appears on the offer the
   * customer actually clicked. Every button disables while any answer is in
   * flight — two offers answered at once is two writes racing over the same
   * switcher list — and this is what keeps the disabled state from being the
   * only feedback.
   */
  const [acting, setActing] = useState<string | null>(null);

  const rows = invitations.data ?? [];
  const pending = accept.isPending || decline.isPending;

  if (invitations.isError)
    // Not `inbox.empty`: an account with no invitations and a failed read look
    // identical, and only one of them is news (`D15.4`'s finding).
    return <p className="text-sm text-muted-foreground">{t("inbox.error")}</p>;

  if (invitations.isPending)
    return (
      <div aria-hidden className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );

  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">{t("inbox.empty")}</p>;

  return (
    <ul className="flex flex-col gap-4">
      {rows.map((invitation, index) => (
        <li className="flex flex-col gap-4" key={invitation.id}>
          {index === 0 ? null : <Separator />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">
                {invitation.organizationName}
              </span>
              {/* Two spans rather than one with a separator character between
                  them: a punctuation literal in JSX is still a literal, and
                  the sentence a locale wants between two facts is not this
                  component's to choose (ADR-0046 §8). */}
              <span className="text-xs text-muted-foreground">
                {t("inbox.invitedAs", {
                  role: t(`members.role.${invitation.role}` as const),
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("inbox.expires", { date: day(invitation.expiresAt) })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                disabled={pending}
                onClick={() => {
                  setActing(invitation.id);
                  decline.mutate(invitation.id);
                }}
                variant="ghost"
              >
                {t("inbox.decline")}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setActing(invitation.id);
                  accept.mutate(invitation.id);
                }}
              >
                {acting === invitation.id && accept.isPending ? (
                  <Spinner />
                ) : null}
                {t("inbox.accept")}
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
};
