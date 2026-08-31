import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { SessionStore } from "@/shared/api/session-store";
import { Toaster } from "@/shared/ui";

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
 * `ensureQueryData` and a loader is not a component and has no hooks.
 *
 * **`D12.6` brought the query client and did *not* bring a loader**, which is
 * the honest outcome of the rule rather than an exception to it. The account
 * area's sections read the profile through `useProfile` — a hook, in a
 * component, under `QueryClientProvider` — so nothing in this app calls
 * `ensureQueryData` yet, and a context field nothing reads would be a claim the
 * compiler cannot check. The two join when the first loader does, which
 * ADR-0055 §5 says arrives with the first domain entity.
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
      {/*
       * Mounted once, at the root — ADR-0034 owns what it renders (`D12.6`).
       * `D12.2` left it out on the grounds that a surface with nothing to put
       * on it is chrome that only looks like a decision; the query client's
       * global mutation cache is what now puts something on it.
       *
       * At the root rather than under `_dashboard`, because a failure that
       * matters can happen on the sign-in screen too.
       */}
      <Toaster />
    </>
  );
}
