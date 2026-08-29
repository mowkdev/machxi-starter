import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

import { config } from "@/shared/config";
import {
  PseudoNoticeProvider,
  createDeferredTranslate,
  useKeyT,
  useT,
} from "@/shared/i18n";
import { createDeferredErrorMessage } from "@/shared/notifications/messages";
import { AppLoader } from "@/shared/ui";

import { createQueryClient } from "./providers/query-client";
import { AppRouter } from "./providers/router";
import { SessionProvider } from "./providers/session";
import { SettingsProvider } from "./providers/settings";
import { AppUiStrings } from "./providers/ui-strings";

/*
 * The design language's faces (ADR-0054 §1), self-hosted beside the stylesheet
 * rather than fetched from Google's CDN: an EU-facing product does not send a
 * visitor's IP to a third party to render text, dev and `test:e2e` run
 * offline, and the bundle budget prices the bytes honestly.
 *
 * The weights the language actually uses and no others — Sans 400/500/600,
 * Mono 400/500. Each file is the *whole* face: `@fontsource`'s per-subset
 * files (`latin-400.css`) carry no `unicode-range`, so importing two of them
 * makes the last one win for every character instead of splitting by script.
 * These do carry the ranges, so the browser downloads only the subsets the
 * page's text needs, and `--font-sans`/`--font-mono` in `@theme` do the rest.
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
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
/*
 * The same wire, for the same handler, one field along (`D7.4`): a mutation's
 * `meta.success` is a key now, and the cache that turns it into a toast is
 * built here — beside the deferred error lookup and for the identical reason.
 */
const outcomes = createDeferredTranslate();
const queryClient = createQueryClient({
  messageForError: errorMessages.messageForError,
  translate: outcomes.translate,
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
const BindTranslations = () => {
  const { t } = useT("errors");
  const tk = useKeyT();

  useEffect(() => {
    errorMessages.bind(t);
  }, [t]);

  useEffect(() => {
    outcomes.bind(tk);
  }, [tk]);

  return null;
};

const App = () => (
  <SessionProvider fallback={<AppLoader />}>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider fallback={<AppLoader />}>
        <BindTranslations />
        {/*
         * The design system's injectable strings, fed from `common` (`D7.3`,
         * ADR-0046 §12). Inside `SettingsProvider` because that is where
         * `I18nProvider` is, and above the router because a dialog's close
         * button is chrome no route owns. Radix renders its overlays into a
         * portal, and React context reaches through one.
         */}
        <AppUiStrings>
          {/*
           * Whether the dev-only pseudo-locale notice shows (`D8.7`,
           * ADR-0048 §3). The context lives in `shared/i18n` and this is the
           * `app` layer connecting it to the build flag — the same
           * relationship `settings.tsx` has with `shared/theme`'s provider.
           * `_dashboard.tsx` is its only reader.
           */}
          <PseudoNoticeProvider enabled={config.VITE_I18N_PSEUDO}>
            <AppRouter queryClient={queryClient} />
          </PseudoNoticeProvider>
        </AppUiStrings>
      </SettingsProvider>
    </QueryClientProvider>
  </SessionProvider>
);

export default App;
