import { Link } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

import { LogoutMenuItem } from "@/features/auth";

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
 * `D3.9` fills the trigger with the signed-in principal; until then it is a
 * plain label, because reading the store to render a name is that step's work
 * and this one only has to be able to end the session.
 */

const NAVIGATION = [
  { to: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { to: "/staff", label: "Staff", icon: ShieldIcon },
  { to: "/users", label: "Users", icon: UsersIcon },
  { to: "/profile", label: "Profile", icon: UserIcon },
] as const;

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" tooltip="Account">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent">
                  <UserIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Account</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" side="right">
              <LogoutMenuItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
);
