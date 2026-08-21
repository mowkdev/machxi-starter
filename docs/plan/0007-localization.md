# D7 — Interface localization

- Status: **planned** — opens when D6 ships. Its ADR, [0046](../adr/0046-interface-localization.md), was **written ahead on 2026-08-22** while D6 was in progress (writing is not opening — the D4 precedent) and is `proposed` until accepted at the head of D7's first step.
- Steps: written when the deliverable opens; this file carries scope, order rationale and the decisions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: **every operator-facing string in `apps/admin` moves into a typed dictionary**, the locale switch lands and persists through D6's settings, and — the part that makes this a strategy rather than a chore — the i18n foundation is **designed for two SPAs and the shared packages between them**, because D8 extracts machinery into packages and builds the customer app on them, and that app must be _born_ localized. The ADR index's Planned list has carried "Internationalization" since D1; this is that entry becoming a deliverable.

## Why before the customer app

Retrofitting i18n is the expensive half — sweeping an app for hardcoded strings, restructuring copy into keys, threading formatters through every date and count. That price is paid **once**, for `apps/admin`, which already exists. Sequenced after the customer app it would be paid twice. And D8's extraction then moves components that are already dictionary-fed, so the packages never exist in a hardcoded state that would need its own sweep.

## Strategy requirements (the constraints ADR-0046 satisfies)

- **Typed keys.** A missing or misspelled key is a type error, not a runtime fallback — the same lint-mechanized posture ADR-0002 takes everywhere else.
- **ICU-grade formatting**: plurals, interpolation, and locale-aware dates and numbers (the grid's timestamp formatters become locale consumers).
- **Lazy per-locale bundles.** A locale costs its user, not every user.
- **Packages can declare strings without owning dictionaries.** Shared machinery (grid chrome — "No results", pager copy, form errors) ships its keys, likely namespaced per package; the apps own the dictionaries that satisfy them. This constraint exists so D8's extraction has a rule to follow.
- **Lint enforcement.** An ESLint rule (restricted-syntax on literal JSX text, in the ADR-0002 "lint half of the ADRs" tradition) makes a hardcoded string fail `pnpm lint` rather than depend on review.
- **The two-catalogue rule evolves rather than breaks.** D3 settled that operator copy has exactly two catalogues: error _codes_ in `shared/notifications/messages.ts`, field _rules_ in the contracts schemas. The first becomes a dictionary namespace mechanically. The second turned out to be simpler than it looked: the contracts schemas carry almost no hand-written messages — field rules surface as **zod's own default messages**, which the API copies into `VALIDATION_ERROR` details and the admin renders (a D3.9 decision whose comment already names the mechanism: _"localising the latter is zod's own error map on the contracts package"_). So the answer is zod's error map, switched with the locale on the client. Zod 4 ships locale maps but **no Latvian one**; ours lives in `@repo/contracts` as zod-only code, which ADR-0023 permits. The API keeps its developer-facing English (ADR-0013) and is untouched.

## Decisions (taken 2026-08-22, recorded in ADR-0046)

Made by the operator after a comparison of react-i18next, FormatJS/react-intl, Lingui and Paraglide; the ADR carries the reasoning and the trade-offs, this file carries the outcome.

- **react-i18next** — the boring choice on purpose: ubiquity and hiring outweighed Lingui's smaller runtime and built-in pseudo-locale. No ICU plugin: `Intl.PluralRules` through i18next's `_zero` / `_one` / `_other` keys covers Latvian's three forms.
- **Validation copy is localized on the client; the API stays English.** No frozen ADR is touched, no envelope change; a server detail that matches a rendered field is re-derived from the same contracts schema under the active locale.
- **`@repo/ui`'s hard-coded a11y strings** (`Close`, `Previous`, `Toggle Sidebar`…) go through a `UiStrings` context with English defaults — six owned, commented edits to generated files under ADR-0031's existing rule, and no i18n dependency in the design system.
- **Latvian is machine-drafted in D7 and marked `pending native review`** until the operator signs it off — a real second locale with an honest status, rather than a catalogue waiting for a translator.
- **`en` means en-GB**: British spelling for the source copy (the repository's own voice) and European date order through Intl; `lv` maps to `lv-LV`.
- Typed keys by declaration merging over the `en` catalogue; one `locales/` tree with a namespace per slice; `en` eager, other locales lazy per namespace; locale precedence settings → `localStorage` → `navigator.languages` → `en`, and `Accept-Language` used nowhere; `eslint-plugin-i18next` as the mechanical half; `i18next-parser` extraction with a drift check in `pnpm check`; a dev-only pseudo-locale behind `VITE_I18N_PSEUDO`; and an i18n factory rather than a singleton, so D8 lifts it into a package unchanged.

## Locales (decided 2026-08-20)

- **English is the source language; Latvian (`lv`) is the second locale, named by the operator** — the deliverable ships both, so the pipeline is proven by a real translation, not just infrastructure. Latvian is also a usefully demanding second locale: three plural forms (the `21 ieraksts` / `2 ieraksti` / `11 ierakstu` split), which is exactly what the ICU-plurals requirement above exists for — an i18n layer that survives Latvian counts survives most of Europe.
- **A pseudo-locale still ships as a dev-only verification tier** (accented-and-widened English in the `en-XA` tradition): it catches extraction gaps mechanically, which a real translation cannot — a missed hardcoded string looks fine in Latvian review only until someone reads every screen. It is excluded from the production locale enum.

## Acceptance sketch

A pseudo-locale walk of every screen shows no unaccented string anywhere — grid chrome, dialogs, toasts, validation errors included; the same walk in `lv` reads as Latvian throughout, plural forms correct on grid counts and pagination; the lint rule is red on a literal JSX string and the gate proves it; switching locale is live, without reload, and survives sign-out/sign-in on another browser via D6; dates and counts format per locale.
