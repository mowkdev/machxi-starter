import type { Locale } from "@repo/contracts";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

import { createQueryClient } from "@/shared/api/query-client";
import { createAppRouter } from "@/app/providers/router";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import {
  EN_RESOURCES,
  NAMESPACES,
  PseudoNoticeProvider,
  createI18n,
  type I18n,
  type TranslateKey,
} from "@/shared/i18n";
import { GridDensityProvider } from "@/shared/density";
import { createMessageForError } from "@/shared/notifications/messages";
import { ThemeProvider } from "@/shared/theme";
import { AppUiStrings, Toaster, UI_STRING_KEYS } from "@/shared/ui";

/**
 * The two ways this app is rendered under test (ADR-0036, ADR-0055 §2).
 *
 * `renderWithProviders` is for a component in isolation: the API client and
 * session store of ADR-0033, mounted the way the app mounts them.
 * `renderApp` is for anything that is *about* routing — it mounts the real
 * generated route tree on a memory history, so guards, redirects and layout
 * composition are exercised as shipped rather than as re-declared by a test. A
 * guard asserted against a hand-built route tree only proves the test's tree.
 *
 * Every dependency is *passed*, never module-mocked: that is the property the
 * factories in `shared/api` and `app/providers` exist to give, and it is why a
 * test needs no `vi.mock`. **The query client joined the list at `D12.6`**, one
 * per render so nothing leaks between cases, and built from the same factory
 * the app calls — so ADR-0034's global handlers turn mutation `meta` into
 * toasts here exactly as they do in production.
 */

export interface ProviderOptions {
  /** The session the guards read. An empty store is the anonymous app. */
  readonly store?: SessionStore;
  readonly client?: ApiClient;
  /**
   * A cache of the test's own, so nothing leaks between cases.
   *
   * Passed rather than built when a test needs to *ask* it something — the
   * pseudo-locale walk waits on `isFetching()`, which is the only truthful
   * answer to "has this screen finished arriving".
   */
  readonly queryClient?: QueryClient;
  /**
   * The language the tree renders in (ADR-0046 §14).
   *
   * `en` by default and **loaded synchronously**, which is the property the
   * whole harness rests on: the eager catalogue is in the bundle, nothing is
   * awaited, and `test:unit` stays a pure function of the tree and stays cached
   * under ADR-0026. It also keeps assertions by accessible name in English, so
   * localising a screen does not rewrite the tests that prove it works.
   *
   * A test that passes `"lv"` gets a real instance in Latvian, whose catalogues
   * arrive through the same lazy `import()` the app uses — so such a test must
   * await the copy it expects rather than assume it is there on the first
   * render.
   */
  readonly locale?: Locale;
  /**
   * Renders through the dev-only pseudo-locale (ADR-0046 §10, §14).
   *
   * Off by default and deliberately so: every assertion by accessible name in
   * this suite is English, and a lens that accents them would rewrite all of
   * them. The one suite that wants it is the route walk, which asserts the
   * opposite property — that nothing on a page survived the lens unaccented.
   */
  readonly pseudo?: boolean;
}

/**
 * Builds the trio every rendered tree needs, so a caller that cares about none
 * of them still gets a working `useApiClient` and a working `t`.
 */
const providers = ({
  store,
  client,
  queryClient,
  locale = "en",
  pseudo = false,
}: ProviderOptions) => {
  const sessionStore = store ?? createSessionStore();
  /*
   * The client is built before the router and has to tell it when a session
   * dies, so the two are joined through a slot the router fills on the next
   * line down (`renderApp`). That is the same shape `app/providers` uses — a
   * late binding rather than a ring of imports — and building it here is what
   * makes the join *testable*: before `D12.2`'s review the handler was
   * registered at module scope against the module-scope router, so no test
   * could reach it and deleting it left the suite green.
   */
  const sessionEnded = { handler: () => undefined as void };
  // One instance per render, from the same factory the app calls: a test that
  // switched the locale must not leave the next one in Latvian, which a
  // module-level singleton could not promise (ADR-0046 §13).
  const i18n = createI18n({
    resources: { en: EN_RESOURCES },
    namespaces: NAMESPACES,
    locale,
    pseudo,
  });

  return {
    store: sessionStore,
    sessionEnded,
    client:
      client ??
      createApiClient({
        store: sessionStore,
        baseUrl: "http://api.test",
        // The app's population (ADR-0055 §2). A harness on the other segment
        // would send every request somewhere MSW does not answer, and the
        // suite would fail on `onUnhandledRequest` rather than on the claim.
        segment: "user",
        onSessionEnded: () => {
          sessionEnded.handler();
        },
      }),
    /*
     * The client is built *from* this render's instance (`D12.6`).
     *
     * ADR-0034's global handlers turn a failed mutation into a toast and a
     * successful one into its `meta.success` key, and both sentences come out
     * of catalogues — so a suite whose client had no translator would assert
     * English toasts under a Latvian tree, or a raw `profile:outcomes.updated`
     * under an English one. The app joins the same two ends with a deferred
     * binding, because there the client is older than the instance; here they
     * are born together.
     */
    queryClient:
      queryClient ??
      createQueryClient({
        messageForError: createMessageForError(
          i18n.instance.getFixedT(null, "errors"),
        ),
        translate: i18n.instance.t as TranslateKey,
      }),
    i18n,
  };
};

export interface ProviderResult extends RenderResult {
  readonly store: SessionStore;
  readonly client: ApiClient;
  /*
   * Returned so a test can assert about it: the query client is where
   * `gcTime: 0` is observable — a settled credential mutation must not still be
   * in `getMutationCache()` — and where an invalidation shows up. A test that
   * had to build its own to see either would be asserting about a client the
   * component never used.
   */
  readonly queryClient: QueryClient;
  readonly i18n: I18n;
  /** The slot `renderApp` fills with the router's invalidation. */
  readonly sessionEnded: { handler: () => void };
}

export const renderWithProviders = (
  ui: ReactElement,
  options: ProviderOptions = {},
): ProviderResult => {
  const value = providers(options);

  return {
    ...render(
      /*
       * The local-only theme, which is what `app/index.tsx` provides while the
       * app is anonymous. `useTheme` throws outside a provider on purpose, so
       * the harness mounts one: a component test should not have to remember
       * the app's wiring to render a control the app ships.
       */
      <ThemeProvider>
        {/*
         * The theme's sibling, mounted for the same reason (`D12.7`): the app
         * mounts it inside `SettingsProvider`, and `useGridDensity` throws
         * outside a provider on purpose — a control that changes nothing is a
         * worse thing to ship than a loud failure. Local-only here, which is
         * the anonymous app.
         */}
        <GridDensityProvider>
          <ApiProvider value={{ client: value.client, store: value.store }}>
            <QueryClientProvider client={value.queryClient}>
              <I18nextProvider i18n={value.i18n.instance}>
                {/*
                 * The design system's injectable strings, wired the way the app
                 * wires them (`D12.5`, ADR-0046 §12). Mounted here because a
                 * component test should not have to remember the app's own
                 * wiring to render a drawer whose trigger the app has localised
                 * — without it the primitives answer with their English
                 * defaults, which is a different code path from the one that
                 * ships, and one the pseudo-locale walk would then report as
                 * untranslated copy.
                 */}
                <AppUiStrings keys={UI_STRING_KEYS}>
                  {ui}
                  {/*
                   * And the surface ADR-0034's outcomes are delivered to
                   * (`D12.6`), for the same reason: the app mounts one on the
                   * root route, which a component test does not render, so a
                   * mutation whose toast had nowhere to go would be a different
                   * code path from the one that ships.
                   */}
                  <Toaster />
                </AppUiStrings>
              </I18nextProvider>
            </QueryClientProvider>
          </ApiProvider>
        </GridDensityProvider>
      </ThemeProvider>,
    ),
    ...value,
  };
};

export interface RenderAppOptions extends ProviderOptions {
  /** Where the app starts. Defaults to the signed-in home. */
  readonly initialPath?: string;
  /**
   * Shows the dev-only pseudo-locale **notice** (`D12.9`, ADR-0048 §3).
   *
   * **A different option from `pseudo` above, on purpose.** That one selects
   * the pseudo-locale *lens* and reaches only `createI18n`; reusing it here
   * would mount the notice on every route of ADR-0046 §14's walk, whose copy
   * would then have to survive `unaccented()`. In the app the two do travel
   * together — `config.VITE_I18N_PSEUDO` feeds both — but the suite needs to
   * drive them apart, and the notice is the one with a consumer to prove.
   *
   * It exists at all because `vitest.config.ts` pins `VITE_I18N_PSEUDO` to
   * `"false"` for the whole suite, so a notice gated on the variable directly
   * would render in no test in this repository.
   *
   * On `renderApp` only, and not on `ProviderOptions`: the notice is drawn by
   * the `_dashboard` route file into a slot only `AppShell` has, so a component
   * rendered in isolation has nowhere to put one.
   */
  readonly pseudoNotice?: boolean;
}

/**
 * The router comes back with the render.
 *
 * Two things need it and neither can fake it: reading where the app *is* — a
 * memory history does not touch `window.location`, so `router.state.location`
 * is the only truthful answer — and driving Back and Forward, which
 * `window.history` cannot do to a history it does not own.
 */
export interface RenderAppResult extends RenderResult {
  readonly router: ReturnType<typeof createAppRouter>;
  readonly store: SessionStore;
  readonly client: ApiClient;
  readonly queryClient: QueryClient;
  readonly i18n: I18n;
  readonly sessionEnded: { handler: () => void };
}

export const renderApp = ({
  initialPath = "/",
  pseudoNotice = false,
  ...options
}: RenderAppOptions = {}): RenderAppResult => {
  const value = providers(options);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    session: value.store,
    // The production wiring, per render rather than per module: the client this
    // harness built announces a dead session, and this router is what hears it.
    registerSessionEnded: (handler) => {
      value.sessionEnded.handler = handler;
    },
  });

  return {
    ...render(
      /*
       * `SessionProvider` is deliberately absent from this tree, and it is the
       * one place the harness is not the app.
       *
       * That provider's whole job is the boot gate — hold everything until
       * `GET /auth/csrf` and a refresh have settled (ADR-0033 §Boot). Mounting
       * it here would make every routing test wait on two requests to assert a
       * redirect that does not depend on them, and would make the *store* the
       * test passed irrelevant, because the bootstrap would overwrite it. So
       * the harness supplies what the gate supplies — `ApiProvider` over a
       * scripted store — and the gate's own behaviour is asserted directly, by
       * `app/__tests__/session-provider.test.tsx`, which mounts it.
       */
      <ThemeProvider>
        {/* `SettingsProvider`'s third child, mounted here for the reason the
            theme is: this tree is hand-built, so a provider the app mounts in
            `app/index.tsx` reaches no test unless it is added here too. */}
        <GridDensityProvider>
          <ApiProvider value={{ client: value.client, store: value.store }}>
            <QueryClientProvider client={value.queryClient}>
              <I18nextProvider i18n={value.i18n.instance}>
                <AppUiStrings keys={UI_STRING_KEYS}>
                  {/*
                   * This tree is hand-built, so a provider the app mounts in
                   * `app/index.tsx` reaches no test unless it is added here too
                   * (`D12.9`, ADR-0048 §3). Off by default: the notice is a
                   * dev-build warning, and every other suite renders the app a
                   * customer gets.
                   */}
                  <PseudoNoticeProvider enabled={pseudoNotice}>
                    {/* The root route mounts its own `<Toaster>`; this tree
                        adds none. */}
                    <RouterProvider router={router} />
                  </PseudoNoticeProvider>
                </AppUiStrings>
              </I18nextProvider>
            </QueryClientProvider>
          </ApiProvider>
        </GridDensityProvider>
      </ThemeProvider>,
    ),
    router,
    ...value,
  };
};
