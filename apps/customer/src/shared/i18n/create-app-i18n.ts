import type { ResourceKey } from "i18next";

import {
  createI18n as createI18nBase,
  type CreateI18nOptions,
  type I18n,
} from "@repo/i18n";

import { DEFAULT_NAMESPACE, type Namespace } from "./namespaces";
import type { Catalogues } from "./resources";

/**
 * This app's instance factory: `@repo/i18n`'s, with the things only this app
 * can supply already bound (ADR-0051's door rule, ADR-0046 §13).
 *
 * **The door supplies app config**, and here that is two answers: what an
 * unprefixed key means, and where a non-eager catalogue comes from. Binding
 * them here rather than at each call site is what keeps `createI18n` meaning
 * the same thing everywhere in the app — the composition root, every suite that
 * builds an instance, and anything added later.
 *
 * `onLocaleApplied`/`localeSideEffectsReady` are **not** bound yet, and their
 * absence is a statement rather than an omission: the admin passes
 * `@repo/form`'s zod-locale installer through them so a field error is in the
 * operator's language, and this app has no zod schema on screen until `D12.6`.
 * A consumer with no schemas should not pay for the installer, which is exactly
 * why `@repo/i18n` made both a parameter (`D9.2`).
 *
 * Every field stays overridable — the spread is last — so a test that wants a
 * bare instance can still ask for one.
 */

/**
 * Where this app's non-eager catalogues come from.
 *
 * The specifier is relative to **this** module, which is the whole reason it
 * lives here rather than in the package: `@repo/i18n` used to own an identical
 * function, and a relative `import()` resolves against the module that writes
 * it, so the day the factory moved the path pointed at a package with no
 * `locales/` — an `lv` that silently never loaded (`D9.2`).
 */
const loadCatalogue = async (
  language: string,
  namespace: string,
): Promise<ResourceKey> => {
  const catalogue: unknown = await import(
    `./locales/${language}/${namespace}.json`
  );

  return catalogue as ResourceKey;
};

/**
 * This app's options: the package's, with the two fields it had to widen
 * narrowed back.
 *
 * `@repo/i18n` types `resources` and `namespaces` as `string`-keyed shapes
 * because a package cannot know an app's namespace names. That widening is
 * correct there and would be a real loss here: **the `namespaces` parameter is
 * the only thing enforcing that every name in `NAMESPACES` has an eager `en`
 * catalogue**, because `EN_RESOURCES` is `as const` and is never annotated.
 * Left wide, `namespaces: ["bogus"]` would type-check at the composition root.
 */
export type CreateAppI18nOptions = Omit<
  CreateI18nOptions,
  "namespaces" | "resources"
> & {
  readonly resources: Catalogues;
  readonly namespaces: readonly Namespace[];
};

export const createI18n = (options: CreateAppI18nOptions): I18n =>
  createI18nBase({
    defaultNamespace: DEFAULT_NAMESPACE,
    loadCatalogue,
    ...options,
  });
