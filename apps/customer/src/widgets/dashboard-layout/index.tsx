import type { ReactNode } from "react";

import { AppShell } from "@/shared/ui";

/**
 * The `_dashboard` layout's widget: a thin adapter over `@repo/ui`'s `AppShell`
 * (ADR-0049 §The-shell-adapter, ADR-0048 §2 as carried by ADR-0054 §5).
 *
 * **It renders no layout markup of its own, and that is its whole job.** The
 * layer owns the composition's *contents* — the typed route links inside
 * `AppSidebar`, the resolved `staticData.title` — and the package owns its
 * *geometry*. The height contract and the
 * `data-slot="page-container"` / `data-full-height` pair live in the
 * composition with the markup that carries them; a widget that rendered a
 * wrapper here would put itself between them and the page, which is the one
 * failure this adapter has available to it.
 *
 * The sidebar arrives as a prop rather than as an import, and that is the
 * dependency rule doing its job rather than an awkward signature. `app-sidebar`
 * is a sibling widget — navigation and the current principal change for
 * different reasons than the frame around a page — so the layer that may see
 * both composes them: the `_dashboard` route file, which is wiring. It arrives
 * as **one node**, not as region fragments: the app's `<Sidebar>` is the whole
 * drawer, header, footer and rail included.
 *
 * **This is the admin's adapter minus the props nothing in this app hands it,
 * and the subtraction is the decision.** `AppShell` offers `breadcrumbs`,
 * `banner`, `description`, `pageActions` and `fullHeight` as well; a prop
 * declared here would be `undefined` on every screen this app ships, which is
 * the slot-with-no-consumer defect ADR-0048 §2 spends a paragraph on, one layer
 * down. Each has a step that will name its consumer, and each is one line then:
 * `banner` at `D12.7` with the pseudo-locale notice, `description` at `D12.6`
 * when the account sections declare one, and `breadcrumbs`, `pageActions` and
 * `fullHeight` with the first domain entity — which is what ADR-0055 §3 says
 * brings the grid.
 *
 * `title` and `navigating` are props instead of router lookups because the
 * router-driven version wants route `staticData` and `useRouterState`, which
 * the frame must not know exist (ADR-0047): the route file reads both and
 * passes them down.
 */
export const DashboardLayout = ({
  children,
  sidebar,
  headerEnd,
  title,
  navigating = false,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  /**
   * The account control (ADR-0053 §2), composed by the `_dashboard` route file
   * and placed here. It arrives as a prop rather than as an import for the
   * reason `sidebar` does — and this file imports no `AccountMenu`, which is
   * the assertion the layering rule turns on: `boundaries` would permit the
   * import, so what forbids it is that a frame reaching for the account
   * control is a frame that knows a principal exists.
   */
  headerEnd?: ReactNode;
  title: string;
  /**
   * A navigation is in flight (ADR-0052 §Felt navigation, the delta on
   * ADR-0048 §2 this app inherits with the shell). It travels as a prop for
   * exactly the reason `title` does: the answer comes from `useRouterState`,
   * the frame may not know a router exists, and the layer that already reads
   * route meta reads this too.
   */
  navigating?: boolean;
}) => (
  <AppShell
    headerEnd={headerEnd}
    navigating={navigating}
    sidebar={sidebar}
    title={title}
  >
    {children}
  </AppShell>
);
