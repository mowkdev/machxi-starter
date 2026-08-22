import type { FlatNamespace, ParseKeys } from "i18next";

import type auth from "./locales/en/auth.json";
import type common from "./locales/en/common.json";
import type dashboard from "./locales/en/dashboard.json";
import type errors from "./locales/en/errors.json";
import type form from "./locales/en/form.json";
import type grid from "./locales/en/grid.json";
import type profile from "./locales/en/profile.json";
import type settings from "./locales/en/settings.json";
import type staff from "./locales/en/staff.json";
import type users from "./locales/en/users.json";

/**
 * Typed keys (ADR-0046 §2): a missing key or a missing namespace is a type
 * error, not a runtime fallback.
 *
 * `en` is the type source because `en` is the source language — a key exists
 * when `en` has it, and every other locale is measured against `en` by
 * `D7.6`'s drift check rather than by the compiler, because a missing `lv`
 * entry is a correct runtime fallback and an incorrect state of the catalogue.
 *
 * The first four namespaces are the cross-cutting ones `D7.1` created and
 * `D7.2` filled. The six after them are `D7.4`'s, one per slice that owns
 * operator copy — and adding them here is what makes `TranslationKey` a real
 * union instead of `never`, which is what a `ResourceConfig` leans on the
 * moment it starts carrying keys instead of sentences.
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
      auth: typeof auth;
      dashboard: typeof dashboard;
      profile: typeof profile;
      staff: typeof staff;
      users: typeof users;
      settings: typeof settings;
    };
  }
}

/**
 * Any key any catalogue resolves, namespace prefix included — what a
 * `ResourceConfig`, a route's `staticData.title` and a mutation's
 * `meta.success` carry instead of a sentence (ADR-0046 §7).
 *
 * It was `never` while the catalogues were empty, which was the property
 * working rather than a bug: nothing may claim to carry a key before there is
 * one. `D7.4` gives it members.
 */
export type TranslationKey = ParseKeys<FlatNamespace[]>;
