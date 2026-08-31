/**
 * The one door `@repo/ui` comes through (ADR-0047 §What-code; ADR-0049 places
 * the file, ADR-0055 §2 gives this app its own).
 *
 * Every layer above `shared` imports design-system components from here, and a
 * lint rule refuses `@repo/ui/components/*` anywhere else. The point is that a
 * change on the other side of the boundary — a primitive renamed upstream, a
 * wrapper that gives one app defaults the other does not want — is one edit
 * here instead of a grep across every page.
 *
 * Re-exports only, and deliberately so: a component with app-specific
 * behaviour is not a re-export, it is a `shared/ui` component of its own, and
 * it goes in a file beside this one — `app-loader.tsx` is the first.
 *
 * Named rather than `export *` because the door is also the inventory: what
 * this app uses from the design system is readable in one screen, and adding to
 * it is a visible line in a diff. It is deliberately **not** the admin's list
 * with the unused half deleted — it is this app's, and it grows a line at a
 * time as a screen needs one.
 */

export { Button, buttonVariants } from "@repo/ui/components/button";
export { Card } from "@repo/ui/components/card";
/*
 * The account control's popover (`D12.5`, ADR-0053 §2). Six names and no
 * `DropdownMenuRadioGroup`/`RadioItem`: this menu is identity and exit, and
 * the radio pair is exactly what a settings menu leaves behind when it is
 * emptied by hand — so the door does not offer them, and the suite's
 * `menuitemradio` assertion has a second, structural half.
 */
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/field";
export { Input } from "@repo/ui/components/input";
/*
 * The drawer (`D12.5`). `SidebarProvider`, `SidebarInset` and `SidebarTrigger`
 * are deliberately absent: `AppShell` mounts all three itself, and this app's
 * sidebar node is what the composition is handed — a consumer reaching for the
 * provider would be building a second shell beside the one it was given.
 */
export {
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
} from "@repo/ui/components/sidebar";
export { Spinner } from "@repo/ui/components/spinner";
// Not a component: the design system's operator-read strings, injectable
// (ADR-0046 §12). It comes through the door for the door's own reason —
// `app/providers` mounts the provider, and `app` may not reach past `shared`.
export { UiStringsProvider, type UiStrings } from "@repo/ui/ui-strings";

/*
 * A composition, not a generated primitive: hand-written on `@repo/ui`'s
 * `compositions/` path (ADR-0047 §What-code, ADR-0048 §1), through the same
 * door as the rest. Its consumer is `widgets/dashboard-layout` (`D12.5`).
 */
export { AppShell, type AppShellProps } from "@repo/ui/compositions/app-shell";

/** The components in this slice with behaviour of their own. */
export { AppLoader } from "./app-loader";
export { AppError, AppNotFound } from "./app-error";
