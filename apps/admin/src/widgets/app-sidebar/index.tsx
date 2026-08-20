import { Link } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { LogoutMenuItem } from "@/features/auth";
import { useSession } from "@/shared/api/context";

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

const NAVIGATION = [
  { to: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { to: "/staff", label: "Staff", icon: ShieldIcon },
  { to: "/users", label: "Users", icon: UsersIcon },
  { to: "/profile", label: "Profile", icon: UserIcon },
] as const;

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

  const fullName =
    principal === null
      ? ""
      : [principal.firstName, principal.lastName].filter(Boolean).join(" ");
  const displayName =
    fullName === "" ? (principal?.email ?? "Account") : fullName;
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
        <SidebarMenuButton aria-label="Account" size="lg" tooltip="Account">
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
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <LogoutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const AppSidebar = () => (
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
                <span className="truncate font-semibold">machxi</span>
                <span className="truncate text-xs">Admin</span>
              </div>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Manage</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {NAVIGATION.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild tooltip={label}>
                  <Link
                    activeOptions={{ exact: to === "/" }}
                    activeProps={{ "data-active": true }}
                    to={to}
                  >
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
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
