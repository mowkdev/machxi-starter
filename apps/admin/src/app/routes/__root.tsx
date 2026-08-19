import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { SessionStore } from "@/shared/api/session-store";
import { Toaster } from "@/shared/ui";

/**
 * The root route, and the declaration of what every guard and loader may read
 * (ADR-0032 §Layout topology).
 *
 * `createRootRouteWithContext` is what makes `context.session` typed inside a
 * `beforeLoad` rather than an `any` the next author has to guess at. The
 * context is *declared* here and *supplied* in `app/providers/router.tsx`.
 *
 * ADR-0032 draws the context as `{ queryClient, session }`. The query client
 * arrives with ADR-0034 in `D3.5`, and declaring the slot early would mean
 * importing a package this step does not depend on to name a type nothing
 * reads. Widening the context then touches this file and the provider — no
 * route file — so there is nothing to buy by pre-declaring it.
 */

export interface RouterContext {
  readonly session: SessionStore;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      {/* Mounted once, at the root — ADR-0034 owns what it renders. */}
      <Toaster />
    </>
  );
}
