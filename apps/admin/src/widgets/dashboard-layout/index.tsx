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
  title,
  fullHeight = false,
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
  title: string;
  fullHeight?: boolean;
}) => (
  <AppShell
    breadcrumbs={breadcrumbs}
    fullHeight={fullHeight}
    headerEnd={headerEnd}
    sidebar={sidebar}
    title={title}
  >
    {children}
  </AppShell>
);
