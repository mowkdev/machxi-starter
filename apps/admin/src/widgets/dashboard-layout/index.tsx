import type { ReactNode } from "react";

import { AppShell } from "@/shared/ui";

/**
 * The `_dashboard` layout's widget: a thin adapter over `@repo/ui`'s `AppShell`
 * (ADR-0049 §The-shell-adapter, ADR-0048 §2).
 *
 * **It renders no layout markup of its own, and that is its whole job.** The
 * layer owns the composition's *contents* — the typed route links and the
 * `can()` join inside `AppSidebar`, the resolved `staticData.title` — and the
 * package owns its *geometry*. The height contract (ADR-0037) and the
 * `data-slot="page-container"` / `data-full-height` pair moved to the
 * composition with the markup that carries them; a widget that rendered a
 * wrapper here would put itself between them and the page, which is the one
 * failure this adapter has available to it.
 *
 * The sidebar arrives as a prop rather than as an import, and that is the
 * dependency rule doing its job rather than an awkward signature. `app-sidebar`
 * is a sibling widget — navigation and the current principal change for
 * different reasons than the frame around a page — and ADR-0049 allows no
 * sideways imports, so the layer that may see both composes them: the
 * `_dashboard` route file, which is wiring. It arrives as **one node**, not as
 * region fragments: the app's `<Sidebar>` is the whole drawer, header and rail
 * included.
 *
 * `title` and `fullHeight` are props instead of router lookups because the
 * router-driven version wants route `staticData` the layout would have to read;
 * the route file reads it and passes it down for the same reason.
 */
export const DashboardLayout = ({
  children,
  sidebar,
  headerEnd,
  breadcrumbs,
  banner,
  title,
  description,
  fullHeight = false,
  navigating = false,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  /**
   * The account menu (`D8.5`), composed by the `_dashboard` route file and
   * placed here. It arrives as a prop rather than as an import for the reason
   * `sidebar` does — and this file imports no `AccountMenu`, which is the
   * assertion the layering rule turns on: `boundaries` would permit the
   * import, so what forbids it is that a frame reaching for the account menu
   * is a frame that knows a principal exists (ADR-0049 §The-shell-adapter).
   */
  headerEnd?: ReactNode;
  /**
   * The trail, composed by the `_dashboard` route file (`D8.6`). JSX, not
   * crumb data, for the reason `sidebar` is one node: a frame that took labels
   * and hrefs would be a frame that knows about routing.
   */
  breadcrumbs?: ReactNode;
  /**
   * The banner region's content (`D8.7`). The dev-only pseudo-locale notice
   * today, D13's impersonation banner next. A prop rather than something this
   * widget decides, for the reason it decides nothing else: a frame that knew
   * *why* a banner shows is not a frame.
   */
  banner?: ReactNode;
  title: string;
  /**
   * The page-header band's second line (`D11.3`, ADR-0054 §5). It travels the
   * channel `title` travels for the identical reason: the description is
   * per-route `staticData`, the route file reads it, and this frame places
   * what it is handed.
   *
   * **`pageActions` is deliberately not here yet.** `AppShell` has the slot,
   * because the record names it; nothing in this app fills it until `D11.6`
   * puts the density control in the band, and an adapter prop no caller passes
   * is the defect ADR-0048 §2 spends a paragraph on.
   */
  description?: string | undefined;
  fullHeight?: boolean;
  /**
   * A navigation is in flight (`D10.1`, ADR-0052 §Felt navigation). It travels
   * as a prop for exactly the reason `title` and `fullHeight` do: the answer
   * comes from `useRouterState`, the frame may not know a router exists, and
   * the layer that already reads route meta reads this too.
   */
  navigating?: boolean;
}) => (
  <AppShell
    banner={banner}
    breadcrumbs={breadcrumbs}
    description={description}
    fullHeight={fullHeight}
    headerEnd={headerEnd}
    navigating={navigating}
    sidebar={sidebar}
    title={title}
  >
    {children}
  </AppShell>
);
