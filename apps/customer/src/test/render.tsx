import type { Locale } from "@repo/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

import { createAppRouter } from "@/app/providers/router";
import { createApiClient, type ApiClient } from "@/shared/api/client";
import { ApiProvider } from "@/shared/api/context";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { EN_RESOURCES, NAMESPACES, createI18n, type I18n } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";

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
 * test needs no `vi.mock`. The query client joins the list at `D12.6`, which is
 * when there is one to pass.
 */

export interface ProviderOptions {
  /** The session the guards read. An empty store is the anonymous app. */
  readonly store?: SessionStore;
  readonly client?: ApiClient;
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
    // One instance per render, from the same factory the app calls: a test that
    // switched the locale must not leave the next one in Latvian, which a
    // module-level singleton could not promise (ADR-0046 §13).
    i18n: createI18n({
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale,
      pseudo,
    }),
  };
};

export interface ProviderResult extends RenderResult {
  readonly store: SessionStore;
  readonly client: ApiClient;
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
        <ApiProvider value={{ client: value.client, store: value.store }}>
          <I18nextProvider i18n={value.i18n.instance}>{ui}</I18nextProvider>
        </ApiProvider>
      </ThemeProvider>,
    ),
    ...value,
  };
};

export interface RenderAppOptions extends ProviderOptions {
  /** Where the app starts. Defaults to the signed-in home. */
  readonly initialPath?: string;
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
  readonly i18n: I18n;
  readonly sessionEnded: { handler: () => void };
}

export const renderApp = ({
  initialPath = "/",
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
        <ApiProvider value={{ client: value.client, store: value.store }}>
          <I18nextProvider i18n={value.i18n.instance}>
            <RouterProvider router={router} />
          </I18nextProvider>
        </ApiProvider>
      </ThemeProvider>,
    ),
    router,
    ...value,
  };
};
