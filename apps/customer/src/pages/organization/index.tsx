import type { OrganizationResource } from "@repo/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useMyOrganizationBySlug } from "@/entities/organization";
import {
  DeleteOrganizationCard,
  NewOrganizationCard,
  OrganizationDetailsForm,
  OrganizationInvitationsSection,
  OrganizationMembersSection,
} from "@/features/organization-manage";
import { useT } from "@/shared/i18n";
import {
  AccountSummary,
  AppNotFound,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/shared/ui";

/**
 * `/orgs/$orgSlug` and `/orgs/$orgSlug/settings` (ADR-0067 §6).
 *
 * **The slug is resolved client-side, out of the switcher's list**, which is the
 * whole architecture of these two screens: `GET /user/orgs` is already in the
 * cache because the switcher renders in the shell on every screen, so an
 * address outside the caller's memberships is a not-found **with no request
 * made** — the URL rule of ADR-0067 §4 read from the browser, and the reason the
 * API needs no `GET /user/orgs/:orgId` for this app.
 *
 * The alternative — a route loader over a detail endpoint — would have made the
 * `404` a round trip, put an organization id in a loader's cache, and let the
 * timing of the answer say whether a tenant exists. This says nothing at all.
 */

/**
 * What stands where a role would, when there is none.
 *
 * A module constant rather than a literal in JSX (ADR-0046 §8), and an en dash
 * rather than a blank for `@repo/grid`'s reason: an empty cell reads as a
 * rendering failure.
 */
const NO_ROLE = "–";

/**
 * The three states a slug can be in, and the one thing each of them renders.
 *
 * A missing slug renders **`AppNotFound`** — the same component and the same
 * sentence an unmatched path gets, because that is what this is: an address
 * naming nothing this account can see.
 *
 * **Rendered rather than thrown as `notFound()`**, and that is a finding rather
 * than a preference. The router's `notFound()` is caught by a route's own
 * boundary when it is thrown from a `beforeLoad` or a loader; thrown from a
 * *component* here it escaped every boundary — "the following error wasn't
 * caught by any route" — and the screen became the dev error overlay. There is
 * no loader to throw it from on purpose (resolving a slug is a cache read, not
 * a fetch), so the honest form is the component the router would have rendered,
 * rendered directly.
 *
 * The **pending** case is the one worth being careful about. The list arriving
 * and the list holding no such slug are two different things, and rendering a
 * not-found for the first would flash a dead end on every cold load of an
 * organization screen. Three-valued in the hook, three branches here.
 */
const useResolvedOrganization = (
  slug: string,
): { organization: OrganizationResource | undefined; fallback: ReactNode } => {
  const { isError, isMissing, organization } = useMyOrganizationBySlug(slug);

  if (isMissing) return { organization: undefined, fallback: <AppNotFound /> };

  return {
    organization,
    fallback:
      organization === undefined ? (
        <OrganizationFallback isError={isError} />
      ) : null,
  };
};

/**
 * What stands in while the switcher's list is still arriving, or has failed.
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
 * `/orgs/$orgSlug` — what this organization is, and the way into its settings.
 *
 * Deliberately small. Everything a customer can be told about an organization
 * in v1 is its name, its address, its kind and their own role in it (ADR-0067
 * §7 keeps per-organization settings out of this deliverable), and a screen
 * that padded that out would be inventing the product's next feature in the
 * layout.
 */
export const OrganizationOverviewPage = ({
  slug,
}: {
  readonly slug: string;
}) => {
  const { t } = useT("organizations");
  const { fallback, organization } = useResolvedOrganization(slug);

  if (organization === undefined) return fallback;

  return (
    <Card aria-labelledby="organization-summary-title" role="region">
      <CardHeader>
        <CardTitle id="organization-summary-title">
          {organization.name}
        </CardTitle>
        <CardDescription>{t("overview.description")}</CardDescription>
        <CardAction>
          <Button asChild variant="outline">
            {/*
             * A typed `Link`, so a renamed route is a compile error rather
             * than a button that 404s (ADR-0049 §Routing).
             */}
            <Link params={{ orgSlug: slug }} to="/orgs/$orgSlug/settings">
              {t("overview.settings")}
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {/* Two columns rather than three, the account summary's reasoning: the
            content column is capped, and three columns inside it would put an
            address in a third of it. */}
        <dl className="grid gap-6 sm:grid-cols-2">
          <AccountSummary label={t("overview.address")}>
            {organization.slug}
          </AccountSummary>
          <AccountSummary label={t("overview.kind")}>
            <Badge variant="secondary">
              {t(`kind.${organization.kind}` as const)}
            </Badge>
          </AccountSummary>
          {/*
           * `role` is the one field on the resource that is not a column: it is
           * the *caller's* role here, `null` only on the admin segment where
           * staff are never members (ADR-0067 §3). A membership is what got
           * this screen rendered at all, so it is never `null` in this app —
           * the fallback is the contract's nullability being respected rather
           * than a state this app can reach.
           *
           * It renders an en dash and not a word. The first version reached for
           * `kind.team`, which is a review finding worth keeping visible: it
           * would have put a *kind* under a heading that says "Your role", and
           * an unreachable branch with confident wrong copy is worse than a
           * blank, because nothing will ever contradict it.
           */}
          <AccountSummary label={t("overview.role")}>
            {organization.role === null ? (
              NO_ROLE
            ) : (
              <Badge variant="secondary">
                {t(`members.role.${organization.role}` as const)}
              </Badge>
            )}
          </AccountSummary>
        </dl>
      </CardContent>
    </Card>
  );
};

/**
 * `/orgs/$orgSlug/settings` — the cards a member may act through.
 *
 * **Which cards render is the caller's role**, read off the membership the API
 * put on the resource for exactly this. The API is still the authority — every
 * one of these operations is a guard on its route, and this app mounts no
 * policy table at all (ADR-0055 §3) — so the role decides only whether a
 * control that would certainly be refused is offered.
 *
 * - **Name and address**: an owner or an admin. A personal organization's
 *   address is derived from the account and the form does not offer it.
 * - **Members**: everyone, because every member may see who else is here and
 *   may leave; the row controls narrow themselves.
 * - **Invitations**: an owner or an admin, and never on a **personal**
 *   organization — a review finding, and the same shape the address field and
 *   the deletion card already had. A personal organization has one member by
 *   construction, so the service refuses every invitation into one with
 *   `409 ORGANIZATION_PERSONAL_CLOSED`; mounting the section there would have
 *   offered a control that cannot succeed above a table that can never fill.
 * - **A new organization**: everyone. It is not about *this* organization at
 *   all, and this is the screen ADR-0067 §6 puts it on — so the personal
 *   organization every account starts with is one click from a team one.
 * - **Deletion**: an owner, and never delegated to an admin.
 */
export const OrganizationSettingsPage = ({
  slug,
}: {
  readonly slug: string;
}) => {
  const { t } = useT("organizations");
  const { fallback, organization } = useResolvedOrganization(slug);

  if (organization === undefined) return fallback;

  const isOwner = organization.role === "owner";
  const mayAdminister = isOwner || organization.role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild size="sm" variant="ghost">
          <Link params={{ orgSlug: slug }} to="/orgs/$orgSlug">
            {t("settings.back")}
          </Link>
        </Button>
      </div>

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

      <OrganizationMembersSection organization={organization} />

      {mayAdminister && organization.kind !== "personal" ? (
        <OrganizationInvitationsSection organization={organization} />
      ) : null}

      <NewOrganizationCard />

      {isOwner ? <DeleteOrganizationCard organization={organization} /> : null}
    </div>
  );
};
