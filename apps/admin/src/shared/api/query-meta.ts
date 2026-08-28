/*
 * The `meta` contract of ADR-0034, typed.
 *
 * **It stayed in this app at `D9.6`, and it is the one file in `shared/api`
 * that is not a door.** The shape is app-agnostic and the *content* is not:
 * `mutationMeta.success` is a `TranslationKey`, which resolves over this app's
 * merged catalogue, so the augmentation is this app declaring what its own
 * mutations may say (ADR-0046 §13, the rule `types.d.ts` follows one slice
 * over). Putting it in a package would also have cost a door with nothing to
 * export — the augmentation has no symbols — and a second slice-wide exemption
 * from the door lint to let `shared/api` reach for it. A second app writes
 * these four lines; that is cheaper than either.
 *
 * It lives in `shared` rather than beside the query client that reads it,
 * because `entities/*` and `features/*` are the layers that *write* `meta` and
 * ADR-0032 forbids them importing from `app`. Declaration merging is
 * program-global so the boundaries lint cannot see the dependency — which is
 * exactly why the file has to be placed by the rule rather than by the linter,
 * the same call D3.4 made for `useApiClient`.
 *
 * The `export {}` is load-bearing. Without at least one import or export this
 * file is a global script, and `declare module "…"` in a script *replaces* the
 * module's types instead of merging with them — which manifests as
 * `@tanstack/react-query` suddenly having no `useQuery`, several files away.
 * The `import type` below now makes this a module too; the export stays,
 * because a type-only import is erased and the property should not depend on
 * which imports happen to survive compilation.
 */
import type { TranslationKey } from "@/shared/i18n";

export {};
/**
 * Makes `meta` typed rather than stringly-typed, so `meta: { succes: "…" }` is
 * a compile error and the convention is discoverable from autocomplete instead
 * of from this ADR.
 */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /**
       * Shown as a success toast. Absent means the mutation says nothing.
       *
       * A **key**, not a sentence, since `D7.4` — the additive narrowing
       * ADR-0043's own last consequence said D7 would need (ADR-0046 §7).
       * Nothing about where `meta` is read or who delivers it moved: the one
       * global handler calls `t()` before `toast.success`, and a misspelled
       * outcome is now a compile error at the mutation that declared it.
       */
      readonly success?: TranslationKey;
      /** `false` where a form renders the failure inline (ADR-0034). */
      readonly errorToast?: boolean;
    };
    queryMeta: {
      /*
       * `true` only, never `false`. Queries are silent by default (see
       * `createNotifyingQueryCache`), so an opt-*out* would be a no-op that
       * reads like a decision — the asymmetry with `mutationMeta` is
       * deliberate and this type is where it is legible.
       */
      readonly errorToast?: true;
    };
  }
}
