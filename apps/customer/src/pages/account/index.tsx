import { Link } from "@tanstack/react-router";
import { LockIcon, UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useProfile } from "@/entities/profile";
import {
  ChangePasswordDialog,
  ProfileDetailsForm,
} from "@/features/profile-manage";
import { dateTimeFormat, useT } from "@/shared/i18n";
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
  SettingsLayout,
  Skeleton,
} from "@/shared/ui";

/**
 * The account area (`D12.6`; ADR-0053 §1, §4, §5 with ADR-0055 §3's sections).
 *
 * Four files' worth of screen, one slice: the layout that frames every section,
 * and the sections behind it. **Two of them here and a third at `D12.7`** —
 * `/account/preferences` is that step's, and `D12.8` adds deletion to the
 * security section, which is the placement ADR-0053 §1 anticipated and ADR-0055
 * §3 made this app's.
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
 * makes that trip possible at all. That is why the list is written to hold a
 * third entry rather than as two inline links — `D12.7`'s Preferences is the
 * section that mitigation is really about, and it is one row.
 */
const SECTIONS = [
  { to: "/account/profile", label: "sections.profile", icon: UserIcon },
  { to: "/account/security", label: "sections.security", icon: LockIcon },
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
const LINK =
  "flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[active=true]:bg-primary-tint data-[active=true]:text-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--primary)] [&>svg]:size-4 [&>svg]:shrink-0";

const SectionNav = () => {
  const { t } = useT("account");

  return (
    <>
      {SECTIONS.map(({ to, label, icon: Icon }) => (
        <Link
          activeProps={{ "data-active": true }}
          className={LINK}
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
    <SettingsLayout nav={<SectionNav />} navLabel={t("nav.label")}>
      {children}
    </SettingsLayout>
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

const Summary = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

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
             * Two columns rather than three, and the cap is why: the content
             * pane is 720px wide (ADR-0054 §7), and three columns inside 720
             * would put an email address in 220px.
             */}
            <dl className="grid gap-6 sm:grid-cols-2">
              <Summary label={t("summary.email")}>{profile.data.email}</Summary>
              <Summary label={t("summary.memberSince")}>
                {dateTime(profile.data.createdAt)}
              </Summary>
              {/* This session's own sign-in, so it is never `null` here — the
                  formatter still handles it, because the type says it can be
                  and a page is not the place to argue with a contract. */}
              <Summary label={t("summary.lastLogin")}>
                {dateTime(profile.data.lastLoginAt)}
              </Summary>
            </dl>

            <Separator className="my-6" />

            <ProfileDetailsForm profile={profile.data} />
          </>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * `/account/security` — how you prove it is you (ADR-0053 §1).
 *
 * The password card and its dialog. ADR-0053 §1 names sessions, 2FA and step-up
 * as this section's future neighbours and ADR-0055 §3 names one more that is
 * nearer: **account deletion lands here at `D12.8`**, which is the whole reason
 * this app's security section was known to differ from the admin's before
 * either existed — and the argument for giving a single card its own address,
 * since a password is an action with side effects on every device the person
 * owns and the things that will sit beside it are all of that kind.
 */
export const AccountSecuritySection = () => {
  const { t } = useT("profile");
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("password.title")}</CardTitle>
          <CardDescription>{t("password.description")}</CardDescription>
          <CardAction>
            <Button
              onClick={() => {
                setChangingPassword(true);
              }}
              variant="outline"
            >
              {t("password.action")}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-muted-foreground">
            {/*
             * ADR-0027's consequences stated where they are felt rather than
             * left for a customer to discover: the current password is required
             * even though this browser holds a valid session, the other
             * sessions end because ending them is what a password change is
             * for, and this one survives because it is the one already proven
             * to belong to whoever is typing.
             */}
            {t("password.note")}
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
    </>
  );
};
