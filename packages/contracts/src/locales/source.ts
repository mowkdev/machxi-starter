import { z } from "zod";

/**
 * The custom messages a schema writes for itself, and the seam that lets a
 * client say them in another language (ADR-0046 §6, `D7.5`).
 *
 * ## The problem this exists to solve
 *
 * Almost every field rule in this package is a **generic zod issue** — a
 * `too_small`, an `invalid_format` — and those are localised by zod's own error
 * map, which a client installs with `z.config({ localeError })` and the API
 * never touches. That covers the overwhelming majority of validation copy at
 * no cost to anybody.
 *
 * A handful of rules are not generic: `.refine()`s that carry a sentence
 * somebody wrote, because no issue code describes them ("Roles must not
 * repeat"). Those sentences cannot be reached by a locale map, and the reason
 * is worth stating exactly, because it is what forced the shape below.
 * `finalizeIssue` resolves a message in this order:
 *
 * ```
 * issue.message → schema-level error → per-parse error → customError → localeError
 * ```
 *
 * A `.refine(fn, { error: "…" })` installs a **schema-level** error, which wins
 * over everything a consumer can configure. So exactly one of "the schema
 * carries the sentence" and "the client can translate it" is available, and
 * the schema keeping it means an operator reading Latvian meets three English
 * sentences with no way to move them.
 *
 * ## The shape
 *
 * The refinement carries a **key** instead of a sentence —
 * `params: { i18n: "rolesUnique" }`, through {@link customRule} — and the
 * sentence lives here, in {@link CUSTOM_MESSAGES}, reached through an error map
 * installed at `customError`. The English is the **source**, exactly as it was
 * when it sat on the refinement; what changed is that a consumer can now put
 * its own map in front of it and have this one as the floor.
 *
 * **The install below is a module-level side effect, and that is deliberate.**
 * It is the only way the API keeps emitting these sentences with **no diff in
 * `apps/api/src`** — a definition-of-done item for D7 and the whole of ADR-0046
 * §6's "the API is untouched". `zod` does the same thing to itself on import
 * (`config(en())` in its own entry point), which is both the precedent and the
 * reason the ordering works: this runs after that one and merges into it.
 *
 * It is reached from every schema that needs it, because those schemas import
 * {@link customRule} as a **value** — so there is no import path that carries a
 * keyed refinement without carrying its catalogue.
 *
 * Depends on `zod` and nothing else ([ADR-0023](../../../docs/adr/0023-shared-contracts-package.md)).
 */

/**
 * Every sentence a `.refine()` in this package needs, in the source language.
 *
 * British English, because ADR-0046 §5 makes `en` mean en-GB and this is the
 * same voice the rest of the repository is written in.
 *
 * A rule that has **no operator** is deliberately not here: the `grids` bound
 * in `settings/schemas.ts` keeps its literal, because no form renders a
 * `grids` field — the body is assembled by a debounced writer (ADR-0045) and
 * the sentence exists for whoever is reading a `400` in a terminal. Giving it a
 * key would put a sentence in front of a translator that no operator can reach,
 * and would make this module import a bound it would then have to keep in step.
 */
export const CUSTOM_MESSAGES = {
  rolesUnique: "Roles must not repeat",
  updateNotEmpty: "Provide at least one field to update",
  passwordMustDiffer: "The new password must differ from the current one",
} as const;

export type CustomMessageKey = keyof typeof CUSTOM_MESSAGES;

/**
 * The keys as data, so a consumer can assert it has a translation for each one
 * without hand-listing them (`@repo/contracts` declares, the app catalogues).
 */
export const CUSTOM_MESSAGE_KEYS = Object.keys(
  CUSTOM_MESSAGES,
) as readonly CustomMessageKey[];

/**
 * What a keyed refinement carries instead of a sentence.
 *
 * Spread into the refinement's parameters — `.refine(fn, { path: […],
 * ...customRule("passwordMustDiffer") })` — so the call site reads as "this
 * rule, that key" and the key is checked by the compiler.
 *
 * A function rather than an inline object literal for a second reason: it is a
 * **value** import, so a module that declares a keyed rule cannot be loaded
 * without loading the catalogue and the install below.
 */
export const customRule = (key: CustomMessageKey) =>
  ({ params: { i18n: key } }) as const;

/**
 * The key a raw issue carries, or `undefined` for every issue that is not one
 * of ours.
 *
 * Deliberately narrow: only a `custom` issue whose `params.i18n` names a key
 * this catalogue actually has. Anything else — a `custom` issue from a
 * consumer's own schema, a `params` bag used for something unrelated — falls
 * through, so installing this map cannot change a message it does not own.
 */
const customMessageKey = (issue: {
  readonly code?: string;
  readonly params?: Record<string, unknown> | undefined;
}): CustomMessageKey | undefined => {
  if (issue.code !== "custom") return undefined;

  const key = issue.params?.["i18n"];

  return typeof key === "string" && key in CUSTOM_MESSAGES
    ? (key as CustomMessageKey)
    : undefined;
};

/**
 * An error map over the keyed refinements, with the source sentence as its
 * floor.
 *
 * `translate` is what a localised client passes; it returns `undefined` for a
 * key its catalogue has not got, which is the same silent, correct fallback
 * i18next itself performs for a missing entry. Called with no argument it is
 * the source map, which is what this package installs on import and what the
 * API therefore emits.
 */
export const createCustomMessageError =
  (
    translate?: (key: CustomMessageKey) => string | undefined,
  ): z.core.$ZodErrorMap =>
  (issue) => {
    const key = customMessageKey(issue);

    if (key === undefined) return undefined;

    return translate?.(key) ?? CUSTOM_MESSAGES[key];
  };

/*
 * The install. See the header: it is a side effect on purpose, it is the reason
 * `apps/api/src` needs no line of localisation code, and a client replaces it
 * by calling `z.config({ customError })` with a translating map of its own.
 *
 * `z.config` merges rather than replaces, so zod's own `localeError` — the
 * English map its entry point installed — is untouched by this.
 */
z.config({ customError: createCustomMessageError() });
