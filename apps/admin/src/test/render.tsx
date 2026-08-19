import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { createAppRouter } from "@/app/providers/router";
import type { SessionStore } from "@/shared/api/session-store";

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

export const renderWithProviders = (ui: ReactElement): RenderResult =>
  render(ui);

export interface RenderAppOptions {
  /** Where the app starts. Defaults to the dashboard index. */
  readonly initialPath?: string;
  /** The guard's view of the session — a guard needs to be told no. */
  readonly session?: SessionStore;
}

export const renderApp = ({
  initialPath = "/",
  session,
}: RenderAppOptions = {}): RenderResult => {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    ...(session ? { session } : {}),
  });

  return render(<RouterProvider router={router} />);
};
