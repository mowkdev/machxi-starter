import type { FlatNamespace, ParseKeys } from "i18next";

import type common from "./locales/en/common.json";
import type errors from "./locales/en/errors.json";
import type form from "./locales/en/form.json";
import type grid from "./locales/en/grid.json";

/**
 * Typed keys (ADR-0046 §2): a missing key or a missing namespace is a type
 * error, not a runtime fallback.
 *
 * `en` is the type source because `en` is the source language — a key exists
 * when `en` has it, and every other locale is measured against `en` by
 * `D7.6`'s drift check rather than by the compiler, because a missing `lv`
 * entry is a correct runtime fallback and an incorrect state of the catalogue.
 *
 * The four namespaces below are the cross-cutting ones `D7.1` created empty;
 * `D7.4` adds one import per slice namespace as those catalogues land. Adding
 * a namespace here is what makes its keys exist, which is the property `D7.4`
 * leans on when a `ResourceConfig` starts carrying keys instead of sentences.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    returnNull: false;
    resources: {
      common: typeof common;
      grid: typeof grid;
      form: typeof form;
      errors: typeof errors;
    };
  }
}

/**
 * Any key any catalogue resolves, namespace prefix included — what a
 * `ResourceConfig`, a route's `staticData.title` and a mutation's
 * `meta.success` carry instead of a sentence (ADR-0046 §7).
 *
 * It is `never` while the catalogues are empty, which is exactly right for
 * `D7.1`: nothing may claim to carry a key before there is one.
 */
export type TranslationKey = ParseKeys<FlatNamespace[]>;
