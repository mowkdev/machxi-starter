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
 * Five providers, outermost first:
 *
 * - `SessionProvider` holds a loading gate until the ADR-0033 boot sequence
 *   resolves, and nothing below it renders before the store is either hydrated
 *   or known to be empty — otherwise the `_dashboard` guard would read an empty
 *   store and bounce a signed-in customer to `/login` on every reload.
 * - `QueryClientProvider` inside the gate, because a query fired before the
 *   session is hydrated would go out without a token, and outside the router,
 *   because ADR-0034 gives one client to the whole app. The client is built
 *   once at module scope for the reason the router is — constructing it in the
 *   component body would discard the cache on every re-render.
 * - `SettingsProvider` (`D12.7`) exactly where `D12.6` predicted it: it needs
 *   the query client above it, and it must *hold* the i18next instance so the
 *   account's locale is the one i18next starts in rather than one it switches
 *   to. It is a second gate inside the first, and it mounts the three providers
 *   that carry an account preference — the theme, the locale and the density.
 * - `AppUiStrings` (`D12.5`), because it is a *reader* of the locale rather
 *   than a source of one: it resolves the design system's own `sr-only` labels
 *   through `t` and hands them down the `UiStrings` context (ADR-0046 §12), so
 *   it has to sit inside the instance that resolves them. The two pre-i18next
 *   screens render above it and keep the package's English defaults, which is
 *   what those defaults are for.
 * - `PseudoNoticeProvider` innermost (`D12.9`), and the only one of the five
 *   whose value is a build flag rather than a session, a cache or an account:
 *   it publishes `config.VITE_I18N_PSEUDO` to the one component that draws the
 *   notice. What its position *does* fix is that it is above the router, whose
 *   `_dashboard` layout is its only reader.
 *
 * **`ThemeProvider` left this file at `D12.7`, and the reason it was here was
 * wrong.** `D12.1` mounted it outermost so the boot gate's two screens "are
 * painted in the right one" — but nothing about painting goes through that
 * provider: `main.tsx` applies the stored theme to `<html>` before React exists
 * (ADR-0045 §Theme), and the provider is context for `useTheme`, which neither
 * `AppLoader` nor the unreachable notice calls. So the theme is now where the
 * account can reach it, inside `SettingsProvider`, and the boot screens are
 * painted by the same pre-paint apply that always painted them.
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
  <SessionProvider fallback={<AppLoader />}>
    <QueryClientProvider client={queryClient}>
      {/*
       * The same fallback as the boot gate's, so the two waits are one screen
       * rather than a spinner, a frame and a spinner (`D12.7`).
       *
       * It is a second `AppLoader`, so its own 250ms delay restarts on the
       * remount: a settings read faster than that draws the ground and no
       * spinner at all, which is that delay doing what it was written to do.
       * The ground is painted from the first frame either way, so what a
       * customer sees between the two is the app's background rather than
       * white.
       */}
      <SettingsProvider fallback={<AppLoader />}>
        <BindTranslations />
        <AppUiStrings>
          {/*
           * Whether the dev-only pseudo-locale notice shows (`D12.9`,
           * ADR-0048 §3). The context lives in `@repo/i18n` and comes through
           * `shared/i18n`; this is the `app` layer joining it to the build
           * flag, which is the same relationship `settings.tsx` has with the
           * theme's provider. `_dashboard.tsx` is its only reader.
           *
           * **Above the router** because its reader is the `_dashboard` layout
           * and a context has to outlive the tree that reads it. Its position
           * relative to `AppUiStrings` is *not* a constraint — this provider
           * publishes a boolean and resolves no copy — so it is innermost
           * simply because that is the smallest place it fits, and any claim
           * that it had to sit here would be a comment inventing a rule.
           */}
          <PseudoNoticeProvider enabled={config.VITE_I18N_PSEUDO}>
            <AppRouter />
          </PseudoNoticeProvider>
        </AppUiStrings>
      </SettingsProvider>
    </QueryClientProvider>
  </SessionProvider>
);

export default App;
