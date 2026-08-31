import type account from "./locales/en/account.json";
import type auth from "./locales/en/auth.json";
import type common from "./locales/en/common.json";
import type errors from "./locales/en/errors.json";
import type home from "./locales/en/home.json";
import type profile from "./locales/en/profile.json";

/**
 * Typed keys (ADR-0046 §2): a missing key or a missing namespace is a type
 * error, not a runtime fallback.
 *
 * `en` is the type source because `en` is the source language — a key exists
 * when `en` has it, and every other locale is measured against `en` by
 * `scripts/i18n.mjs` rather than by the compiler, because a missing `lv` entry
 * is a correct runtime fallback and an incorrect state of the catalogue.
 *
 * Adding a namespace here is what makes `TranslationKey` a real union instead
 * of `never`, which is what a route's `staticData.title` leans on: a typo is a
 * compile error at the route file rather than a raw `auth:titel` in the shell.
 *
 * **This augmentation is per app and never shared.** Declaration merging is
 * program-global, so this file and `apps/admin`'s equivalent are the same
 * interface in two different programs; each app's `check-types` sees only its
 * own, which is exactly the isolation ADR-0046 §13 wants.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    returnNull: false;
    resources: {
      common: typeof common;
      errors: typeof errors;
      auth: typeof auth;
      home: typeof home;
      account: typeof account;
      profile: typeof profile;
    };
  }
}

/*
 * **`form` is absent on purpose** (`D12.6`). It is `@repo/form`'s namespace,
 * declared by that package through `ResourceNamespaceMap` rather than here —
 * which is what stops two packages colliding on this one field (TS2717,
 * ADR-0046 §13). It feeds `TypeOptions['resources']` all the same, so
 * `TranslationKey` sees a `form:` key exactly as it sees a `profile:` one.
 */
