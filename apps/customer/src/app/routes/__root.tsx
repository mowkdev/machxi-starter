import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { SessionStore } from "@/shared/api/session-store";

/**
 * The root route, and the declaration of what every guard and loader may read
 * (ADR-0049 §Layout topology).
 *
 * `createRootRouteWithContext` is what makes `context.session` typed inside a
 * `beforeLoad` rather than an `any` the next author has to guess at. The
 * context is *declared* here and *supplied* in `app/providers/router.tsx`.
 *
 * **One field, and the omission is deliberate.** The admin's context is
 * `{ session, queryClient, client }`, because its route loaders call
 * `ensureQueryData` and a loader is not a component and has no hooks. This app
 * has no loader until `D12.6`, and a context field nothing reads is a claim
 * the compiler cannot check — so the two join when the first loader does, in
 * the step that can prove they are used.
 */

export interface RouterContext {
  readonly session: SessionStore;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  /*
   * No `<Toaster>` yet: ADR-0034's global handlers are what render into one,
   * and they are built with the query client this app does not have until
   * `D12.6`. A surface with nothing to put on it is chrome that only looks
   * like a decision.
   */
  return <Outlet />;
}
