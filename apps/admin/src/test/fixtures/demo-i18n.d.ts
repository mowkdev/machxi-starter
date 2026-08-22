import type demo from "./demo-catalogue.json";

/**
 * The demo fixture's own namespace, declared the way **a package** will declare
 * one (ADR-0046 §13, amended `D7.1`).
 *
 * `D7.4` made every operator-facing string in a `ResourceConfig` a
 * `TranslationKey`, which the demo resource of `D3.6` is one of — and its copy
 * ("Name", "Show archived", "Accept terms") is nobody's real resource, so it
 * must not land in a shipped catalogue. The alternative would have been to give
 * the fixture keys borrowed from `staff` and `users`, which is a fixture
 * claiming to be a resource it is not.
 *
 * So it augments **`ResourceNamespaceMap`** rather than
 * `CustomTypeOptions.resources`: that is the interface i18next 26 ships
 * precisely so a second declarer does not collide with the app's own merge
 * (TS2717), which is the failure D8's second extracted package would otherwise
 * walk into. Both feed `TypeOptions['resources']`, so `TranslationKey` sees
 * `demo:` keys exactly as it sees `staff:` ones — and this is therefore also
 * the rehearsal of the rule D8 inherits, run a deliverable early and for free.
 *
 * The bundle itself is added by `src/test/render.tsx` after the instance is
 * built, which is `register(i18n)` in miniature: nothing under `src/shared`
 * knows this namespace exists, and no reachable production module imports the
 * JSON, so it is types at build time and nothing at all in the bundle.
 */
declare module "i18next" {
  interface ResourceNamespaceMap {
    demo: typeof demo;
  }
}
