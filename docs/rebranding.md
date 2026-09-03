# Rebranding the blueprint

`machxi` is a placeholder. A fork replaces it in three lines, on the first day, before the first deployment:

```
# 1. the runtime identity — every cookie name and the JWT audience derive from it
APP_ID=<name>            # .env
VITE_APP_ID=<name>       # apps/admin/.env and apps/customer/.env

# 2. the mechanical identity — fixtures, compose, roles, package name, brand strings
node scripts/rename.mjs <name>     # --dry-run first

# 3. review the diff
git diff
```

That is the whole procedure. The rest of this page is why, and what the script deliberately leaves alone.

## Why three lines and not a checklist

[ADR-0064](adr/0064-brand-seams.md) split the seams in two.

**What a deployment configures** is one identifier per side. `APP_ID` gives the API `__Secure-<name>.refresh`, `__Host-<name>.csrf.admin`, `__Host-<name>.csrf.user`, the retired host-wide cookie, and the JWT audience `<name>-staff` / `<name>-user`. `VITE_APP_ID` gives each SPA its device-storage prefix `<name>.<segment>`, so the admin panel writes `<name>.admin.theme` and the customer app writes `<name>.user.theme` — two apps on one origin no longer share a theme, a locale or a grid arrangement. Both default to `machxi`, so a deployment that sets neither behaves exactly as this repository always has.

The platform packages hold none of it. `@repo/app-services`, `@repo/i18n` and `@repo/grid` take the prefix as a parameter, and each app's `src/shared` door binds it. That is the property a fork depends on for as long as it merges from upstream: the brand lives in the fork's `.env` and its doors, which the starter never edits, so a rename cannot conflict inside a package.

**What a script rewrites** is the identity that is not runtime-derived and never should be: the `@machxi.local` fixture domain across seeds, dev fixtures, integration suites, MSW principals, e2e specs and the Postman environment; the compose project, container, network and role names and the Docker init SQL; the connection strings that have to agree with those roles; the root package name; the `brand` block in each app's `common` catalogue and the two `index.html` titles.

The rendered brand stays a typed i18n key ([ADR-0046](adr/0046-interface-localization.md)) rather than moving into a config object: a brand line may legitimately differ by language, and a missing key already fails `check-types`. The script seeds those values; it does not replace the mechanism.

## Renaming after launch is a sign-out

Changing `APP_ID` on a live deployment invalidates every refresh and CSRF cookie in every browser and orphans every device preference. There is no dual-read, no migration window and no legacy-name fallback beyond the one [ADR-0056](adr/0056-per-population-csrf-cookie.md) already ships. This is by design ([ADR-0064](adr/0064-brand-seams.md) §2): it is a fork-day value.

The script carries the same condition for a second reason. `packages/db/migrations/0008_database_roles.sql` names the application role in `GRANT`, `REVOKE` and two guard clauses, so a rename rewrites a committed migration — safe before the first `pnpm db:migrate`, and a divergence from [ADR-0008](adr/0008-database-migrations-and-seeding.md) after it.

## What the script leaves alone

- **The records.** `docs/adr/`, `docs/plan/`, `CLAUDE.md` and `.claude/**` keep `machxi` in their prose. They are the history of this blueprint's decisions; a fork inherits the decisions, not the name in the telling — and rewriting them would make every quotation false and every upstream merge a conflict.
- **`LICENSE`**, which names a copyright holder: a legal fact, not a brand.
- **This page**, which documents the placeholder it removes.
- **`@repo/*`.** The package scope is already brand-neutral, so no import changes anywhere.
- **The design language.** Nothing in Instrument ([ADR-0054](adr/0054-design-language-instrument.md)) is brand-named. A fork that wants a different look changes token values in `packages/ui/src/styles/globals.css` and the `@fontsource` imports, per that record's rules — a design decision, not a rename.
