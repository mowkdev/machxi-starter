import { ThemeProvider } from "@/shared/theme";
import { AppLoader } from "@/shared/ui";

import { I18nProvider } from "./providers/i18n";
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
 * What is deliberately **not** here yet, each with the step that brings it:
 * `QueryClientProvider` at `D12.6`, when there is something to fetch;
 * `SettingsProvider` and the pseudo-locale notice at `D12.7`. The admin's root
 * is the shape this converges on, and the ordering above is chosen so each
 * arrival is an insertion rather than a rearrangement — `SettingsProvider` goes
 * between the query client and `I18nProvider`, which is where the admin puts it
 * and why `I18nProvider` is already the innermost of the three.
 */
const App = () => (
  <ThemeProvider>
    <SessionProvider fallback={<AppLoader />}>
      <I18nProvider>
        <AppUiStrings>
          <AppRouter />
        </AppUiStrings>
      </I18nProvider>
    </SessionProvider>
  </ThemeProvider>
);

export default App;
