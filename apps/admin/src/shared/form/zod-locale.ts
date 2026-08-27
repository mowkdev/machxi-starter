/**
 * The door onto the zod locale installer (`D9.5`, ADR-0051).
 *
 * **It came back through `shared/form` rather than `shared/i18n`**, which is
 * `D9.2`'s finding cashed: the installer's `RULE_KEYS` name keys in the `form`
 * namespace, that namespace is `@repo/form`'s since this step, and copy and
 * the code that names it belong together (ADR-0046 §13). The `en`/`lv`
 * sentences for `@repo/contracts`' keyed refinements now ship beside it.
 */
export {
  RULE_KEYS,
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
  type RuleTranslator,
} from "@repo/form";
