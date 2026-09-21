import { Link, useRouteContext } from "@tanstack/react-router";

import { RegisterForm, useSignOut } from "@/features/auth";
import { useInvitationLink } from "@/features/invitation-link";

import { useT } from "@/shared/i18n";
import { useRouteTitle } from "@/shared/lib/route-meta";
import {
  AuthLayout,
  Button,
  Card,
  FieldError,
  Separator,
  Spinner,
} from "@/shared/ui";

/**
 * ADR-0054 §7's 38px rung, as every auth card spells it — deciding to join an
 * organization is the same size of decision as signing in, in the same card.
 */
const AUTH_CONTROL = "h-[38px] text-[13px]";

/**
 * Where a signed-out or wrongly-signed-in reader is sent, and what waits for
 * them there.
 *
 * **The account inbox rather than back here**, and the reason is the strike:
 * the token has already been taken out of the address bar by the time this
 * screen renders, so a `redirect` to this route would land on the dead-link
 * sentence. It does not need to come back — an invitation is addressed to an
 * **address**, and `/account/invitations` lists every offer made to the one
 * the caller signs in with (ADR-0067 §4). Acceptance by address match is safe
 * because ADR-0071 §3 made every `active` account's address proven, which is
 * the exposure `D15.1` escalated and this deliverable closed.
 */
const INVITATION_INBOX = "/account/invitations";

/**
 * `/invitations/accept` — where the mailed invitation link lands
 * (ADR-0071 §5).
 *
 * **One screen and three landings, which is the decision this page is.** The
 * step names a stranger, an account holder and a mismatched address; they are
 * one offer read by three different sessions, and the API puts the link at
 * exactly this path (`MAIL_LINK_PATHS.acceptInvitation`) with no way of
 * knowing which of the three will open it. Splitting them would mean a route
 * that reads the token only to redirect — and a redirect that either carries
 * the credential in a URL or loses it.
 *
 * A page is thin composition (ADR-0049): the feature reads the link, spends
 * it and owns the five states; this renders the sentence each one has and the
 * one way forward it offers.
 *
 * **It composes `AuthLayout` itself rather than sitting under a layout
 * route**, which is `/verify-email`'s and `/reset-password`'s constraint and
 * not a preference — and here both halves of it bite at once, because this is
 * the one screen in the app that is *designed* to be opened in both states.
 * `_auth`'s mirror guard sends an authenticated visitor home, which is exactly
 * the person who can accept; `_dashboard`'s guard sends an anonymous one to
 * `/login`, which is exactly the person the register form is for — and a
 * fragment never survives that redirect, since it reaches no route's search
 * params.
 */
export const AcceptInvitationPage = () => {
  const { t } = useT("organizations");
  const { status, offer, signedInAs, joining, formError, accept, retry } =
    useInvitationLink();
  const { signOut, pending: signingOut } = useSignOut();
  /*
   * The same flag `/register`'s `beforeLoad` reads, and for its reason
   * (`D18.8`, `security-reviewer`). With self-registration off that address
   * does not exist and `POST /public/auth/register` answers `404`, so a
   * sign-up card drawn here would be the one screen in the app that re-opens
   * a disabled affordance — a stranger would fill it in and meet a generic
   * refusal. The API is still the control; this is the client echoing it.
   *
   * From the **router context** rather than from `shared/config`, which is
   * `/register`'s arrangement: the flag is a parameter of the router so a test
   * can build the app both ways (`app/providers/router.tsx`).
   */
  const { features } = useRouteContext({ from: "/invitations/accept" });
  /*
   * The fallback is the same key the route declares, which is `_auth.tsx`'s
   * shape too: the hook's parameter is required, and a screen that is its own
   * shell always matches a route that declares one, so the fallback is
   * unreachable here rather than a second place the copy lives.
   */
  const title = useRouteTitle("organizations:link.title");

  return (
    <AuthLayout description={undefined} title={title}>
      <Card className="flex flex-col gap-4 p-5">
        {/*
         * The pending sentence is a status and the two failures below are
         * alerts (`D28.8`, the review's `FE-11`): each replaces the last
         * without a navigation, so a screen reader hears the change only if
         * the node says what kind of change it is. The spinner is hidden from
         * it here — the sentence beside it already says the same thing, and a
         * second status inside the first would be read twice.
         */}
        {status === "pending" ? (
          <p
            className="flex items-center gap-2 text-[14px] leading-5 text-muted-foreground"
            role="status"
          >
            <Spinner aria-hidden="true" />
            {t("link.pending")}
          </p>
        ) : null}

        {status === "refused" ? (
          <p
            className="text-[14px] leading-5 text-muted-foreground"
            role="alert"
          >
            {t("link.refused")}
          </p>
        ) : null}

        {/*
         * The check failed for a reason that is not the link's — the lookup's
         * source-keyed budget answering `429` above all, which behind one
         * office egress is a colleague's request and not the reader's. The
         * link is still held and still good, so the way forward is to ask
         * again rather than to have a working invitation revoked and replaced.
         */}
        {status === "unavailable" ? (
          <>
            {/*
             * One alert holding both sentences, the screen's and the
             * catalogue's for the code, rather than two alerts read in
             * whichever order the reader reaches them. So the code's sentence
             * is a plain paragraph in `FieldError`'s colour rather than a
             * `FieldError`, whose own `role="alert"` would nest a second one.
             */}
            <div className="flex flex-col gap-2" role="alert">
              <p className="text-[14px] leading-5 text-muted-foreground">
                {t("link.unavailable")}
              </p>
              {formError === null ? null : (
                <p className="text-sm text-destructive">{formError}</p>
              )}
            </div>
            <Button
              className={AUTH_CONTROL}
              onClick={retry}
              type="button"
              variant="outline"
            >
              {t("link.retry")}
            </Button>
          </>
        ) : null}

        {/*
         * The offer itself, on the three states that have read the link. One
         * sentence naming the organization and the role, because that is the
         * whole of what an invitation is — and the same sentence whoever is
         * reading it, since what differs between the three is only what can be
         * done next.
         */}
        {offer === undefined ? null : (
          <>
            <p className="text-[14px] leading-5">
              {t("link.offer", {
                organization: offer.organizationName,
                role: t(`members.role.${offer.role}` as const),
              })}
            </p>

            {status === "holder" ? (
              <>
                <Button
                  className={AUTH_CONTROL}
                  disabled={joining}
                  onClick={accept}
                  type="button"
                >
                  {joining ? <Spinner /> : null}
                  {joining ? t("link.accepting") : t("link.accept")}
                </Button>
                {formError === null ? null : (
                  <FieldError role="alert">{formError}</FieldError>
                )}
              </>
            ) : null}

            {status === "mismatch" ? (
              <>
                <p className="text-[14px] leading-5 text-muted-foreground">
                  {/*
                   * Both addresses, which is what "told plainly" means here:
                   * "this is not your invitation" is useless to somebody who
                   * cannot see which of their two mailboxes it went to. The
                   * invited address is not a disclosure — the lookup answers
                   * it to whoever holds the token, by ADR-0071 §5's own
                   * decision, so this screen is showing the reader something
                   * they already hold.
                   */}
                  {t("link.mismatch", {
                    current: signedInAs ?? "",
                    email: offer.email,
                  })}
                </p>
                {/*
                 * Signing **out**, not a link to `/login`: the reader has a
                 * session, and `_auth`'s mirror guard would send them straight
                 * home from the sign-in screen. This lands them on it.
                 */}
                <Button
                  className={AUTH_CONTROL}
                  disabled={signingOut}
                  onClick={signOut}
                  type="button"
                  variant="outline"
                >
                  {t("link.signOut")}
                </Button>
              </>
            ) : null}

            {status === "stranger" ? (
              <>
                <p className="text-[14px] leading-5 text-muted-foreground">
                  {t(
                    features.userRegistration
                      ? "link.stranger"
                      : "link.strangerClosed",
                    { email: offer.email },
                  )}
                </p>
                {/*
                 * The address is fixed rather than typed: any other one
                 * produces an account this invitation cannot reach, and the
                 * offer is addressed to a mailbox rather than to a person.
                 * The form's own success path is unchanged — a `202` and the
                 * confirmation screen — and the invitation is waiting in the
                 * account area once the address is proven.
                 *
                 * Absent where the deployment has closed sign-ups, so this is
                 * not the one screen that re-opens a disabled affordance; the
                 * sentence above changes with it, and the sign-in link under
                 * the card is then the only way forward — which is the truth
                 * on such a deployment.
                 */}
                {features.userRegistration ? (
                  <>
                    <Separator />
                    <RegisterForm email={offer.email} />
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </Card>

      {status === "stranger" ? (
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          {/*
           * The way out, under the card rather than in it — the sign-up
           * screen's shape and for its reason: ADR-0054 §7 lists a card's
           * contents as the controls, and "I already have an account" is not
           * one of them.
           */}
          <Link
            className="underline underline-offset-4"
            search={{ redirect: INVITATION_INBOX }}
            to="/login"
          >
            {t("link.haveAccount")}
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
};
