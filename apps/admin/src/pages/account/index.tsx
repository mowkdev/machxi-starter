import { Link } from "@tanstack/react-router";
import { LockIcon, SettingsIcon, UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useProfile } from "@/entities/profile";
import {
  ChangePasswordDialog,
  ProfileDetailsForm,
} from "@/features/profile-manage";
import { RolesList, StatusBadge } from "@/shared/grid/cells";
import { dateTime } from "@/shared/grid/formatters";
import { useT } from "@/shared/i18n";
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
 * The account area (`D11.9`; ADR-0053 §1, §4, §5).
 *
 * Three files' worth of screen, one slice: the layout that frames every
 * section, and the two sections this step fills. `/account/preferences` is a
 * route with a title and no content until `D11.10` puts the theme, density and
 * locale controls in it — the plan's own division, and the reason nothing here
 * pretends to hold them.
 *
 * **`entities/profile` and `features/profile-manage` are reused exactly as
 * they are** (ADR-0053 §5). Nothing below the page layer knew it was on
 * `/profile`, so nothing below it changes: the same query, the same form, the
 * same dialog, split across two addresses instead of stacked on one. The split
 * itself is §1's section rule — profile is who you are, security is how you
 * prove it — which is the same seam ADR-0027 already cut between the details
 * form and the password sub-resource, now visible in the URL.
 *
 * What this page does **not** carry is geometry: the 220px nav column, the
 * 32px gap, the 720px content cap and the 16px card stack are all
 * `SettingsLayout`'s (ADR-0054 §7 as amended at `D11.8`), because they are
 * both apps' and the customer app builds its own sections into the same frame.
 */

/**
 * The section links, as data, because there are three of them and one shape.
 *
 * `to` is the typed route path rather than a string, so a renamed route is a
 * compile error here rather than a nav item that 404s — the same property the
 * sidebar's `NAVIGATION` has. The icons are ADR-0053 §2's mitigation and not
 * decoration: an operator stranded in a language they cannot read now travels
 * through the menu and a section label, and a stable glyph beside
 * "Preferences" is what makes that trip possible at all.
 */
const SECTIONS = [
  { to: "/account/profile", label: "sections.profile", icon: UserIcon },
  { to: "/account/security", label: "sections.security", icon: LockIcon },
  {
    to: "/account/preferences",
    label: "sections.preferences",
    icon: SettingsIcon,
  },
] as const;

/**
 * One section link, and the two things it borrows rather than invents.
 *
 * **The active treatment is the sidebar's** (`D11.3`, ADR-0054 §5): an inset
 * bar over `--primary-tint`, applied through `activeProps` setting
 * `data-active` and a `data-[active=true]:` class, which is the idiom this app
 * already uses for "the nav item you are on". A second visual language for the
 * same idea, on the one screen that shows both navs at once, would be the
 * design disagreeing with itself.
 *
 * **The 36 and the 14px label are ADR-0054 §7's, amended at this step**, and
 * neither is a reading of §3's control rungs. §7's `D11.8` amendment gave this
 * nav a column width and a 2px item gap and no item height, so rather than
 * pick one here the record was widened to say what ships and why: 36 is where
 * the app's generated controls sit today, 14 is §3's body rung, and a nav
 * label is read as copy rather than typed into. §3's `44 settings option row`
 * is **not** this rung either — that is a theme or language row inside a
 * Preferences card, which is `D11.10`'s. The amendment names all of it, so the
 * next reader finds a stated gap rather than a silent disagreement.
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
 * files are wiring (ADR-0049, carrying ADR-0032), so what arrives here is a
 * rendered child rather than a router primitive — which is also what lets this
 * page be rendered in a test with a section handed to it directly.
 *
 * `navLabel` is required by the composition and answered here (ADR-0053 §4, as
 * amended at `D11.8`): the shell already puts a breadcrumb `<nav>` on this
 * page, so an unnamed second landmark would give a screen reader two identical
 * entries.
 */
export const AccountPage = ({ children }: AccountPageProps) => {
  const { t } = useT("account");

  return (
    <SettingsLayout nav={<SectionNav />} navLabel={t("nav.label")}>
      {children}
    </SettingsLayout>
  );
};

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
 * `/account/profile` — identity (ADR-0053 §1).
 *
 * Everything it renders is `GET /admin/profile` — **not** the principal in the
 * session store. The two agree today and are not the same thing: the store
 * holds session identity, refreshed at session boundaries, while this is the
 * account read fresh, and it is the only source that carries `status`,
 * `lastLoginAt` and `createdAt` at all (ADR-0033 §The session store).
 *
 * The named region is `D8.5`'s and it survives the move for the reason it was
 * added: `main` is the `SidebarInset` and the account menu sits in the header
 * inside it, so the operator's email is on screen twice within the landmark
 * and a query scoped to it matches both. `aria-labelledby` points at this
 * card's own title, which gives the page's suite something to scope to and
 * gives a screen reader a named region it did not have.
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
           * The panel ADR-0034 requires wherever a silent query renders
           * (amended D3.7): this screen has no table for it to sit inside, so
           * it takes the place of the summary itself.
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
             * Two columns rather than four, and the cap is why: the content
             * pane is 720px wide (ADR-0054 §7), where the retired `/profile`
             * had the whole page container. Four `lg:` columns inside 720
             * would put an email address and a role list in 180px each.
             */}
            <dl className="grid gap-6 sm:grid-cols-2">
              <Summary label={t("summary.email")}>{profile.data.email}</Summary>
              {/*
               * The grid's own renderers, not a second pair (D3.9 review).
               * They are resource-agnostic by ADR-0035's rule — `statusBadge`
               * colours an enum label, `rolesList` renders string badges, and
               * neither knows what a staff member is — so a screen with no
               * table on it is still entitled to the vocabulary.
               */}
              <Summary label={t("summary.status")}>
                <StatusBadge value={profile.data.status} />
              </Summary>
              <Summary label={t("summary.roles")}>
                <RolesList value={profile.data.roles} />
              </Summary>
              <Summary label={t("summary.lastLogin")}>
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
  );
};

/**
 * `/account/security` — how you prove it is you (ADR-0053 §1).
 *
 * The password card and its dialog, unchanged from the screen they came off.
 * ADR-0053 §1 names sessions, 2FA and step-up as this section's future
 * neighbours, which is the whole argument for giving a single card its own
 * address: a password is an action with side effects on every device the
 * operator owns, and the things that will sit beside it are all of that kind.
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
             * ADR-0027 §Staff self-service, stated where it is felt rather than
             * left for an operator to discover: the current password is
             * required even though this browser holds a valid session, the
             * other sessions end because ending them is what a password change
             * is for, and this one survives because it is the one already
             * proven to belong to whoever is typing.
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
