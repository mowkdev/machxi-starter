import { AppLoader } from "@/shared/ui";

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
 * `D3.5` adds `QueryClientProvider` here, between the two.
 */
const App = () => (
  <SessionProvider fallback={<AppLoader />}>
    <AppRouter />
  </SessionProvider>
);

export default App;
