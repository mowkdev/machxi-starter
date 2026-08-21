# ADR-0046: Interface localization — react-i18next, typed namespaced catalogues, zod's error map on the client, and `UiStrings` for the design system

- Status: proposed
- Date: 2026-08-22

> One of the D7 (interface localization) decision set — the "i18n strategy ADR" that [`docs/plan/0007-localization.md`](../plan/0007-localization.md) names as the one decision the deliverable needs. Written 2026-08-22 **ahead of D7 opening**, while D6 is `in progress`: writing is not opening, the D4 precedent (ADR-0037–0042 were written under D3 and accepted one step at a time under D4). It is `proposed` until accepted at the head of D7's first implementing step, and D7's plan will name the steps. It supersedes nothing. It is additive beside frozen [ADR-0031](0031-ui-design-system.md), [ADR-0033](0033-browser-api-client-and-session.md), [ADR-0035](0035-config-driven-resource-ui.md), [ADR-0036](0036-admin-testing-strategy.md) and [ADR-0043](0043-readable-list-search-params.md), and beside [ADR-0045](0045-user-settings.md), which is amendable while D6 is in progress — and this record asks nothing of it beyond the `LOCALES` append it already reserved.

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

**`Accept-Language` is not used anywhere, by any side.** The index's Planned bullet for internationalization mentioned it, and the answer is no: a locale is an account fact that follows the operator between devices, not a request header that follows the browser's settings panel; the API never renders copy (§6), so it has nothing to negotiate; and the one place the header would have been read — a first-visit guess before sign-in — is step 3 above, answered from `navigator.languages`, which is the same data without a round trip.

### 5. `en` means en-GB, and Intl follows the active locale

**Source copy is British English** — _serialise_, _honour_, _catalogue_ — because it is the repository's documentation voice and a second spelling convention in the catalogues would be a review argument with no winner. The Intl tag map is one object in `shared/i18n`, because `@repo/contracts` holds only the enum and a BCP 47 tag is a presentation fact:

```ts
export const INTL_TAGS: Record<Locale, string> = { en: "en-GB", lv: "lv-LV" };
```

- **`shared/grid/formatters.ts` and `filter-chips.ts` build their `Intl.DateTimeFormat`s from the active locale**, not from `undefined`, and rebuild on `languageChanged`. Today's `undefined` means "the browser's locale", and a Latvian operator on an English OS would otherwise read Latvian headers over English dates. The formatter registry's entries stay `(value) => string` — they close over a formatter holder that the language listener swaps, so ADR-0035's "configs carry keys, registries carry functions" is unchanged. `filter-chips.ts`'s `timeZone: "UTC"` day formatter keeps its timezone reasoning intact and only changes locale.
- **Numbers and dates in copy go through i18next's built-in Intl formatters** — `"{{total, number}}"`, `"{{since, datetime(dateStyle: medium)}}"` — or through those Intl objects. **Never `toLocaleString()` with an implicit locale**, anywhere in `apps/admin`, which the lint rule of §8 cannot see and a grep in `pnpm i18n:check` (§9) does.

### 6. Validation copy: zod's error map on the client; the API stays English

This is the plan's "subtle one", and the D3.9 argument in `server-errors.ts` already named the mechanism: _"localising the latter is zod's own error map on the contracts package, applied once for both sides."_ That sentence is adopted, with one refinement.

- **The client sets zod's locale from the active locale**: `z.config({ localeError })` at `createI18n` time and again on every `languageChanged`. zod 4's shipped `en` map (`zod/v4/locales/en`) is used as-is.
- **The `lv` map is ours.** zod ships no Latvian. `packages/contracts/src/locales/lv.ts` mirrors the shape of zod's own locale modules — a default-exported factory returning `{ localeError }`, a `Sizable` table, a `FormatDictionary`, one `switch` over `issue.code` — and **depends on zod alone**, which is legal under ADR-0023 word for word. It is exported through a subpath, `@repo/contracts/locales/lv`, so a consumer that never switches to Latvian never bundles it, and so the package's root export stays what it is. Contracts thereby _holds a locale map_ and still _holds no translation of its own messages_: the schemas keep their English rule text as the source, and the map translates the generic issue codes.

  The schemas' **custom messages** — `passwordSchema`'s policy text, a `.refine()` with its own sentence — are the residual this design owns rather than hides. A custom message is a string baked into the schema, and the error map never sees it. D7 handles them the way zod 4 intends: a custom message becomes a **`params: { i18n: "<key>" }`** on the issue, the client-side resolver maps it through the `form` namespace, and the API keeps emitting the English `message` beside it. The contracts package still ships no sentence in any language but the source one.

- **The API is untouched.** [ADR-0011](0011-middleware-pipeline.md)'s `validate()` and [ADR-0013](0013-error-model.md)'s `message` stay developer-facing English, `toErrorDetails` keeps copying `issue.message` unchanged, and the integration tier and the Postman collection keep asserting one language. Nothing on the server reads a locale.
- **A matched `VALIDATION_ERROR` detail is re-derived client-side.** `applyServerErrors` today renders `detail.message` verbatim, on the D3.9 argument that the words are the schema's own. The argument holds and the _words_ no longer do — the API's words are English and the operator's may not be. So the refinement: for a detail whose path matches a rendered field, the form **re-runs its resolver on the current values under the active locale** and prefers its own issue message for that path. The rule is unchanged — it is the same schema, caught a second time, in the operator's language — and the API's English text is the fallback only in the **D3.8 residual**: a key the controls never held, which the resolver cannot produce an issue for because the form's state is not its body. That residual was already recorded as "the one shape of validation copy this design cannot promise an operator has seen before"; it is now also an **un-localised** residual, and it is the same narrow case, not a new one.

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

### 8. Lint: the mechanical half

**`eslint-plugin-i18next`'s `no-literal-string`, in the admin config of `@repo/config-eslint`** — the ADR-0002 pattern: a rule is the half of an ADR that does not depend on a reviewer noticing. It fires on JSX text and on the attributes an operator reads — `aria-label`, `title`, `placeholder`, `alt` — in `apps/admin/src/**`, and is off for `src/**/__tests__/**`, `src/test/**` and `src/shared/i18n/**` (the catalogues and the pseudo-locale are literals by definition). Class names, `data-*`, keys, `type` and `role` attributes are outside the rule's reach by its own defaults, which is the right line: it catches sentences, not identifiers.

The rule lives in the shared package rather than in `apps/admin/eslint.config.js` for the reason `apiConfig` does: D8's customer app applies the same export, and a second copy is where the two apps' rules diverge.

### 9. Extraction and drift checks

- **`pnpm i18n:extract`** runs `i18next-parser` over `apps/admin/src` and rewrites `en/*.json` from the `t()` calls: new keys added with their default value, unused keys removed, order stable. The source of truth for "which keys exist" is the code; the catalogue is derived, which is what keeps it from rotting.
- **`pnpm i18n:check`** is part of `pnpm check` and red on two conditions: **(a)** the extractor would change any `en` file — key drift, a `t()` added without its catalogue entry or a key orphaned by a deletion; **(b)** an `lv` namespace is missing any key `en` has. Runtime falls back to `en` for a missing `lv` key, silently and correctly; the check is what makes the gap visible in the gate rather than on a Latvian operator's screen. The check also greps for `toLocaleString(` and `toLocaleDateString(` outside `shared/i18n` (§5). Under [ADR-0026](0026-task-graph-caching-and-serialisation.md) it is a pure function of the tree and is cached.

### 10. Pseudo-locale, dev only

**`i18next-pseudo` as a post-processor**, turning `Save changes` into `[Šàvé çhàñgéš ∙∙∙]` — accented so a literal stands out, widened so a truncation shows. It is enabled by **`VITE_I18N_PSEUDO=true`**, a new admin variable: added to the `shared/config` zod schema ([ADR-0004](0004-configuration-and-environment.md)'s one reader), documented in `apps/admin/.env.example`, declared in `turbo.json`'s `env` for any task that reads it (the `build` and `dev` tasks, the same way `VITE_API_URL` is). It is **not a member of `LOCALES`** — the enum is the production set, stored in a database column, and a pseudo-locale is a lens over `en`, not a language an account can have.

It is the deliverable's definition-of-done tool: the acceptance walk under the pseudo-locale shows no unaccented string anywhere — grid chrome, dialogs, toasts, validation errors and the six `@repo/ui` strings included — and §14's route suite is the executable form of that walk.

### 11. Latvian: machine-drafted, review status explicit

**The `lv` catalogues are machine-drafted in D7 and marked `pending native review` in the plan** until the operator signs them off. The plural forms are written correctly from the start — the `_zero` / `_one` / `_other` split is grammar, not style, and is tested (§14). This record says it plainly because the alternative is a claimed translation: `lv` is a real second locale with an explicit review status, it exercises every mechanism above end to end, and the sentences themselves are the part a native reader still owns.

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

### 14. Testing ([ADR-0036](0036-admin-testing-strategy.md))

- Tests run with **`en` loaded synchronously** through the same factory, no lazy loading, so the harness is a pure function of the tree and stays in the cached `test:unit` loop.
- **`renderApp` (and `renderWithProviders`) accept a `locale`**, default `en`; **assertions by accessible name keep using English**, so the four hundred-odd existing assertions do not move.
- **One suite renders every route under the pseudo-locale** and asserts that no rendered text node or operator-read attribute survives unaccented — the executable half of §10's walk, over the route tree rather than a hand-kept list so a new page is covered on arrival.
- **The `errors` completeness check is type-level** (§2) and has no runtime test; `check-types` is its suite.
- **The `lv` zod map has a unit test per issue code it translates**, driving each `issue.code` through `localeError` and asserting the Latvian sentence, plus one test per plural category on the `grid` counts.
- MSW handlers are unchanged: the wire stays English, which is the point of §6.

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
