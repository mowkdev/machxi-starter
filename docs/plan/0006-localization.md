# D6 — Interface localization

- Status: **planned** — opens when D5 ships
- Steps: written when the deliverable opens; this file carries scope, order rationale and the assumptions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: **every operator-facing string in `apps/admin` moves into a typed dictionary**, the locale switch lands and persists through D5's settings, and — the part that makes this a strategy rather than a chore — the i18n foundation is **designed for two SPAs and the shared packages between them**, because D7 extracts machinery into packages and D8's customer app must be *born* localized. The ADR index's Planned list has carried "Internationalization" since D1; this is that entry becoming a deliverable.

## Why before the customer app

Retrofitting i18n is the expensive half — sweeping an app for hardcoded strings, restructuring copy into keys, threading formatters through every date and count. That price is paid **once**, for `apps/admin`, which already exists. Sequenced after the customer app it would be paid twice. And D7's extraction then moves components that are already dictionary-fed, so the packages never exist in a hardcoded state that would need its own sweep.

## Strategy requirements (the ADR chooses the library; these are the constraints it must satisfy)

- **Typed keys.** A missing or misspelled key is a type error, not a runtime fallback — the same lint-mechanized posture ADR-0002 takes everywhere else.
- **ICU-grade formatting**: plurals, interpolation, and locale-aware dates and numbers (the grid's timestamp formatters become locale consumers).
- **Lazy per-locale bundles.** A locale costs its user, not every user.
- **Packages can declare strings without owning dictionaries.** Shared machinery (grid chrome — "No results", pager copy, form errors) ships its keys, likely namespaced per package; the apps own the dictionaries that satisfy them. This constraint exists so D7's extraction has a rule to follow.
- **Lint enforcement.** An ESLint rule (restricted-syntax on literal JSX text, in the ADR-0002 "lint half of the ADRs" tradition) makes a hardcoded string fail `pnpm lint` rather than depend on review.
- **The two-catalogue rule evolves rather than breaks.** D3 settled that operator copy has exactly two catalogues: error *codes* in `shared/notifications/messages.ts`, field *rules* in the contracts schemas. The first becomes a dictionary namespace mechanically. The second is the subtle one: **`@repo/contracts` depends only on zod (ADR-0023) and must not grow translations** — so contract validation messages become stable keys-plus-params resolved by a locale-aware zod error map applied in the apps, and contracts stays locale-free. The API's own `error.message` remains never-rendered, which is what makes server-side localization unnecessary.

Candidates the ADR weighs: react-i18next (the ecosystem default), FormatJS/react-intl (ICU-first), Paraglide (compile-time, fully typed, tree-shaken — the best fit on paper for a typed Vite monorepo, and the least battle-tested of the three). The choice is deliberately **not** made here.

## Decisions this deliverable needs

- **One new ADR**: the i18n strategy — library, key scheme, package/dictionary boundary, the zod error map, the lint rule, and the pseudo-locale verification tier. Additive beside frozen ADR-0031–0036; the messages-catalogue evolution touches what D3 decided, so the ADR must say explicitly why it is an extension and not a divergence — or supersede.

## Assumptions taken 2026-08-20 (revisable until the deliverable opens)

- **English stays the source language; a pseudo-locale ships alongside it** (accented-and-widened English in the `en-XA` tradition) as the proof that nothing is hardcoded — pseudo-localization catches extraction gaps mechanically and needs no translator. **A real second locale is then a content drop, not a code change**, and the operator names the language when they want it. Recorded as the default because "en only, infrastructure ready" rots silently and no target language was named.

## Acceptance sketch

A pseudo-locale walk of every screen shows no unaccented string anywhere — grid chrome, dialogs, toasts, validation errors included; the lint rule is red on a literal JSX string and the gate proves it; switching locale is live, without reload, and survives sign-out/sign-in on another browser via D5; dates and counts format per locale.
