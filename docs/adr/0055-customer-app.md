# ADR-0055: The customer app — `apps/customer`, the roster, and user-segment self-service

- Status: accepted
- Date: 2026-08-31
- Supersedes: [ADR-0022](0022-frontend-apps.md) (delta: the app roster — `apps/web` narrows to marketing and `apps/customer` joins; every stack decision stands)

> Written 2026-08-31 for D12 ([`docs/plan/0012-customer-app.md`](../plan/0012-customer-app.md)). **Accepted 2026-08-31 at the head of `D12.1`**, where ADR-0022 moved to `superseded by` in the same commit; amendable in place while D12 is `in progress` (ADR-0025 rule 2). This record is **deliberately mostly by reference**: the customer app is the second consumer of the platform D8–D11 built, and its architecture *is* those records — what it decides is the roster, the deltas the `/user` segment forces, and the self-service endpoints that segment still lacks. The 2026-08-22 re-scoping deferred 0022's supersession "until an app actually changes"; this is that day.

## Context

[ADR-0022](0022-frontend-apps.md) named `web` (Next.js) the public, user-facing app. The operator re-scoped that in the ledger on 2026-08-22 — the actual user-facing product is a **customer app**, staff-adjacent in shape, and `apps/web` is marketing only, built last (D14) — but the frozen roster record could only be corrected by the deliverable that changes an app. Meanwhile everything a second SPA needs became packages: the session machine parameterised by segment ([0051](0051-platform-extraction.md); `createApiClient` takes `"user"`), the shell and surfaces ([0047](0047-ui-package-scope.md)/[0048](0048-app-shell-and-record-surfaces.md)), Instrument ([0054](0054-design-language-instrument.md)), the account area's shape ([0053](0053-account-area.md)), settings on both segments ([0045](0045-user-settings.md) with `gridDensity` since `D11.6`), and localization designed for two apps from the start ([0046](0046-interface-localization.md)). What the `/user` segment does **not** yet have is a *complete* self-service surface, while [ADR-0027](0027-credential-self-service-and-reset.md) and [ADR-0028](0028-account-deletion.md) built those flows for staff and for administrators acting on users. **(Amended 2026-08-31, `D12.2`: this paragraph originally read "it holds auth and settings only — no profile read or write, no password change, no account deletion", which was wrong on the first two counts and never checked. See §4's amendment.)**

## Decision

### 1. The roster

`apps/customer` — **Vite + React SPA over the `/user` segment, dev port 3002** (reassigned from `web`, which takes its new port from its own deliverable, D14). `apps/web` is **marketing only**; its architecture stays the open decision the index's Planned list records, owned by D14. `apps/admin` is unchanged. Everything else ADR-0022 decided — the stacks, the React/Vite alignment, the port discipline — stands as written.

**Amended 2026-08-31 (`D12.1`).** "Reassigned" had a consequence this record did not follow through: `apps/web/package.json` still said `next dev -p 3002`, so `pnpm dev` with no filter started two apps on one port and whichever bound second silently moved to another — a race deciding which app answers 3002. Two apps cannot share a port, and deferring web's port to D14 cannot mean leaving it on the customer app's. So **`apps/web`'s dev server moves to 3003 now**. That is a placeholder and not the assignment D14 owns: the marketing site's real address is a deployment decision, and this number exists only so `pnpm dev` is deterministic in the meantime. The CORS allow-list stays exactly the two SPAs (3001 and 3002) — a marketing page makes no credentialed request.

### 2. The architecture, by reference

The customer app is built exactly as the admin panel is, from the same records: FSD layers and routing per [0049](0049-admin-app-architecture.md) as carried by [0051](0051-platform-extraction.md) — the same `_auth`/`_dashboard` topology, thin route files, downward-only imports lint-enforced with its own `boundaries` config; the platform packages reached **only through its own `shared/` doors** (0051 — the doors are per-app; a door is the only path to the symbols); session, CSRF bootstrap and single-flight refresh per [0033](0033-browser-api-client-and-session.md) as carried, with `createApiClient({ segment: "user" })`; server state per [0043](0043-readable-list-search-params.md); testing per [0036](0036-admin-testing-strategy.md) — Vitest, Testing Library, MSW handlers parsed by the contracts, no live tier, its own pseudo-locale route walk; localization per [0046](0046-interface-localization.md) — its own dictionary and namespaces, package bundles composed at `init`, `en` and `lv` from the first screen; Instrument per [0054](0054-design-language-instrument.md) — the shared token sheet, its own `@fontsource` imports (0054 §1 said each app loads its own bytes), the shell and surfaces from `@repo/ui`. The app keeps what every app keeps: its catalogues, its config, its `meta` augmentations.

### 3. The deltas the `/user` segment forces

- **No roles, no policy table.** A customer is one population with one shape of authority: themselves. The app mounts **no `RESOURCE_POLICY` and no `can()` join** — surfaces are offered by their configs alone, and the API remains the only authority ([0019](0019-authorization-guards.md) deny-by-default stands server-side, untouched). [ADR-0042](0042-client-side-authorization.md) is an admin-app record and stays one.
- **The header's account control, not the operator's menu.** `headerEnd` takes the Instrument account control opening [0053](0053-account-area.md)'s slim popover — identity block, one **Account** link, **Sign out** — which is the requirement `D8.5` wrote down as the slot's second consumer, arriving.
- **The account area is 0053's shape with customer sections**: `/account` on `SettingsLayout` — profile (names), security (password change, **and account deletion**, the placement 0053 §1 anticipated), preferences (theme, locale — self-named — and density, which is an account fact whether or not a grid is mounted yet).
- **No grid in v1.** Self-service has no domain list; `@repo/grid` enters this app when its first domain entity does, not before. The bundle budget mechanism lands with the app (a committed `size-budget.json`, baselined at first build — the D10.5 mechanism, as [0052](0052-grid-and-admin-followups.md) said the customer app inherits).

### 4. User-segment self-service — the API this deliverable adds

The `/user` segment gains what `/admin/profile` proved, with the account itself as the actor:

- **`GET /api/v1/user/profile`** and **`PATCH /api/v1/user/profile`** — the caller's own account; names editable, email not (changing a login identifier is a verification flow this record does not build — the same boundary 0027 drew).
- **`POST /api/v1/user/profile/password`** — [0027](0027-credential-self-service-and-reset.md)'s self-service rules verbatim: the current password required despite a valid session, every *other* session revoked, the calling one kept.
- **`DELETE /api/v1/user/profile`** — self-service deletion with [0028](0028-account-deletion.md)'s user semantics carried exactly (soft delete, the partial unique index's consequences stand), plus two rules the self-service actor forces: **the current password is required** (a hijacked tab must not be able to destroy the account — 0027's re-auth principle applied to the one operation more destructive than a password change), and **every session is revoked, the calling one included** — the account ends signed out everywhere.

All three land in the existing profile/auth module structure per [0009](0009-api-modular-layering.md), guarded `authenticate` + user-population (0019), enveloped per [0012](0012-response-envelope.md), refused per [0013](0013-error-model.md), with integration tests (0021) and Postman entries. No new library, no new table, no migration.

**Amended 2026-08-31 (`D12.2`) — two of the three already exist, and this section was written without checking.** `D12.2`'s orientation read `apps/api/src/routes/user.router.ts` and found `createUserProfileRouter` already mounted, shipped at **D2.3/D2.4**:

- **`GET /api/v1/user/profile`** and **`PATCH /api/v1/user/profile`** — built, with `updateProfileBody` in `@repo/contracts`, `apps/api/test/user-profile.int.test.ts` in the integration tier, and a Postman folder that signs in as a created account rather than a fixture precisely so it can change a password.
- **`POST /api/v1/user/profile/change-password`** — built, on [0027](0027-credential-self-service-and-reset.md)'s rules. Note the **path**: `/change-password`, not the `/password` this record spelled. The shipped spelling is the staff mirror's and stands; the spelling above was invented here and is the error.
- **`DELETE /api/v1/user/profile`** — genuinely absent, exactly as written. §4's third bullet is unaffected.

What this changes is the *claim*, not the decisions: the `/user` segment's self-service surface is thinner than `/admin`'s but it is not empty, and this record's §Context sentence — "it holds auth and settings only" — is false and was false when written. The rules the three endpoints must follow are unchanged, because they are 0027's and 0028's and this record only ever carried them by reference. The consequence for the build order is in [the plan](../plan/0012-customer-app.md) §3, amended in the same commit: `D12.3` becomes a verification and adoption step rather than a construction one.

### 5. What this record deliberately does not decide

Registration and email-based password reset stay unwritten (the index's Planned list; the seeded-accounts world stands). Impersonation is [D13](../plan/0013-impersonation.md)'s record. `apps/web`'s architecture is D14's. A customer-visible domain entity — the thing that would bring `@repo/grid` and real navigation — is named by the operator when it exists; this app ships v1 able to receive it.

## Consequences

- The bet D8–D11 made is finally tested: **anything `apps/customer` cannot build from the packages without changing them is a finding against those deliverables**, recorded as such — the plan carries this as its standing rule.
- The API grows three endpoints on a segment that had two modules; Postman and the integration tier grow with it.
- Two apps now import the token sheet; Instrument's "each app loads its own bytes" gets its second consumer, and the customer app starts life inside a bundle budget instead of acquiring one later.
- A customer who deletes their account is signed out everywhere and their email stays claimable by no one (0028's index) — support flows for undeletion remain an admin capability, not a self-service one.

## Alternatives considered

- **A mode of the admin panel instead of a second app.** Rejected at the 2026-08-20 scoping and the reasoning has only strengthened: two session models in one client, staff attack surface in the customer origin, and D13's impersonation needing the two sessions never to coexist.
- **Carrying ADR-0022 whole.** Permitted, not required (0050); the delta is one roster paragraph and the parent's stack decisions are untouched — restating them would be the drift surface.
- **Email change and registration in v1.** Both are verification-flow decisions (email delivery, tokens, abuse) the Planned list already holds; bolting either onto this deliverable would decide them by accident.
- **Deletion without password re-auth.** Simpler, and wrong for the same reason 0027 requires the current password on a change: a session is not an identity proof for irreversible acts.
