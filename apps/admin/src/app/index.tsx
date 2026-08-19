import { QueryClientProvider } from "@tanstack/react-query";

import { AppLoader } from "@/shared/ui";

import { createQueryClient } from "./providers/query-client";
import { AppRouter } from "./providers/router";
import { SessionProvider } from "./providers/session";
import "./styles.css";

/**
 * The composition root of the SPA (ADR-0032): the `app` layer is wiring, and
 * this is the whole of it.
 *
 * `SessionProvider` is outside the router on purpose. It holds a loading gate
 * until the ADR-0033 boot sequence resolves, and nothing below it renders
 * before the store is either hydrated or known to be empty — otherwise the
 * `_dashboard` guard would read an empty store and bounce a signed-in operator
 * to `/login` on every reload.
 *
 * `QueryClientProvider` sits between them: inside the gate, because a query
 * fired before the session is hydrated would go out without a token, and
 * outside the router, because ADR-0034 gives one client to the whole app.
 *
 * The client is built once at module scope for the same reason the router is
 * — constructing it in the component body would discard the cache on every
 * re-render.
 */
const queryClient = createQueryClient();

const App = () => (
  <SessionProvider fallback={<AppLoader />}>
    <QueryClientProvider client={queryClient}>
      <AppRouter queryClient={queryClient} />
    </QueryClientProvider>
  </SessionProvider>
);

export default App;
