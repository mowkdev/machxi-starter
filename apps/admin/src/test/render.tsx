import type { Locale } from "@repo/contracts";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { createQueryClient } from "@/app/providers/query-client";
import { createAppRouter } from "@/app/providers/router";
import { AppUiStrings } from "@/app/providers/ui-strings";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import {
  EN_RESOURCES,
  NAMESPACES,
  createI18n,
  type I18n,
  type TranslateKey,
} from "@/shared/i18n";
import { createMessageForError } from "@/shared/notifications/messages";
import { ThemeProvider } from "@/shared/theme";
import { Toaster } from "@/shared/ui";

import demoCatalogue from "./fixtures/demo-catalogue.json";

/**
 * The two ways this app is rendered under test (ADR-0036).
 *
 * `renderWithProviders` is for a component in isolation: the API client and
 * session store of ADR-0033, and the ADR-0034 query client with its real
 * defaults — retry policy, `staleTime`, and the global caches that turn
 * mutation `meta` into toasts. A `<Toaster>` comes with it, because a component
 * test that asserts an operation's feedback should not have to remember to
 * mount the surface it lands on; the app mounts one at the root for the same
 * reason.
 *
 * `renderApp` is for anything that is *about* routing: it mounts the real
 * generated route tree on a memory history, so guards, redirects and layout
 * composition are exercised as shipped rather than as re-declared by a test. A
 * guard asserted against a hand-built route tree only proves the test's tree.
 * Its router shares the one query client, which is what ADR-0032's
 * `context: { queryClient, session }` is for.
 *
 * Every dependency is *passed*, never module-mocked: that is the property the
 * factories in `shared/api` and `app/providers` exist to give, and it is why a
 * test needs no `vi.mock`.
 */

/**
 * A standalone instance, for a test with no tree (`D7.2`).
 *
 * The pure halves of the sweep — `chipsForState`, `summariseBulk`,
 * `applyServerErrors` — take a translator as an argument now, so their table
 * tests need one without rendering anything. Building it from the same factory
 * the app calls is what keeps those tables asserting the **catalogue's** words
 * rather than a stub's, which is the whole reason a missing key should be a
 * failure rather than a blank.
 */
export const createTestI18n = (locale: Locale = "en"): I18n =>
  withDemoCatalogue(
    createI18n({
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale,
    }),
  );

/**
 * The demo fixture's namespace, added to an instance after it is built
 * (`D7.4`).
 *
 * This is `register(i18n)` from ADR-0046 §13 in miniature, and it is here for
 * the reason the ADR gives: a package — and a fixture — **declares** strings
 * and never owns the app's dictionary. `createI18n` takes the app's ten
 * namespaces and knows nothing about `demo:`; the harness adds the bundle,
 * exactly as D8's extracted packages will add theirs.
 *
 * `en` only, and that is honest rather than lazy: the fixture exists to prove
 * the machinery renders what a config declares, and the machinery does not care
 * which language it is.
 */
const withDemoCatalogue = (i18n: I18n): I18n => {
  i18n.instance.addResourceBundle("en", "demo", demoCatalogue);

  return i18n;
};

export interface ProviderOptions {
  readonly store?: SessionStore;
  readonly client?: ApiClient;
  /** A cache of the test's own, so nothing leaks between cases. */
  readonly queryClient?: QueryClient;
  /**
   * The language the tree renders in (`D7.1`, ADR-0046 §14).
   *
   * `en` by default and **loaded synchronously**, which is the property the
   * whole harness rests on: the eager catalogue is in the bundle, nothing is
   * awaited, and `test:unit` stays a pure function of the tree and stays
   * cached under ADR-0026. It also keeps the suite's four hundred-odd
   * assertions by accessible name in English, so localising a screen does not
   * rewrite the tests that prove it works.
   *
   * A test that passes `"lv"` gets a real instance in Latvian, whose
   * catalogues arrive through the same lazy `import()` the app uses — so such
   * a test must await the copy it expects rather than assume it is there on
   * the first render.
   */
  readonly locale?: Locale;
  /**
   * Renders through the dev-only pseudo-locale (`D7.6`, ADR-0046 §10, §14).
   *
   * Off by default and deliberately so: every assertion by accessible name in
   * this suite is English, and a lens that accents them would rewrite four
   * hundred of them. The one suite that wants it is the route walk, which
   * asserts the opposite property — that nothing on a page survived the lens
   * unaccented, which is what makes a hardcoded string visible to a machine
   * rather than to a reviewer.
   */
  readonly pseudo?: boolean;
}

/**
 * Builds the trio every rendered tree needs, so a caller that cares about none
 * of them still gets a working `useApiClient` and a working `useQuery`.
 */
const providers = ({
  store,
  client,
  queryClient,
  locale = "en",
  pseudo = false,
}: ProviderOptions) => {
  const sessionStore = store ?? createSessionStore();
  // One instance per render, from the same factory the app calls: a test
  // that switched the locale must not leave the next one in Latvian, which
  // a module-level singleton could not promise (ADR-0046 §13).
  const i18n = withDemoCatalogue(
    createI18n({
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale,
      pseudo,
    }),
  );

  return {
    store: sessionStore,
    client:
      client ??
      createApiClient({ store: sessionStore, baseUrl: "http://api.test" }),
    /*
     * The client is built *from* this render's instance (`D7.2`).
     *
     * ADR-0034's global handlers turn a failed mutation into a toast, and the
     * sentence now comes out of the `errors` catalogue — so a suite whose
     * client had no translator would assert English toasts while every other
     * string on screen followed the requested locale. The app joins the same
     * two ends with a deferred binding, because there the client is older than
     * the instance; here they are born together.
     */
    queryClient:
      queryClient ??
      createQueryClient({
        messageForError: createMessageForError(
          i18n.instance.getFixedT(null, "errors"),
        ),
        /*
         * And the outcome sentences with them (`D7.4`): `meta.success` is a
         * key, so a suite whose client had no translator would assert raw
         * `staff:outcomes.created` in every success toast.
         */
        translate: i18n.instance.t as TranslateKey,
      }),
    i18n,
  };
};

/**
 * The trio is returned alongside the render result so a test can assert about
 * it (`D3.9`): the query client is where `gcTime: 0` is observable — a settled
 * credential mutation must not still be in `getMutationCache()` — and where a
 * cross-entity invalidation shows up. A test that had to build its own client
 * to see either would be asserting about a client the component never used.
 */
export interface ProviderResult extends RenderResult {
  readonly store: SessionStore;
  readonly client: ApiClient;
  readonly queryClient: QueryClient;
  readonly i18n: I18n;
}

export const renderWithProviders = (
  ui: ReactElement,
  options: ProviderOptions = {},
): ProviderResult => {
  const value = providers(options);

  return {
    ...render(
      <ApiProvider value={{ client: value.client, store: value.store }}>
        <QueryClientProvider client={value.queryClient}>
          {/*
           * The local-only theme, which is what `app/providers/settings.tsx`
           * provides for an anonymous session (`D6.3`). `useTheme` throws
           * outside a provider on purpose, so the harness mounts one for the
           * same reason it mounts a `<Toaster>`: a component test should not
           * have to remember the app's wiring to render a control the app
           * ships. A test about *adoption* builds its own `SettingsProvider`.
           */}
          <ThemeProvider>
            <I18nextProvider i18n={value.i18n.instance}>
              {/*
               * The design system's six strings, wired the way the app wires
               * them (`D7.3`). Mounted here for the reason the `<Toaster>` is:
               * a component test should not have to remember the app's own
               * wiring to render a dialog whose close button the app has
               * localised. Without it the primitives answer with their English
               * defaults, which is a different code path from the one that
               * ships.
               */}
              <AppUiStrings>
                {ui}
                <Toaster />
              </AppUiStrings>
            </I18nextProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </ApiProvider>,
    ),
    ...value,
  };
};

export interface RenderAppOptions extends ProviderOptions {
  /** Where the app starts. Defaults to the dashboard index. */
  readonly initialPath?: string;
}

/**
 * The router comes back with the render (`D4.2`).
 *
 * Two things need it and neither can fake it: reading where the app *is* — a
 * memory history does not touch `window.location`, so `router.state.location`
 * is the only truthful answer — and driving Back and Forward, which
 * `window.history` cannot do to a history it does not own. Both are exactly
 * what ADR-0040's routed surfaces claim, so a suite that could not reach them
 * could not test the claim.
 */
export interface RenderAppResult extends RenderResult {
  readonly router: ReturnType<typeof createAppRouter>;
  readonly i18n: I18n;
}

export const renderApp = ({
  initialPath = "/",
  ...options
}: RenderAppOptions = {}): RenderAppResult => {
  const value = providers(options);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    session: value.store,
    queryClient: value.queryClient,
    // The same client the tree's hooks use, so a route loader and a component
    // fetch through one MSW-intercepted instance (`D4.2`, ADR-0040).
    client: value.client,
  });

  const tree: ReactNode = (
    <ApiProvider value={{ client: value.client, store: value.store }}>
      <QueryClientProvider client={value.queryClient}>
        {/* The root route mounts its own `<Toaster>`; this tree adds none. */}
        <ThemeProvider>
          <I18nextProvider i18n={value.i18n.instance}>
            <AppUiStrings>
              <RouterProvider router={router} />
            </AppUiStrings>
          </I18nextProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ApiProvider>
  );

  return { ...render(tree), router, i18n: value.i18n };
};
