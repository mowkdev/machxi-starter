import { ThemeProvider } from "@/shared/theme";

import { I18nProvider } from "./providers/i18n";
import { AppRouter } from "./providers/router";

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
 * Two providers at `D12.1`, in the order the later steps grow around:
 *
 * - `ThemeProvider` outermost, because a theme is a device fact before it is an
 *   account fact and nothing below it should render in the wrong one. It is
 *   local-only here; `D12.7` gives it the account's value through the settings
 *   gate, which is where the admin's `SettingsProvider` sits.
 * - `I18nProvider` inside it and above the router, because a locale reaches
 *   every screen and a route is not the thing that owns it.
 *
 * What is deliberately **not** here yet, each with the step that brings it:
 * `SessionProvider` and its boot gate, and `QueryClientProvider`, at `D12.2`;
 * `SettingsProvider` and the pseudo-locale notice, at `D12.7`. The admin's root
 * is the shape this converges on — the ordering above is chosen so each arrival
 * is an insertion rather than a rearrangement.
 */
const App = () => (
  <ThemeProvider>
    <I18nProvider>
      <AppRouter />
    </I18nProvider>
  </ThemeProvider>
);

export default App;
