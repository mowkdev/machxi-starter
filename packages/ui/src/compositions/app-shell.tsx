"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  PageActionsProvider,
  PageActionsTarget,
} from "@repo/ui/compositions/page-actions";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";
import { useUiStrings } from "@repo/ui/ui-strings";

/**
 * The application shell both apps of this shape are built from (ADR-0048 §2).
 *
 * **It knows nothing about routing or authorization.** Navigation arrives as
 * JSX in one node, breadcrumbs arrive composed, the account menu arrives in a
 * slot: the `can()` join (ADR-0042) and the typed route links stay in the app
 * that owns them. No `@repo/contracts` import, no principal, no router — the
 * boundary is checkable rather than asserted, because none of those packages
 * is a dependency of this one (ADR-0047 §What-code).
 *
 * **The drawer arrives as one node, not as three regions.** An earlier draft
 * of the record gave the shell `brand`/`nav`/`sidebarFooter`; that shape
 * cannot be filled, because a consumer's sidebar *is* the `<Sidebar>` with its
 * header, content, footer and rail. `collapsible="icon"` and the mobile
 * `Sheet` swap stay the primitive's, inside the app's node.
 *
 * **`headerStart` is deliberately not in the API.** Nothing fills it, and a
 * slot with no consumer is a defect this repository has recorded twice. It is
 * one prop wide when a screen names it — which is exactly how `description`
 * and `pageActions` arrived at `D11.3` (ADR-0054 §5): the band layout named
 * them, so the shell grew the width for them.
 *
 * ## The bands (ADR-0054 §5, `D11.3`)
 *
 * The inset is a stack of full-width bands rather than a padded document: a
 * **56px header** (breadcrumb left, account control right), then the
 * **page-header band** (title, description, actions), then whatever the page
 * puts below — for a grid, its own toolbar, filter and pager bands. The
 * sidebar is **240px**, set here rather than in a consumer because the width
 * is one of the three custom properties the whole drawer divides and only the
 * `sidebar-wrapper` sees both the gap element and the fixed container. A
 * consumer setting it on its own `<Sidebar>` would move the drawer and leave
 * the gap it reserves at the primitive's 16rem.
 *
 * ## The height contract is this component's, and it is a chain of three
 *
 * ADR-0037 restated as one component's responsibility, every link owned here
 * so no consumer can drop one:
 *
 * 1. **`SidebarProvider`'s `min-h-svh`** (on its `sidebar-wrapper` div) is a
 *    floor, not a ceiling: the frame is a viewport tall while the content
 *    fits, and grows past it when a grid is taller.
 * 2. **`SidebarInset` gains `h-svh` in full-height mode**, which is what makes
 *    the height *definite* — a budget needs one to divide. Document-flowed
 *    pages are left alone.
 * 3. **The page container is `flex min-w-0 flex-1 flex-col` unconditionally,
 *    and in full-height mode gains `min-h-0` while dropping the gutter.**
 *    `min-w-0` is the second half of the `SidebarInset` fix: without it the
 *    container is floored at the min-content width of the widest table it
 *    holds and the excess escapes as a page-level horizontal scrollbar.
 *    `flex-1` is what gives `min-h-0` anything to override. `gap-4 p-4` is
 *    every document page's padding and gutter and belongs to the container
 *    rather than to each consumer.
 *
 * **The gutter is the full-bleed variant, and `fullHeight` selects it**
 * (ADR-0054 §5, amended at `D11.3`). A band layout runs its chrome to the
 * inset's edges; a document page keeps `gap-4 p-4`. The record decided the
 * variant and left the switch open, and this is it: a height-budgeted page and
 * a band layout are the same category of page — every screen in both apps that
 * declares one declares the other — so a second always-equal boolean would be
 * the slot-with-no-consumer defect wearing a different coat. The day a screen
 * wants one without the other is the day the flag splits, and it will have a
 * consumer to name.
 *
 * Collapsing these onto one element drops `h-svh` and breaks the chain
 * everything below divides. jsdom lays nothing out, so no test would say so —
 * which is why the package suite asserts the class strings themselves.
 *
 * **`data-slot="page-container"` and `data-full-height` stay on the same
 * element**, the latter present as an empty string when on and absent when
 * off. That is the producing form today and one the consuming app's routing
 * tests cannot police: their on-case assertion is a valueless
 * `toHaveAttribute`, which would accept `"true"` just as silently.
 *
 * **The chrome above the page container is in-flow `shrink-0` siblings, never
 * children of it.** A row inside the `min-h-0` box becomes a new in-flow
 * sibling of `children` and silently takes height from every grid. Outside and
 * `shrink-0`, each costs the budget exactly what the 56px header already
 * costs it: chrome takes what it declares, the scroll body takes the rest.
 *
 * **`navigating` is the one exception, and it is out of flow for that reason**
 * (ADR-0052 §Felt navigation). Every other slot here is either always present
 * or decided once per screen; this one appears and disappears on every click,
 * and an in-flow bar would take two pixels from the height budget for the
 * duration of a navigation and hand them back — a grid that reflows because
 * the app is telling you it is busy. `absolute inset-x-0 top-0` inside the
 * inset (which the primitive already positions `relative`) costs the budget
 * nothing at all, in both states.
 */

export interface AppShellProps {
  /** The whole drawer as one node — the app's `<Sidebar>`, not three fragments. */
  readonly sidebar: ReactNode;
  /** Beside the trigger, which stays the shell's. The account menu today. */
  readonly headerEnd?: ReactNode;
  /** The header row's trail, composed by the app: JSX, not crumb data. */
  readonly breadcrumbs?: ReactNode;
  /**
   * The content column's width, above the header, inside the inset (§3).
   * Renders nothing at all — not an empty `div` — when handed nothing, because
   * an element that reserved space would shift every grid page's budget.
   */
  readonly banner?: ReactNode;
  /**
   * The page header: the row the screen's single `<h1>` lives in. A `string`
   * rather than a `ReactNode`, and narrower on purpose — every named consumer
   * hands one (the adapter's `staticData.title`, and `recordLabel ?? title`
   * from `D8.6`), and a node would let a caller put a second heading inside
   * the `<h1>` and break ADR-0044's exactly-one-heading invariant with the
   * compiler silent.
   */
  readonly title: string;
  /**
   * The line under the title, in the page-header band (ADR-0054 §5).
   *
   * A `string` for the reason `title` is one: it is a sentence about the
   * screen, and a node here would be an invitation to put a second heading —
   * or a whole toolbar — under the `<h1>`. Absent renders no element at all,
   * the same rule the banner region obeys, so a screen without a description
   * pays nothing for the slot.
   */
  /*
   * `| undefined` explicitly, because `exactOptionalPropertyTypes` is on in
   * every consumer: a route that declares no description resolves to
   * `undefined`, and without this the adapter could not pass what it has.
   */
  readonly description?: string | undefined;
  /**
   * The band's right-hand side: the controls that act on the whole page
   * rather than on the rows (ADR-0054 §5). Icon buttons and the primary.
   *
   * Named here rather than left for a later prop because the record names its
   * consumer: `D11.6`'s 34×34 density control lives in this band. Renders no
   * wrapper when handed nothing.
   */
  readonly pageActions?: ReactNode;
  /**
   * ADR-0037's per-page opt-in, unchanged in meaning — and, since `D11.3`,
   * the switch for ADR-0054 §5's full-bleed page container: a height-budgeted
   * page is a band layout, and a document page keeps the `p-4` gutter.
   */
  readonly fullHeight?: boolean;
  /**
   * A navigation is in flight (ADR-0052 §Felt navigation, the delta on
   * ADR-0048 §2). Renders a slim indeterminate bar across the top of the
   * inset; absent or `false` renders nothing at all.
   *
   * **The shell does not compute this and must not.** `useRouterState` would
   * make the router a dependency of the design system and end the boundary
   * ADR-0047 draws — so the app answers the question and hands down a boolean,
   * exactly as it does for `fullHeight`. What the shell owns is the geometry
   * of the answer.
   */
  readonly navigating?: boolean;
  /** The page, inside the page container. */
  readonly children: ReactNode;
}

export const AppShell = ({
  sidebar,
  headerEnd,
  breadcrumbs,
  banner,
  title,
  description,
  pageActions,
  fullHeight = false,
  navigating = false,
  children,
}: AppShellProps) => {
  const { navigating: navigatingLabel } = useUiStrings();

  return (
    /*
     * 240px, not the primitive's 16rem (ADR-0054 §5). It is set on the
     * provider because the wrapper is the one element both halves of the
     * drawer read it from — the gap that reserves the column and the fixed
     * container that fills it — and the primitive stays byte-identical
     * (ADR-0047): the value arrives as the `style` it already merges.
     */
    <SidebarProvider style={{ "--sidebar-width": "240px" } as CSSProperties}>
      {/*
       * Inside the sidebar provider rather than around it, because a context
       * provider renders no element: the drawer and the inset stay the same
       * two flex children of the same wrapper, and the band below can be
       * reached from anywhere in either of them (`D11.12`).
       */}
      <PageActionsProvider>
        {sidebar}
        <SidebarInset className={cn(fullHeight && "h-svh")}>
          {navigating ? (
            /*
             * `role="progressbar"` with no `aria-valuenow` is the ARIA spelling
             * of indeterminate — the bar knows a navigation is running and
             * nothing about how far along it is, which is the truth. The name
             * comes through `UiStrings` like every other word this package says
             * out loud (ADR-0046 §12): the design system still names no i18n
             * dependency.
             */
            <div
              aria-label={navigatingLabel}
              className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/20"
              data-slot="navigation-indicator"
              role="progressbar"
            >
              {/*
               * The runner, and its reduced-motion answer: `animate-none` alone
               * would leave a third of a bar frozen at the left edge saying
               * nothing, so the same state renders as a full static bar. The
               * feedback survives the preference; only the motion goes.
               */}
              <div className="h-full w-1/3 animate-navigation-indeterminate bg-primary motion-reduce:w-full motion-reduce:animate-none" />
            </div>
          ) : null}
          {banner ? (
            <div className="shrink-0 px-4 pt-4" data-slot="banner-region">
              {banner}
            </div>
          ) : null}
          {/* 56px, and the first of ADR-0054 §5's bands. */}
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            {breadcrumbs}
            {headerEnd ? <div className="ml-auto">{headerEnd}</div> : null}
          </header>
          {/*
           * The page-header band: title and description left, actions right
           * (ADR-0054 §5). Its height stays content-driven rather than declared,
           * which is ADR-0048's decision and the reason a description can be
           * added to a screen without re-budgeting the grid below it.
           */}
          <div
            className="flex shrink-0 items-center gap-3 px-4 py-3"
            data-slot="page-header"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h1 className="truncate text-[20px] leading-[26px] font-semibold">
                {title}
              </h1>
              {/*
               * No element when there is no description — the banner region's
               * rule, for the banner region's reason: an empty `<p>` with the
               * band's own `gap` above it is a line of blank space on every
               * screen that never wanted one.
               */}
              {description === undefined ? null : (
                <p
                  className="truncate text-[13px] text-muted-foreground"
                  data-slot="page-description"
                >
                  {description}
                </p>
              )}
            </div>
            {/*
             * The group renders when the app hands it something, and the
             * portal's landing site rides inside it (`D11.12`, ADR-0054 §5).
             *
             * **The shell's half of the contract is all it can state**: the
             * target listens exactly when this slot is filled, so a consumer
             * that wants to hoist into it must fill it. Whether that lines up
             * with "every page holding a grid" is a routing question, and
             * ADR-0048 §2 keeps routing out of here — `apps/admin` decides it
             * in `_dashboard.tsx`, where `fullHeight` is read. A consumer that
             * gets it wrong finds no container and keeps its controls, which
             * is {@link usePageActionsContainer}'s documented `null` rather
             * than a failure.
             */}
            {pageActions ? (
              <div
                className="flex shrink-0 items-center gap-2"
                data-slot="page-actions"
              >
                {pageActions}
                <PageActionsTarget />
              </div>
            ) : null}
          </div>
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              fullHeight ? "min-h-0" : "gap-4 p-4",
            )}
            data-full-height={fullHeight ? "" : undefined}
            data-slot="page-container"
          >
            {children}
          </div>
        </SidebarInset>
      </PageActionsProvider>
    </SidebarProvider>
  );
};
