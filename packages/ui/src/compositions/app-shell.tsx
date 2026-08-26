"use client";

import type { ReactNode } from "react";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

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
 * **`headerStart` and `pageActions` are deliberately not in the v1 API.**
 * Nothing fills either today, and a slot with no consumer is a defect this
 * repository has recorded twice. Each is one prop wide when a screen names it.
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
 * 3. **The page container is `flex min-w-0 flex-1 flex-col gap-4 p-4`
 *    unconditionally and gains `min-h-0` in full-height mode.** `min-w-0` is
 *    the second half of the `SidebarInset` fix: without it the container is
 *    floored at the min-content width of the widest table it holds and the
 *    excess escapes as a page-level horizontal scrollbar. `flex-1` is what
 *    gives `min-h-0` anything to override. `gap-4 p-4` is every screen's
 *    padding and gutter and belongs to the container rather than to each
 *    consumer.
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
 * `shrink-0`, each costs the budget exactly what the `h-16` header already
 * costs it: chrome takes what it declares, the scroll body takes the rest.
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
  /** ADR-0037's per-page opt-in, unchanged in meaning. */
  readonly fullHeight?: boolean;
  /** The page, inside the page container. */
  readonly children: ReactNode;
}

export const AppShell = ({
  sidebar,
  headerEnd,
  breadcrumbs,
  banner,
  title,
  fullHeight = false,
  children,
}: AppShellProps) => (
  <SidebarProvider>
    {sidebar}
    <SidebarInset className={cn(fullHeight && "h-svh")}>
      {banner ? (
        <div className="shrink-0 px-4 pt-4" data-slot="banner-region">
          {banner}
        </div>
      ) : null}
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        {breadcrumbs}
        {headerEnd ? <div className="ml-auto">{headerEnd}</div> : null}
      </header>
      <div
        className="flex shrink-0 items-center gap-2 px-4 pt-4"
        data-slot="page-header"
      >
        <h1 className="text-base font-medium">{title}</h1>
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4 p-4",
          fullHeight && "min-h-0",
        )}
        data-full-height={fullHeight ? "" : undefined}
        data-slot="page-container"
      >
        {children}
      </div>
    </SidebarInset>
  </SidebarProvider>
);
