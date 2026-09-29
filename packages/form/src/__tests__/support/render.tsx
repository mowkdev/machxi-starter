import { isApiClientError, type ErrorMessage } from "@repo/api-client";
import type { Locale } from "@repo/contracts";
import { createI18n, type I18n } from "@repo/i18n";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

import { bundles } from "../../i18n";
import lvForm from "../../locales/lv.json";
import {
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
} from "../../zod-locale";
import demo from "./demo-catalogue.json";

/**
 * The form machinery's harness for the suites that moved out of the admin
 * (`D22.3`, ADR-0077 §4, ADR-0036).
 *
 * **It mounts what this package owns and stands in for what an app binds.**
 * In the admin these suites rendered through `renderWithProviders`, whose
 * instance held the app's ten catalogues; what they read was only ever this
 * package's `form` namespace, the demo fixture's `demo:` copy, and the app's
 * code map for a form-level failure. So the instance below is those — the
 * package's own catalogue in both locales, the fixture's in `en` — and the
 * code map is {@link messageForError}, a stand-in with sentences no app ships.
 *
 * `@repo/i18n`'s factory with **the two seams an app binds, bound here**, as
 * `zod-locale.test.ts` binds them: `changeLocale` moves zod's error map with
 * i18next, which is what the Latvian re-derivation in
 * `server-errors-locale.test.tsx` reads.
 */

/** A device-key prefix an app would supply (ADR-0064 §1). */
export const KEY_PREFIX = "test.form";

export interface TestI18nOptions {
  readonly locale?: Locale;
  /** The dev-only pseudo-locale lens (ADR-0046 §10). */
  readonly pseudo?: boolean;
}

export const createTestI18n = ({
  locale = "en",
  pseudo = false,
}: TestI18nOptions = {}): I18n =>
  createI18n({
    resources: {
      en: { form: bundles.en, demo },
      lv: { form: lvForm },
    },
    storageKeyPrefix: KEY_PREFIX,
    namespaces: ["form", "demo"],
    defaultNamespace: "form",
    locale,
    pseudo,
    onLocaleApplied: (applied, translate) => {
      applyZodLocale(applied, createRuleTranslator(translate));
    },
    localeSideEffectsReady: zodLocaleReady,
  });

export interface RenderedForm extends RenderResult {
  readonly i18n: I18n;
}

/**
 * A component under this package's instance — `renderWithProviders`, reduced
 * to the one provider a form reads. No query client, API client or theme:
 * nothing under `@repo/form` asks for them.
 */
export const renderWithI18n = (
  ui: ReactElement,
  options: TestI18nOptions = {},
): RenderedForm => {
  const i18n = createTestI18n(options);

  return {
    ...render(<I18nextProvider i18n={i18n.instance}>{ui}</I18nextProvider>),
    i18n,
  };
};

/**
 * A stand-in for an app's code map (ADR-0034), over sentences **no app
 * ships**: a case that reads one of these can only have got it through the
 * `messageForError` option `applyServerErrors` is handed, which is the
 * property under test. The admin's own map and catalogue are that app's, and
 * its door keeps the smoke test that proves them.
 */
export const APP_ERRORS = {
  fallback: "Something went wrong (test).",
  STAFF_EMAIL_TAKEN: "That email address is already taken (test).",
  STAFF_LAST_SUPER_ADMIN: "This is the last super admin (test).",
  SERVICE_UNAVAILABLE: "The API could not be reached (test).",
} as const;

const ERRORS: Readonly<Record<string, string>> = APP_ERRORS;

export const messageForError: ErrorMessage = (error) =>
  (isApiClientError(error) ? ERRORS[error.code] : undefined) ??
  APP_ERRORS.fallback;
