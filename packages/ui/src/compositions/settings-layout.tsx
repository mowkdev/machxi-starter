import type { ReactNode } from "react";

/**
 * The account area's two-pane arrangement (ADR-0053 §4, ADR-0054 §7).
 *
 * A section nav beside a content pane, stacking on a narrow viewport. Both
 * apps' settings areas are this shape and only this shape: `apps/admin`'s
 * three sections land at `D11.9`–`D11.10`, and the customer app's differ
 * already — its security section gains delete-account (ADR-0028) — which is
 * exactly why **the sections are the app's and only the geometry is shared**.
 * ADR-0048 §2's slot-honesty rule is satisfied by name rather than by hope.
 *
 * **Routing-ignorant, the same division `AppShell` makes.** The nav arrives as
 * {@link SettingsLayoutProps.nav} — the app's own rendered `<Link>`s, carrying
 * their own active state — because a composition that knew what "active" meant
 * would be a composition that had learned the router. There is no
 * `@tanstack/react-router` import here and there cannot be one: the package
 * does not depend on it, so reaching for it is a red `check-types` rather than
 * a convention someone has to remember. The same holds for `@repo/contracts`
 * and for anything that knows a section by name.
 *
 * **`navLabel` is a prop, not a `UiStrings` key**, and the division is
 * `AppShell`'s. `UiStrings` carries the words this package invents on its own
 * behalf — `Close`, `Navigating`, `Dismiss` — with an English default that is
 * right in every consumer. The landmark's name is not one of those: it names
 * *the app's own set of sections*, the way `AppShell`'s `title` names the
 * app's own screen, and an English default here would be a guess about an area
 * the customer app has not named yet. So it arrives beside the nodes it
 * describes, and no consumer can render an unnamed landmark by forgetting it.
 *
 * ## The geometry (ADR-0054 §7, amended at `D11.8`)
 *
 * A 220px nav column, a 32px gap and a content column capped at 720px, over
 * §3's 16px card stack. Every one of those is the reference's own value; the
 * layout supplies **no outer padding at all**, because `/account` is a
 * document page and ADR-0054 §5's page container already spends the 16px
 * gutter on it. A composition that added its own would inset the area twice.
 *
 * The collapse is one breakpoint: below `md` the panes stack and the nav wraps
 * into a row above the content, above `md` the nav is the fixed left column.
 * The nav's own items are the app's nodes, so the wrap is what keeps a narrow
 * viewport from needing an overflow rule this composition would have to
 * enforce on children it does not own.
 */

/**
 * `flex-1` so the area fills the page container's column, which is what gives
 * the content pane's own `flex-1` a column to fill — and `min-w-0` for the
 * reason ADR-0048 §2 gives the shell's own container: a
 * flex child is floored at its content's min-content width, and a long email
 * in the profile summary would push the whole area wide rather than wrap.
 */
const LAYOUT = "flex min-w-0 flex-1 flex-col gap-8 md:flex-row";

/**
 * The nav column: 220px, and `shrink-0` so it keeps that against a wide
 * content pane.
 *
 * `flex-wrap` below `md` and `md:flex-nowrap` above it, which is not
 * redundant: a wrapping *column* with a definite height — and this one has
 * one, because the row's items stretch — breaks into a second column the
 * moment the sections outgrow the viewport, which is a nav that has quietly
 * moved rather than scrolled.
 */
const NAV =
  "flex shrink-0 flex-wrap gap-0.5 md:w-[220px] md:flex-col md:flex-nowrap";

/**
 * The content column, over §3's 16px card stack — the gap between the cards a
 * section is made of, which every section in both apps is.
 *
 * The cap is the reference's 720 and it is unconditional — a `md:` prefix on
 * it would be one more class a later re-tune of the collapse could drop
 * without the layout looking any different at the width it was tested at. It
 * is not inert while stacked: below `md` the cap still engages in the narrow
 * band between 720 and the breakpoint, and holding the same measure there is
 * the behaviour wanted anyway.
 */
const CONTENT = "flex min-w-0 max-w-[720px] flex-1 flex-col gap-4";

export interface SettingsLayoutProps {
  /**
   * The landmark's accessible name — "Account sections" in `apps/admin`.
   * Required, because a second `<nav>` on a page that already has the shell's
   * breadcrumb trail is exactly the case where an unnamed landmark leaves a
   * screen reader with two identical entries in its rotor.
   */
  readonly navLabel: string;
  /** The section links, rendered by the app. JSX, not section data. */
  readonly nav: ReactNode;
  /** The section itself — the cards `pages/account` composes. */
  readonly children: ReactNode;
}

export const SettingsLayout = ({
  navLabel,
  nav,
  children,
}: SettingsLayoutProps) => (
  <div className={LAYOUT} data-slot="settings-layout">
    <nav aria-label={navLabel} className={NAV} data-slot="settings-nav">
      {nav}
    </nav>
    <div className={CONTENT} data-slot="settings-content">
      {children}
    </div>
  </div>
);
