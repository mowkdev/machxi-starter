/*
 * The `meta` contract of ADR-0034, typed.
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
 */
export {};
/**
 * Makes `meta` typed rather than stringly-typed, so `meta: { succes: "…" }` is
 * a compile error and the convention is discoverable from autocomplete instead
 * of from this ADR.
 */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Shown as a success toast. Absent means the mutation says nothing. */
      readonly success?: string;
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
