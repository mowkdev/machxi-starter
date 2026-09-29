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
 * it goes in a file beside this one — `query-error.tsx` was the one left,
 * everything else having moved into `@repo/app-kit` at `D14.8`, and
 * `spinner.tsx` joined it at `D28.8`.
 *
 * Named rather than `export *` because the door is also the inventory: what
 * this app uses from the design system is readable in one screen, and adding to
 * it is a visible line in a diff. It is deliberately **not** the admin's list
 * with the unused half deleted — it is this app's, and it grows a line at a
 * time as a screen needs one.
 */

/*
 * The confirmations `D15.5` brought: leaving an organization, removing somebody
 * from one, revoking an invitation, deleting a tenant. Five names and not the
 * primitive's twelve — no `AlertDialogTrigger`, because every one of these is
 * opened from state rather than from a control inside the dialog's own tree,
 * and no `AlertDialogMedia`/`Portal`/`Overlay`, which `AlertDialogContent`
 * mounts for itself.
 */
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
/*
 * The role a member holds and the state an invitation is in, as a chip
 * (`D15.5`). `badgeVariants` stays out: nothing here builds a badge-looking
 * thing out of something that is not a `<Badge>`.
 */
export { Badge } from "@repo/ui/components/badge";
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
/*
 * The role control on the members table (`D15.5`). Five names and not the
 * primitive's ten: this app has one select, over three flat values, so
 * `SelectGroup`, `SelectLabel`, `SelectSeparator` and the two scroll buttons
 * would be inventory with no consumer. `@repo/form`'s `select` adapter reaches
 * the primitive through its own package and not through this door.
 */
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
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
/*
 * The members and invitations lists (`D15.5`, ADR-0067 §6). A table and not
 * `@repo/grid`: ADR-0055 §5 keeps the grid for the first domain entity, and a
 * grid over one organization's handful of people would put a second set of list
 * params in a URL that carries only the record. `TableFooter` and
 * `TableCaption` are unused — these lists have a card header above them and no
 * totals row.
 */
export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
/*
 * ADR-0034's one delivery surface for mutation outcomes (`D12.6`). `toast` is
 * called from exactly one place — `@repo/app-kit`'s query client and its global
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
export { QueryError } from "./query-error";
/*
 * The primitive with its accessible name from the catalogue (`D28.8`,
 * ADR-0046 §12): exported in the primitive's place, so no screen can reach the
 * English `aria-label` the generated file hard-codes.
 */
export { Spinner } from "./spinner";
/*
 * The shared composition, through this door (`D14.8`, ADR-0062 §1).
 *
 * `shared/ui` is the door for the rendering half of `@repo/app-kit` as well as
 * for `@repo/ui`, which is why its `DOORS` row lists this slice: every one of
 * these was app code in *both* apps until the kit took ownership, and every
 * consumer above `shared` keeps the import it already had.
 *
 * `AppRoot` joined at `D22.1` (ADR-0077 §1) and took `AppLoader` and
 * `AppErrorBoundary` off this door with it: the root composition mounts both
 * inside the kit, so `app/index.tsx` was their last consumer here.
 */
export {
  ACCOUNT_SECTION_LINK,
  AccountShell,
  AccountSummary,
  AppCrash,
  AppError,
  AppNotFound,
  AppRoot,
  AppUiStrings,
  AuthLayout,
  SettingsOptions,
  type AccountShellProps,
  type AccountSummaryProps,
  type AppRootProps,
  type AppUiStringsProps,
  type AuthLayoutProps,
  type SettingsOption,
  type SettingsOptionsProps,
} from "@repo/app-kit";

export { UI_STRING_KEYS } from "./ui-strings";
