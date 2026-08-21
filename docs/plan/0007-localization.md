# D7 — Interface localization

- Status: **planned** — opens when D6 ships
- Steps: written when the deliverable opens; this file carries scope, order rationale and the assumptions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: **every operator-facing string in `apps/admin` moves into a typed dictionary**, the locale switch lands and persists through D6's settings, and — the part that makes this a strategy rather than a chore — the i18n foundation is **designed for two SPAs and the shared packages between them**, because D8 extracts machinery into packages and D9's customer app must be _born_ localized. The ADR index's Planned list has carried "Internationalization" since D1; this is that entry becoming a deliverable.

## Why before the customer app

Retrofitting i18n is the expensive half — sweeping an app for hardcoded strings, restructuring copy into keys, threading formatters through every date and count. That price is paid **once**, for `apps/admin`, which already exists. Sequenced after the customer app it would be paid twice. And D8's extraction then moves components that are already dictionary-fed, so the packages never exist in a hardcoded state that would need its own sweep.

## Strategy requirements (the ADR chooses the library; these are the constraints it must satisfy)

- **Typed keys.** A missing or misspelled key is a type error, not a runtime fallback — the same lint-mechanized posture ADR-0002 takes everywhere else.
- **ICU-grade formatting**: plurals, interpolation, and locale-aware dates and numbers (the grid's timestamp formatters become locale consumers).
- **Lazy per-locale bundles.** A locale costs its user, not every user.
- **Packages can declare strings without owning dictionaries.** Shared machinery (grid chrome — "No results", pager copy, form errors) ships its keys, likely namespaced per package; the apps own the dictionaries that satisfy them. This constraint exists so D8's extraction has a rule to follow.
- **Lint enforcement.** An ESLint rule (restricted-syntax on literal JSX text, in the ADR-0002 "lint half of the ADRs" tradition) makes a hardcoded string fail `pnpm lint` rather than depend on review.
- **The two-catalogue rule evolves rather than breaks.** D3 settled that operator copy has exactly two catalogues: error _codes_ in `shared/notifications/messages.ts`, field _rules_ in the contracts schemas. The first becomes a dictionary namespace mechanically. The second is the subtle one: **`@repo/contracts` depends only on zod (ADR-0023) and must not grow translations** — so contract validation messages become stable keys-plus-params resolved by a locale-aware zod error map applied in the apps, and contracts stays locale-free. The API's own `error.message` remains never-rendered, which is what makes server-side localization unnecessary.

Candidates the ADR weighs: react-i18next (the ecosystem default), FormatJS/react-intl (ICU-first), Paraglide (compile-time, fully typed, tree-shaken — the best fit on paper for a typed Vite monorepo, and the least battle-tested of the three). The choice is deliberately **not** made here.

## Decisions this deliverable needs

- **One new ADR**: the i18n strategy — library, key scheme, package/dictionary boundary, the zod error map, the lint rule, and the pseudo-locale verification tier. Additive beside frozen ADR-0031–0036; the messages-catalogue evolution touches what D3 decided, so the ADR must say explicitly why it is an extension and not a divergence — or supersede.

## Locales (decided 2026-08-20)

- **English is the source language; Latvian (`lv`) is the second locale, named by the operator** — the deliverable ships both, so the pipeline is proven by a real translation, not just infrastructure. Latvian is also a usefully demanding second locale: three plural forms (the `21 ieraksts` / `2 ieraksti` / `11 ierakstu` split), which is exactly what the ICU-plurals requirement above exists for — an i18n layer that survives Latvian counts survives most of Europe.
- **A pseudo-locale still ships as a dev-only verification tier** (accented-and-widened English in the `en-XA` tradition): it catches extraction gaps mechanically, which a real translation cannot — a missed hardcoded string looks fine in Latvian review only until someone reads every screen. It is excluded from the production locale enum.

## Acceptance sketch

A pseudo-locale walk of every screen shows no unaccented string anywhere — grid chrome, dialogs, toasts, validation errors included; the same walk in `lv` reads as Latvian throughout, plural forms correct on grid counts and pagination; the lint rule is red on a literal JSX string and the gate proves it; switching locale is live, without reload, and survives sign-out/sign-in on another browser via D6; dates and counts format per locale.
