import type { ReactNode } from "react";

import {
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
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
 * `title` is a prop instead of a breadcrumb read from the router because the
 * router-driven version wants route `staticData` the layout would have to look
 * up; the route file reads it and passes it down for the same reason.
 */
export const DashboardLayout = ({
  children,
  sidebar,
  title,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  title: string;
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
      <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
    </SidebarInset>
  </SidebarProvider>
);
