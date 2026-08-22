# Catalogues

One tree, a namespace per slice, `en` as the source language (ADR-0046 §3). The
namespace name **is** the slice name: `entities/staff` and `features/staff-manage`
write `t("staff:…")` and nothing else, and a `staff:` key rendered from
`features/users-manage` is a review finding rather than a failed build — the
import lint of ADR-0032 cannot see a string prefix.

- **`en` is the type source.** `types.d.ts` declaration-merges these files over
  `CustomTypeOptions`, so a key exists when `en` has it and a misspelling is a
  compile error. `en` is bundled eagerly because it is also the fallback locale
  and the locale the suite runs in.
- **Every other locale is lazy**, one dynamic `import()` per
  `<locale>/<namespace>.json`, and measured against `en` by `pnpm i18n:check`
  rather than by the compiler: a missing entry is a correct runtime fallback and
  an incorrect state of the catalogue.
- **Plurals are i18next suffix keys** — `_zero`, `_one`, `_other` — resolved by
  `Intl.PluralRules`. A locale carries the categories **its own** grammar has, so
  `en` writes two forms where `lv` writes three, and `pnpm i18n:check` fails a
  counted key that is short of one.

## `lv` — **pending native review**

The Latvian catalogues were **machine-drafted in `D7.6`** and are marked
`pending native review` until the operator signs them off (ADR-0046 §11). That
is the honest status: every mechanism around them is exercised end to end — the
lazy load, the plural categories, the zod error map, the locale switch — and the
sentences themselves are the part a native reader still owns. Read a wording
change as translation, not as a decision: nothing about the keys or the plural
categories moves with it.
