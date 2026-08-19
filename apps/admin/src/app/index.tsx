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
  <SessionProvider fallback={<BootGate />}>
    <AppRouter />
  </SessionProvider>
);

/**
 * Deliberately minimal: two round trips on a local network, and a spinner that
 * flashes for 80ms is worse than a blank frame. It exists so the gate is a
 * decision rather than an accident.
 */
const BootGate = () => (
  <div
    aria-busy="true"
    aria-live="polite"
    className="min-h-svh bg-background"
  />
);

export default App;
