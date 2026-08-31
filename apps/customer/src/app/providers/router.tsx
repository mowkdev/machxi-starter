import {
  RouterProvider,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { AppError, AppNotFound } from "@/shared/ui";

import { routeTree } from "../routeTree.gen";
import { onSessionEnded, sessionStore } from "./session";

/**
 * The router, and the context its guards read (ADR-0049 §Routing).
 *
 * `app/providers` is wiring, which is what the `app` layer is for: this is the
 * only place that knows both the generated route tree and the session store,
 * and every route file below reaches it through the typed context rather than
 * by importing a singleton.
 *
 * `createAppRouter` takes its dependencies instead of building them, so a test
 * renders the real route tree against a scripted session and a memory history
 * — the guard redirect is testable without a browser.
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
  /** The guard's view of the session; the app passes its singleton store. */
  readonly session?: SessionStore;
  /** A memory history under test; the browser's own history in the app. */
  readonly history?: RouterHistory;
  /**
   * How this router learns that the API client has ended the session
   * (`D12.2`'s review).
   *
   * A parameter rather than a module-level call, because a module-level call
   * can only ever wire the module-level router — so the join was unreachable
   * from every test, and deleting it left lint, types and the whole suite
   * green while a terminal `401` mid-use left a customer sitting on a
   * protected screen with a cleared store. It is the one control that ejects
   * them, and it now travels the same road every other dependency does.
   */
  readonly registerSessionEnded?: (handler: () => void) => void;
}

export const createAppRouter = ({
  session,
  history,
  registerSessionEnded = onSessionEnded,
}: AppRouterOptions = {}) => {
  const store = session ?? createSessionStore();

  const router = createRouter({
    routeTree,
    /*
     * `{ session }` and nothing else, which is what this app's routes can
     * truthfully read today. The admin's context also carries `queryClient` and
     * `client`, because its loaders prime the cache (ADR-0043) — this app has
     * no loader until `D12.6` gives it something to fetch, and a context field
     * with no reader is a claim the compiler cannot check. The two join it in
     * the step that needs them.
     */
    context: { session: store },
    defaultPreload: "intent",
    /*
     * What a customer meets when a route throws or an address matches nothing
     * (`D12.2`'s review). The router's own defaults render `error.message` —
     * the API's developer-facing English default (ADR-0013) — behind a **Show
     * Error** button that ships in production. See `shared/ui/app-error.tsx`.
     */
    defaultErrorComponent: AppError,
    defaultNotFoundComponent: AppNotFound,
    // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes`
    // (ADR-0002) distinguishes "absent" from "explicitly undefined", and the
    // router's own option is the former.
    ...(history ? { history } : {}),
  });

  /*
   * When the client decides a session is over — a terminal code, or a retry
   * that failed again — the guards have to be asked again. Invalidating re-runs
   * `beforeLoad`, the `_dashboard` guard sees an empty store, and the redirect
   * to `/login` happens in the one place that owns it (ADR-0049: guards belong
   * to the route tree). The alternative, a `navigate` call inside the API
   * client, would put routing knowledge in `shared/api`.
   */
  registerSessionEnded(() => {
    void router.invalidate();
  });

  return router;
};

const appRouter = createAppRouter({ session: sessionStore });

export const AppRouter = () => <RouterProvider router={appRouter} />;
