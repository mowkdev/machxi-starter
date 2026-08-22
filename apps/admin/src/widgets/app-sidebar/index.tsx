import { Link } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { LogoutMenuItem } from "@/features/auth";
import { LocaleMenuItems } from "@/features/locale";
import { ThemeMenuItems } from "@/features/theme";
import { useSession } from "@/shared/api/context";
import { useCan, type ResourceName } from "@/shared/auth";
import { useT } from "@/shared/i18n";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/shared/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";

/**
 * The navigation half of the `sidebar-07` shell (ADR-0031, ADR-0032).
 *
 * `collapsible="icon"` is what the plan means by a collapsible drawer: the
 * rail stays, the labels go, and on a small screen `SidebarProvider` swaps the
 * whole thing for a `Sheet` without this component knowing.
 *
 * The links are typed against the generated route tree, so a path that does not
 * exist is a compile error rather than a dead link discovered by clicking
 * (ADR-0032 §Routing). `activeProps` is the router's own active state — no
 * `useLocation` comparison to keep in sync.
 *
 * The footer holds the account menu, which is where logout lives (ADR-0032
 * names "navigation, current-principal block, logout" as this widget's job).
 *
 * **The principal comes from the session store, not from a query** (`D3.9`).
 * ADR-0033 puts it there because it is session identity — who is signed in —
 * and `useSession` subscribes React to the store, so a refresh that rotates it
 * re-renders this without anything having to remember to. The alternative,
 * fetching `GET /admin/profile` here, would put a request in a layout that
 * every protected screen mounts, to render a label that is already in memory.
 * The one thing the store cannot notice on its own is the operator renaming
 * themselves on `/profile`, and that is why `useUpdateProfile` writes the fresh
 * names back to it (`useSetPrincipal`) rather than this widget going and
 * looking.
 *
 * `principal` is nullable in the type and rendered as a plain "Account" when it
 * is absent. That state is reachable: `_dashboard` guards on the access token,
 * and the token and the principal are separate fields of the snapshot
 * (ADR-0033) — so a session hydrated from a response this app did not write
 * would render the menu with no name rather than crash the shell around it.
 */

/**
 * The navigation, with the `can()` join written out rather than inferred
 * (`D4.3`, ADR-0042 §What it may gate).
 *
 * The naive reading — "filter the items by `can("read", item.resource)`" — is a
 * bug, and an instructive one: only two of these four name a resource. `/` is
 * the dashboard and `/profile` is the resource ADR-0042 deliberately keeps *out*
 * of the policy table (it mounts with no `authorize` at all), so filtering on a
 * derived resource name would hide both from everybody but a `super_admin`,
 * courtesy of deny-by-default doing exactly what it was asked.
 *
 * So the item carries the join explicitly and **absence means "not gated"** —
 * which is the same rule the policy table states from the other end: a screen no
 * role gates has no question for `can()` to answer, and a `false` about it is
 * the predicate answering a question it was not asked.
 *
 * This makes the shell principal-dependent, so two operators see different apps.
 * That is the intent, and its cost is named in ADR-0042: an operator sees a
 * smaller app than the one that exists, with no indication that more is there,
 * so "I can't find X" now has a new possible answer and the policy table is
 * where it is looked up.
 */
interface NavItem {
  readonly to: "/" | "/staff" | "/users" | "/profile";
  /**
   * A key in `common:nav`, not a sentence (`D7.2`).
   *
   * ADR-0046 §3 puts navigation in `common` and names the tension it creates:
   * two of these four are *resources*, whose own namespaces land in `D7.4`. The
   * shell's word for a destination is chrome — it is what the sidebar calls the
   * place, and it is read next to "Dashboard" rather than next to a staff
   * record — so it stays here, and the resource screens' own titles are theirs.
   */
  readonly label: NavKey;
  readonly icon: typeof LayoutDashboardIcon;
  readonly resource?: ResourceName;
}

type NavKey = "nav.dashboard" | "nav.staff" | "nav.users" | "nav.profile";

/*
 * Annotated rather than `as const satisfies`, which is the shape the rest of
 * this repository prefers and the wrong one here: `as const` keeps each entry's
 * literal type, so the two items with no `resource` have no such property to
 * read and `item.resource === undefined` stops compiling. The annotation is
 * what makes "absent means not gated" expressible at all.
 */
const NAVIGATION: readonly NavItem[] = [
  { to: "/", label: "nav.dashboard", icon: LayoutDashboardIcon },
  { to: "/staff", label: "nav.staff", icon: ShieldIcon, resource: "staff" },
  { to: "/users", label: "nav.users", icon: UsersIcon, resource: "users" },
  { to: "/profile", label: "nav.profile", icon: UserIcon },
];

/**
 * The signed-in operator, as two lines and a monogram.
 *
 * `displayName` falls back to the email rather than rendering an empty line:
 * `staff` names are `NOT NULL` (ADR-0017) so this cannot happen for a staff
 * principal, and the fallback exists because the wire type covers both
 * populations and `user` names are nullable — writing the impossible branch is
 * cheaper than a runtime `?? ""` nobody would notice going wrong.
 */
const AccountMenu = () => {
  const { principal } = useSession();
  const { t } = useT("common");

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
         * The trigger's contents are the operator's own name and address, so
         * without it the control would be found by whoever happens to be signed
         * in — the button's *job* is constant and the label should be too.
         */}
        <SidebarMenuButton
          aria-label={t("account.menu")}
          size="lg"
          tooltip={t("account.menu")}
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent text-xs font-medium">
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
          <ChevronsUpDownIcon className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56" side="right">
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
          <Link to="/profile">
            <UserIcon />
            {t("account.profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
         * A preference about the operator, in the menu named after them
         * (`D6.3`, ADR-0045). It is the account's from here on, so it follows
         * them to the next machine — which is the smallest visible proof that
         * "display state" and "device state" were never the same category.
         */}
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        {/*
         * And the language beside it (`D7.5`, ADR-0046 §4). The same account
         * row holds both, so they are one menu apart rather than one screen
         * apart — and an operator who has landed in the wrong language finds
         * the way out where they were already looking for a preference about
         * themselves, in the menu named after them.
         */}
        <LocaleMenuItems />
        <DropdownMenuSeparator />
        <LogoutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The nav items this operator is offered.
 *
 * Split out so the rule is one expression and the widget stays composition: an
 * item with no `resource` always renders, and one with a `resource` renders only
 * where `can("read", …)` says so.
 */
const NavigationMenu = () => {
  const can = useCan();
  const { t } = useT("common");

  return (
    <SidebarMenu>
      {NAVIGATION.filter(
        (item) => item.resource === undefined || can("read", item.resource),
      ).map(({ to, label, icon: Icon }) => (
        <SidebarMenuItem key={to}>
          <SidebarMenuButton asChild tooltip={t(label)}>
            <Link
              activeOptions={{ exact: to === "/" }}
              activeProps={{ "data-active": true }}
              to={to}
            >
              <Icon />
              <span>{t(label)}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
};

export const AppSidebar = () => {
  const { t } = useT("common");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <span className="text-sm font-semibold">m</span>
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
          <SidebarGroupLabel>{t("nav.group")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavigationMenu />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
