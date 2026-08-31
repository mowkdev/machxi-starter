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
/*
 * The card's parts (`D12.6`). `Card` alone was enough while a card held one
 * sentence; the account area's sections are titled cards with descriptions and,
 * on the security card, a header-right action.
 */
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
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
  /*
   * `FieldSet` is half of ADR-0035's submit lock (`D12.6`), and the half a
   * hand-assembled form has to spell for itself: `AppFormDialog` renders it
   * inside the package, the inline details form does not.
   */
  FieldSet,
} from "@repo/ui/components/field";
export { Input } from "@repo/ui/components/input";
export { Separator } from "@repo/ui/components/separator";
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
export { Skeleton } from "@repo/ui/components/skeleton";
export { Spinner } from "@repo/ui/components/spinner";
/*
 * ADR-0034's one delivery surface for mutation outcomes (`D12.6`). `toast` is
 * called from exactly one place — `app/providers/query-client.ts`'s global
 * caches — and `<Toaster>` is mounted once, on the root route.
 */
export { Toaster, toast } from "@repo/ui/components/sonner";
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
/*
 * What fills that shell's `banner` region (`D12.9`, ADR-0048 §3). Its one
 * consumer is the dev-only pseudo-locale notice in `app/routes/_dashboard.tsx`
 * — the slot's promised second-app consumer arriving, and the last of
 * ADR-0046's closing work.
 *
 * **Two symbols, not the admin's three.** `BannerVariant` is the composition's
 * variant union and nothing in this app names it — `variant="info"` is checked
 * through `BannerProps` — so exporting it would put a symbol with no consumer
 * in a file whose header says it grows a line at a time as a screen needs one.
 * It is one line the day a screen picks a variant from a value.
 */
export { Banner, type BannerProps } from "@repo/ui/compositions/banner";
/*
 * The account area's frame (`D12.6`, ADR-0053 §4). ADR-0048 §2's slot-honesty
 * rule named this composition's second consumer before it existed — "the
 * customer app's sections differ already" — and this door line is that consumer
 * arriving with no `packages/*` diff behind it.
 */
export {
  SettingsLayout,
  type SettingsLayoutProps,
} from "@repo/ui/compositions/settings-layout";

/** The components in this slice with behaviour of their own. */
export { AppLoader } from "./app-loader";
export { AppError, AppNotFound } from "./app-error";
export { QueryError } from "./query-error";
/*
 * The Preferences section's one control shape (`D12.7`, ADR-0054 §3/§7). Not a
 * re-export — `@repo/ui` ships no radio primitive and this is a hand-written
 * group over native inputs — so it sits beside the door rather than in it, and
 * its three consumers are `features/{theme,density,locale}`.
 */
export {
  SettingsOptions,
  type SettingsOption,
  type SettingsOptionsProps,
} from "./settings-options";
