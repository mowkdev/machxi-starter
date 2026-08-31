import { RouterProvider, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";

import { routeTree } from "../routeTree.gen";

/**
 * The router (ADR-0049 §Routing).
 *
 * `app/providers` is wiring, which is what the `app` layer is for: this is the
 * only place that knows the generated route tree, and every route file below
 * reaches its dependencies through the router's context rather than by
 * importing a singleton.
 *
 * `createAppRouter` takes its dependencies instead of building them, so a test
 * renders the real route tree on a memory history. The parameter list is one
 * entry long today and grows at `D12.2` with the session store, the query
 * client and the API client — the shape the admin's has, arriving with the
 * things that fill it rather than ahead of them.
 *
 * The app's own router is built **once, here at module scope**, which is what
 * ADR-0049's `const router = createRouter(...)` means and not merely how it
 * reads: constructing it inside `AppRouter` would hand `RouterProvider` a new
 * router on every re-render and throw away navigation state.
 */

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }

  /*
   * `StaticDataRouteOption` is **not** declared here: the channel's shape is
   * `@repo/app-services/route-meta`'s, beside the hooks that read it
   * (ADR-0051). Declaration merging is program-global, so every
   * `createFileRoute` in this app still gets the same typed `staticData` and
   * the same compile error for a typo.
   *
   * `Register.router` stays, because it names this app's own `createAppRouter`
   * and could not mean anything anywhere else.
   */
}

export interface AppRouterOptions {
  /** A memory history under test; the browser's own history in the app. */
  readonly history?: RouterHistory;
}

export const createAppRouter = ({ history }: AppRouterOptions = {}) =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes`
    // (ADR-0002) distinguishes "absent" from "explicitly undefined", and the
    // router's own option is the former.
    ...(history ? { history } : {}),
  });

const appRouter = createAppRouter();

export const AppRouter = () => <RouterProvider router={appRouter} />;
