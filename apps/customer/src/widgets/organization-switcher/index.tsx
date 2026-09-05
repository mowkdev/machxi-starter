import { Link, useParams } from "@tanstack/react-router";
import { BuildingIcon, ChevronsUpDownIcon } from "lucide-react";

import { useMyOrganizations } from "@/entities/organization";
import { useT } from "@/shared/i18n";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";

/**
 * The organization switcher, in the shell's header beside the account control
 * (`D15.5`, ADR-0067 §6, ADR-0053 §2 for where the account control is).
 *
 * **A widget rather than a feature, for the reason `AccountMenu` is one**: it
 * is chrome made of one query and the current location, mounted by the layer
 * that composes the shell (`app/routes/_dashboard.tsx`). It is the second thing
 * in `headerEnd` and the first thing a customer with more than one tenant
 * looks at.
 *
 * **It is the app's only resolver of a slug**, which is the property ADR-0067
 * §6 asked for and the reason this query lives in the shell rather than on the
 * organization screens: `GET /user/orgs` is in the cache on every screen, so an
 * address like `/orgs/not-mine` is a not-found the client answers **without a
 * request** — the URL rule of §4 read from the browser. A switcher fetched per
 * organization page would have made that impossible and would have leaked the
 * existence of a tenant through the timing of a `404`.
 *
 * **Every membership, in the order the API returns them.** No sorting here and
 * no "recent" list: the API orders by creation, a customer belongs to a handful
 * of organizations, and a client-side ordering would be a second opinion about
 * a list that fits on one screen.
 */
export const OrganizationSwitcher = () => {
  const { t } = useT("organizations");
  const organizations = useMyOrganizations();
  /*
   * `strict: false` because this control renders on every screen and only some
   * of them are addressed by an organization. It is the router's own answer to
   * "where am I", which is the only truthful one — a component that tracked the
   * active organization in state would have to be told about every navigation.
   */
  const { orgSlug } = useParams({ strict: false });

  const rows = organizations.data ?? [];
  const active = rows.find((row) => row.slug === orgSlug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
         * `aria-label` rather than the rendered text as the accessible name,
         * the account control's reasoning: the label changes with the URL and
         * the control's job does not, so a test — or a screen reader user —
         * finds "Switch organization" wherever they are standing.
         */}
        <Button
          aria-label={t("switcher.label")}
          className="max-w-56"
          variant="outline"
        >
          <BuildingIcon className="size-4" />
          <span className="truncate">
            {active?.name ?? t("switcher.trigger")}
          </span>
          <ChevronsUpDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      {/* The account control's geometry (ADR-0054 §7), so the two controls
          beside each other open the same shape of popover. */}
      <DropdownMenuContent
        align="end"
        className="w-[232px] rounded-xl"
        side="bottom"
      >
        <DropdownMenuLabel>{t("switcher.heading")}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {organizations.isError ? (
          /*
           * Not `switcher.empty`, which is the distinction `D15.4`'s review
           * drew on the admin's members table: a failed query and an account
           * with no organizations look identical from the DOM, and telling a
           * customer they belong to nothing because a request failed is a
           * silent failure the client manufactured. The query also carries
           * `errorToast: true`, so this sentence is not the only signal.
           */
          <DropdownMenuItem disabled>{t("switcher.error")}</DropdownMenuItem>
        ) : rows.length === 0 ? (
          <DropdownMenuItem disabled>{t("switcher.empty")}</DropdownMenuItem>
        ) : (
          rows.map((organization) => (
            <DropdownMenuItem asChild key={organization.id}>
              {/*
               * A typed `Link`, so a renamed route is a compile error here
               * rather than a menu entry that 404s (ADR-0049 §Routing). The
               * slug and not the id: a customer's URL and the API's path say
               * the same thing in different vocabularies, and this is where the
               * translation happens (ADR-0067 §6).
               */}
              <Link params={{ orgSlug: organization.slug }} to="/orgs/$orgSlug">
                <span className="truncate">{organization.name}</span>
                {organization.kind === "personal" ? (
                  /*
                   * The one kind worth marking. A customer has exactly one
                   * personal organization and it is the one they cannot delete
                   * or rename the address of, so the badge is what makes the
                   * refusals on its settings screen unsurprising.
                   */
                  <Badge className="ml-auto" variant="secondary">
                    {t("kind.personal")}
                  </Badge>
                ) : null}
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
