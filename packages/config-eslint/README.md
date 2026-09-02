# `@repo/eslint-config`

Shared ESLint flat configurations for the monorepo.

| Export                      | Use for                                           |
| --------------------------- | ------------------------------------------------- |
| `@repo/eslint-config`       | Node packages and apps (`api`, `@repo/logger`, …) |
| `@repo/eslint-config/react` | React libraries and SPAs (`@repo/ui`, `admin`)    |

There is no Next.js preset. It existed for the marketing-site placeholder that
`D14.1` deleted, and the deliverable that scaffolds that site adds one back
against the Next version it actually uses rather than inheriting a pin nothing
consumed.

`eslint-plugin-only-warn` downgrades every rule to a warning, so **every `lint`
script must pass `--max-warnings 0`** — without it, rules such as `no-console`
(ADR-0005) report but do not fail the build.

Rules that enforce the ADRs (envelope helpers, layer boundaries, `process.env`
containment, functional style) are listed in ADR-0002 and are added to the base
config alongside the API core (D1.7).
