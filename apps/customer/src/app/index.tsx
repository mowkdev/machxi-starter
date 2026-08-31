import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

import { createDeferredTranslate, useKeyT, useT } from "@/shared/i18n";
import { createDeferredErrorMessage } from "@/shared/notifications/messages";
import { ThemeProvider } from "@/shared/theme";
import { AppLoader } from "@/shared/ui";

import { I18nProvider } from "./providers/i18n";
import { createQueryClient } from "./providers/query-client";
import { AppRouter } from "./providers/router";
import { SessionProvider } from "./providers/session";
import { AppUiStrings } from "./providers/ui-strings";

/*
 * The design language's faces (ADR-0054 §1), self-hosted beside the stylesheet
 * rather than fetched from Google's CDN: an EU-facing product does not send a
 * visitor's IP to a third party to render text, dev runs offline, and the
 * bundle budget prices the bytes honestly. §1 says each app loads its own
 * bytes, which is why these five lines are here and not in `@repo/ui`.
 *
 * The weights the language actually uses and no others — Sans 400/500/600,
 * Mono 400/500. Each file is the *whole* face: `@fontsource`'s per-subset files
 * (`latin-400.css`) carry no `unicode-range`, so importing two of them makes
 * the last one win for every character instead of splitting by script. These do
 * carry the ranges, so the browser downloads only the subsets the page's text
 * needs, and `--font-sans`/`--font-mono` in `@theme` do the rest.
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

/**
 * The composition root of the SPA (ADR-0049): the `app` layer is wiring, and
 * this is the whole of it.
 *
 * Three providers, in the order the later steps grow around:
 *
 * - `ThemeProvider` outermost, because a theme is a device fact before it is an
 *   account fact and nothing below it should render in the wrong one. It is
 *   local-only here; `D12.7` gives it the account's value through the settings
 *   gate.
 * - `SessionProvider` next: it holds a loading gate until the ADR-0033 boot
 *   sequence resolves, and nothing below it renders before the store is either
 *   hydrated or known to be empty — otherwise the `_dashboard` guard would read
 *   an empty store and bounce a signed-in customer to `/login` on every reload.
 *   It is **inside** the theme so its own two pre-i18next screens (the loader
 *   and the unreachable notice) are painted in the right one.
 * - `I18nProvider` inside the gate and above the router, because a locale
 *   reaches every screen and a route is not the thing that owns it.
 * - `AppUiStrings` innermost of the four (`D12.5`), because it is a *reader* of
 *   the locale rather than a source of one: it resolves the design system's own
 *   `sr-only` labels through `t` and hands them down the `UiStrings` context
 *   (ADR-0046 §12), so it has to sit inside the instance that resolves them.
 *   The boot gate's two pre-i18next screens render above it and keep the
 *   package's English defaults, which is what those defaults are for.
 *
 * - `QueryClientProvider` between the session gate and `I18nProvider`
 *   (`D12.6`), which is exactly the insertion `D12.1` said this ordering was
 *   chosen to make: **inside** the gate, because a query fired before the
 *   session is hydrated would go out without a token, and **outside** the
 *   router, because ADR-0034 gives one client to the whole app. The client is
 *   built once at module scope for the reason the router is — constructing it
 *   in the component body would discard the cache on every re-render.
 *
 * What is deliberately **not** here yet: `SettingsProvider` and the
 * pseudo-locale notice, both `D12.7`'s. `SettingsProvider` goes between the
 * query client and `I18nProvider` — it needs the client, and it must hold the
 * instance so the account's locale is the one i18next starts in rather than one
 * it switches to.
 */

/**
 * The wire between the global toast handler and the i18next instance
 * (ADR-0046 §2).
 *
 * The two are built at opposite ends of the tree on purpose: ADR-0034 gives one
 * query client to the whole app and it is constructed here, above the session
 * gate the instance is created inside. Neither end moves; a deferred lookup is
 * what joins them, and it is a factory rather than a module-level box so the
 * suite gets its own per render.
 */
const errorMessages = createDeferredErrorMessage();
/*
 * The same wire, for the same handler, one field along: a mutation's
 * `meta.success` is a key, and the cache that turns it into a toast is built
 * here — beside the deferred error lookup and for the identical reason.
 */
const outcomes = createDeferredTranslate();
const queryClient = createQueryClient({
  messageForError: errorMessages.messageForError,
  translate: outcomes.translate,
});

/**
 * Binds those lookups, from inside the instance.
 *
 * A component rather than a prop threaded down through `I18nProvider`, because
 * the binding is not something that provider has an opinion about: anything
 * mounted as its child is already under the instance. Rendering nothing is the
 * whole of its output.
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
  <ThemeProvider>
    <SessionProvider fallback={<AppLoader />}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <BindTranslations />
          <AppUiStrings>
            <AppRouter />
          </AppUiStrings>
        </I18nProvider>
      </QueryClientProvider>
    </SessionProvider>
  </ThemeProvider>
);

export default App;
