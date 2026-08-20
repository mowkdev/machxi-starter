import type { ReactNode } from "react";

import {
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  cn,
} from "@/shared/ui";

/**
 * The `sidebar-07` shell (ADR-0031, ADR-0032): sidebar, header, outlet, behind
 * the pathless `_dashboard` route that guards every protected page.
 *
 * The sidebar arrives as a prop rather than as an import, and that is the
 * dependency rule doing its job rather than an awkward signature. `app-sidebar`
 * is a sibling widget — navigation and the current principal (`D3.9`) change
 * for different reasons than the frame around a page — and ADR-0032 allows no
 * sideways imports, so the layer that may see both composes them: the
 * `_dashboard` route file, which is wiring. The frame stays a pure frame.
 *
 * `title` and `fullHeight` are props instead of router lookups because the
 * router-driven version wants route `staticData` the layout would have to read;
 * the route file reads it and passes it down for the same reason.
 *
 * **The page container carries the flex contract** (ADR-0037). `min-w-0` is
 * unconditional and is the second half of the fix `SidebarInset` got in
 * `@repo/ui`: without it this container is floored at the min-content width of
 * whatever it holds, and a wide table pushes a horizontal scrollbar onto the
 * document. `min-h-0` is the `fullHeight` half, and it is a choice per page
 * rather than a shell default: with it the container is a height budget its
 * child divides up, and without it the container grows with its content and the
 * document scrolls, which is what a form taller than the viewport wants.
 *
 * Anything inserted between here and a grid carries the same two classes or the
 * budget silently reverts to document scroll — ADR-0037 §Consequences states
 * that as a reviewable rule, and this is the wrapper it starts at.
 */
export const DashboardLayout = ({
  children,
  sidebar,
  title,
  fullHeight = false,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  title: string;
  fullHeight?: boolean;
}) => (
  <SidebarProvider>
    {sidebar}
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />
        <h1 className="text-base font-medium">{title}</h1>
      </header>
      <div
        data-slot="page-container"
        data-full-height={fullHeight ? "" : undefined}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4 p-4",
          fullHeight && "min-h-0",
        )}
      >
        {children}
      </div>
    </SidebarInset>
  </SidebarProvider>
);
