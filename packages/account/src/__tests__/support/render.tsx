import {
  ApiProvider,
  createApiClient,
  createSessionStore,
  isApiClientError,
  type ApiClient,
  type ApiSegment,
  type ErrorMessage,
  type SessionStore,
} from "@repo/api-client";
import { GridDensityProvider, ThemeProvider } from "@repo/app-services";
import type {
  ErrorCode,
  ErrorDetail,
  ErrorEnvelope,
  Locale,
  PrincipalResource,
  SuccessEnvelope,
} from "@repo/contracts";
import { bundles as formBundles } from "@repo/form";
import {
  LocalePublisherProvider,
  createI18n,
  type I18n,
  type LocalePublisher,
} from "@repo/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import en from "../../locales/en.json";
import lv from "../../locales/lv.json";
import type {
  PreferenceOptionsControl,
  PreferenceOptionsProps,
} from "../../preferences/options-control";

/**
 * The package's own harness (`D22.2`, ADR-0077 §4, ADR-0036).
 *
 * **It mounts what this package depends on and stands in for what it does
 * not.** The API client, the session store, the theme and density providers
 * and the i18n factory are the real ones, from the packages below this one.
 * What an *app* binds is stood in for, by the smallest thing of the same
 * shape: a segment, a device-key prefix, a code map over a three-entry
 * `errors` catalogue, and the options control the kit owns. Each app's door
 * keeps a smoke test that proves the binding with the real ones.
 *
 * Every dependency is passed, never module-mocked (ADR-0036).
 */

/** Where the API is, for handlers and the client alike. */
export const API_ORIGIN = "http://api.test";

/** `/api/v1/<segment>`, as `createApiClient` builds it. */
export const apiBase = (segment: ApiSegment = "user"): string =>
  `${API_ORIGIN}/api/v1/${segment}`;

/** A device-key prefix an app would supply (ADR-0064 §1). */
export const DEVICE_KEY_PREFIX = "test.account";

const REQUEST_ID = "00000000-0000-7000-8000-000000000000";

/** The success envelope, as the API writes it (ADR-0012). */
export const ok = <T,>(data: T, status = 200) =>
  HttpResponse.json<SuccessEnvelope<T>>(
    { success: true, data, meta: { requestId: REQUEST_ID } },
    { status },
  );

/** The error envelope (ADR-0013). */
export const fail = (
  status: number,
  code: ErrorCode,
  message?: string,
  details?: readonly ErrorDetail[],
) =>
  HttpResponse.json<ErrorEnvelope>(
    {
      success: false,
      error: {
        code,
        message: message ?? code,
        ...(details === undefined ? {} : { details }),
      },
      meta: { requestId: REQUEST_ID },
    },
    { status },
  );

/**
 * A stand-in for an app's `errors` catalogue and its three differing
 * sentences.
 *
 * Deliberately **not** either app's words: a case that reads one of these can
 * only have got it through the dependency the door passes, which is the
 * property under test.
 */
export const APP_COPY = {
  errors: {
    fallback: "Something went wrong (test).",
    RATE_LIMITED: "Too many attempts (test).",
    AUTH_CURRENT_PASSWORD_INVALID: "That is not the current password (test).",
  },
  app: {
    password: {
      dialogDescription: "Why other sessions end (test).",
      currentPasswordDescription: "Why it is asked for (test).",
      newPasswordDescription: "What happens to the others (test).",
    },
    fields: {
      firstName: "First name",
      lastName: "Last name",
    },
    outcome: "The password was reset (test).",
  },
} as const;

declare module "i18next" {
  interface ResourceNamespaceMap {
    errors: (typeof APP_COPY)["errors"];
    app: (typeof APP_COPY)["app"];
  }
}

const ERRORS: Readonly<Record<string, string>> = APP_COPY.errors;

/** The code map an app's `useMessageForError` answers with, over the stand-in. */
export const messageForError: ErrorMessage = (error) =>
  (isApiClientError(error) ? ERRORS[error.code] : undefined) ??
  APP_COPY.errors.fallback;

export const useMessageForError = (): ErrorMessage => messageForError;

export const createTestI18n = (locale: Locale = "en"): I18n =>
  createI18n({
    resources: {
      en: { accountClient: en, form: formBundles.en, ...APP_COPY },
      lv: { accountClient: lv, form: formBundles.en, ...APP_COPY },
    },
    storageKeyPrefix: DEVICE_KEY_PREFIX,
    namespaces: ["accountClient", "form", "errors", "app"],
    defaultNamespace: "accountClient",
    locale,
  });

/**
 * A stand-in for `@repo/app-kit`'s `SettingsOptions`: a named group of native
 * radios, which is that control's contract with a screen reader and nothing
 * of its geometry. The kit's own suite asserts the geometry.
 */
export const OptionsControl: PreferenceOptionsControl = <
  TValue extends string,
>({
  label,
  name,
  layout,
  options,
  value,
  onChange,
}: PreferenceOptionsProps<TValue>) => (
  <fieldset aria-label={label} data-layout={layout}>
    {options.map(({ value: option, label: optionLabel, icon: Icon }) => (
      <label key={option}>
        <input
          checked={option === value}
          name={name}
          onChange={() => {
            onChange(option);
          }}
          type="radio"
          value={option}
        />
        {Icon ? <Icon className="size-4" /> : null}
        {optionLabel}
      </label>
    ))}
  </fieldset>
);

/** A principal of either population, for a store that starts signed in. */
export const principal = (
  overrides: Partial<PrincipalResource> = {},
): PrincipalResource =>
  ({
    kind: "user",
    id: "0198c1f0-0000-7000-8000-0000000000aa",
    email: "person@machxi.local",
    firstName: "Pat",
    lastName: "Person",
    ...overrides,
  }) as PrincipalResource;

export const authenticatedAs = (
  who: PrincipalResource = principal(),
): SessionStore => {
  const store = createSessionStore();

  store.setSession({ accessToken: "test-access-token", principal: who });

  return store;
};

export interface RenderOptions {
  /** Signed out by default; {@link authenticatedAs} for a session. */
  readonly store?: SessionStore;
  readonly segment?: ApiSegment;
  readonly queryClient?: QueryClient;
  readonly locale?: Locale;
  /** Where a locale change also goes, as the settings gate would install it. */
  readonly publishLocale?: LocalePublisher;
  /**
   * `false` for a test that mounts the settings gate, which mounts the theme,
   * locale and density providers itself.
   */
  readonly preferences?: boolean;
}

export interface RenderedAccount extends RenderResult {
  readonly store: SessionStore;
  readonly client: ApiClient;
  readonly queryClient: QueryClient;
  readonly i18n: I18n;
}

/**
 * The i18n provider an app would hand the settings gate, over this harness's
 * instance: it adopts nothing and publishes through the context, which is all
 * the gate asks of the slot.
 */
export const createI18nSlot = (i18n: I18n) => {
  const I18nSlot = ({
    children,
    publish,
  }: {
    readonly children: ReactNode;
    readonly adopted?: Locale | undefined;
    readonly publish?: LocalePublisher | undefined;
  }) => (
    <I18nextProvider i18n={i18n.instance}>
      <LocalePublisherProvider publish={publish}>
        {children}
      </LocalePublisherProvider>
    </I18nextProvider>
  );

  return I18nSlot;
};

/** The theme provider an app would hand the gate, with a prefix bound. */
export const ThemeSlot = ({
  children,
  adopted,
  publish,
}: {
  readonly children: ReactNode;
  readonly adopted?: Parameters<typeof ThemeProvider>[0]["adopted"];
  readonly publish?: Parameters<typeof ThemeProvider>[0]["publish"];
}) => (
  <ThemeProvider
    adopted={adopted}
    publish={publish}
    storageKeyPrefix={DEVICE_KEY_PREFIX}
  >
    {children}
  </ThemeProvider>
);

export const renderAccount = (
  ui: ReactElement,
  {
    store = createSessionStore(),
    segment = "user",
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }),
    locale = "en",
    publishLocale,
    preferences = true,
  }: RenderOptions = {},
): RenderedAccount => {
  const client = createApiClient({ store, baseUrl: API_ORIGIN, segment });
  const i18n = createTestI18n(locale);

  const tree = preferences ? (
    <ThemeSlot>
      <GridDensityProvider>
        <I18nextProvider i18n={i18n.instance}>
          <LocalePublisherProvider publish={publishLocale}>
            {ui}
          </LocalePublisherProvider>
        </I18nextProvider>
      </GridDensityProvider>
    </ThemeSlot>
  ) : (
    ui
  );

  return {
    ...render(
      <ApiProvider value={{ client, store }}>
        <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
      </ApiProvider>,
    ),
    store,
    client,
    queryClient,
    i18n,
  };
};
