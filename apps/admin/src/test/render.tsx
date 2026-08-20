import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { createQueryClient } from "@/app/providers/query-client";
import { createAppRouter } from "@/app/providers/router";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { Toaster } from "@/shared/ui";

/**
 * The two ways this app is rendered under test (ADR-0036).
 *
 * `renderWithProviders` is for a component in isolation: the API client and
 * session store of ADR-0033, and the ADR-0034 query client with its real
 * defaults — retry policy, `staleTime`, and the global caches that turn
 * mutation `meta` into toasts. A `<Toaster>` comes with it, because a component
 * test that asserts an operation's feedback should not have to remember to
 * mount the surface it lands on; the app mounts one at the root for the same
 * reason.
 *
 * `renderApp` is for anything that is *about* routing: it mounts the real
 * generated route tree on a memory history, so guards, redirects and layout
 * composition are exercised as shipped rather than as re-declared by a test. A
 * guard asserted against a hand-built route tree only proves the test's tree.
 * Its router shares the one query client, which is what ADR-0032's
 * `context: { queryClient, session }` is for.
 *
 * Every dependency is *passed*, never module-mocked: that is the property the
 * factories in `shared/api` and `app/providers` exist to give, and it is why a
 * test needs no `vi.mock`.
 */

export interface ProviderOptions {
  readonly store?: SessionStore;
  readonly client?: ApiClient;
  /** A cache of the test's own, so nothing leaks between cases. */
  readonly queryClient?: QueryClient;
}

/**
 * Builds the trio every rendered tree needs, so a caller that cares about none
 * of them still gets a working `useApiClient` and a working `useQuery`.
 */
const providers = ({ store, client, queryClient }: ProviderOptions) => {
  const sessionStore = store ?? createSessionStore();

  return {
    store: sessionStore,
    client:
      client ??
      createApiClient({ store: sessionStore, baseUrl: "http://api.test" }),
    queryClient: queryClient ?? createQueryClient(),
  };
};

/**
 * The trio is returned alongside the render result so a test can assert about
 * it (`D3.9`): the query client is where `gcTime: 0` is observable — a settled
 * credential mutation must not still be in `getMutationCache()` — and where a
 * cross-entity invalidation shows up. A test that had to build its own client
 * to see either would be asserting about a client the component never used.
 */
export interface ProviderResult extends RenderResult {
  readonly store: SessionStore;
  readonly client: ApiClient;
  readonly queryClient: QueryClient;
}

export const renderWithProviders = (
  ui: ReactElement,
  options: ProviderOptions = {},
): ProviderResult => {
  const value = providers(options);

  return {
    ...render(
      <ApiProvider value={{ client: value.client, store: value.store }}>
        <QueryClientProvider client={value.queryClient}>
          {ui}
          <Toaster />
        </QueryClientProvider>
      </ApiProvider>,
    ),
    ...value,
  };
};

export interface RenderAppOptions extends ProviderOptions {
  /** Where the app starts. Defaults to the dashboard index. */
  readonly initialPath?: string;
}

export const renderApp = ({
  initialPath = "/",
  ...options
}: RenderAppOptions = {}): RenderResult => {
  const value = providers(options);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    session: value.store,
    queryClient: value.queryClient,
  });

  const tree: ReactNode = (
    <ApiProvider value={{ client: value.client, store: value.store }}>
      <QueryClientProvider client={value.queryClient}>
        {/* The root route mounts its own `<Toaster>`; this tree adds none. */}
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>
  );

  return render(tree);
};
