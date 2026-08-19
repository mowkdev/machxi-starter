import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { createAppRouter } from "@/app/providers/router";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";

/**
 * The two ways this app is rendered under test (ADR-0036).
 *
 * `renderWithProviders` is for a component in isolation. It wraps nothing yet —
 * there is nothing to wrap until `D3.4` adds a session provider and `D3.5` a
 * `QueryClientProvider` — and it deliberately takes no options until one of
 * them consumes one: an ignored `session` argument is worse than none, because
 * a test that passes it would get the default and pass for the wrong reason.
 *
 * `renderApp` is for anything that is *about* routing: it mounts the real
 * generated route tree on a memory history, so guards, redirects and layout
 * composition are exercised as shipped rather than as re-declared by a test. A
 * guard asserted against a hand-built route tree only proves the test's tree.
 */

export interface ProviderOptions {
  readonly store?: SessionStore;
  readonly client?: ApiClient;
}

/**
 * Builds the pair every rendered tree needs, so a caller that cares about
 * neither still gets a working `useApiClient`.
 */
const providers = ({ store, client }: ProviderOptions) => {
  const sessionStore = store ?? createSessionStore();

  return {
    store: sessionStore,
    client:
      client ??
      createApiClient({ store: sessionStore, baseUrl: "http://api.test" }),
  };
};

export const renderWithProviders = (
  ui: ReactElement,
  options: ProviderOptions = {},
): RenderResult => {
  const value = providers(options);

  return render(<ApiProvider value={value}>{ui}</ApiProvider>);
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
  });

  return render(
    <ApiProvider value={value}>
      <RouterProvider router={router} />
    </ApiProvider>,
  );
};
