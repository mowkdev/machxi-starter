import { useNavigate, useRouterState } from "@tanstack/react-router";
import { BuildingIcon, CheckIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import {
  useDisplayedOrganization,
  useMyOrganizations,
  useRememberOrganization,
} from "@/entities/organization";
import { NewOrganizationDialog } from "@/features/organization-manage";
import { useT } from "@/shared/i18n";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";

import { TEAM_ROUTES, screenOf } from "./context-path";

/*
 * Re-exported through this widget's public API, because the drawer needs the
 * same map: a nav item names a *screen* and resolves to one of its two
 * addresses (ADR-0067 §6 as amended). A widget composing a sibling widget's
 * door is the shell/sidebar split the import lint already allows by name.
 */
export { TEAM_ROUTES, screenOf, type TenantScreen } from "./context-path";

/**
 * The organization switcher, in the shell's header beside the account control
 * (`D15.5`; reshaped at `D15.9`, ADR-0067 §6 as amended 2026-09-07).
 *
 * **It switches the context a customer acts in.** What `D15.5` built was a list
 * of links to an organization's summary card, whose one action was its settings
 * — so "switching" read as "opening settings", and nothing in the app was ever
 * *the organization I am acting as*. That was the operator's finding on the
 * `D15.8` browser walk and it is what the amendment answers: choosing a context
 * keeps the screen and swaps the prefix, and the trigger always names the
 * context the caller is standing in.
 *
 * **A widget rather than a feature, for the reason `AccountMenu` is one**: it is
 * chrome made of one query and the current location, mounted by the layer that
 * composes the shell (`app/routes/_dashboard.tsx`). It hosts one write — the
 * new-organization dialog — which is ADR-0053 §2's shape for the account menu
 * rather than an exception to the widget rule: the *entry* navigates nowhere and
 * the write happens on a surface of its own.
 *
 * **It is still the app's only resolver of a slug**, and that property is now
 * `entities/organization`'s `useActiveOrganization` rather than this file's:
 * `GET /user/orgs` is in the cache on every screen because this control renders
 * in the shell, so an address like `/orgs/not-mine` is a not-found the client
 * answers **without a request** — the URL rule of ADR-0067 §4 read from the
 * browser.
 */

/**
 * The private context, and the two ways it is not a team.
 *
 * It is labelled rather than named: ADR-0067 §6 makes the personal
 * organization's name unmanaged, so the interface calls it "Private" instead of
 * showing a value nothing can edit — which also means the label is the same for
 * every account and a test can find it by name.
 */
const PRIVATE_VALUE = "__private__";

export const OrganizationSwitcher = () => {
  const { t } = useT("organizations");
  const navigate = useNavigate();
  const organizations = useMyOrganizations();
  /*
   * What the shell shows, which is the resolver's answer on a tenant screen and
   * the remembered team on a self-scoped one — `entities/organization`'s, so the
   * drawer's links read exactly the same value (ADR-0067 §6 names both).
   */
  const displayed = useDisplayedOrganization();
  const [creating, setCreating] = useState(false);

  useRememberOrganization();

  /*
   * The screen is read off the router rather than passed in, so this control
   * needs telling about no navigation — the same reason the context itself is
   * the URL's answer and not a piece of state.
   */
  const screen = useRouterState({
    select: (state) => screenOf(state.location.pathname),
  });

  const rows = organizations.data ?? [];
  /*
   * Teams only. The personal organization is the "Private" entry above the
   * separator and is never addressed by slug (ADR-0067 §6), so listing it here
   * would offer a second, broken way into the context it already names.
   */
  const teams = rows.filter((row) => row.kind === "team");

  const switchTo = (slug: string | null) => {
    void (slug === null
      ? /*
         * The private context has one screen. A team's settings chosen from the
         * private entry has no counterpart there, so it lands on the home —
         * ADR-0067 §6's rule, and the reason this branch does not consult
         * `screen` at all.
         */
        navigate({ to: "/" })
      : navigate({ params: { orgSlug: slug }, to: TEAM_ROUTES[screen] }));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/*
           * `aria-label` rather than the rendered text as the accessible name,
           * the account control's reasoning: the label changes with the context
           * and the control's job does not, so a test — or a screen reader user
           * — finds "Switch organization" wherever they are standing.
           */}
          <Button
            aria-label={t("switcher.label")}
            className="max-w-56"
            variant="outline"
          >
            <BuildingIcon className="size-4" />
            <span className="truncate">
              {displayed.organization?.kind === "team"
                ? displayed.organization.name
                : t("switcher.private")}
            </span>
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
             * with no teams look identical from the DOM, and telling a customer
             * they belong to nothing because a request failed is a silent
             * failure the client manufactured. The query also carries
             * `errorToast: true`, so this sentence is not the only signal.
             */
            <DropdownMenuItem disabled>{t("switcher.error")}</DropdownMenuItem>
          ) : (
            <>
              {/*
               * The private context, always present and always first (ADR-0067
               * §2's invariant is what makes "always" true). It is where a
               * customer with no team spends every minute, so it is not an
               * entry that appears once there is something to contrast it with.
               */}
              <SwitcherEntry
                active={displayed.slug === undefined}
                label={t("switcher.private")}
                onSelect={() => {
                  switchTo(null);
                }}
                value={PRIVATE_VALUE}
              />

              {teams.map((organization) => (
                <SwitcherEntry
                  active={displayed.slug === organization.slug}
                  key={organization.id}
                  label={organization.name}
                  onSelect={() => {
                    switchTo(organization.slug);
                  }}
                  value={organization.slug}
                />
              ))}
            </>
          )}

          <DropdownMenuSeparator />

          {/*
           * The way into the active team's settings, and it is deliberately not
           * offered from the private context: a personal organization has no
           * settings surface at all (ADR-0067 §6), so an entry here would open
           * a screen that renders not-found.
           */}
          {displayed.organization?.kind === "team" ? (
            <DropdownMenuItem
              onSelect={() => {
                void navigate({
                  params: { orgSlug: displayed.organization?.slug ?? "" },
                  to: "/orgs/$orgSlug/settings/general",
                });
              }}
            >
              <SettingsIcon />
              {t("switcher.settings")}
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem
            onSelect={() => {
              /*
               * **The menu is allowed to close, and that is load-bearing.** The
               * first version prevented the default here — copied from
               * `AccountMenu`'s sign-out entry, which keeps the menu open so a
               * navigation does not unmount the control mid-flight. It is the
               * wrong borrowing for a dialog: the menu is a modal layer, so the
               * dialog opened underneath a still-open one, and unmounting the
               * dialog after it navigated left Radix's `aria-hidden` on the rest
               * of the app — the shell's own header included. Found by the
               * browser tier, where the switcher simply ceased to exist as a
               * role after a team was created; jsdom never saw it, because the
               * suite that opens the dialog never closes it.
               *
               * The dialog renders outside the menu, so letting the menu close
               * is the ordinary Radix arrangement rather than a workaround.
               */
              setCreating(true);
            }}
          >
            <PlusIcon />
            {t("create.action")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {creating ? (
        <NewOrganizationDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
};

/**
 * One context in the list.
 *
 * A `menuitem` that navigates rather than a `<Link>`, which is the change
 * `D15.9` made and the reason the control now deserves the name "switcher": the
 * destination is a function of where the caller already is, so it cannot be an
 * `href` written at render time without recomputing every entry on every
 * navigation.
 *
 * The check mark rather than a highlight: the menu's own focus treatment
 * already owns the accent, and "which one am I in" has to survive the keyboard
 * moving through the list. `aria-hidden` on it because the state is announced
 * by `aria-current` instead — the mark is the sighted half of the same fact.
 */
const SwitcherEntry = ({
  active,
  label,
  onSelect,
  value,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onSelect: () => void;
  readonly value: string;
}) => (
  <DropdownMenuItem
    aria-current={active ? "true" : undefined}
    data-value={value}
    onSelect={onSelect}
  >
    <span className="truncate">{label}</span>
    {active ? <CheckIcon aria-hidden className="ml-auto size-4" /> : null}
  </DropdownMenuItem>
);
