import { Link, useRouteContext } from "@tanstack/react-router";
import { LockIcon, MailIcon, SettingsIcon, UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useProfile } from "@/entities/profile";
import { SetPasswordFirst, SignInMethodsCard } from "@/features/auth";
import { GridDensityCards } from "@/features/density";
import { InvitationInbox } from "@/features/invitation-inbox";
import { LocaleRows } from "@/features/locale";
import {
  ChangeEmailDialog,
  ChangePasswordDialog,
  DeleteAccountDialog,
  ProfileDetailsForm,
} from "@/features/profile-manage";
import { ThemeCards } from "@/features/theme";
import { dateTimeFormat, useT } from "@/shared/i18n";
import {
  ACCOUNT_SECTION_LINK,
  AccountShell,
  AccountSummary,
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
 * The account area (`D12.6`, `D12.7`; ADR-0053 §1, §4, §5 with ADR-0055 §3's
 * sections).
 *
 * One slice: the layout that frames every section, and the three sections
 * behind it. **`D12.7` filled the third**, and `D12.8` adds deletion to the
 * security section — the placement ADR-0053 §1 anticipated and ADR-0055 §3 made
 * this app's.
 *
 * **The layout is `@repo/ui`'s and this app changed nothing about it**, which
 * is the second-consumer claim ADR-0053 §4 made by name: the customer app is
 * the second consumer, its sections were already known to differ, and that is
 * why the sections are the app's and only the geometry is shared. The 220px nav
 * column, the 32px gap, the 720px content cap and the 16px card stack are all
 * `SettingsLayout`'s (ADR-0054 §7), so nothing in this file spells a width or a
 * gap.
 */

/**
 * The section links, as data, because there is one shape and more than one of
 * them.
 *
 * `to` is the typed route path rather than a string, so a renamed route is a
 * compile error here rather than a nav item that 404s — the same property the
 * sidebar's `NAVIGATION` has. **The icons are ADR-0053 §2's mitigation and not
 * decoration**: a customer stranded in a language they cannot read travels
 * through the account control and a section label, and a stable glyph is what
 * makes that trip possible at all. `D12.7`'s Preferences row is the one that
 * mitigation is really about — it is the way out — and it arrived as one line
 * because `D12.6` wrote this as a list rather than as two inline links.
 */
const SECTIONS = [
  { to: "/account/profile", label: "sections.profile", icon: UserIcon },
  { to: "/account/security", label: "sections.security", icon: LockIcon },
  {
    to: "/account/preferences",
    label: "sections.preferences",
    icon: SettingsIcon,
  },
  /*
   * `D15.5`'s, and the second time the list shape has paid for itself: an
   * invitation is addressed to the *account*, not to an organization, so
   * ADR-0053 §1's rule for sections puts it here rather than on a tenant's
   * screen — and it arrived as one line.
   */
  {
    to: "/account/invitations",
    label: "sections.invitations",
    icon: MailIcon,
  },
] as const;

/**
 * One section link, and the two things it borrows rather than invents.
 *
 * **The active treatment is the sidebar's** (ADR-0054 §5): an inset bar over
 * `--primary-tint`, applied through `activeProps` setting `data-active` and a
 * `data-[active=true]:` class, which is the idiom this app already uses for
 * "the nav item you are on". A second visual language for the same idea, on the
 * one screen that shows both navs at once, would be the design disagreeing with
 * itself.
 *
 * **The 36 and the 14px label are ADR-0054 §7's**, as the admin's `D11.9`
 * amended that section to say: 36 is where this app's generated controls sit,
 * 14 is §3's body rung, and a nav label is read as copy rather than typed into.
 */
const SectionNav = () => {
  const { t } = useT("account");

  return (
    <>
      {SECTIONS.map(({ to, label, icon: Icon }) => (
        <Link
          activeProps={{ "data-active": true }}
          className={ACCOUNT_SECTION_LINK}
          key={to}
          to={to}
        >
          <Icon />
          <span>{t(label)}</span>
        </Link>
      ))}
    </>
  );
};

export interface AccountPageProps {
  /** The section, handed down by the route that matched it. */
  readonly children: ReactNode;
}

/**
 * The area's frame: the nav on the left, the matched section on the right.
 *
 * **The `<Outlet />` stays in the route file.** A page is composition and route
 * files are wiring (ADR-0049), so what arrives here is a rendered child rather
 * than a router primitive — which is also what lets this page be rendered in a
 * test with a section handed to it directly.
 *
 * `navLabel` is required by the composition and answered here (ADR-0053 §4, as
 * amended at `D11.8`): a `<nav>` landmark with no name is one a screen reader
 * announces as "navigation", indistinguishable from the drawer's.
 */
export const AccountPage = ({ children }: AccountPageProps) => {
  const { t } = useT("account");

  return (
    <AccountShell nav={<SectionNav />} navLabel={t("nav.label")}>
      {children}
    </AccountShell>
  );
};

/**
 * The two facts on this card that are instants, rendered in **the app's**
 * locale and the customer's timezone (ADR-0046 §5).
 *
 * `@repo/grid`'s `dateTime` formatter is what the admin's account page reaches
 * for; this app has no grid to take one off (ADR-0055 §3), so the four lines it
 * would have imported are here, over the same `dateTimeFormat` underneath.
 * `DATE_TIME_OPTIONS` is a module constant because that function caches on it —
 * an object built inline would key the cache on a fresh string every render.
 *
 * The formatter is resolved **per call** rather than captured, which is what
 * makes a locale switch move these dates: the page re-renders on
 * `languageChanged` because `useT` subscribes it, and the tag has already moved
 * by then.
 *
 * The en dash rather than a blank, for `@repo/grid`'s reason: an empty cell
 * looks like a rendering failure, and "has never signed in" is information.
 */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

const dateTime = (value: string | null): string =>
  value === null
    ? "—"
    : dateTimeFormat(DATE_TIME_OPTIONS).format(new Date(value));

/**
 * `/account/profile` — who you are (ADR-0053 §1).
 *
 * Everything it renders is `GET /user/profile` — **not** the principal in the
 * session store. The two agree today and are not the same thing: the store
 * holds session identity, refreshed at session boundaries, while this is the
 * account read fresh, and it is the only source that carries `createdAt` and
 * `lastLoginAt` at all (ADR-0033 §The session store).
 *
 * **Three summary facts, where the admin's screen shows four**, and the two it
 * drops are the segment's own decision rather than a smaller version of the
 * same page: `status` and `roles` are things somebody else sets about an
 * operator, and this app mounts no policy table at all (ADR-0055 §3) — a
 * customer has exactly one role and reading it back to them says nothing. What
 * replaces them is `createdAt`, which is a fact about the person's own
 * relationship with the service rather than about their authority.
 *
 * The named region is the admin's `D8.5` device and it is worth as much here:
 * `main` is the `SidebarInset` and the account control sits in the header
 * inside it, so the customer's email is on screen twice within the landmark and
 * a query scoped to it matches both. `aria-labelledby` points at this card's
 * own title.
 */
export const AccountProfileSection = () => {
  const { t } = useT("profile");
  const profile = useProfile();
  const [changingEmail, setChangingEmail] = useState(false);

  return (
    <Card aria-labelledby="account-summary-title" role="region">
      <CardHeader>
        <CardTitle id="account-summary-title">{t("account.title")}</CardTitle>
        <CardDescription>{t("account.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        {profile.data === undefined && profile.error !== null ? (
          /*
           * The panel ADR-0034 requires wherever a silent query renders: this
           * screen has no table for it to sit inside, so it takes the place of
           * the summary itself.
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
            {/*
             * The email's own row (ADR-0080 §4): the fact at the start, its
             * change action at the end — the shape the security section's
             * sign-in-methods rows have. Its own `<dl>` beside the button,
             * because a `<dl>`'s groups may hold only `<dt>` and `<dd>`.
             *
             * `D18.9`'s control is the one on this screen that opens a
             * ceremony rather than editing a field (ADR-0071 §6, ADR-0040),
             * and it stays out of the details form below: the form writes
             * names and cannot carry an address at all, because
             * `updateProfileBody` deliberately has no such field, and the two
             * are not saved together — names change on submit, an address
             * when a link in a mailbox is followed. `outline`, the security
             * section's spelling for "opens a ceremony".
             *
             * **Offered only once `hasPassword` says there is a current
             * password to ask for** (ADR-0072 §3, amended between `D19.2` and
             * `D19.3`): a passwordless account reads "set a password first"
             * below instead, and nothing is offered while the account loads.
             */}
            <div
              className="flex flex-wrap items-center justify-between gap-3"
              data-slot="account-email-row"
            >
              <dl className="min-w-0 break-words">
                <AccountSummary label={t("summary.email")}>
                  {profile.data.email}
                </AccountSummary>
              </dl>
              {profile.data.hasPassword ? (
                <Button
                  onClick={() => {
                    setChangingEmail(true);
                  }}
                  variant="outline"
                >
                  {t("email.action")}
                </Button>
              ) : null}
            </div>

            {/*
             * Two columns rather than three, and the cap is why: the content
             * pane is 720px wide (ADR-0054 §7), and three columns inside 720
             * would crowd the facts.
             */}
            <dl className="mt-6 grid gap-6 sm:grid-cols-2">
              <AccountSummary label={t("summary.memberSince")}>
                {dateTime(profile.data.createdAt)}
              </AccountSummary>
              {/* This session's own sign-in, so it is never `null` here — the
                  formatter still handles it, because the type says it can be
                  and a page is not the place to argue with a contract. */}
              <AccountSummary label={t("summary.lastLogin")}>
                {dateTime(profile.data.lastLoginAt)}
              </AccountSummary>
            </dl>

            {profile.data.hasPassword ? null : (
              <div className="mt-6">
                <SetPasswordFirst email={profile.data.email} />
              </div>
            )}

            <Separator className="my-6" />

            <ProfileDetailsForm profile={profile.data} />
          </>
        )}
      </CardContent>

      {changingEmail ? (
        <ChangeEmailDialog
          onClose={() => {
            setChangingEmail(false);
          }}
        />
      ) : null}
    </Card>
  );
};

/**
 * `/account/security` — how you prove it is you (ADR-0053 §1).
 *
 * **Sign-in methods first, then deletion** — two cards, in the order of how far
 * they go. The first is ADR-0072 §4's: the password and Google, each a row
 * with the one control that fits the account (`SignInMethodsCard`), which
 * since `D19.5` is where "Change password" lives — the password card it
 * replaced said the same thing about the same dialog. The second is `D12.8`'s,
 * and it is the first one's consequences taken all the way — every session
 * including this one, and nothing in this app that can undo it. Deletion last
 * is not decoration: a customer arriving here because they cannot get into
 * their account should meet the ways in first.
 *
 * **Deletion asks for the current password, so an account with none reads
 * "set a password first" in its place** (ADR-0072 §3, amended between `D19.2`
 * and `D19.3`): the API would answer the dialog `403` whatever was typed,
 * because a null hash never verifies.
 */
export const AccountSecuritySection = () => {
  const { t } = useT("profile");
  const profile = useProfile();
  const { features } = useRouteContext({
    from: "/_dashboard/account/security",
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  return (
    <>
      <SignInMethodsCard
        canLinkGoogle={features.googleSignIn}
        onChangePassword={() => {
          setChangingPassword(true);
        }}
      />

      <Card aria-labelledby="delete-account-title" role="region">
        <CardHeader>
          <CardTitle id="delete-account-title">{t("delete.title")}</CardTitle>
          <CardDescription>{t("delete.description")}</CardDescription>
          {/*
           * The one destructive control on this screen, and the only place
           * the style is available to say so: `AppFormDialog` gives the
           * dialog's submit a single appearance (the plan's finding 11), so
           * the warning is carried by the button that opens the ceremony and
           * by the dialog's own copy. Offered only once the profile says there
           * is a current password to ask for.
           */}
          {profile.data?.hasPassword === true ? (
            <CardAction>
              <Button
                onClick={() => {
                  setDeletingAccount(true);
                }}
                variant="destructive"
              >
                {t("delete.action")}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {/*
             * ADR-0028's user semantics, stated where the decision is made
             * rather than only inside the dialog: the row survives, the address
             * is released, and no endpoint in v1 restores an account — so
             * "delete" here does not mean what it usually implies, and a
             * customer should be able to read that before they click.
             */}
            {t("delete.note")}
          </p>
          {profile.data?.hasPassword === false ? (
            <SetPasswordFirst email={profile.data.email} />
          ) : null}
        </CardContent>
      </Card>

      {changingPassword ? (
        <ChangePasswordDialog
          onClose={() => {
            setChangingPassword(false);
          }}
        />
      ) : null}

      {deletingAccount ? (
        <DeleteAccountDialog
          onClose={() => {
            setDeletingAccount(false);
          }}
        />
      ) : null}
    </>
  );
};

/**
 * `/account/preferences` — how the app behaves for you (`D12.7`; ADR-0053
 * §1/§2, ADR-0055 §3).
 *
 * **The inventory, and in this app it was never anything else.** In the admin
 * these three controls spent a deliverable each in the account menu before
 * ADR-0053 §2 collected them; this app was built after that decision, so its
 * account control shipped at `D12.5` as identity-and-exit and the preferences
 * have had exactly one home since their first render. The section is the
 * mitigation §2 promised as much as it is the surface: it is the way out of a
 * language a customer cannot read, which is why the nav row that reaches it
 * carries a stable icon.
 *
 * **One card per fact, not one card with three groups.** Each of these is an
 * independent account setting with its own write path — the theme and the
 * density ride ADR-0045's coalescing writer, the locale goes through
 * `useUpdateSettings` and the device key — and a card is what gives each one a
 * title a screen reader can land on and a sentence saying what it does. The
 * cards sit on `SettingsLayout`'s 16px stack (ADR-0054 §7), which is why
 * nothing here spells a gap.
 *
 * **Three cards where the admin has three, and one of them means less.** Rows
 * is here because ADR-0055 §3 says the density is an account fact whether or
 * not a grid is mounted, and this app mounts none — so it is the one preference
 * whose effect a customer cannot see today. Its description says so rather than
 * implying a table that does not exist; the alternative was to omit it and lose
 * the choice a customer makes before the first domain entity arrives.
 *
 * The controls themselves are the three features', unchanged below their
 * component layer (ADR-0053 §5): this page composes, and knows nothing about
 * how a preference is written.
 */
export const AccountPreferencesSection = () => {
  const { t } = useT("settings");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.title")}</CardTitle>
          <CardDescription>{t("appearance.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeCards />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("language.title")}</CardTitle>
          <CardDescription>{t("language.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleRows />
        </CardContent>
      </Card>

      {/*
       * Last, where the admin puts it second, and the order is the one thing
       * about this section that is a judgement rather than a record: the two
       * above change what a customer sees the moment they are clicked, and this
       * one changes something they have no screen for yet.
       */}
      <Card>
        <CardHeader>
          <CardTitle>{t("density.title")}</CardTitle>
          <CardDescription>{t("density.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <GridDensityCards />
        </CardContent>
      </Card>
    </>
  );
};

/**
 * `/account/invitations` — the organizations that have invited you (`D15.5`;
 * ADR-0053 §1, ADR-0067 §4).
 *
 * **A section of the account area rather than a screen of an organization**,
 * and the endpoint says why: `/user/invitations` sits outside the
 * `/orgs/:orgId` prefix because what selects its rows is the caller's address
 * and the caller is not a member of anything yet. A surface hung off an
 * organization would have had to name one to ask about the offers of others.
 *
 * The card is this page's and the list is the feature's, which is ADR-0053 §5's
 * line: this composes, and knows nothing about how an invitation is answered.
 */
export const AccountInvitationsSection = () => {
  const { t } = useT("organizations");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("inbox.title")}</CardTitle>
        <CardDescription>{t("inbox.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <InvitationInbox />
      </CardContent>
    </Card>
  );
};
