# `@repo/eslint-config`

Shared ESLint flat configurations for the monorepo.

| Export                      | Use for                                           |
| --------------------------- | ------------------------------------------------- |
| `@repo/eslint-config`       | Node packages and apps (`api`, `@repo/logger`, …) |
| `@repo/eslint-config/react` | React libraries and SPAs (`@repo/ui`, `admin`)    |
| `@repo/eslint-config/next`  | Next.js apps (`web`)                              |

`eslint-plugin-only-warn` downgrades every rule to a warning, so **every `lint`
script must pass `--max-warnings 0`** — without it, rules such as `no-console`
(ADR-0005) report but do not fail the build.

Rules that enforce the ADRs (envelope helpers, layer boundaries, `process.env`
containment, functional style) are listed in ADR-0002 and are added to the base
config alongside the API core (implementation-plan step 7).
