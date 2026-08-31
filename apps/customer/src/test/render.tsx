import type { Locale } from "@repo/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

import { createAppRouter } from "@/app/providers/router";
import { EN_RESOURCES, NAMESPACES, createI18n, type I18n } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";

/**
 * The two ways this app is rendered under test (ADR-0036, ADR-0055 §2).
 *
 * `renderWithProviders` is for a component in isolation; `renderApp` is for
 * anything that is *about* routing — it mounts the real generated route tree on
 * a memory history, so layout composition and (from `D12.2`) guards and
 * redirects are exercised as shipped rather than as re-declared by a test. A
 * guard asserted against a hand-built route tree only proves the test's tree.
 *
 * Every dependency is *passed*, never module-mocked: that is the property the
 * factories in `app/providers` exist to give, and it is why a test needs no
 * `vi.mock`. The API client, the query client and the session store join the
 * list at `D12.2`, which is when there is one to pass.
 */

export interface ProviderOptions {
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
   * opposite property — that nothing on a page survived the lens unaccented,
   * which is what makes a hardcoded string visible to a machine rather than to
   * a reviewer.
   */
  readonly pseudo?: boolean;
}

/**
 * One instance per render, from the same factory the app calls: a test that
 * switched the locale must not leave the next one in Latvian, which a
 * module-level singleton could not promise (ADR-0046 §13).
 */
const buildI18n = ({ locale = "en", pseudo = false }: ProviderOptions): I18n =>
  createI18n({
    resources: { en: EN_RESOURCES },
    namespaces: NAMESPACES,
    locale,
    pseudo,
  });

export interface ProviderResult extends RenderResult {
  readonly i18n: I18n;
}

export const renderWithProviders = (
  ui: ReactElement,
  options: ProviderOptions = {},
): ProviderResult => {
  const i18n = buildI18n(options);

  return {
    ...render(
      /*
       * The local-only theme, which is what `app/index.tsx` provides while the
       * app is anonymous. `useTheme` throws outside a provider on purpose, so
       * the harness mounts one: a component test should not have to remember
       * the app's wiring to render a control the app ships.
       */
      <ThemeProvider>
        <I18nextProvider i18n={i18n.instance}>{ui}</I18nextProvider>
      </ThemeProvider>,
    ),
    i18n,
  };
};

export interface RenderAppOptions extends ProviderOptions {
  /** Where the app starts. Defaults to the one address there is. */
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
  readonly i18n: I18n;
}

export const renderApp = ({
  initialPath = "/login",
  ...options
}: RenderAppOptions = {}): RenderAppResult => {
  const i18n = buildI18n(options);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  return {
    ...render(
      <ThemeProvider>
        <I18nextProvider i18n={i18n.instance}>
          <RouterProvider router={router} />
        </I18nextProvider>
      </ThemeProvider>,
    ),
    router,
    i18n,
  };
};
