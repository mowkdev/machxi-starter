import type { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";

import { routeTree } from "../routeTree.gen";
import { createQueryClient } from "./query-client";
import { onSessionEnded, sessionStore } from "./session";

/**
 * The router, and the context its guards read (ADR-0032).
 *
 * `app/providers` is wiring, which is what the `app` layer is for: this is the
 * only place that knows both the generated route tree and the session store,
 * and every route file below reaches them through the typed context rather
 * than by importing a singleton.
 *
 * `createAppRouter` takes its dependencies instead of building them, so a test
 * renders the real route tree against a scripted session and a memory history
 * — the guard redirect is testable without a browser, and `D3.4` swaps the stub
 * for ADR-0033's store by changing one argument.
 *
 * The app's own router is built **once, here at module scope**, which is what
 * ADR-0032's `const router = createRouter(...)` means and not merely how it
 * reads. Constructing it inside `AppRouter` would hand `RouterProvider` a new
 * router on every re-render and throw away navigation state — latent while
 * nothing renders above it, and armed by the session provider (`D3.4`) and
 * `QueryClientProvider` (`D3.5`) that are going to.
 */

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }

  /**
   * Per-route data the shells read (ADR-0032: route files are wiring).
   * Declared here so `staticData.title` is typed at every `createFileRoute`,
   * and a typo is a compile error rather than a blank header.
   */
  interface StaticDataRouteOption {
    title?: string;
  }
}

export interface AppRouterOptions {
  /** The guard's view of the session; the app passes its singleton store. */
  readonly session?: SessionStore;
  /** A memory history under test; the browser's own history in the app. */
  readonly history?: RouterHistory;
  /** The cache route loaders may prime; the app passes its singleton. */
  readonly queryClient?: QueryClient;
}

export const createAppRouter = ({
  session,
  history,
  queryClient,
}: AppRouterOptions = {}) =>
  createRouter({
    routeTree,
    context: {
      session: session ?? createSessionStore(),
      queryClient: queryClient ?? createQueryClient(),
    },
    defaultPreload: "intent",
    // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes`
    // (ADR-0002) distinguishes "absent" from "explicitly undefined", and the
    // router's own option is the former.
    ...(history ? { history } : {}),
  });

const appRouter = createAppRouter({ session: sessionStore });

/*
 * When the client decides a session is over -- a terminal code, or a retry that
 * failed again -- the guards have to be asked again. Invalidating re-runs
 * `beforeLoad`, the `_dashboard` guard sees an empty store, and the redirect to
 * `/login` happens in the one place that owns it (ADR-0032: guards belong to
 * the route tree). The alternative, a `navigate` call inside the API client,
 * would put routing knowledge in `shared/api`.
 */
onSessionEnded(() => {
  void appRouter.invalidate();
});

export const AppRouter = ({ queryClient }: { queryClient: QueryClient }) => {
  // The router is built once at module scope; the app's client is handed to its
  // context here rather than at construction so both providers share one cache.
  appRouter.update({ context: { ...appRouter.options.context, queryClient } });

  return <RouterProvider router={appRouter} />;
};
