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
import { useCan, type ResourceName } from "@/shared/auth";
import { APP_VERSION } from "@/shared/config";
import { useT } from "@/shared/i18n";

import {
  Button,
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
 * **The account menu left the footer at `D8.5`** (ADR-0049
 * §The-shell-adapter). ADR-0032 named "navigation, current-principal block,
 * logout" as this widget's job; ADR-0049 supersedes that and moves the whole
 * account menu to the shell's `headerEnd` slot. `AccountMenu` is still
 * declared here, and exported below, because it is made of session facts this
 * slice owns.
 *
 * **And the menu slimmed back to ADR-0032's three things at `D11.10`**
 * (ADR-0053 §2): the theme and locale blocks are `/account/preferences`' now,
 * so what hangs here is the principal, one way into the account area, and the
 * way out. The sidebar's own `/profile` item retired in the same change
 * (ADR-0053 §3) — the drawer is domain navigation, and one page reachable from
 * both navs was a double entry that only looked like redundancy for free.
 *
 * **The footer itself went with it and came back at `D11.3`** (ADR-0054 §5),
 * and the rule is the same in both directions: `D8.5` removed the region
 * because it then held nothing, and an empty region kept "for symmetry" is the
 * unexercised-surface defect this repository keeps recording; it returns now
 * that the redesign gave it a job — the version string, alone.
 *
 * **The principal comes from the session store, not from a query** (`D3.9`).
 * ADR-0033 puts it there because it is session identity — who is signed in —
 * and `useSession` subscribes React to the store, so a refresh that rotates it
 * re-renders this without anything having to remember to. The alternative,
 * fetching `GET /admin/profile` here, would put a request in a layout that
 * every protected screen mounts, to render a label that is already in memory.
 * The one thing the store cannot notice on its own is the operator renaming
 * themselves on `/account/profile`, and that is why `useUpdateProfile` writes
 * the fresh names back to it (`useSetPrincipal`) rather than this widget going
 * and looking.
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
 * bug, and an instructive one: `/` is the dashboard and names no resource, so
 * filtering on a derived resource name would hide it from everybody but a
 * `super_admin`, courtesy of deny-by-default doing exactly what it was asked.
 *
 * **`/profile` used to be the second such item and left at `D11.10`**
 * (ADR-0053 §3). The rule it illustrated did not leave with it — one ungated
 * item is enough to make the join wrong to infer, and the next domain screen
 * that has no policy row would otherwise be added to a list that had quietly
 * stopped needing the distinction.
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
  readonly to: "/" | "/staff" | "/users";
  /**
   * A key in `common:nav`, not a sentence (`D7.2`).
   *
   * ADR-0046 §3 puts navigation in `common` and names the tension it creates:
   * two of these three are *resources*, whose own namespaces land in `D7.4`.
   * The shell's word for a destination is chrome — it is what the sidebar calls
   * the place, and it is read next to "Dashboard" rather than next to a staff
   * record — so it stays here, and the resource screens' own titles are theirs.
   */
  readonly label: NavKey;
  readonly icon: typeof LayoutDashboardIcon;
  readonly resource?: ResourceName;
}

type NavKey = "nav.dashboard" | "nav.staff" | "nav.users";

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
];

/**
 * The signed-in operator, as two lines and a monogram.
 *
 * `displayName` falls back to the email rather than rendering an empty line:
 * `staff` names are `NOT NULL` (ADR-0017) so this cannot happen for a staff
 * principal, and the fallback exists because the wire type covers both
 * populations and `user` names are nullable — writing the impossible branch is
 * cheaper than a runtime `?? ""` nobody would notice going wrong.
 *
 * **Exported, and mounted into the shell's `headerEnd` slot** (`D8.5`,
 * ADR-0049 §The-shell-adapter). It stays in this slice because it is made of
 * the same session facts the sidebar's author owns and changes for the same
 * reasons; only its mount point moved. The `_dashboard` route file composes it
 * and hands it to `dashboard-layout`, which places it — the `boundaries`
 * config would in fact permit that widget to import it directly through this
 * slice's public API, so the hand-off is chosen on a layering ground rather
 * than a lint one: the adapter's job is to be a frame, and a frame that
 * reaches for the account menu is a frame that knows a principal exists.
 *
 * **The header mount re-chooses the trigger and the popover, and nothing
 * else.** A `SidebarMenuButton size="lg"` is dead outside a `<Sidebar>`
 * ancestor — its `group-data-[collapsible=icon]` styling never matches — while
 * its `tooltip` prop would still fire from provider state, putting a tooltip
 * on a header control nobody asked for. `align="end" side="right"` was
 * sidebar-footer geometry, flying the popover rightward out of a rail that is
 * no longer there. So: a plain ghost `Button`, the popover `side="bottom"
 * align="end"`, and an explicit `h-auto` with its own padding because the
 * trigger keeps two lines of content and no size token is built for that. The
 * `aria-label` and the rendered name and email come across untouched — four
 * shipped assertions reach this control by exactly those.
 */
export const AccountMenu = () => {
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
           * `px-2` ADR-0049 §The-shell-adapter decides.
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
       * The popover's own geometry (`D11.5`, ADR-0054 §7): 232px wide at
       * radius 8, over 4px of padding and 32px items that highlight on
       * `--accent`. Only two of those five are written here, and that is the
       * point of "tokens alone" — `DropdownMenuContent` already ships `p-1`
       * and `bg-popover`, and `DropdownMenuItem` already measures 32
       * (`py-1.5` over a 20px line) and already focuses to `bg-accent`, which
       * Radix applies on hover. What the primitive does not have is the width
       * (`w-56` is 224) and the radius (`rounded-md` is 5) — §2's assignment
       * arriving at the surface that owns the shape, exactly as it says.
       *
       * The *contents* are `D11.10`'s and they have landed: the theme and
       * locale blocks left for `/account/preferences`, and what remains is the
       * principal, Account and Sign out — identity and exit, which is what
       * ADR-0053 §2 calls the menu once it is not a settings surface.
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
        {/*
         * One entry into the whole area, not one per section (`D11.10`,
         * ADR-0053 §1/§2). It points at `/account`, whose index route sends
         * the operator to the first section — so the menu names a place rather
         * than picking one, and a fourth section later needs nothing here.
         *
         * The icon is ADR-0053 §2's mitigation and the reason it is stable:
         * an operator stranded in a language they cannot read reaches the
         * language switch through this entry and the Preferences section
         * label, and a glyph that moved with the copy would be no help at all.
         */}
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserIcon />
            {t("account.area")}
          </Link>
        </DropdownMenuItem>
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
          <SidebarMenuButton
            asChild
            /*
             * The active item is an inset bar over a tint, not a grey pill
             * (ADR-0054 §5, `D11.3`).
             *
             * Every class here is `data-[active=true]:`-prefixed and every one
             * displaces a class the primitive spells with the same modifier
             * *and* the same property group, which is what `tailwind-merge`
             * keys on: `bg-sidebar-accent` and `text-sidebar-accent-foreground`
             * lose to these, and the primitive stays byte-identical
             * (ADR-0047) — the design reaches it through the composition's
             * own class string, which is the sanctioned route.
             *
             * The bar is a `box-shadow`, not a border or a pseudo-element: a
             * border would move the label two pixels the moment a route became
             * active, and the shadow is drawn inside the button's own box.
             *
             * `text-sidebar-foreground`, not `text-foreground` — the `D11.3`
             * review's catch. Inside a `<Sidebar>` the scoped token is the
             * sidebar's, and the two happen to be the same value in both
             * themes today; naming the global one would have left this single
             * item behind the day the sheet re-points the drawer's foreground.
             */
            className="data-[active=true]:bg-primary-tint data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]"
            tooltip={t(label)}
          >
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
                  {/*
                   * The mark is a key too (`D7.6`). One letter reads as
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
          <SidebarGroupLabel>{t("nav.group")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavigationMenu />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/*
       * The version, and nothing else (ADR-0054 §5, `D11.3`).
       *
       * **`SidebarFooter` comes back, with a consumer this time.** `D8.5`
       * removed it because the account menu left for the shell's header and an
       * empty region kept "for symmetry" is the unexercised-surface defect
       * this repository keeps recording. It returns because the redesign gave
       * it exactly one job — and only that one: the reference drew a health
       * dot beside the string and the operator excluded it, because "all
       * systems normal" implies a poll nothing here performs.
       *
       * 48px, mono, right-aligned, `--muted-foreground`: it is a fact to look
       * up when reporting a problem, not something to read on the way past.
       * `APP_VERSION` is substituted at build time from
       * `apps/admin/package.json` — see `shared/config`.
       *
       * Hidden when the rail is collapsed rather than truncated into it: a
       * 3rem column cannot hold a version string, and the two characters that
       * would survive are worse than nothing.
       */}
      <SidebarFooter className="h-12 justify-center border-t border-sidebar-border px-3 py-0 group-data-[collapsible=icon]:hidden">
        <span className="truncate text-right font-mono text-xs text-muted-foreground">
          {t("brand.version", { version: APP_VERSION })}
        </span>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
};
