# ADR-0064: Brand seams — one identifier per side, every name derived

- Status: proposed
- Date: 2026-09-02

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; accepted at the head of the step that builds it.

## Context

[`docs/rebranding.md`](../rebranding.md) is the fork-time checklist, and it is honest about what it costs: seven sections, a project-wide search for `machxi.local` as "the honest tool", and the note that §3 is "cheapest at fork time and progressively more annoying later". The seams it lists are real constants, not configuration:

- `apps/api/src/core/http/cookies.ts` holds `REFRESH_COOKIE` (`__Secure-machxi.refresh`), the per-population CSRF pair `__Host-machxi.csrf.admin` / `.user` ([ADR-0056](0056-per-population-csrf-cookie.md), _the per-population CSRF cookie_) and `LEGACY_CSRF_COOKIE`, each with a comment arguing that names are constants rather than configuration because "a deployment that needs to change them is a deployment with a different security model".
- `apps/api/src/modules/auth/auth.tokens.ts` builds the audience as `` `machxi-${population}` `` ([ADR-0018](0018-authentication-sessions-and-tokens.md), _authentication, sessions and tokens_); `JWT_ISSUER` is already env.
- The device keys are `machxi.admin.theme` (`packages/app-services/src/theme.ts`), `machxi.admin.locale` (`packages/i18n/src/locale-storage.ts`) and `machxi.admin.grid:<gridId>:v1` (`packages/grid/src/preferences.ts`) — all three read unchanged by `apps/customer`, which `apps/customer/src/shared/theme/index.ts` records as D12's finding 1: the key "is per-origin and the two SPAs are two origins" was the D9 argument, `D12.1` was named as its test, and it read wrong. Two SPAs deployed on one origin do not merely _read_ wrong; they share theme, locale and grid arrangements between an operator and a customer.

That last comment also names the discipline this record spends: `@repo/i18n`'s and `@repo/app-services`' "one parameter each", reserved for a reason beyond tidiness. A fork is that reason.

The second force is merges. [ADR-0065](0065-starter-lifecycle.md) makes a fork a clone that merges from `starter/main` forever. A fork that renames by editing `packages/app-services/src/theme.ts` edits the same line the starter edits, so every upstream merge conflicts in the platform packages — the files a fork has the least business owning. A name that is a *parameter* moves the edit to the fork's own composition root, where a conflict cannot happen.

The third force is proportion. `machxi` appears in hundreds of places, and nearly all of them are fixtures, seeds and the `@machxi.local` email domain — mechanical, no judgement, no ADR. That is script work, not checklist work.

## Decision

### 1. One brand identifier per side, and every name is derived from it

**The API reads `APP_ID` from config** under [ADR-0004](0004-configuration-and-environment.md) (_configuration and environment_): a zod entry in `core/config/schema.ts`, a line in `.env.example`, and `turbo.json` `env` for every task that reads it. It defaults to `machxi`, so this repository's own cookies and tokens are byte-identical after the change. From it derive:

```
REFRESH_COOKIE          = `__Secure-${appId}.refresh`
csrfCookieName(pop)     = `__Host-${appId}.csrf.${pop === "staff" ? "admin" : "user"}`
LEGACY_CSRF_COOKIE      = `__Host-${appId}.csrf`
audienceFor(population) = `${appId}-${population}`
```

A **delta** on [ADR-0029](0029-browser-token-transport.md) (_browser token transport_) and ADR-0056 for the cookie names' provenance, and on ADR-0018 for the audience's. Everything those records decide about prefixes, paths, `httpOnly`, the double-submit mechanism, the population split and audience verification stands untouched: what changes is where the leading word comes from, not one attribute or one guarantee. The cookies file's argument survives too, in its true form — the *shape* of these names is not configuration; the *brand* in them is a fork-day value, which is a different question.

**The SPAs read `VITE_APP_ID`** and derive every device-storage key as `` `${appId}.${segment}.${fact}` `` — `machxi.admin.theme`, `machxi.user.locale`, `machxi.user.grid:orders:v1`. The `segment` is the one `createApiClient` already takes (`"admin" | "user"`, [ADR-0051](0051-platform-extraction.md), _platform extraction_), so the app that already declares which segment it speaks to declares which keys it owns, and the shared-key defect closes as a by-product rather than as a special fix. A **delta** on [ADR-0045](0045-user-settings.md) (_user settings_) and [ADR-0041](0041-grid-preferences.md) (_grid preferences_) for the key strings, and on [ADR-0033](0033-browser-api-client-and-session.md) (_browser API client and session_) as carried by ADR-0051 for the storage carve-out's spelling. The carve-out itself is unchanged: display state may be persisted, credentials may not.

**The packages take the prefix as a parameter and never hold a constant.** `@repo/app-services`, `@repo/i18n` and `@repo/grid` are given the prefix by the app that composes them; no platform package reads `import.meta.env`. That is the merge property: a fork's brand lives in its `apps/*/src/shared` doors and its `.env`, which the starter never edits.

### 2. Renaming a live deployment is a sign-out, and the record says so

Changing `APP_ID` after launch invalidates every refresh and CSRF cookie in every browser and orphans every device preference. This is **by design and not worth mitigating**: no dual-read, no migration window, no legacy-name fallback beyond the one ADR-0056 already ships. `APP_ID` is a **fork-day value** — set once, before the first deployment, alongside the rename script below. A project that must rename later takes the sign-out.

### 3. `scripts/rename.mjs` — one argument, the mechanical half

A repo-level script ([ADR-0002](0002-monorepo-layout-and-tooling.md), _monorepo layout and tooling_: tooling outside the workspaces lives in `scripts/`) taking the new identifier and rewriting the identity that is not runtime-derived:

- the fixture and seed email domain (`machxi.local` → `<name>.local`) across seeds, dev fixtures, integration suites, MSW principals, e2e specs and the Postman environment;
- the compose project, container and network names, and the Docker init SQL;
- the root package name;
- the `brand` block values in each app's `common` catalogue and the two `index.html` titles.

The **rendered brand stays where it is** — the typed `brand` keys of [ADR-0046](0046-interface-localization.md) (_interface localization_), per app and per locale, because a brand line may legitimately differ by language and a missing key already fails `check-types`. The script seeds those values; it does not replace the catalogue with a config object.

`docs/rebranding.md` then shrinks to three lines: set `APP_ID` and `VITE_APP_ID`, run `node scripts/rename.mjs <name>`, review the diff. It stops being a checklist that can rot and becomes the argument for a script plus two variables.

## Consequences

- A fork rebrands in one commit it can read, and the platform packages are not among the files it touches — so upstream merges stay clean where they matter most.
- The admin/customer storage collision closes without a bespoke fix; D12's finding 1 is discharged by the mechanism rather than patched.
- One more required variable per side, and a deployment that sets neither still gets `machxi` — the defaults keep this repository's behaviour identical, which is what makes the change reviewable at all.
- The gate grows nothing. The claim "no `machxi` literal survives outside history and defaults" is a lint rule or a test, not a sentence in this record.
- Renaming mid-life is now a documented sign-out rather than an undocumented surprise; support gets a sentence to quote.

## Alternatives considered

- **Script only, keys stay constants.** The rename works once and then every upstream merge conflicts inside `packages/*` — the fork editing files it does not own. It also leaves the shared-key defect standing.
- **Checklist only** (today's state). Seven sections and a full-text search per fork, growing with every deliverable, with no mechanism that fails when it drifts.
- **A `brand.config.ts` object replacing the i18n `brand` keys.** A second copy mechanism beside the typed catalogue, losing per-locale brand lines and the `check-types` guarantee for nothing.
- **Deriving cookie names from `JWT_ISSUER`.** One variable, but it fuses a token claim with a browser cookie name: changing an issuer for a key rotation would sign everyone out.
