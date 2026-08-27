/**
 * The config-driven form machinery, extracted (`D9.5`, [ADR-0051](../../../docs/adr/0051-platform-extraction.md)).
 *
 * Everything [ADR-0035](../../../docs/adr/0035-config-driven-resource-ui.md)'s
 * form half decided, unchanged and now living here: the two contexts and their
 * join point, the finite field vocabulary and its adapters, the frame that
 * mounts the providers and the submit lock, the three shells of
 * [ADR-0040](../../../docs/adr/0040-record-edit-surfaces.md) over
 * [ADR-0048](../../../docs/adr/0048-app-shell-and-record-surfaces.md) §4's
 * inverted container, and the server-error landing of ADR-0035.
 *
 * **The two behavioural wrappers [ADR-0047](../../../docs/adr/0047-ui-package-scope.md)
 * kept out of `@repo/ui` are here, and this is their home** — `AppFormActions`
 * reads form state through `useFormContext`, and `AppFormPage` blocks a
 * navigation with `useBlocker`. D8 moved the record surface's *geometry* into
 * the design system and left the behaviour behind on purpose (`D8.10`); this
 * is where the behaviour was going. `@repo/ui` gains nothing from this step,
 * which is ADR-0047's boundary holding rather than being re-argued.
 *
 * Two peers, for the reason ADR-0051 gives: `react-hook-form` is the
 * machinery's engine, and `@tanstack/react-router` is what `AppFormPage`
 * blocks with. Both are honest and cheap — every planned SPA has both — and an
 * injected seam would buy portability no plan names.
 *
 * The namespace (`./i18n`) is this package's own copy, ADR-0046 §13's second
 * real use; `zod-locale.ts` came with it, because its `RULE_KEYS` name keys in
 * that namespace and `D9.2` sent it back to the app for exactly that reason.
 */

export { AppFormDialog, type AppFormDialogProps } from "./app-form-dialog";

export {
  AppFormActions,
  AppFormFrame,
  type AppFormFrameProps,
} from "./app-form-frame";

export {
  AppFormInput,
  createAppFormInput,
  type AppFormInputProps,
} from "./app-form-input";

export { AppFormSurface, type AppFormSurfaceProps } from "./app-form-surface";

export {
  AppFormProvider,
  useAppForm,
  useFieldConfig,
  type AppFormProviderProps,
} from "./context";

export {
  CheckboxField,
  InputField,
  MultiCheckboxField,
  SelectField,
  SwitchField,
  TextareaField,
  type FieldAdapter,
  type FieldAdapterProps,
} from "./fields";

export { AppFormError } from "./form-error";

export { FORM_NAMESPACE, bundles, loadCatalogue, register } from "./i18n";

export { fieldRegistry, type FieldRegistry } from "./registry";

export {
  FORM_ERROR_PATH,
  applyServerErrors,
  schemaFieldRules,
  type FieldRules,
  type ServerErrorOptions,
} from "./server-errors";

export {
  RULE_KEYS,
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
  type RuleTranslator,
} from "./zod-locale";
