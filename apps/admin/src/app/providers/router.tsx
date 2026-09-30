import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  RouterProvider,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import type { ApiClient } from "@/shared/api/client";
import {
  parseAdminSearch,
  stringifyAdminSearch,
} from "@/shared/api/search-params";
import { createQueryClient } from "@/shared/api/query-client";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import {
  AppError,
  AppNotFound,
  AppPending,
  PENDING_MIN_MS,
  PENDING_MS,
} from "@/shared/ui";

import { routeTree } from "../routeTree.gen";
import { apiClient, onSessionEnded, sessionStore } from "./session";

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

  /*
   * **`StaticDataRouteOption` is no longer declared here** (`D9.6`,
   * ADR-0051). The channel's shape moved to `@repo/app-services/route-meta`,
   * beside the four hooks that read it — a package that reads
   * `match.staticData.title` must own the property or type-check against
   * nothing, and the contract and its readers drifting apart is the failure
   * the move prevents. Declaration merging is program-global, so every
   * `createFileRoute` below still gets the same typed `staticData` and the
   * same compile error for a typo.
   *
   * `Register.router` stays, because it names this app's own
   * `createAppRouter` and could not mean anything anywhere else.
   */
}

export interface AppRouterOptions {
  /** The guard's view of the session; the app passes its singleton store. */
  readonly session?: SessionStore;
  /** A memory history under test; the browser's own history in the app. */
  readonly history?: RouterHistory;
  /** The cache route loaders may prime; the app passes its singleton. */
  readonly queryClient?: QueryClient;
  /**
   * What loaders fetch through (`D4.2`); the app passes its singleton.
   *
   * Required, unlike its two siblings, and the asymmetry is deliberate: a
   * defaulted session store or query client is an empty one, which is
   * harmless, while a defaulted **client** would be a second axios instance —
   * its own single-flight refresh state (ADR-0033) and no `onSessionEnded`
   * wiring, so a dead session would never be announced. There is one client per
   * document by construction; making it required is how that stays true.
   */
  readonly client: ApiClient;
}

export const createAppRouter = ({
  session,
  history,
  queryClient,
  client,
}: AppRouterOptions) => {
  const store = session ?? createSessionStore();

  return createRouter({
    routeTree,
    context: {
      session: store,
      queryClient: queryClient ?? createQueryClient(),
      client,
    },
    defaultPreload: "intent",
    /*
     * The router's own defaults are not shippable (`D14.8`, ADR-0062 §1):
     * `defaultErrorComponent` renders `error.message` behind a **Show Error**
     * button and `defaultNotFoundComponent` renders the literal `"Not Found"`,
     * both in production and both in English. `D12.2` fixed it in the customer
     * app; this is the same fix arriving here from the package that now owns
     * both components, which is the asymmetry ADR-0062 exists to end.
     */
    defaultErrorComponent: AppError,
    defaultNotFoundComponent: AppNotFound,
    /*
     * A wait the shell's indicator has covered for a second becomes a
     * sentence in the outlet, and holds long enough not to flicker (`D31.3`,
     * ADR-0080 §5). The numbers are the kit's, measured once for both apps.
     */
    defaultPendingComponent: AppPending,
    defaultPendingMs: PENDING_MS,
    defaultPendingMinMs: PENDING_MIN_MS,
    /*
     * One serialization for the list-query language, here rather than on the
     * routes (ADR-0043, `D5.2`). `validateSearch` has to round-trip its own
     * output, so the routes keep holding the parsed object and the spelling
     * changes underneath them; every name the language does not define is
     * handed to the router's own implementation.
     */
    parseSearch: parseAdminSearch,
    stringifySearch: stringifyAdminSearch,
    // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes`
    // (ADR-0002) distinguishes "absent" from "explicitly undefined", and the
    // router's own option is the former.
    ...(history ? { history } : {}),
  });
};

const appRouter = createAppRouter({ session: sessionStore, client: apiClient });

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

/**
 * The router's own match cache is server state too (`D13.6`).
 *
 * A loader that returns `ensureQueryData`'s answer puts a record — an email
 * among other things — into the match, and TanStack Router keeps inactive
 * matches for its own `gcTime`, well past the query cache the principal
 * boundary empties. This component is mounted under `D13.6`'s per-principal
 * key, so a mount is a boot or a principal change and nothing else; clearing
 * here is the same rule one store along. The effect is late enough to be
 * harmless — a remount re-loads the location it lands on — and early enough to
 * beat the only thing that reads the cache, which is a later navigation.
 */
export const AppRouter = ({ queryClient }: { queryClient: QueryClient }) => {
  // The router is built once at module scope; the app's client is handed to its
  // context here rather than at construction so both providers share one cache.
  appRouter.update({ context: { ...appRouter.options.context, queryClient } });

  useEffect(() => {
    appRouter.clearCache();
  }, []);

  return <RouterProvider router={appRouter} />;
};
