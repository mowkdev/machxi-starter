import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

import { useT } from "@/shared/i18n";
import { createDeferredErrorMessage } from "@/shared/notifications/messages";
import { AppLoader } from "@/shared/ui";

import { createQueryClient } from "./providers/query-client";
import { AppRouter } from "./providers/router";
import { SessionProvider } from "./providers/session";
import { SettingsProvider } from "./providers/settings";
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
 *
 * `SettingsProvider` is the third gate and the innermost (`D6.3`, ADR-0045).
 * It needs the query client, so it cannot sit beside `SessionProvider`; it must
 * hold the router, because ADR-0041's `read` is synchronous and a grid that
 * mounted before the account's arrangement was in memory would show the local
 * one and never hear otherwise. Anonymous, it costs nothing and provides the
 * `localStorage` adapter the app has always used.
 */
/**
 * The wire between the global toast handler and the i18next instance
 * (`D7.2`, ADR-0046 §2).
 *
 * The two are built at opposite ends of the tree on purpose: ADR-0034 gives one
 * query client to the whole app and it is constructed here, while `D7.1` put
 * the instance *inside* `SettingsProvider` so the account's locale is the one
 * it starts in rather than one it switches to. Neither end moves; a deferred
 * lookup is what joins them, and it is a factory rather than a module-level box
 * so the suite gets its own per render.
 */
const errorMessages = createDeferredErrorMessage();
const queryClient = createQueryClient({
  messageForError: errorMessages.messageForError,
});

/**
 * Binds that lookup, from inside the provider.
 *
 * A component rather than a prop threaded down through `SettingsProvider`,
 * because the binding is not something the settings gate has an opinion about:
 * `SettingsProvider` renders its children inside `I18nProvider`, so anything
 * mounted here is already under the instance. Rendering nothing is the whole of
 * its output.
 */
const BindErrorMessages = () => {
  const { t } = useT("errors");

  useEffect(() => {
    errorMessages.bind(t);
  }, [t]);

  return null;
};

const App = () => (
  <SessionProvider fallback={<AppLoader />}>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider fallback={<AppLoader />}>
        <BindErrorMessages />
        <AppRouter queryClient={queryClient} />
      </SettingsProvider>
    </QueryClientProvider>
  </SessionProvider>
);

export default App;
