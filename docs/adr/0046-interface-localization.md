# ADR-0046: Interface localization — react-i18next, typed namespaced catalogues, zod's error map on the client, and `UiStrings` for the design system

- Status: superseded by [ADR-0064](0064-brand-seams.md) (delta: §4's locale cache key takes its prefix as a parameter; every localization decision stands)
- Date: 2026-08-22

> One of the D7 (interface localization) decision set — the "i18n strategy ADR" that [`docs/plan/0007-localization.md`](../plan/0007-localization.md) names as the one decision the deliverable needs. Written 2026-08-22 **ahead of D7 opening**, while D6 is `in progress`: writing is not opening, the D4 precedent (ADR-0037–0042 were written under D3 and accepted one step at a time under D4). **Accepted 2026-08-22 at the head of `D7.1`** ([ADR-0025](0025-deliverables.md) rule 3), the per-step acceptance D4, D5 and D6 each ran on; it governs `D7.1`–`D7.6` and stays amendable in place while D7 is `in progress` in [`docs/plan/README.md`](../plan/README.md) (rule 2). It supersedes nothing. It is additive beside frozen [ADR-0031](0031-ui-design-system.md), [ADR-0033](0033-browser-api-client-and-session.md), [ADR-0035](0035-config-driven-resource-ui.md), [ADR-0036](0036-admin-testing-strategy.md) and [ADR-0043](0043-readable-list-search-params.md), and beside [ADR-0045](0045-user-settings.md), which is amendable while D6 is in progress — and this record asks nothing of it beyond the `LOCALES` append it already reserved.
>
> **Superseded in part 2026-09-03, at the head of `D14.7`.** [ADR-0064](0064-brand-seams.md) changes one string in §4's negotiation list: the device cache is keyed `` `${appId}.${segment}.locale` ``, supplied to `@repo/i18n` by the app that composes it, so the package holds no brand and a customer app stops writing a key that says `admin`. `machxi.admin.locale` is still exactly what `apps/admin` writes. **Everything else stands**: the four negotiation sources and their order, the ten namespaces and the typed catalogues, the `en`/`lv` pair and the Intl tags, the pseudo lens, zod's error map, `UiStrings`, and §13's rule that an app owns its dictionary while a package owns its machinery — which is the rule 0064's parameter obeys.

## Context

The admin panel speaks English in about two hundred places and in exactly two catalogues. D3 settled the catalogues on purpose: error _codes_ are sentences in `apps/admin/src/shared/notifications/messages.ts`, a `Record<ErrorCode, string>` whose own header calls itself "the i18n seam"; field _rules_ are the zod messages inside the `@repo/contracts` schema that defines them, rendered verbatim when the API's `VALIDATION_ERROR` detail carries a path the form renders (`shared/form/server-errors.ts`, "decided D3.9"). The API's own `error.message` is a developer-facing English default ([ADR-0013](0013-error-model.md)) and is never shown. Everything else — route titles in `staticData`, column headers and field labels in the resource configs, `meta.success` strings on mutations, the grid's "No results", the confirm dialogs, the sidebar's navigation, and six strings inside `@repo/ui`'s generated primitives (`Close` three times, `Previous`, `Next`, `More pages`, `More`, `Toggle Sidebar`) — is a literal where it is used, which was the right cost for a panel with one language and is the whole cost of the second.

[ADR-0045](0045-user-settings.md) put the slot in place before there was anything to put in it: `locale` is a column on both settings tables, an enum built from the contracts tuple `LOCALES = ["en"]`, "carried and inert" until this deliverable. The plan's scope document adds the constraints this record has to satisfy rather than choose: typed keys, ICU-grade plurals and locale-aware dates, lazily loaded locale bundles, packages that can declare strings without owning dictionaries (so D8's extraction has a rule), lint enforcement in the ADR-0002 tradition, and a two-catalogue rule that _evolves_ rather than breaks — `@repo/contracts` depends on zod alone ([ADR-0023](0023-shared-contracts-package.md)) and must not grow translations.

Four forces decide the shape, beyond those.

**Latvian is the second locale, and it is a demanding one.** The operator named `lv` on 2026-08-20, and the plan says why it is a useful test rather than a convenient one: three CLDR plural categories — `0 ierakstu`, `1 ieraksts`, `2 ieraksti`, `11 ierakstu`, `21 ieraksts` — where English has two. An i18n layer that gets Latvian counts right on the pager and the selection summary gets most of Europe right. zod 4 ships locale maps for some fifty languages and **`lv` is not among them**, which turns "use the library's translation" into "write one" for the validation catalogue specifically.

**The frontend is about to be two apps sharing packages.** D8 lifts `apps/admin/src/shared` into packages and builds `apps/customer` on them; the plan sequences localization _before_ that on purpose, so the sweep for literals is paid once, on the app that exists, and the packages never exist in a hard-coded state. Every decision below is therefore judged on two questions: does it work in this app today, and does it lift unchanged tomorrow.

**The design system is generated code.** [ADR-0031](0031-ui-design-system.md) keeps the shadcn primitives byte-close to what the CLI emits, exempts them from prettier, and rules that an edit to one "has to earn itself" with a comment at the point of change. Six of its strings reach screen readers and `sr-only` spans. Leaving them English would mean a Latvian operator's screen reader announces `Close` and `Toggle Sidebar`; localising them means owned edits to generated files, and this record has to say which and at what recurring cost.

**The comparison was made and is closed.** On 2026-08-22 the operator compared react-i18next, FormatJS/react-intl, Lingui and Paraglide against the plan's requirements and chose i18next. §Alternatives records what each would have won so the trade-offs stay honest; none of them is reopened by this record.

## Decision

### 1. Library: i18next + react-i18next, no ICU plugin

**`i18next` with `react-i18next`, the boring choice on purpose.** The deciding weights were ubiquity and hiring: Grafana, the Keycloak admin console, Backstage and Rocket.Chat run on it, which means the conventions below are ones a new contributor has met, the answers to its failure modes are written down somewhere public, and the tooling around it — extractor, lint plugin, pseudo-locale post-processor, typed keys — is maintained by people who are not us.

- **Interpolation is native `{{name}}`.** No ICU plugin. Plurals use i18next's JSON v4 suffix keys — `_zero`, `_one`, `_other` (and `_two`, `_few`, `_many` where a locale has them) — resolved by `Intl.PluralRules`, which already knows that Latvian has three categories and that `21` is `one`:

  ```jsonc
  // en/grid.json                          // lv/grid.json
  "rowCount_one": "{{count}} record",      "rowCount_zero": "{{count}} ierakstu",
  "rowCount_other": "{{count}} records",   "rowCount_one": "{{count}} ieraksts",
                                           "rowCount_other": "{{count}} ieraksti"
  ```

  The `_zero` key is a CLDR category for Latvian, not a convenience: `t("grid:rowCount", { count: 0 })` in `lv` resolves to `0 ierakstu` and in `en` to `0 records`, and the catalogue carries the forms its locale actually has.

- **`context` covers variants** (`deleted_one` / `deleted_other` by count, `status_active` / `status_disabled` by value); select-style ICU messages are not needed for anything on the D7 surface. ICU is revisited only if a need names it — a message that genuinely nests a plural inside a select — and the revisit is an amendment while D7 is open, a supersession after.

### 2. Typed keys

**A missing key or a missing namespace is a type error.** `react-i18next`'s `CustomTypeOptions` is declaration-merged over the `en` catalogue JSON, imported with `resolveJsonModule`; `returnNull: false`; key separator `.`; namespace separator `:`.

```ts
// apps/admin/src/shared/i18n/types.d.ts
import type common from "./locales/en/common.json";
import type errors from "./locales/en/errors.json";
// … one import per namespace

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    returnNull: false;
    resources: { common: typeof common; errors: typeof errors; grid: …; form: …; auth: …; dashboard: …; profile: …; staff: …; users: …; settings: … };
  }
}

/** A key any catalogue resolves, for config files and `meta` to carry (§7). */
export type TranslationKey = ParseKeys<Namespace[], TOptions, undefined>;
```

`en` is the type source because `en` is the source language: a key exists when `en` has it, and every other locale is measured against `en` (§9).

**The `errors` namespace keeps `messages.ts`'s compile-time completeness.** `ERROR_MESSAGES: Record<ErrorCode, string>` exists so that a code added to `@repo/contracts` fails the admin build until somebody writes its sentence. That guarantee moves, not lapses: `en/errors.json` is keyed by `ErrorCode`, and a type-level check asserts that every member of the union is a key of it —

```ts
// shared/i18n/__checks__/errors.ts — compiled, never imported at runtime
type MissingErrorKeys = Exclude<ErrorCode, keyof typeof errors>;
const _complete: MissingErrorKeys extends never ? true : MissingErrorKeys = true;
```

— so a new code is still a red `check-types` rather than a raw `SCREAMING_SNAKE` on screen. `messageForError(error)` survives with the same signature, now `t(\`errors:${code}\`)` behind it with the same runtime fallback for a code this bundle has never heard of.

**Amended 2026-08-22 (D7.2): the signature survives; the export does not.** "Same signature" is the right requirement and it cannot be met by a module-level function, because §13 forbids the module-level instance such a function would have to read. So the thing that keeps `(error) => string` is what `createMessageForError(t)` **returns**, and the exports are that factory, a `useMessageForError()` hook over `useT("errors")` for components, and `englishMessageForError` — the same lookup against the eagerly bundled `en` JSON, for a caller that has no instance yet. Every consumer that had `messageForError` imported now receives one: `applyServerErrors` takes it as a required option (a defaulted English would be a form whose fields are translated and whose form-level failure is not), and `runBulkAction` takes it as an argument, both from callers that are components or hooks.

The one consumer that is **older than the instance** is ADR-0034's global cache handler. `createQueryClient` runs at the composition root and the instance is created inside `SettingsProvider`, where the account's locale is already known (§4, amended `D7.1`) — neither end moves, so `createDeferredErrorMessage()` joins them: a stable `messageForError` the client closes over at construction, and a `bind(t)` that a one-line component under the provider calls. It is a factory rather than a module-level box, so the suite gets one per render; the harness needs none, because there the client and the instance are born together.

The type-level completeness check of the snippet above lives at `shared/i18n/__checks__/errors.ts`. Removing a code from `en/errors.json` fails `check-types` with `Type 'true' is not assignable to type '"USER_DELETED"'` — the missing code by name, which is the whole reason the check is written as an assignment rather than as a conditional type nobody reads.

### 3. Catalogue layout: one `locales/` tree, a namespace per slice

```
apps/admin/src/shared/i18n/
├── index.ts                 # createI18n (§13), useT re-export, the Intl tag map (§5)
├── types.d.ts               # CustomTypeOptions, TranslationKey
├── resolve-locale.ts        # resolveInitialLocale(): the precedence of §4, pure
├── pseudo.ts                # the dev-only post-processor (§10)
├── zod.ts                   # applyZodLocale(locale): z.config({ localeError }) (§6)
└── locales/
    ├── en/                  # bundled eagerly — the source language and the type source
    │   ├── common.json      # chrome, generic actions (Save, Cancel, Delete…), navigation, UiStrings
    │   ├── grid.json        # pager, selection, applied filters, "No results", bulk-delete summary
    │   ├── form.json        # frame copy: confirm, unsaved changes, the form-level error heading
    │   ├── errors.json      # keyed by ErrorCode — ERROR_MESSAGES, moved
    │   ├── auth.json        # the login page
    │   ├── dashboard.json
    │   ├── profile.json
    │   ├── staff.json       # the staff resource's labels, descriptions, titles, outcomes
    │   ├── users.json
    │   └── settings.json    # the locale switch and theme copy
    └── lv/                  # the same ten files, loaded lazily
```

- **One tree, not a JSON beside each FSD slice** — because the extractor (§9) writes to one tree and the lazy loader reads from one, and because a catalogue is not a slice's private implementation: the translator's view of the app is the `locales/` directory, whole. The FSD boundary is kept by the **namespace name being the slice name**: `features/staff-manage` and `entities/staff` write `t("staff:…")` and nothing else, and a key under `staff:` appearing in `features/users-manage` is a review finding with a name. ADR-0032's lint cannot enforce a string prefix, and this record does not pretend it can.
- **Four cross-cutting namespaces** (`common`, `grid`, `form`, `errors`) belong to `shared/*` and are the ones that lift into packages in D8 (§13).
- **`en` is bundled eagerly**: it is the fallback for every other locale, the type source, and the locale the tests run in. **Other locales load lazily, per namespace**, through `i18next-resources-to-backend` over a dynamic `import()`, so Vite emits one chunk per `<locale>/<namespace>.json` and a Latvian operator downloads Latvian while an English one downloads nothing extra. No HTTP backend, no `public/locales`, no runtime fetch of a JSON file from the page origin — which is the CSP reason as much as the bundling one: the catalogues are code, shipped and hashed like code.

**Amended 2026-08-22 (D7.1): the tree as built, and the two files the sketch above did not have.** The layout is the one drawn here, with `index.ts` holding `createI18n`, `INTL_TAGS`, `NAMESPACES` and `EN_RESOURCES` as written — plus:

- **`locale-storage.ts`**, which is §4's `localStorage` key with its two guarded accessors. It is a separate module because `resolve-locale.ts` is *pure* and is tested as a table: the precedence takes `stored` as an argument precisely so that nothing in it touches a browser, and the reader that produces that argument therefore cannot live beside it. `preferredLocale(settings)` in `index.ts` is the two impure lines that join them, and it is the only function a caller outside `shared/i18n` needs.
- **`locales/lv/`**, present from `D7.1` holding the same four `{}` files as `en`. The catalogues are empty until `D7.6` drafts them, and they exist now because the lazy loader's template-literal `import()` over `./locales/<locale>/<namespace>.json` is compiled by Vite into a fixed map of what is on disk: a locale with no directory is not a missing translation at runtime, it is a chunk that does not exist. Creating them empty makes the `lv` path real from the first step rather than at the step that fills it, which is what let `D7.1` assert `changeLocale("lv")` end to end with nothing to translate.

`zod.ts` (§6) and `pseudo.ts` (§10) are not yet written; they arrive with `D7.5` and `D7.6`, which is the tree describing the deliverable's end state rather than its first step.

**Amended 2026-08-22 (D7.2): three more files, and the one screen that is outside the provider.**

- **`tags.ts`** holds `INTL_TAGS`, which `D7.1` had in `index.ts`. It moved because `intl.ts` needs it and `index.ts` needs `intl.ts`; leaving it in the barrel would have made the two a cycle. `index.ts` re-exports it, so nothing outside `shared/i18n` learns the difference.
- **`intl.ts`** is §5's formatter holder — see that section.
- **`__checks__/errors.ts`** is §2's completeness check. A directory of its own, because a file whose entire purpose is to be type-checked and never imported should not sit among files that are.

And the residual this layout has, stated rather than discovered later: **`AppLoader` renders above `I18nextProvider`.** It is the fallback of both boot gates, and the instance is created inside the inner one, so `useTranslation` there does not degrade — it warns and returns the key, and an operator would read `loading.starting` while the app started. It therefore reads `I18nContext` and falls back to the bundled `en`, which is the only catalogue that could be in memory that early in any case: every other locale is a dynamic `import()` nobody has asked for yet. The key stays a key, so `D7.6`'s extractor still finds it. This is the honest floor of "the app is localized" — the first paint is in the source language, and there is no ordering that changes it.

**Amended 2026-08-22 (D7.4): three more modules, ten real namespaces, and one catalogue that is deliberately not in the tree.**

- **`namespaces.ts`** holds `NAMESPACES`, `Namespace` and `DEFAULT_NAMESPACE`, and **`resources.ts`** holds `EN_RESOURCES` and the `Catalogue` / `Catalogues` types. Both moved out of `index.ts` for the reason `tags.ts` did at `D7.2`: `keys.ts` needs them and `index.ts` re-exports `keys.ts`, so leaving them in the barrel would have made the two a cycle. `index.ts` re-exports both, so nothing outside `shared/i18n` learns the difference.
- **`keys.ts`** is §7's translator seam: `TranslateKey`, `useKeyT()`, `dynamicKey`, `englishTranslation` and `createDeferredTranslate`.
- **The ten namespaces sketched above are now all real.** `auth`, `dashboard`, `profile`, `staff`, `users` and `settings` land with `D7.4`, each named for the slice that owns it; `settings` holds the appearance control's copy and is where `D7.5`'s locale switch joins it, because the two are views of one account row.
- **The test fixture's catalogue is outside `locales/` on purpose.** `demoResourceConfig` is a `ResourceConfig` too, so `D7.4` made its copy keys — and its words ("Show archived", "Accept terms") are nobody's resource and must not ship in a catalogue a translator opens. `src/test/fixtures/demo-catalogue.json` is registered on the harness's instance instead, which is §13's `register(i18n)` rule arriving a deliverable early; see that section.

**Amended 2026-08-22 (D7.5): the file this tree called `zod.ts` is two files, and one of them is not about zod at all.**

- **`zod-locale.ts`** is §6's installer — `RULE_KEYS`, `createRuleTranslator`, `applyZodLocale` and `zodLocaleReady`. The sketch above named it `zod.ts`; the longer name is worth two characters because the directory now holds `intl.ts`, `tags.ts` and this, and "the zod file" says nothing about which of the three it is.
- **`locale-context.tsx`** is the *control* half, which this record had not accounted for anywhere: §4 decides where a locale comes **from** and says nothing about how an operator changes it. `useLocale()` reads the language off the mounted instance and writes it with `changeLanguage`, and a `LocalePublisherProvider` carries the account half that `app/providers` installs — the shape `shared/theme` has, for the reason ADR-0032 gives: the control is a feature, its host is a widget, and neither may import from `app`.

  The one deliberate difference from the theme is that **the device half needs no provider**. `useTheme` throws outside `ThemeProvider`; `useLocale` does not, because everything it needs is already in `I18nextProvider`, and what a missing publisher means is not "misconfigured" but "signed out" — which is the login screen, the one place an operator most needs the switch and the one place there is nothing to write to.

### 4. Locale resolution, in order

```ts
// shared/i18n/resolve-locale.ts — pure, unit-tested on a table
export const resolveInitialLocale = ({ settings, stored, navigator }: {
  readonly settings: Locale | null;           // the principal's D6 settings row, when signed in
  readonly stored: string | null;             // localStorage "machxi.admin.locale"
  readonly navigator: readonly string[];      // navigator.languages
}): Locale =>
  settings ?? asLocale(stored) ?? navigator.map(asLocale).find(isDefined) ?? "en";
```

1. **The principal's settings locale, when signed in** — server wins on sign-in, which is ADR-0045's first-sync rule applied to a scalar: the account's locale is the fact, the device's is a cache of it.
2. **`localStorage` `machxi.admin.locale`** — non-credential display state, exactly the theme's precedent under ADR-0033's D3.1 carve-out, and for the theme's reason: the login screen has no session to ask, and an operator who chose Latvian should not read `Sign in` in English for one screen every morning. Written whenever the active locale changes; read before first paint.
3. **The first `navigator.languages` entry that matches `LOCALES`** — `lv-LV` matches `lv` by primary subtag; anything else does not match and is not guessed at.
4. **`en`.**

`<html lang>` follows the active locale, set by the same `languageChanged` listener that switches the zod map (§6) and rebuilds the formatters (§5). The switch itself writes through `useUpdateSettings` like the theme does and through the local key synchronously, in that order of importance and the reverse order of time.

**Amended 2026-08-22 (D7.1): `<html lang>` carries the Intl tag, not the enum member.** "Follows the active locale" has two readings and only one of them is right. `lang="en"` and `lang="en-GB"` are both well-formed, and the attribute is read by things that care about the difference: a screen reader picks a voice from it, a browser hyphenates by it, and `:lang()` selectors match it. §5 has already decided that `en` **means** en-GB here — British spelling, European date order — so writing the bare enum member into the document would be the one place that decision is not honoured. `INTL_TAGS[locale]` is therefore what the listener assigns, and it stays the single place a locale becomes a formatting tag.

The listener is also installed *before* `init` and applied once *after* it, rather than relying on the emit `init` makes on its way through. Applying is idempotent — an assignment and a `localStorage` write — so paying for it twice costs nothing, and depending on an emit that a future i18next may reorder would cost the document's language on first paint.

**`Accept-Language` is not used anywhere, by any side.** The index's Planned bullet for internationalization mentioned it, and the answer is no: a locale is an account fact that follows the operator between devices, not a request header that follows the browser's settings panel; the API never renders copy (§6), so it has nothing to negotiate; and the one place the header would have been read — a first-visit guess before sign-in — is step 3 above, answered from `navigator.languages`, which is the same data without a round trip.

### 5. `en` means en-GB, and Intl follows the active locale

**Source copy is British English** — _serialise_, _honour_, _catalogue_ — because it is the repository's documentation voice and a second spelling convention in the catalogues would be a review argument with no winner. The Intl tag map is one object in `shared/i18n`, because `@repo/contracts` holds only the enum and a BCP 47 tag is a presentation fact:

```ts
export const INTL_TAGS: Record<Locale, string> = { en: "en-GB", lv: "lv-LV" };
```

- **`shared/grid/formatters.ts` and `filter-chips.ts` build their `Intl.DateTimeFormat`s from the active locale**, not from `undefined`, and rebuild on `languageChanged`. Today's `undefined` means "the browser's locale", and a Latvian operator on an English OS would otherwise read Latvian headers over English dates. The formatter registry's entries stay `(value) => string` — they close over a formatter holder that the language listener swaps, so ADR-0035's "configs carry keys, registries carry functions" is unchanged. `filter-chips.ts`'s `timeZone: "UTC"` day formatter keeps its timezone reasoning intact and only changes locale.
- **Numbers and dates in copy go through i18next's built-in Intl formatters** — `"{{total, number}}"`, `"{{since, datetime(dateStyle: medium)}}"` — or through those Intl objects. **Never `toLocaleString()` with an implicit locale**, anywhere in `apps/admin`, which the lint rule of §8 cannot see and a grep in `pnpm i18n:check` (§9) does.

**Amended 2026-08-22 (D7.2): the formatters read a holder, and the holder is app-wide.** `shared/i18n/intl.ts` owns the active tag and hands out `Intl.DateTimeFormat`s cached per tag and options; `createI18n`'s `languageChanged` listener calls `setIntlLocale` as part of `applyLocale`, **before** `document.documentElement.lang` and before react-i18next's own listener has run — so the dates have already moved by the time the tree is asked to render, rather than lagging it by a paint. `formatters.ts` and `filter-chips.ts` resolve the formatter **per call** rather than capturing one, which is what keeps a registry entry `(value) => string` (ADR-0035) while still following a switch.

The holder is module-level state and therefore **app-wide, not per-instance** — the one place in `shared/i18n` that is. It has to be: an entry in ADR-0035's formatter registry takes a value and nothing else, so there is no parameter for an instance to arrive through. The cost is named rather than hidden: two instances at two locales in one test file share it and the last `languageChanged` wins, so a locale-sensitive assertion belongs in a file that renders one tree. `en` being the suite's locale (§14) is what makes that a rule about one file rather than about all of them.

**Amended 2026-08-22 (D7.5): there are two app-wide holders now, and the second is zod's.** `z.config` writes to one object per process (§6), so the active zod locale has exactly the property this paragraph names for `Intl` and needs no separate argument: two instances at two locales in one test file share it and the last `languageChanged` wins. The cause is the same one — `zodResolver` runs a schema deep inside react-hook-form and there is no parameter an instance could arrive through — and so is the discipline: a locale-sensitive assertion belongs in a file that renders one tree, and a file that switches the locale restores `en` before it finishes.

### 6. Validation copy: zod's error map on the client; the API stays English

This is the plan's "subtle one", and the D3.9 argument in `server-errors.ts` already named the mechanism: _"localising the latter is zod's own error map on the contracts package, applied once for both sides."_ That sentence is adopted, with one refinement.

- **The client sets zod's locale from the active locale**: `z.config({ localeError })` at `createI18n` time and again on every `languageChanged`. zod 4's shipped `en` map (`zod/v4/locales/en`) is used as-is.
- **The `lv` map is ours.** zod ships no Latvian. `packages/contracts/src/locales/lv.ts` mirrors the shape of zod's own locale modules — a default-exported factory returning `{ localeError }`, a `Sizable` table, a `FormatDictionary`, one `switch` over `issue.code` — and **depends on zod alone**, which is legal under ADR-0023 word for word. It is exported through a subpath, `@repo/contracts/locales/lv`, so a consumer that never switches to Latvian never bundles it, and so the package's root export stays what it is. Contracts thereby _holds a locale map_ and still _holds no translation of its own messages_: the schemas keep their English rule text as the source, and the map translates the generic issue codes.

  The schemas' **custom messages** — `passwordSchema`'s policy text, a `.refine()` with its own sentence — are the residual this design owns rather than hides. A custom message is a string baked into the schema, and the error map never sees it. D7 handles them the way zod 4 intends: a custom message becomes a **`params: { i18n: "<key>" }`** on the issue, the client-side resolver maps it through the `form` namespace, and the API keeps emitting the English `message` beside it. The contracts package still ships no sentence in any language but the source one.

- **The API is untouched.** [ADR-0011](0011-middleware-pipeline.md)'s `validate()` and [ADR-0013](0013-error-model.md)'s `message` stay developer-facing English, `toErrorDetails` keeps copying `issue.message` unchanged, and the integration tier and the Postman collection keep asserting one language. Nothing on the server reads a locale.
- **A matched `VALIDATION_ERROR` detail is re-derived client-side.** `applyServerErrors` today renders `detail.message` verbatim, on the D3.9 argument that the words are the schema's own. The argument holds and the _words_ no longer do — the API's words are English and the operator's may not be. So the refinement: for a detail whose path matches a rendered field, the form **re-runs its resolver on the current values under the active locale** and prefers its own issue message for that path. The rule is unchanged — it is the same schema, caught a second time, in the operator's language — and the API's English text is the fallback only in the **D3.8 residual**: a key the controls never held, which the resolver cannot produce an issue for because the form's state is not its body. That residual was already recorded as "the one shape of validation copy this design cannot promise an operator has seen before"; it is now also an **un-localised** residual, and it is the same narrow case, not a new one.

**Amended 2026-08-22 (D7.5), in four parts: the mechanism above is right and the sentence describing where it fires was not.**

- **A schema-level message cannot be translated from outside, so the schemas stopped carrying one.** The plan and this section both say a custom message "becomes `params: { i18n: "<key>" }` on the issue" and that "the client-side resolver maps it through the `form` namespace", and the second half is not reachable: zod resolves a message as `issue.message` → the schema's own `error` → the per-parse map → `customError` → `localeError`, so a `.refine(fn, { error: "…" })` wins over everything a consumer can configure, and `zodResolver` throws the issue's `params` away before react-hook-form ever sees them. Exactly one of "the schema carries the sentence" and "a client can translate it" is available.

  So the refinements carry the key **and nothing else**, the English source sentences move into `packages/contracts/src/locales/source.ts` as `CUSTOM_MESSAGES`, and they are answered by an error map installed at **`customError`** — which is the tier immediately above `localeError`, and therefore exactly where a keyed rule should beat a generic one. `@repo/contracts` installs the source map **on import**, as a module-level side effect, which is what makes "the API is untouched" literally true rather than nearly true: the API emits the same sentences with no line of localisation code, because `zod` does the same thing to itself (`config(en())` in its own entry point) and this merges into it. The client replaces that one map with `createCustomMessageError(translate)` and the source stays behind it as the floor.

- **The client-side path is localised too, and that was not optional.** The sentence above puts this refinement on `applyServerErrors` alone, which would have left `changePasswordBody`'s "must differ" rule reading English under a form whose every other word was Latvian — the rule an operator meets *without* the server, in the one dialog that has one. Installing at `customError` fixes both paths with one mechanism instead of fixing the server path with a re-derivation and the client path with a resolver rewrite.

- **`passwordSchema` has no custom message and never did.** This section names its "policy text" as one of the residual sentences; the schema is `.min(12).max(128)` and its rule surfaces as zod's own `too_small`, which the locale map already translates. Three sentences carry keys (`rolesUnique`, `updateNotEmpty`, `passwordMustDiffer`) and a fourth deliberately does not: the `grids` bound in `settings/schemas.ts` keeps its literal, because no form renders a `grids` field — the body is built by a debounced writer and the sentence exists for whoever is reading a `400` in a terminal.

- **The re-derivation runs the schema, not the resolver.** "Re-runs the form's resolver on the current values" is the intent and `zodResolver` is the wrong instrument for it: it is asynchronous, and it discards everything about an issue except its message and code. `schemaFieldRules(schema, values)` calls the same schema's `safeParse` — synchronously, lazily, at most once per rejection — and `applyServerErrors` prefers its message for a path it answers. The schema is the one the caller already handed `zodResolver`, so "the same schema, caught a second time" holds exactly; what does not hold is that it is the same *function*.

### 7. Config copy becomes keys

**Every operator-facing string in a `ResourceConfig` is a `TranslationKey`**, resolved by the rendering machinery with `t()`: column `header`, field `label`, `description` and `placeholder`, `emptyMessage`, hot-filter and filter-operator labels (`"Contains…"`, `"Deleted only"`), `errorFields`' messages where they have any. The same rule covers the three places beside the configs where copy travels as data: route **`staticData.title`**, mutation **`meta.success`** (the follow-up [ADR-0043](0043-readable-list-search-params.md) §Consequences left for D7), and **confirm-dialog** copy.

```ts
// entities/staff/staff.config.ts — after
columns: {
  email: { header: "staff:columns.email", sortable: true,
           filter: { kind: "text", op: "like", placeholder: "grid:filter.containsPlaceholder" } },
  …
},
fields: {
  password: { label: "staff:fields.password.label", description: "staff:fields.password.description", … },
},
// app/routes/_dashboard.staff.tsx
staticData: { title: "staff:title", fullHeight: true },
// entities/staff/staff.queries.ts
meta: { success: "staff:outcomes.created" },
```

- **ADR-0035's "config is serializable data" holds — a key is data.** A config still diffs, snapshots and deep-merges; nothing in it is a function; `as const satisfies ResourceConfig` now also checks that every key exists in `en`, because `TranslationKey` is a union of literals. A typo'd key is a compile error, the same property the registries already have for formatter names.
- **A registry function never formats copy itself.** `rowActions`, `statusBadge`, the filter dialogs and the chips bar call `t()` on the keys the config handed them; an enum option's label is `t(\`${ns}:options.${value}\`)` from a namespace the config names. `filter-chips.ts`'s `labelFor` becomes a function of `(filter, column, t)` and stays pure and table-tested.
- **The `meta` type changes one field's type**: `mutationMeta.success?: TranslationKey`, and the global handler calls `t()` before `toast.success`. That is the D7 amendment ADR-0043's own last consequence said it would need, made as an additive type narrowing beside a frozen record: the string-typed field is replaced by a key-typed one, and nothing about where `meta` is read or who delivers it moves.

**Amended 2026-08-22 (D7.2): the line between the two sweeps is not a directory.** The plan gives `D7.2` "`src/shared`, `src/widgets` and `src/app`" and gives this section route `staticData.title`, `meta.success` and confirm-dialog copy — and those live in `src/app` and in the features. `D7.2` therefore finished with `src/shared` and `src/widgets` at **zero** operator-facing literals and `src/app` holding exactly the ones this section claims: eight `staticData.title`s, the two shell fallbacks that back them (`useRouteTitle("Sign in")`, `useRouteTitle("Admin")`), and two "Back to \<resource\>" links. Every one of them names a resource or a route, and every one of them needs a namespace `D7.4` creates. Splitting them earlier would have meant `auth`, `dashboard`, `profile`, `staff` and `users` landing in the step that was supposed to own the cross-cutting four — so the seam is the *namespace*, not the folder, and the plan's "no operator-facing literal remains under `src/app`" is read against that.

**Amended 2026-08-22 (D7.4): five things the sweep found where this section had guessed.**

- **An enum option's label is `common:options.<value>`, not one composed from a namespace the config names.** The sentence above assumed every option label arrives through a config, and two of them do not: `StatusBadge` and `RolesList` are handed a cell value and nothing else — that is what makes them resource-agnostic and what lets the profile page reuse them — so a per-resource namespace could not reach the place a status is most often read. One block in `common` answers both, and it is the right home for another reason: `active`, `disabled` and `super_admin` are app-wide vocabulary that `staff` and `users` share, so a key per slice would be the same nine words written twice for a translator to disagree with themselves over. `humanize` survives as the **`defaultValue`**, so a member added to `@repo/contracts` renders the plausible English word it rendered before D7 rather than a raw key.
- **That key is composed at runtime, and it is the only one in the app that is.** Spelling the members out in each config would be the one place ADR-0023's "declared once" property is copied, and the copy is the thing that rots. The cast lives once in `shared/i18n/keys.ts` (`dynamicKey`) with the reason at the point of change, and each resource's config test asserts that every option it declares has a catalogue entry — the half the compiler cannot check gets a test instead. **`D7.6` inherits the cost**: `i18next-parser` cannot see a composed key, so `common:options.*` is a block §9's extractor has to be told to keep — and **every key a config carries has the same property for the same reason**, because none of them appears inside a `t()` call in the source. §9's "the code is the source of truth for which keys exist" is true of `t()` call sites and is not true of config values; `D7.6` decides how the extractor is told about the second kind.
- **`emptyMessage` is a prop, not a `ResourceConfig` field.** This section lists it among config copy and it never was one: it reaches `AppGrid` from the page, beside `columns` and `hotFilters`. It becomes a `TranslationKey` **prop**, resolved by the grid through a namespace the grid does not know the name of, and `grid:empty` stays the default for a screen that says nothing. Nothing in ADR-0035's vocabulary moved to accommodate it.
- **The machinery needs a translator over every namespace, and that is a type worth naming.** `useT("grid")` is right for a module whose copy is all one namespace's — the key it resolves is checked as that namespace's — and exactly wrong for a module resolving keys **it did not write**: `AppGrid`, `buildColumns`, the field adapters and `filter-chips.ts` all render `staff:` and `users:` alike. So `shared/i18n` exports `TranslateKey` and `useKeyT()`, and the two pure modules that mix both kinds — `filter-chips.ts` and `bulk-summary.ts` — take the app-wide translator and spell `grid:` on the keys they own. The prefix is not noise: it is the line between a module's own copy and a caller's, said in the key.
- **The bulk summary's noun is resolved with the same count as its sentence**, which closes the half-answer `D7.2` recorded. `grid:bulk.deleted` pluralises the sentence and left the noun inside it singular; `staff:noun` now carries `_one` / `_other` of its own and is resolved as `t(noun, { count })`, so a language that declines the noun answers with its own categories rather than being handed an English singular. `summariseBulk` therefore takes a key where it took a word.

And the wire this section's `meta.success` needed: ADR-0034's global mutation handler is built at the composition root, before any instance exists — the same ordering §2 solved for `messageForError` — so `createDeferredTranslate()` sits beside `createDeferredErrorMessage()` in `shared/i18n/keys.ts`, bound by the same one-line component under the provider, with `englishTranslation` (a path walk over the eagerly bundled `en`) as its floor.

### 8. Lint: the mechanical half

**`eslint-plugin-i18next`'s `no-literal-string`, in the admin config of `@repo/config-eslint`** — the ADR-0002 pattern: a rule is the half of an ADR that does not depend on a reviewer noticing. It fires on JSX text and on the attributes an operator reads — `aria-label`, `title`, `placeholder`, `alt` — in `apps/admin/src/**`, and is off for `src/**/__tests__/**`, `src/test/**` and `src/shared/i18n/**` (the catalogues and the pseudo-locale are literals by definition). Class names, `data-*`, keys, `type` and `role` attributes are outside the rule's reach by its own defaults, which is the right line: it catches sentences, not identifiers.

The rule lives in the shared package rather than in `apps/admin/eslint.config.js` for the reason `apiConfig` does: D8's customer app applies the same export, and a second copy is where the two apps' rules diverge.

**Amended 2026-08-22 (D7.6): the rule is type-aware, and that is what makes it a rule rather than a nuisance.** Without a TypeScript program the plugin sees every string literal inside JSX alike, so `t("actions.apply")`, `can("read", resource)` and `align ?? "start"` are reported beside a genuine sentence — and the only defence is a hand-kept list of callee names, which is the kind of list that rots into `// eslint-disable` comments. With one, a literal whose *contextual type* is a string-literal union is skipped, and that is the correct rule stated properly: a `TranslationKey`, an `Action` and an alignment are identifiers the compiler already checks, not copy an operator reads. It is the same trade `apiConfig` makes for `no-floating-promises` — a program for the rules that cannot be decided syntactically, and nothing else type-checked — and it is why `adminConfig` takes the app's own `tsconfigRootDir` as its one argument. Three smaller details this section had not fixed: the mode is `jsx-only` with `jsx-attributes.include` set to exactly the four attributes above, because the plugin's default `jsx-text-only` would leave `aria-label="Close"` untouched and four of the six strings §12 had to reach into the design system for were precisely that shape; the exemption list gained `src/**/__checks__/**` beside the three named here; and the finding arrives as a **warning** rather than an error, because `eslint-plugin-only-warn` is in the shared config — `--max-warnings 0` is what makes it fatal, which is this repository's existing convention and not a weakening of the rule.

### 9. Extraction and drift checks

- **`pnpm i18n:extract`** runs `i18next-parser` over `apps/admin/src` and rewrites `en/*.json` from the `t()` calls: new keys added with their default value, unused keys removed, order stable. The source of truth for "which keys exist" is the code; the catalogue is derived, which is what keeps it from rotting.
- **`pnpm i18n:check`** is part of `pnpm check` and red on two conditions: **(a)** the extractor would change any `en` file — key drift, a `t()` added without its catalogue entry or a key orphaned by a deletion; **(b)** an `lv` namespace is missing any key `en` has. Runtime falls back to `en` for a missing `lv` key, silently and correctly; the check is what makes the gap visible in the gate rather than on a Latvian operator's screen. The check also greps for `toLocaleString(` and `toLocaleDateString(` outside `shared/i18n` (§5). Under [ADR-0026](0026-task-graph-caching-and-serialisation.md) it is a pure function of the tree and is cached.

**Amended 2026-08-22 (D7.6): it is not `i18next-parser`, and `i18n:extract` only ever deletes.** The sentence above — "the code is the source of truth for which keys exist and the catalogue is derived" — is the right instinct pointed the wrong way for a design with typed keys. `en` **is** the type source (§2): `TranslationKey` is a union over it, so a `t()` call or a config value naming a key `en` lacks is already a red `check-types`, and a tool that rewrote `en` from the code could only ever delete the key the compiler is about to demand. Worse, a call-site parser cannot see most of this app's keys at all — §7 made column headers, field labels, route titles and `meta.success` into `TranslationKey` *values*, and feeding those to `i18next-parser` would take a custom lexer, which its plugin contract spells as a class (ADR-0009). So `apps/admin/scripts/i18n.mjs` is a reference scan that reads both kinds of key, the dependency is not taken, and the check reports six kinds rather than the two named above: `orphan`, `gap`, `stale`, `plural` (a counted key short of a category in **its own** locale's CLDR set), `empty`, and `implicit-locale`.

The delete-only rule was learned from the wrong side, and that is why it is written here. An earlier `i18n:extract --write` removed the live key `grid:pager.next` from `en/grid.json` as an orphan, and **what caught it was `check-types`** — `TS2345 … Did you mean '"pager.none"'?` — not the check that had just rewritten the file. That is this section's own claim proved by its failure: the compiler owns the direction "the code names a key `en` lacks", so `rewrite()` adds nothing at all, and the branch that would have added an empty key is gone. The scan over-reports references on purpose (a key named in a comment counts), which is safe while deciding what to **delete** and exactly wrong while deciding what to add, because every key-shaped literal that is not a key — a dotted fixture path, a token name — would arrive as a key to create. A `gap` is not filled either: an empty `lv` entry would silence the finding without translating anything, so the report is the whole product and the check stays red until a person writes the words.

§7 asked `D7.6` how the extractor is told about the keys composed at runtime. The answer is an enumeration in the script with a call site beside each entry rather than a rule, and there are exactly two: `errors:`, resolved from an `ErrorCode` by `messageForError` and checked for completeness by the compiler at `shared/i18n/__checks__/errors.ts`, and `common:options.`, composed by `dynamicKey` from a `@repo/contracts` enum. Both are enumerated because an enum declared once (ADR-0023) must not be copied into a key list that could then disagree with it.

### 10. Pseudo-locale, dev only

**`i18next-pseudo` as a post-processor**, turning `Save changes` into `[Šàvé çhàñgéš ∙∙∙]` — accented so a literal stands out, widened so a truncation shows. It is enabled by **`VITE_I18N_PSEUDO=true`**, a new admin variable: added to the `shared/config` zod schema ([ADR-0004](0004-configuration-and-environment.md)'s one reader), documented in `apps/admin/.env.example`, declared in `turbo.json`'s `env` for any task that reads it (the `build` and `dev` tasks, the same way `VITE_API_URL` is). It is **not a member of `LOCALES`** — the enum is the production set, stored in a database column, and a pseudo-locale is a lens over `en`, not a language an account can have.

It is the deliverable's definition-of-done tool: the acceptance walk under the pseudo-locale shows no unaccented string anywhere — grid chrome, dialogs, toasts, validation errors and the six `@repo/ui` strings included — and §14's route suite is the executable form of that walk.

**Amended 2026-08-22 (D7.6): three facts about the mechanism.** `languageToPseudo: "en"` is what makes this a lens rather than a language — the processor passes every other language through untouched, so an instance built with it on and switched to `lv` shows Latvian, and switching back to `en` shows the accented source. That is the right behaviour for a lens: it reveals the source language, which is the only one with anything to hide. The library's shipped `.d.ts` is written against `i18next@^19`, where `process` took `key: string` and a mutable `TOptions.lngs`; both widened since, so the *implementation* satisfies i18next 26 while the types do not, and under `exactOptionalPropertyTypes` (ADR-0002) the two signatures cannot be reconciled by anything a caller can write — hence one cast, one expression, contained in `shared/i18n/pseudo.ts`, the only module in the app that names the package. And `VITE_I18N_PSEUDO` reaches the schema as `z.stringbool().default(false)`: an environment variable is a string and `Boolean("false")` is `true`, which is the classic way a flag ends up permanently on, and it is defaulted rather than required so that an `.env` file does not become a prerequisite for running the app.

### 11. Latvian: machine-drafted, review status explicit

**The `lv` catalogues are machine-drafted in D7 and marked `pending native review` in the plan** until the operator signs them off. The plural forms are written correctly from the start — the `_zero` / `_one` / `_other` split is grammar, not style, and is tested (§14). This record says it plainly because the alternative is a claimed translation: `lv` is a real second locale with an explicit review status, it exercises every mechanism above end to end, and the sentences themselves are the part a native reader still owns.

**Amended 2026-08-22 (D7.6): the status note lives with the catalogues, and the drafting proved §9 inside the step that added it.** `pending native review` is recorded in `apps/admin/src/shared/i18n/locales/README.md` rather than only in the plan, because that is the file somebody editing a Latvian sentence opens; it also says what a wording change is and is not — translation, never a decision about keys or plural categories. What the machine drafting got wrong is exactly what the check exists to find: `lv/staff.json` was written without `empty` and without `bulkDelete.title_zero` — a namespace one entry short, and a counted key short of Latvian's third category — and both surfaced as `i18n:check` findings rather than as review findings a reader might have missed. A drafted catalogue is not a careful one, which is the argument for §9 in a sentence.

### 12. `@repo/ui`: `UiStrings`, and six owned edits

The design system gains **no i18n dependency**. It gains one hand-written context:

```tsx
// packages/ui/src/ui-strings.tsx — formatted code, not generated; prettier applies
export interface UiStrings {
  readonly close: string;          // dialog.tsx ×2, sheet.tsx
  readonly previous: string;       // pagination.tsx
  readonly next: string;           // pagination.tsx
  readonly morePages: string;      // pagination.tsx
  readonly more: string;           // breadcrumb.tsx
  readonly toggleSidebar: string;  // sidebar.tsx
}

export const DEFAULT_UI_STRINGS: UiStrings = { close: "Close", previous: "Previous", … };

export const UiStringsProvider = ({ strings, children }: { strings?: Partial<UiStrings>; children: ReactNode }) => …;
export const useUiStrings = (): UiStrings => useContext(UiStringsContext) ?? DEFAULT_UI_STRINGS;
```

- **English defaults, so nothing changes for a consumer that mounts no provider** — `packages/ui`'s own tests and a future app that has not localised yet keep today's behaviour.
- **The apps supply translations from their `common` namespace**: `app/providers` mounts `<UiStringsProvider strings={{ close: t("common:ui.close"), … }}>` and re-renders on `languageChanged`. The design system never learns what i18next is; it learns that six strings are injectable.
- **The generated files take owned edits.** In `dialog.tsx`, `sheet.tsx`, `pagination.tsx`, `breadcrumb.tsx` and `sidebar.tsx` each literal becomes `strings.<key>` from `useUiStrings()`, and **each edit carries a comment at the point of change naming this ADR** — ADR-0031's rule that an edit to a generated file must earn itself, applied six times. The edits are minimal by construction: one hook call and one expression per literal, no restructuring, so the regenerate-and-diff cost (§Consequences) stays a reapply rather than a rewrite.

**Amended 2026-08-22 (D7.3): six keys, ten sites, and a fifth door.**

- **"Six strings" counts keys, not edits.** The upstream literal appears ten times across the five files: `close` three times (`dialog.tsx`'s corner button and its optional footer action, `sheet.tsx`'s corner button) and `toggleSidebar` three times (`SidebarTrigger`'s `sr-only` span, and `SidebarRail`'s `aria-label` **and** its `title`, which upstream writes as two separate literals of the same sentence). The interface is still six, and it should be: an operator who hears two different words for the same control has been told there are two controls.
- **The seam is exported, and the app's lint rule grew a line to match.** `packages/ui/src/ui-strings.tsx` sits at the package root rather than under `components/`, which is what puts it outside ADR-0031's prettier carve-out and outside the regenerate-and-diff surface — it is hand-written code that generated code imports, and the direction matters. It therefore needs its own `exports` entry (`"./ui-strings"`), and `apps/admin`'s `no-restricted-imports` group gains `@repo/ui/ui-strings` beside `components/*`, `hooks/*` and `lib/*`: the provider is mounted from `app/providers`, and `app` is the one layer that must not reach past `shared`, so the seam comes through the `shared/ui` door like everything else.
- **`UiStringsProvider` memoises on the six strings, not on the object.** The app's call site is a component whose whole output is six `t()` calls, so it hands over a **new object on every render**; memoising the context value on that object would push a new value — and a re-render of every dialog, sheet, pager and sidebar below it — whenever anything above it rendered. Destructuring the six and memoising on them is one line here and removes the obligation from every caller, present and future, which is the right side of a package boundary for it to live on.
- **`app/providers/ui-strings.tsx` supplies all six even though `apps/admin` mounts three.** The admin's pager is `shared/grid/grid-pager.tsx` — buttons rather than `Pagination`'s anchors, for the keyboard reason its own header gives — and `BreadcrumbEllipsis` is not on the `shared/ui` door either, so `previous`, `next`, `morePages` and `more` have no rendering site in this app today. They are supplied anyway, for two reasons that outlive the observation: the keys then have a `t()` call site, which is what keeps §9's extractor from pruning them as orphans; and D8's customer app may well mount the primitive this one declined to.
- **The residual, named rather than found later: five operator-read literals in these files are not among the six.** `sidebar.tsx`'s mobile branch renders an `sr-only` sheet header (`Sidebar`, `Displays the mobile sidebar.`); `pagination.tsx` writes `aria-label="Go to previous page"` and `"Go to next page"`; and `pagination.tsx` and `breadcrumb.tsx` each name their `<nav>` landmark (`pagination`, `breadcrumb`). The first pair is reachable in `apps/admin` below the `md` breakpoint and the rest are not reachable at all, which is why §12 could enumerate six and be right about this app. It stops being right the moment a consumer mounts the pager — and §14's route suite asserts that no **operator-read attribute** survives the pseudo-locale unaccented, so `D7.6` meets this rather than inherits it. The answer §Consequences already gives stands: a seventh string is one more key, not a new mechanism. `D7.6` decides how many.

**Amended 2026-08-22 (D7.6): the answer is all of them, and there were seven rather than five.** `UiStrings` is **thirteen keys**, not six. The five the bullet above named are in — `sidebarTitle`, `sidebarDescription`, `previousPage`, `nextPage`, `pagination`, `breadcrumb` is six of them once the pair is counted properly — and so is the one nobody had counted: `sonner.tsx`'s `containerAriaLabel`, the toast region's accessible name. That last one matters most and was the easiest to miss, because the residual's whole justification was reachability — "not reachable at all in `apps/admin`" — and the toast region is mounted on **every screen in the app**. An operator whose screen reader announces a landmark called `Notifications` in the middle of a Latvian panel is precisely the failure §Alternatives rejected leaving in place.

Two things follow, and both are about how it was found rather than what it cost. **It cost nothing structural**, exactly as §Consequences predicted: seven more keys, seven more `common:ui.*` entries, seven more lines in the provider's destructuring, and one more owned edit per file each carrying its ADR-0031 comment — no new mechanism, no new door, no dependency. And **it was found by the machine rather than by a reader**: §14's route suite walks the toast region on every one of the nine routes, and `containerAriaLabel` is an operator-read attribute, so the string surfaced as a failing assertion in the step that added the suite. A residual whose justification is "this app does not mount that primitive" is a residual D8 inherits as a surprise; the reason to close it here is that D8 would otherwise be the one to find it, in a customer-facing app, without this suite.

### 13. D8 inherits a factory

```ts
// shared/i18n/index.ts
export const createI18n = ({ resources, namespaces, locale, pseudo = false }: {
  readonly resources: { readonly en: Resources };                 // eager
  readonly namespaces: readonly Namespace[];
  readonly locale: Locale;
  readonly pseudo?: boolean;
}) => {
  const instance = i18next.createInstance();
  // use(initReactI18next), use(resourcesToBackend(lazyImport)), optional pseudo post-processor,
  // init({ lng: INTL_TAGS-aware, fallbackLng: "en", ns: namespaces, defaultNS: "common", returnNull: false }),
  // on("languageChanged"): applyZodLocale, document.documentElement.lang, localStorage write
  return { instance, changeLocale, t: instance.t } as const;
};
export type I18n = ReturnType<typeof createI18n>;
```

- **A factory, not a module-level singleton wired to this app** — ADR-0009's `create*` rule across the wire, for the reason it has on the API: the seam is a parameter. `app/providers` calls it once and hands the instance to `I18nextProvider`; a test calls it with a locale and nothing else.
- **The package rule D8 will follow, stated now so the extraction has one**: a shared package ships its own namespace JSON under its own `locales/<locale>/<ns>.json` and exports `register(i18n: I18n)`, which adds its resource bundle to the instance it is given; each app composes its own bundle from the packages it mounts plus its own slices. A package declares strings and never owns the app's dictionary, which is the plan's fourth requirement verbatim.
- **Nothing is extracted in D7.** `shared/i18n` is written so that D8 lifts it into a package unchanged; lifting it is D8's work, judged then.

**Amended 2026-08-22 (D7.1): three facts about the library that this record should carry rather than rediscover.**

- **The option that makes `init` synchronous is `initAsync: false`, not `initImmediate: false`.** It was renamed in i18next 26 and the old spelling is what every recipe still carries — including, until this amendment, the reasoning here. The failure is silent in the worst way: an unknown key is ignored, the default (`true`) stands, the instance initialises on a `setTimeout`, and the harness's "`en` loaded synchronously" of §14 quietly becomes "loaded on the next tick" — which does not fail a test, it makes the first render of every localised component miss its copy. Named here because `check-types` **does** catch it, and only because the options object is passed as a literal.
- **Suspense is off: `react: { useSuspense: false }`.** react-i18next's default is to *suspend* a component whose namespace has not arrived, and under §3 every locale but `en` arrives through a dynamic `import()` — so the default would demand a `<Suspense>` boundary above every translated component in the app, and would unmount and remount whole subtrees on a locale switch, which is a grid losing its scroll position and a dialog closing itself because somebody changed language. Not suspending costs one render in the `en` fallback — the same fallback the operator would see for a key `lv` is missing — and react-i18next re-renders on `loaded`. This is also what keeps §14's "assertions by accessible name keep using English" true without the suite learning about suspense boundaries.
- **The per-package namespace rule of the bullet above has a typed mechanism now.** i18next 26 ships `ResourceNamespaceMap`, an interface a package augments with its own namespace instead of augmenting `CustomTypeOptions.resources` — which is what stops two packages' declaration merges colliding on the same field (TS2717), the exact failure D8's extraction would otherwise walk into with the second package. Both feed `TypeOptions['resources']`, so `TranslationKey` sees them alike. D8 should augment `ResourceNamespaceMap` from each package and leave `CustomTypeOptions` to the app; `D7.1` uses `CustomTypeOptions` because there is exactly one declarer.

**Amended 2026-08-22 (D7.4): the second declarer arrived early, and it is a test fixture.** `D7.4` made the demo resource's copy keys and had nowhere to put them: a shipped catalogue would carry a fixture's words, and borrowing `staff:` keys would be the fixture claiming to be a resource it is not. So `src/test/fixtures/demo-i18n.d.ts` augments **`ResourceNamespaceMap`** with `demo`, and `src/test/render.tsx` calls `addResourceBundle("en", "demo", …)` on the instance it just built — `register(i18n)` in miniature, run once for free a deliverable before D8 needs it. It confirms both halves of the bullet above: the augmentation composes with the app's `CustomTypeOptions` merge rather than colliding with it, and `TranslationKey` sees `demo:` keys exactly as it sees `staff:` ones. Nothing under `src/shared` knows the namespace exists and no reachable production module imports the JSON, so it is types at build time and nothing at all in the bundle.

### 14. Testing ([ADR-0036](0036-admin-testing-strategy.md))

- Tests run with **`en` loaded synchronously** through the same factory, no lazy loading, so the harness is a pure function of the tree and stays in the cached `test:unit` loop.
- **`renderApp` (and `renderWithProviders`) accept a `locale`**, default `en`; **assertions by accessible name keep using English**, so the four hundred-odd existing assertions do not move.
- **One suite renders every route under the pseudo-locale** and asserts that no rendered text node or operator-read attribute survives unaccented — the executable half of §10's walk, over the route tree rather than a hand-kept list so a new page is covered on arrival.
- **The `errors` completeness check is type-level** (§2) and has no runtime test; `check-types` is its suite.
- **The `lv` zod map has a unit test per issue code it translates**, driving each `issue.code` through `localeError` and asserting the Latvian sentence, plus one test per plural category on the `grid` counts.
- MSW handlers are unchanged: the wire stays English, which is the point of §6.

**Amended 2026-08-22 (D7.4): a form is now a tree that needs the provider, and `rerender` is not.** The field adapters call `useKeyT()`, because a field's label and description are keys the resource wrote — so a suite that rendered a form with a bare `render` would read `staff:fields.email.label` back as the accessible name. `app-form.test.tsx` moved to `renderWithProviders` and its assertions did not change, which is the property `en` as the test locale buys. The one case that did change is the variant switch: Testing Library's `rerender` replaces the whole tree **including the wrappers**, so its second half would have rendered outside the instance; it unmounts and renders again instead. Worth knowing before the next test reaches for `rerender` under any provider this harness mounts.

**Amended 2026-08-22 (D7.5): the `lv` zod map is tested by calling it, not by installing it.** This section asks for "a unit test per issue code", and the obvious way to write one — install the locale and parse a schema — makes every other file in the process read validation messages in Latvian, because `z.config` is global (§5, §6). A locale map is a **pure function of an issue**, so `packages/contracts/src/__tests__/locales-lv.test.ts` calls `localeError` directly, once per code, with one case that goes through `z.config` to prove the export is shaped the way zod expects. The plural categories are asserted per category rather than once, which is the half a single case would have passed while being wrong: `12` is `zero` in Latvian and `21` is `one`, and a map that read only the ones digit would look right for `1`, `2` and `24`.

Two rules follow for every suite that touches the active locale, and they are the same two `intl.ts` already needed: assert in a file that renders one tree, and restore `en` before the file finishes.

**Amended 2026-08-22 (D7.6): the route suite as built, and the three choices that decide whether it is worth anything.** The paths come from `createAppRouter(...).routesByPath` — the addresses the router resolves a location against, so the two pathless layouts and the root are absent because nothing lands on them — with `$staffId` and `$userId` filled from the MSW fixtures, and the list is built at *collection* time because `it.each` needs it before `src/test/setup.ts` installs the jsdom stubs in `beforeAll`. A router is a data structure until something mounts it, so asking one for its own routes costs nothing and touches no DOM. Then: **the allow-list of strings that are legitimately unaccented is derived from the fixtures rather than written out** — the seeded people, their initials, and `Intl`'s short month names — so a renamed fixture cannot quietly turn the suite into one that passes by allowing everything, and a new piece of *copy* can never enter that list by accident, because nothing but a fixture can get into it. **The assertion is the brackets, not the accents**: `wrapped: true` is the part a hardcoded English sentence cannot imitate, where an accent test alone would pass an em dash or an ellipsis that such a sentence happens to contain. And **`/login` is visited without a session while every other route is visited with one** — the `_auth` layout's mirror guard redirects a signed-in operator to the dashboard, so a uniform session would have walked the dashboard twice under the login screen's name: a page silently uncovered while the suite reported all green.

### 15. Out of scope, stated

- **The marketing site.** `apps/web` is Next.js and builds last (D10); its rendering model puts a locale in the URL or the request, and it decides its own.
- **Right-to-left layout.** No RTL locale is named; the `dir` attribute and mirrored layouts are a later decision with a locale to test it.
- **Translation memory and TMS integration.** The catalogues are JSON in git; a translation platform is a process decision for a project with translators, not for the blueprint.

## Consequences

- **Bundle cost: roughly 40 kB minified for `i18next` + `react-i18next`**, paid by every operator, accepted for the ubiquity and the tooling that came with the choice; §Alternatives records the two candidates that would have cost a tenth of that. The `lv` catalogues and zod map are lazy and cost only the operator who uses them.
- **Key rot is the new maintenance category, and the extractor owns it.** A string is now two edits — a `t()` call and a catalogue entry — and the failure mode is the two disagreeing. `pnpm i18n:extract` makes the second edit mechanical and `pnpm i18n:check` makes forgetting it red in `pnpm check`.
- **D6's `locale` column becomes live, and `LOCALES` gains `"lv"` in D7's first step.** The order ADR-0045 fixes: a migration by `ALTER TYPE locale ADD VALUE 'lv'` (append, so no row and no sort order moves), then the tuple edit. The switch writes through `useUpdateSettings` as the theme does, and a second device finds the first one's language — the acceptance sketch's "survives sign-out/sign-in on another browser" is a property of the API from that step.
- **Six owned edits in generated files, re-applied on every regenerate.** Every `shadcn add` or upgrade of `dialog`, `sheet`, `pagination`, `breadcrumb` or `sidebar` re-emits the English literal and the diff shows the `strings.<key>` edit being undone; the comment at the point of change is what tells the reviewer to put it back. It is the regenerate-and-diff cost ADR-0031 accepted, with six more lines in it, and it is bounded by the `UiStrings` interface: a seventh string in a primitive is one more key, not a new mechanism.
- **The pseudo-locale is an executable acceptance item.** The D3 and D4 ledgers record browser walks the operator accepted rather than ran; §14's route suite turns "no literal anywhere" into a test that fails on the page that has one, and the walk becomes confirmation rather than discovery.
- **What D8 inherits**: `createI18n` as a factory with no app wired into it; the per-package namespace and `register(i18n)` rule; the `UiStrings` seam already app-agnostic; the lint rule in the shared config; and the `errors` / `grid` / `form` / `common` namespaces, which are the four that move with `shared/*`. The customer app's own slices add namespaces; nothing in this record is admin-specific except the ten namespace names.
- **The two-catalogue rule evolves rather than breaks.** Codes are still catalogued once (now `en/errors.json`, with the same compile-time completeness), field rules are still the schema's and still localised by zod's map rather than by a table in the app. What changed is that the API's words are no longer the operator's words in every language, so the form re-derives a matched detail instead of echoing it — and the D3.8 residual is now an un-localised residual, the same case with one more property.
- **The index's "Internationalization" Planned bullet is closed by this record**, with its `Accept-Language` clause answered in the negative (§4) and its "localized validation errors" clause answered client-side (§6).
- **A gap stays open and is named**: the generic `VALIDATION_ERROR` sentence reads oddly under a grid when a list query is refused — ADR-0043's D5.2 amendment left it "for the deliverable that owns operator copy (D7)". With error copy in a namespace, a context-specific key (`errors:VALIDATION_ERROR_list`) is one `context` away; D7's plan decides whether to spend it.
- **The tests are enumerable.** Pure: `resolveInitialLocale` over its table; the plural categories for both locales; the `lv` zod map per issue code; `labelFor` with a `t`. Type-level: `errors` completeness, `TranslationKey` on every config. Component: the locale switch changing the document language and the grid's formatters without a reload; a server-refused field re-deriving its message in `lv`; every route under pseudo. Tooling: `i18n:check` red on a dropped key and on a missing `lv` entry, asserted once in CI by a deliberate break.

## Alternatives considered

- **Lingui.** ICU MessageFormat native, a pseudo-locale built in, PO catalogues that translators' tools already open, a runtime near 3 kB, and a `no-unlocalized-strings` lint rule of its own — on the requirements list it scores highest. It lost on community size and on its macro build step: every package that D8 extracts would carry the SWC/Babel macro in its build, and the blueprint's source-published packages ([ADR-0002](0002-monorepo-layout-and-tooling.md)) have no build step to put it in.
- **FormatJS / react-intl.** ICU throughout, a mature extraction CLI, a strong lint plugin. It lost on `defaultMessage` living in the code beside every call — the sentence is written twice, once in the component and once in the catalogue, and the extractor's job is keeping them equal — and on a runtime larger than i18next's unless messages are precompiled, which is the same build step objection.
- **Paraglide.** The best typing of the four, zero runtime, every unused message tree-shaken: the fit for a typed Vite monorepo on paper, and the plan says so. It lost on maturity — the smallest community and the youngest API of the four — and on its plural and variant syntax, which is its own rather than CLDR's and would be the thing a Latvian translator has to learn first.
- **An in-house `t()` over JSON.** No dependency, and `messages.ts` is already a third of it. Rejected because the rest — `Intl.PluralRules` category resolution with suffix keys, lazy namespace loading, an extractor, a lint rule, a pseudo-locale — would each be rebuilt, each worse, and each would be the blueprint's to maintain.
- **i18next with the ICU plugin** (`i18next-icu`). ICU plural syntax inline. Rejected because `Intl.PluralRules` already resolves Latvian's three categories through the suffix keys, and the plugin adds a message parser to the runtime for a syntax nothing on the D7 surface needs. Revisited by name if a message needs a plural inside a select.
- **Localising on the API per request** (`Accept-Language` → a per-request zod error map → translated `message`). The plan's own "server-side localization unnecessary" sentence is why: it supersedes frozen [ADR-0011](0011-middleware-pipeline.md) and [ADR-0013](0013-error-model.md), puts a locale-dependent error map on the hottest path in the API, and makes every API response locale-dependent — in Postman, in the integration tier and in any second client. The API stays a machine speaking codes.
- **Carrying zod issue params in the envelope** so the client can re-render any detail without re-running the schema. It would close the D3.8 residual. Rejected because it is an [ADR-0012](0012-response-envelope.md) envelope change and a sweep of every handler and every handler test, to localise a case that arises only when a form's state is not its body; re-deriving client-side closes every other case at no wire cost.
- **Leaving `@repo/ui`'s six strings English.** No owned edits, no `UiStrings`. Rejected because four of the six are `sr-only` or `aria-label`: a screen-reader user in Latvian would hear the controls in English, which is the one audience a visual walk never notices.
- **Wrapping the primitives in the apps** (`AppDialog` over `Dialog` with a localised close button). No edits to generated files. Rejected because it duplicates each primitive's internals in the app — the `sr-only` span, the close-button placement, the pagination link shape — which D8 would then extract into a package beside the package that already has them.
