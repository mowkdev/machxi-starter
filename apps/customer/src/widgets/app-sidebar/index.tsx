import { Link } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  HouseIcon,
  LogOutIcon,
  UserIcon,
} from "lucide-react";

import { useSignOut } from "@/features/auth";

import { useSession } from "@/shared/api/context";
import { APP_VERSION } from "@/shared/config";
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
  readonly to: "/";
  /** A key in `common:nav`, not a sentence (ADR-0046 §3: navigation is chrome). */
  readonly label: "nav.home";
  readonly icon: typeof HouseIcon;
}

const NAVIGATION: readonly NavItem[] = [
  { to: "/", label: "nav.home", icon: HouseIcon },
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
 * **The `/account` link is written before its route exists** and points at the
 * area rather than at a section, which is ADR-0053 §1's shape: the index route
 * chooses the first section, so a fourth section later costs nothing here. It
 * lands at `D12.6`; until then the typed `to` would not compile, so the item is
 * an `href` on an anchor the router does not own — see its own comment.
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
           * A plain `<a href>`, and the one place in this app that is not a
           * typed `<Link>` (ADR-0049 §Routing).
           *
           * `/account` is `D12.6`'s, and `Link`'s `to` is checked against the
           * generated route tree — so the typed form does not compile until
           * that step, and the alternatives are worse: a `to={"/account" as
           * never}` cast would silence the very check the typed router exists
           * for, and leaving the entry out would ship a menu ADR-0053 §2 says
           * has three things with two in it. The href is asserted by the
           * suite, so the swap at `D12.6` is a one-line change with a test
           * already standing over it.
           *
           * **The cost, stated rather than glossed: this is a hard
           * navigation.** A bare anchor reloads the document, so between now
           * and `D12.6` clicking it costs a full boot — the in-memory access
           * token goes and comes back through the ADR-0033 CSRF-and-refresh
           * sequence — and lands on the not-found screen, because the route it
           * names does not exist yet. That is the honest shape of a menu entry
           * written one step ahead of its destination; it is temporary by
           * construction, and `D12.6` is where it stops being an anchor.
           */}
          <a href="/account">
            {/*
             * The icon is ADR-0053 §2's mitigation and the reason it is
             * stable: a customer stranded in a language they cannot read
             * reaches the language switch through this entry and the
             * Preferences section label, and a glyph that moved with the copy
             * would be no help at all.
             */}
            <UserIcon />
            {t("account.area")}
          </a>
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/">
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
              {NAVIGATION.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
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
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/*
       * The version, and nothing else (ADR-0054 §5).
       *
       * 48px, mono, right-aligned, `--muted-foreground`: it is a fact to look
       * up when reporting a problem, not something to read on the way past.
       * `APP_VERSION` is substituted at build time from
       * `apps/customer/package.json` — see `shared/config` and
       * `app-version.ts`, which is where the "never an env var, never a git
       * SHA" argument lives.
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
