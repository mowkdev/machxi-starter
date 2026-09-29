import { createQueryClient } from "@/shared/api/query-client";
import { config } from "@/shared/config";
import { reportError } from "@/shared/error-reporting";
import { createDeferredTranslate } from "@/shared/i18n";
import { createDeferredErrorMessage } from "@/shared/notifications/messages";
import { AppRoot, UI_STRING_KEYS } from "@/shared/ui";

import { AppRouter } from "./providers/router";
import { SessionProvider } from "./providers/session";
import { SettingsProvider } from "./providers/settings";

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
 * The composition root of the SPA (ADR-0049): the `app` layer is wiring, and
 * this is the whole of it.
 *
 * **The order of the providers is `@repo/app-kit`'s since `D22.1`** (ADR-0077
 * §1): `AppRoot` mounts the session gate, the query client, the settings gate,
 * the translation bindings, the design system's strings, the top-level error
 * boundary and the pseudo-locale notice, and says why each sits where it
 * does. What is stated here is what this app binds: its session, its settings
 * gate, its query client, its keys, its reporter, its build flag and its
 * router.
 *
 * `SettingsProvider` must hold the router in this app for a reason of its
 * own (`D6.3`, ADR-0045): ADR-0041's `read` is synchronous, and a grid that
 * mounted before the account's arrangement was in memory would show the local
 * one and never hear otherwise.
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
 * so the suite gets its own per render. `AppRoot` binds both from inside the
 * instance.
 */
const errorMessages = createDeferredErrorMessage();
/*
 * The same wire, for the same handler, one field along (`D7.4`): a mutation's
 * `meta.success` is a key now, and the cache that turns it into a toast is
 * built here — beside the deferred error lookup and for the identical reason.
 */
const outcomes = createDeferredTranslate();
/*
 * Built once at module scope for the same reason the router is — constructing
 * it in the component body would discard the cache on every re-render.
 */
const queryClient = createQueryClient({
  messageForError: errorMessages.messageForError,
  translate: outcomes.translate,
});

const App = () => (
  <AppRoot
    errorMessages={errorMessages}
    outcomes={outcomes}
    pseudoNotice={config.VITE_I18N_PSEUDO}
    queryClient={queryClient}
    report={reportError}
    session={SessionProvider}
    settings={SettingsProvider}
    uiStringKeys={UI_STRING_KEYS}
  >
    <AppRouter queryClient={queryClient} />
  </AppRoot>
);

export default App;
