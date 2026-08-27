import type { FlatNamespace, ParseKeys } from "i18next";

/**
 * Any key any mounted catalogue resolves, namespace prefix included — what a
 * `ResourceConfig`, a route's `staticData.title` and a mutation's
 * `meta.success` carry instead of a sentence (ADR-0046 §7).
 *
 * **It lives in the package and is still the consuming app's type** (`D9.2`,
 * ADR-0051), which is the whole of ADR-0046 §13's design working: i18next's
 * declaration merging is global to a TypeScript program, so `ParseKeys` here
 * resolves over whatever the app merged into `CustomTypeOptions` and whatever
 * any package merged into `ResourceNamespaceMap`. The package therefore names
 * the type without owning a single string, and a key that no catalogue in the
 * program declares is a compile error at the call site exactly as before.
 *
 * With no catalogue declared anywhere it is `never`, which is the property
 * working rather than a bug: nothing may claim to carry a key before there is
 * one.
 */
export type TranslationKey = ParseKeys<FlatNamespace[]>;
