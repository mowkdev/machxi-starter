import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { QueryClient } from "@tanstack/react-query";

import type { ApiClient } from "@/shared/api/client";
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
 * both are here. No loader used the client until `D4.2`; it was threaded
 * through because that is what lets a route loader call `ensureQueryData` with
 * the same key and function the hook uses (ADR-0034 §Entity API), and adding it
 * later would mean touching every route file that had already typed its
 * context.
 *
 * **`client` joined them at `D4.2`** (ADR-0040, amended). ADR-0040 writes a
 * loader's query as `queryFn: () => getStaff(id)`, which this repository cannot
 * spell that way: an entity's API surface is a `create<Entity>Api(client)`
 * factory reached through `useApiClient()`, and a loader is not a component and
 * has no hooks. So the client travels the same road the query cache does. That
 * is ADR-0032's rule working rather than bending — it says the context carries
 * "what guards and loaders need", and a loader that fetches needs this — and
 * it keeps ADR-0036's posture intact: `renderApp` passes a client built for the
 * test, and nothing anywhere reaches for the module-scope singleton.
 */

export interface RouterContext {
  readonly session: SessionStore;
  readonly queryClient: QueryClient;
  /** What a loader fetches through; the same instance the hooks use. */
  readonly client: ApiClient;
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
