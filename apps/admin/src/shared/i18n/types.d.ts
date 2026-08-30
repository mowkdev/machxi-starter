import type account from "./locales/en/account.json";
import type auth from "./locales/en/auth.json";
import type common from "./locales/en/common.json";
import type dashboard from "./locales/en/dashboard.json";
import type errors from "./locales/en/errors.json";
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
 * `D7.2` filled. The ones after them are `D7.4`'s rule, one per slice that owns
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
      errors: typeof errors;
      auth: typeof auth;
      dashboard: typeof dashboard;
      profile: typeof profile;
      staff: typeof staff;
      users: typeof users;
      settings: typeof settings;
      account: typeof account;
    };
  }
}

/*
 * **`grid` and `form` are absent on purpose** (`D9.4`, `D9.5`). Each is a
 * package's namespace, declared by that package through `ResourceNamespaceMap`
 * rather than here — which is what stops two packages colliding on this one
 * field (TS2717, ADR-0046 §13 as amended at `D7.1`). Both feed
 * `TypeOptions['resources']`, so `TranslationKey` sees a `form:` key exactly as
 * it sees a `staff:` one.
 */

/*
 * `TranslationKey` moved to `@repo/i18n` at `D9.2` and is re-exported through
 * this slice's door. It is defined there over i18next's merged type options,
 * so it still resolves against the `CustomTypeOptions` augmentation above —
 * declaration merging is global to the program, which is what lets the package
 * name the type without owning any of this app's strings (ADR-0046 §13).
 */
