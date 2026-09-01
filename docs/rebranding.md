# Rebranding the blueprint

This repository is a blueprint: `machxi` is a placeholder identity. This page is the **complete list of seams** a fork changes to become its own product — deliberately a checklist rather than a config object, because every rendered string already has a single typed home (ADR-0046) and the rest are fork-time constants that change once per project, not per environment (ADR-0004's bar for configuration).

Rule of thumb: do §1 and §4–§5 on day one of a fork; §3 is cheapest at fork time and progressively more annoying later (renaming cookies and storage keys mid-life signs users out and resets device preferences); §6 is optional; §7 is deliberately left alone.

## 1. Rendered brand — what people see

The `brand` block in each app's `common` catalogue, **per app and per locale** (a brand line may legitimately differ by language):

- `apps/admin/src/shared/i18n/locales/{en,lv}/common.json` — `brand.mark` (the sidebar monogram), `brand.name`, `brand.product` ("Admin"), `brand.authTagline` ("machxi admin").
- `apps/customer/src/shared/i18n/locales/{en,lv}/common.json` — the same keys ("Account", "machxi account").
- The static document titles: `apps/admin/index.html` (`Admin | machxi`) and `apps/customer/index.html` (`Account | machxi`).

These are typed keys — a missing one fails `check-types`, a drifted catalogue fails `i18n:check` — which is why the catalogue **is** the brand config and no second mechanism exists.

## 2. Design language

Nothing in Instrument (ADR-0054) is brand-named: the token sheet, the fonts and the chrome carry no `machxi`. A fork that wants a different look changes `packages/ui/src/styles/globals.css` values and the `@fontsource` imports per that record's rules — a design decision, not a rename.

## 3. Runtime identifiers — rename at fork time or accept the name forever

All server- or device-side; invisible to users, visible in devtools and support calls. Renaming any of these later invalidates what browsers already hold.

- **Cookies** — `apps/api/src/core/http/cookies.ts`: `REFRESH_COOKIE` (`__Secure-machxi.refresh`), the per-population CSRF pair (`__Host-machxi.csrf.admin` / `.user`, ADR-0056) and `LEGACY_CSRF_COOKIE`. One file; the names are constants.
- **JWT audience and issuer** — `apps/api/src/modules/auth/auth.tokens.ts` builds the audience as `machxi-${population}`; `JWT_ISSUER` lives in `.env` (`machxi-api`).
- **Device storage keys** — `packages/app-services/src/theme.ts` (`machxi.admin.theme`) and `packages/i18n/src/locale-storage.ts` (`machxi.admin.locale`). D12's finding 1 reserved **one parameter each** for these; a fork is exactly the "reason beyond tidiness" that spends them — until then, two constants.

## 4. Infrastructure and environment

- `docker/local/compose.yaml` — project (`machxi-local`), container (`machxi-postgres`), network; `docker/local/postgres/init/01-test-db.sql` and `docker/README.md`.
- `.env.example` (and each app's) — `POSTGRES_USER/PASSWORD/DB`, both `DATABASE_URL`s, `JWT_ISSUER`, and the `SEED_SUPER_ADMIN_*` values (`admin@machxi.local`).

## 5. Fixtures, seeds and the test surface

The `@machxi.local` email domain appears throughout: `packages/db` seeds and dev fixtures, the API integration suites, both apps' MSW principals and e2e specs, and `docs/postman`'s environment. A project-wide search for `machxi.local` is the honest tool; the seeds and the Postman environment are the two places the value is _load-bearing_ (the e2e credentials default to `SEED_SUPER_ADMIN_*`).

## 6. Meta

The root `package.json` name (`machxi-starter`) and the `README.md`. Neither affects behaviour.

## 7. Deliberately not renamed

- **`@repo/*`** — the package scope is already brand-neutral; imports change nowhere.
- **History** — ADRs, plan files and the ledger keep `machxi` in their prose. They are records of this blueprint's decisions; a fork inherits the decisions, not the name in the telling.
