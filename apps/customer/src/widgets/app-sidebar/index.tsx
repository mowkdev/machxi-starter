import { Link } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  HouseIcon,
  LogOutIcon,
  UserIcon,
} from "lucide-react";

import { useDisplayedOrganization } from "@/entities/organization";
import { useSignOut } from "@/features/auth";
import { TEAM_ROUTES } from "@/widgets/organization-switcher";

import { useSession } from "@/shared/api/context";
import { APP_VERSION, GIT_SHA } from "@/shared/config";
import { useT } from "@/shared/i18n";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/shared/ui";

/**
 * The customer app's drawer and its account control (`D12.5`, ADR-0055 §3,
 * ADR-0054 §5, ADR-0053 §2).
 *
 * Two exports from one slice, for the reason the admin's has two: they are made
 * of the same facts — who is signed in, and where this app can go — and they
 * change for the same reasons. Only their mount points differ, and the layer
 * that may see both composes them (`app/routes/_dashboard.tsx`).
 *
 * **What is not here, and why each absence is a decision rather than a gap.**
 * There is no `can()` join and no `RESOURCE_POLICY`: a customer is one
 * population with one shape of authority — themselves — so every item this
 * drawer holds is offered unconditionally and the API remains the only
 * authority (ADR-0055 §3; ADR-0042 stays an admin record). There is no
 * `/account` item, because ADR-0053 §3 says the drawer is domain navigation and
 * the account control is the canonical way in. And there is no
 * `SidebarGroupLabel`: the admin's "Manage" names a group of three, while a
 * caption over a single item is a word that adds nothing to the word beneath
 * it. The label arrives with the second destination, which ADR-0055 §5 says is
 * the first domain entity the operator names.
 */

/**
 * The navigation, which is one item at `D12.5`.
 *
 * Written as a list rather than as a single inline `SidebarMenuItem` because
 * the shape is what makes the second entry a row instead of a refactor, and
 * because the typed `to` is what turns a dead link into a compile error
 * (ADR-0049 §Routing). `activeProps` is the router's own active state — no
 * `useLocation` comparison to keep in sync.
 */
interface NavItem {
  /**
   * The screen, in the vocabulary `TEAM_ROUTES` keys — resolved to one of a
   * destination's **two** addresses at render time (`D15.9`, ADR-0067 §6 as
   * amended 2026-09-07).
   *
   * Every tenant screen exists at `/<screen>` acting as the personal
   * organization and at `/orgs/$orgSlug/<screen>` acting as a team, so a
   * drawer item can no longer be a constant path: "Home" means `/` in the
   * private context and `/orgs/acme` in Acme's. The item names the screen and
   * this widget reads the active context, which is the same division the
   * switcher makes — one resolver, every consumer.
   */
  readonly screen: "home";
  /** A key in `common:nav`, not a sentence (ADR-0046 §3: navigation is chrome). */
  readonly label: "nav.home";
  readonly icon: typeof HouseIcon;
}

const NAVIGATION: readonly NavItem[] = [
  { screen: "home", label: "nav.home", icon: HouseIcon },
];

/**
 * The signed-in customer, as two lines and a monogram, opening ADR-0053 §2's
 * slim popover.
 *
 * **Three things hang here and no fourth**: the identity block, one link into
 * the account area, and the way out. That is the whole of §2's menu once it is
 * not a settings surface — the theme, locale and density controls are
 * `/account/preferences`' (`D12.7`), and the next preference is one
 * `DropdownMenuItem` away from landing here instead of in the section that
 * lists them, which is why the suite asserts the inventory rather than the
 * presence of each entry.
 *
 * **The principal comes from the session store, not from a query** (ADR-0033).
 * It is session identity — who is signed in — and `useSession` subscribes React
 * to the store, so a refresh that rotates it re-renders this without anything
 * having to remember to. Fetching the profile here would put a request in a
 * layout every protected screen mounts, to render a label already in memory.
 *
 * `principal` is nullable in the type and rendered as a plain "Account" when it
 * is absent. That state is reachable: `_dashboard` guards on the access token,
 * and the token and the principal are separate fields of the snapshot — so a
 * session hydrated from a response this app did not write renders the control
 * with no name rather than crashing the shell around it. A customer's names are
 * nullable in the schema too (ADR-0017), so the email fallback below is a live
 * branch here in a way it is not in the admin.
 *
 * **The `/account` link points at the area rather than at a section**, which is
 * ADR-0053 §1's shape: the index route chooses the first section, so a fourth
 * section later costs nothing here. `D12.6` built that route and turned the
 * entry into a typed `Link` — see its own comment for the step it spent as an
 * anchor and what that cost.
 */
export const AccountMenu = () => {
  const { principal } = useSession();
  /*
   * Every word in this control is `common:`, including "Sign out" — which is
   * `auth:signOut` in the admin because the admin's control *is* a
   * `features/auth` component. Here the behaviour is a hook and the surface is
   * this widget, and this app's namespace rule is that the namespace name is
   * the slice name (`shared/i18n/namespaces.ts`): a key under `auth:` rendered
   * from `widgets/` would be the review finding that rule exists to make. The
   * account popover is chrome, so its three labels sit together under
   * `common:account`.
   */
  const { t } = useT("common");
  const { pending, signOut } = useSignOut();

  const fullName =
    principal === null
      ? ""
      : [principal.firstName, principal.lastName].filter(Boolean).join(" ");
  const displayName =
    fullName === "" ? (principal?.email ?? t("account.unnamed")) : fullName;
  const monogram = (fullName === "" ? displayName : fullName)
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
         * `aria-label` rather than the rendered text as the accessible name.
         * The trigger's contents are the customer's own name and address, so
         * without it the control would be found by whoever happens to be
         * signed in — the button's *job* is constant and the label should be
         * too.
         */}
        <Button
          aria-label={t("account.menu")}
          /*
           * `has-[>svg]:px-2` is not decoration and not a duplicate. The
           * omitted `size` defaults to `"h-9 px-4 py-2 has-[>svg]:px-3"`, and
           * `tailwind-merge` keys by modifier *and* group: bare `px-2`
           * displaces bare `px-4` and leaves `has-[>svg]:px-3` standing. The
           * chevron is a direct `<svg>` child, so `:has(> svg)` matches and
           * outranks `.px-2` on specificity — without this the trigger renders
           * the `px-3` a size token meant for one line of content, not the
           * `px-2` this control wants. `h-auto` for the same reason: the
           * trigger keeps two lines and no size token is built for that.
           */
          className="h-auto px-2 py-1.5 has-[>svg]:px-2"
          variant="ghost"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-accent text-xs font-medium">
            {monogram === "" ? <UserIcon className="size-4" /> : monogram}
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{displayName}</span>
            {principal === null ? null : (
              <span className="truncate text-xs text-muted-foreground">
                {principal.email}
              </span>
            )}
          </div>
          <ChevronsUpDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      {/*
       * The popover's geometry (ADR-0054 §7): 232px wide at radius 8, over 4px
       * of padding and 32px items that highlight on `--accent`. Only two of
       * those five are written here, and that is the point of "tokens alone" —
       * `DropdownMenuContent` already ships `p-1` and `bg-popover`, and
       * `DropdownMenuItem` already measures 32 and focuses to `bg-accent`.
       * What the primitive does not have is the width (`w-56` is 224) and the
       * radius (`rounded-md` is 5).
       */}
      <DropdownMenuContent
        align="end"
        className="w-[232px] rounded-xl"
        side="bottom"
      >
        {principal === null ? null : (
          <>
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">
                {displayName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {principal.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          {/*
           * A typed `<Link>` since `D12.6` (ADR-0049 §Routing), which is the
           * one-line swap `D12.5` wrote this entry to be.
           *
           * It shipped as a plain `<a href>` for one step because `Link`'s `to`
           * is checked against the generated route tree and `/account` did not
           * exist yet — so the typed form did not compile, and the two
           * alternatives were a `to={"/account" as never}` cast silencing the
           * very check the typed router exists for, or a menu ADR-0053 §2 says
           * has three things shipping with two. The cost in between was a hard
           * navigation onto a not-found screen; it is now a client-side one
           * onto the area's index route, which sends the customer to Profile.
           *
           * The suite's `href` assertion is unchanged and still passes:
           * `Link` renders one, so what the test always asserted was the
           * address rather than the element.
           */}
          <Link to="/account">
            {/*
             * The icon is ADR-0053 §2's mitigation and the reason it is
             * stable: a customer stranded in a language they cannot read
             * reaches the language switch through this entry and the
             * Preferences section label, and a glyph that moved with the copy
             * would be no help at all.
             */}
            <UserIcon />
            {t("account.area")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
         * The way out, spent here rather than in a component of its own
         * (`D12.2` left `useSignOut` a hook for exactly this).
         *
         * `onSelect` with `preventDefault` so the menu does not close out from
         * under the navigation, and `disabled` while the request is in flight
         * so a second click cannot start a second logout.
         */}
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            signOut();
          }}
        >
          <LogOutIcon />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const AppSidebar = () => {
  const { t } = useT("common");
  /*
   * The context the drawer's links point into (ADR-0067 §6 as amended). The
   * **displayed** one rather than the URL's, which was a review finding: the
   * record names two shell consumers of the remembered context — "the shell's
   * switcher and links" — and reading the URL here sent a customer standing in
   * a team's own profile screen back to `/`, the eject the amendment exists to
   * prevent, through the half of the sentence the first version skipped.
   *
   * A team's slug or `undefined`; `undefined` is the private context, whose
   * screens are the unprefixed ones.
   */
  const { slug } = useDisplayedOrganization();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              {/*
               * The brand block is a way home, so it goes to the *active*
               * context's home rather than always to the private one — an
               * unprefixed `/` here would have been a second control quietly
               * switching the caller out of the team they were working in.
               */}
              <Link
                params={slug === undefined ? {} : { orgSlug: slug }}
                to={slug === undefined ? "/" : TEAM_ROUTES.home}
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {/*
                   * The mark is a key too (ADR-0046 §8). One letter reads as
                   * decoration and is not: it is the brand's initial, so a
                   * blueprint whose brand is not `machxi` changes it in the
                   * catalogue beside `brand.name` rather than in a component.
                   */}
                  <span className="text-sm font-semibold">
                    {t("brand.mark")}
                  </span>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {t("brand.name")}
                  </span>
                  <span className="truncate text-xs">{t("brand.product")}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAVIGATION.map(({ screen, label, icon: Icon }) => (
                <SidebarMenuItem key={screen}>
                  <SidebarMenuButton
                    asChild
                    /*
                     * The active item is an inset bar over a tint, not a grey
                     * pill (ADR-0054 §5).
                     *
                     * Every class here is `data-[active=true]:`-prefixed and
                     * every one displaces a class the primitive spells with
                     * the same modifier *and* the same property group, which
                     * is what `tailwind-merge` keys on — so the primitive
                     * stays byte-identical (ADR-0047) and the design reaches
                     * it through the composition's own class string.
                     *
                     * The bar is a `box-shadow`, not a border: a border would
                     * move the label two pixels the moment a route became
                     * active. `text-sidebar-foreground`, not `text-foreground`
                     * — inside a `<Sidebar>` the scoped token is the
                     * sidebar's, and naming the global one leaves this item
                     * behind the day the drawer re-points its foreground.
                     */
                    className="data-[active=true]:bg-primary-tint data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]"
                    tooltip={t(label)}
                  >
                    <Link
                      /*
                       * `exact` because the home screen's path is a prefix of
                       * every other in its context — `/` of everything, and
                       * `/orgs/acme` of `/orgs/acme/settings/members` — so
                       * without it the drawer would mark Home active while the
                       * caller stands in that team's settings.
                       */
                      activeOptions={{ exact: true }}
                      activeProps={{ "data-active": true }}
                      params={slug === undefined ? {} : { orgSlug: slug }}
                      to={slug === undefined ? "/" : TEAM_ROUTES[screen]}
                    >
                      <Icon />
                      <span>{t(label)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/*
       * The version, and nothing else (ADR-0054 §5).
       *
       * 48px, mono, right-aligned, `--muted-foreground`: it is a fact to look
       * up when reporting a problem, not something to read on the way past.
       *
       * **The build, not a manifest** (ADR-0081 §3): the release label the
       * image was built with, and the first seven characters of its commit
       * when it has one — `dev` alone for a build nobody labelled. Both are
       * substituted at build time — see `shared/config` and `app-version.ts`.
       * The label is shown as given, with no `v` in front: its scheme is the
       * releasing repository's, and a tag-derived label already carries one.
       *
       * Hidden when the rail is collapsed rather than truncated into it: a
       * 3rem column cannot hold a version string, and the two characters that
       * would survive are worse than nothing.
       */}
      <SidebarFooter className="h-12 justify-center border-t border-sidebar-border px-3 py-0 group-data-[collapsible=icon]:hidden">
        <span className="truncate text-right font-mono text-xs text-muted-foreground">
          {GIT_SHA
            ? t("brand.versionWithCommit", {
                version: APP_VERSION,
                commit: GIT_SHA.slice(0, 7),
              })
            : t("brand.version", { version: APP_VERSION })}
        </span>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
};
