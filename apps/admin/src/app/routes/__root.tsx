import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { QueryClient } from "@tanstack/react-query";

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
 * ADR-0032 draws the context as `{ queryClient, session }`, and since `D3.5`
 * both are here. No loader uses the client yet; it is threaded through because
 * that is what lets a route loader call `ensureQueryData` with the same key and
 * function the hook uses (ADR-0034 §Entity API), and adding it later would
 * mean touching every route file that had already typed its context.
 */

export interface RouterContext {
  readonly session: SessionStore;
  readonly queryClient: QueryClient;
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
