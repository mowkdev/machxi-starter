import { Link } from "@tanstack/react-router";
import {
  BuildingIcon,
  MailIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useActiveOrganization } from "@/entities/organization";
import {
  DeleteOrganizationCard,
  OrganizationDetailsForm,
  OrganizationInvitationsSection,
  OrganizationMembersSection,
} from "@/features/organization-manage";
import { useT } from "@/shared/i18n";
import {
  ACCOUNT_SECTION_LINK,
  AccountShell,
  AppNotFound,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/shared/ui";

/**
 * A team's settings area (`D15.9`, ADR-0067 §6 as amended 2026-09-07).
 *
 * **An area on the same composition as `/account`, which is ADR-0053 §4's
 * second consumer arriving a second time.** `D15.5` built one settings *screen*
 * carrying five cards; the amendment splits it into three sections behind a nav,
 * because that is what the account area already is and a customer meets both.
 * The geometry is `AccountShell`'s and nothing here spells a width or a gap.
 *
 * **ADR-0053 §1's section rule is kept, not stretched.** The account area stays
 * about the *person* — profile, security, preferences, the invitations addressed
 * to them — and a tenant's members and invitations never sit under a personal
 * heading. This is the other side of that same rule: these three sections are
 * about the *organization*, and none of them is about the caller.
 *
 * **The personal organization has no settings surface**, so every one of these
 * addresses renders not-found under `/orgs/<personal slug>` — decided once by
 * `useActiveOrganization`, which refuses to resolve a personal organization's
 * slug at all.
 */

/**
 * The three sections, as data, for the reason `pages/account`'s list is data:
 * there is one shape and more than one of them, and the icons are ADR-0053 §2's
 * mitigation rather than decoration.
 *
 * `to` is the typed route path, so a renamed route is a compile error here
 * rather than a nav item that 404s.
 */
const SECTIONS = [
  {
    to: "/orgs/$orgSlug/settings/general",
    label: "settings.sections.general",
    icon: BuildingIcon,
  },
  {
    to: "/orgs/$orgSlug/settings/members",
    label: "settings.sections.members",
    icon: UsersIcon,
  },
  {
    to: "/orgs/$orgSlug/settings/invitations",
    label: "settings.sections.invitations",
    icon: MailIcon,
  },
] as const satisfies readonly {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
}[];

/**
 * What stands in while the switcher's list is arriving, or has failed.
 *
 * The failure case renders a sentence rather than a skeleton that never
 * resolves: the query carries `errorToast: true` (ADR-0034 makes queries silent
 * by default and this one has no panel to be silent into), so the toast says
 * what happened and this says why the screen is empty.
 */
const OrganizationFallback = ({ isError }: { readonly isError: boolean }) => {
  const { t } = useT("organizations");

  return isError ? (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("switcher.error")}</p>
      </CardContent>
    </Card>
  ) : (
    <div aria-hidden className="flex flex-col gap-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
};

/**
 * The three states the active context can be in, and the one thing each renders.
 *
 * A **missing** context renders `AppNotFound` — the same component and the same
 * sentence an unmatched path gets, because that is what it is: an address naming
 * nothing this account can see.
 *
 * **Rendered rather than thrown as `notFound()`**, and that is a `D15.5` finding
 * worth keeping. The router's `notFound()` is caught by a route's own boundary
 * when thrown from a `beforeLoad` or a loader; thrown from a *component* it
 * escapes every boundary and the screen becomes the dev error overlay. There is
 * no loader to throw it from on purpose — resolving a slug is a cache read, not a
 * fetch — so the honest form is the component the router would have rendered.
 */
const useOrganizationSection = () => {
  const { isError, organization, state } = useActiveOrganization();

  if (state === "missing")
    return { organization: undefined, fallback: <AppNotFound /> };

  return {
    organization,
    fallback:
      organization === undefined ? (
        <OrganizationFallback isError={isError} />
      ) : null,
  };
};

/**
 * The area's frame: the section nav on the left, the matched section on the
 * right.
 *
 * The `<Outlet />` stays in the route file — a page is composition and route
 * files are wiring (ADR-0049) — so what arrives here is a rendered child, which
 * is also what lets this page be rendered in a test with a section handed to it.
 *
 * **The frame resolves the context and the sections do not.** A section rendered
 * for a slug outside the memberships would be a screen making requests about a
 * tenant the caller cannot see, so the not-found is decided once, here, above
 * every one of them.
 */
export const OrganizationSettingsPage = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const { t } = useT("organizations");
  const { fallback, organization } = useOrganizationSection();

  if (organization === undefined) return fallback;

  return (
    <AccountShell
      nav={
        <>
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <Link
              activeProps={{ "data-active": true }}
              className={ACCOUNT_SECTION_LINK}
              key={to}
              params={{ orgSlug: organization.slug }}
              to={to}
            >
              <Icon />
              <span>{t(label)}</span>
            </Link>
          ))}
        </>
      }
      navLabel={t("settings.nav.label")}
    >
      {children}
    </AccountShell>
  );
};

/**
 * General — name, address, and the way to delete the organization.
 *
 * **Which cards render is the caller's role**, read off the membership the API
 * put on the resource for exactly this. The API is still the authority — every
 * one of these operations is a guard on its route, and this app mounts no policy
 * table at all (ADR-0055 §3) — so the role decides only whether a control that
 * would certainly be refused is offered.
 */
export const OrganizationGeneralSection = () => {
  const { t } = useT("organizations");
  const { fallback, organization } = useOrganizationSection();

  if (organization === undefined) return fallback;

  const isOwner = organization.role === "owner";
  const mayAdminister = isOwner || organization.role === "admin";

  return (
    <>
      {mayAdminister ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("details.title")}</CardTitle>
            <CardDescription>{t("details.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <OrganizationDetailsForm organization={organization} />
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? <DeleteOrganizationCard organization={organization} /> : null}

      {/*
       * A member sees a section with nothing in it, which is the honest answer
       * rather than a fourth nav item that appears and disappears with a role:
       * the sections a tenant *has* do not depend on who is looking, and hiding
       * the nav item would make a shared link land on a not-found for one
       * colleague and a screen for another.
       */}
      {mayAdminister ? null : (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t("settings.readOnly")}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
};

/**
 * Members — everyone, because every member may see who else is here and may
 * leave; the row controls narrow themselves.
 */
export const OrganizationMembersSectionPage = () => {
  const { fallback, organization } = useOrganizationSection();

  if (organization === undefined) return fallback;

  return <OrganizationMembersSection organization={organization} />;
};

/**
 * Invitations — an owner or an admin.
 *
 * Never reachable on a personal organization, which the resolver already
 * guarantees by refusing its slug: the service refuses every invitation into one
 * with `409 ORGANIZATION_PERSONAL_CLOSED`, and `D15.5`'s review found the screen
 * offering a control that cannot succeed above a table that can never fill.
 */
export const OrganizationInvitationsSectionPage = () => {
  const { t } = useT("organizations");
  const { fallback, organization } = useOrganizationSection();

  if (organization === undefined) return fallback;

  const mayAdminister =
    organization.role === "owner" || organization.role === "admin";

  return mayAdminister ? (
    <OrganizationInvitationsSection organization={organization} />
  ) : (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {t("settings.readOnly")}
        </p>
      </CardContent>
    </Card>
  );
};
