# D18 — Mail flows

- Status: **in progress** — scoped 2026-09-10 by `/scope`, on the operator's decision that Google sign-in ([D19](0019-google-sign-in.md)) waits for verified addresses; **opened 2026-09-10**, the same sitting, on the operator's decision (ADR-0025 rule 5; ledger §How D18 opened). The plan below is what `/step` executes. Built before D16, whose row says "built last".
- Records: [ADR-0071](../adr/0071-mail-flows.md) (mail flows — verified addresses, recovery, invitations delivered, addresses changed; deltas on ADR-0017, 0018, 0027 and 0057) — written `proposed` at scoping and accepted at `D18.1`'s head; its parents move at the step that makes each delta true, and the steps name which. A step whose record is still `proposed` is gated.
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0018-mail-flows.notes.md`](0018-mail-flows.notes.md)

## Goal

Every flow that needs a mailbox, built on one mechanism: a single-use hashed token delivered in a fragment link. A self-registered account is usable once its address is proven; either population recovers a password by mail; an invitation is delivered and accepted from its link; a person changes their own address by proving the new one, and a super admin sets any account's address outright; a staff member is onboarded from an invitation instead of a password typed by an admin. ADR-0071 decides all of it; ADR-0066's port carries it.

## Constraints

- `security-reviewer` reads every step's diff — every flow here mints a bearer credential and most consume one unauthenticated (ADR-0071 §1; D13's constraint carried).
- Tokens are stored as hashes only, consumed once inside the acting transaction, and a refused consumption spends nothing (ADR-0057 §2–§3 as inherited by ADR-0071 §1).
- Links carry the token in the fragment, and the SPA route that lands strikes it from history before posting it (ADR-0057 §2 and its `D13.7` amendment; ADR-0071 §1).
- Every "does this address exist" endpoint answers the same status regardless (ADR-0020 §Enumeration; ADR-0071 §3–§5).
- Every `active` user has a verified or asserted address from `D18.3` on; nothing downstream re-checks a flag (ADR-0071 §3).
- A changed address is takeover-enabling and refused under impersonation (ADR-0057 §5 as carried by ADR-0071 §6).
- New env keys enter ADR-0004's schema, `.env.example`, `docker/prod/.env.example` and [`docs/deploy.md`](../deploy.md) (ADR-0059 §6); none enters `turbo.json` (ADR-0004's step-7 amendment).
- A behaviour change updates the capability's spec in the same diff (ADR-0068 §1); new endpoints get Postman requests (ADR-0021).
- Templates are English with a `locale` parameter (ADR-0071 §2); SPA copy lands in both locales (ADR-0046).
- The gate: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.

## Decisions taken at scoping (operator, 2026-09-10)

- **All five flows in one deliverable**, plus the super admin's administrative address change — chosen over verification and reset alone.
- **Verified before login**: registration issues no session; the link does (ADR-0071 §3).
- **English templates, locale on the seam** (ADR-0071 §2).
- **D18 before D19**: Google sign-in links only to verified addresses, so it waits.
- **Numbered D18, built before D16.**

## Steps

Each step: implement, gate green, one bounded diff review **plus `security-reviewer`**, commit (ADR-0050). ADRs listed are what the builder reads first.

- [ ] **1. Accept ADR-0071; the table, the columns, the config, the sweep.** Accept 0071 at the head, where [ADR-0017](../adr/0017-identity-model-populations-and-roles.md) moves to `superseded by` (delta: `email_verified_at`, a nullable staff hash) — the other three parents wait for the steps that make their deltas true. `account_tokens` in `packages/db` with `TOKEN_PURPOSES` in `@repo/contracts` (one declaration, `pgEnum` and zod both consuming it); `users.email_verified_at`; `staff.password_hash` nullable; a backfill migration stamping every existing user verified; the enumerations (`TRUNCATED_TABLES`, `RESTRICTED_SCHEMA_TABLE_IMPORTS`) grown; `db:sessions:prune` sweeping consumed and expired token rows; `CUSTOMER_APP_URL`, `ADMIN_APP_URL`, the four TTLs and `RATE_LIMIT_PASSWORD_RESET_MAX` through the config schema, `.env.example`, `docker/prod/.env.example` and `docs/deploy.md`; `tokenHash` already redacted, `newEmail` and `payload` added to the logger's paths; the dev seeds stamping their fixtures verified.
      **ADRs:** 0071 (§1, §9), 0017, 0004, 0006, 0008, 0061, 0005.
      **Done when:** gate green; `packages/db` schema test asserts `account_tokens.token_hash` unique and the purpose enum's four values; `seed.int.test.ts` asserts every dev fixture user is `active` with `email_verified_at` set; a `prune-sessions` unit test asserts a consumed token row older than the retention is deleted and a live one is not; `config.test.ts` asserts the two app URLs are required in production and default locally.
- [ ] **2. The token service, the templates, the limiters.** `core/tokens`: `mint(ctx, { purpose, principal, payload?, ttl })` returning the raw token once, superseding the live row for the same principal and purpose; `consume(ctx, purpose, token, tx)` returning the row or `undefined`, single-use inside the caller's transaction. `core/mail/templates`: one function per flow, `locale` parameter, English copy, links built from the app URLs with the token in the fragment. `createPasswordResetRateLimiter` (address and email, `3 / hour`, its own window) and `createVerificationRateLimiter` in the rate-limit module.
      **ADRs:** 0071 (§1, §2, §4), 0066 §1, 0020, 0057 §2, 0009.
      **Done when:** gate green; `core/tokens/__tests__/tokens.test.ts` asserts a token consumes once and a second consume answers `undefined`, that a re-mint consumes the earlier row, and that a consume inside a rolled-back transaction leaves the row live; `core/mail/__tests__/templates.test.ts` asserts every template's link carries the token after `#` and never in the path or query; `rate-limit.test.ts` asserts the reset limiter's window is one hour.
- [ ] **3. Address verification, the API.** Register creates `pending_verification`, mails the link, answers `202` without a session ([ADR-0018](../adr/0018-authentication-sessions-and-tokens.md) moves to `superseded by` at this head — the delta is registration's answer); `POST /public/auth/verify-email` consumes and answers login's body on cookie transport; `POST /public/auth/resend-verification` always `202`; login on a pending account with the right password answers `403 AUTH_EMAIL_UNVERIFIED` (the code in `@repo/contracts` with both apps' catalogue sentences); `account.verified` audit row. `docs/specs/mail-flows.md` begun; `auth-sessions.md`'s registration requirement rewritten; Postman folder.
      **ADRs:** 0071 (§3), 0018, 0020, 0058, 0013.
      **Done when:** gate green; `apps/api/test/mail-flows.int.test.ts` asserts a registration answers `202` with no `Set-Cookie` and a `pending_verification` row, the mailed token (read from the log adapter's capture) verifies once and signs the device in, a second verify answers `401`, login before verification with the right password answers `403 AUTH_EMAIL_UNVERIFIED` and with the wrong one `401 AUTH_INVALID_CREDENTIALS`, and resend for an unknown address answers `202`; `docs/specs/mail-flows.md` requirement "An account is usable once its address is proven" with those scenarios; `pnpm test:postman` green with the folder's counts in both READMEs.
- [ ] **4. Address verification, the customer app, and the tier reads its mail.** The register form lands on a check-your-mail screen with resend; `/verify-email` redeeming the fragment (the `/impersonate` route's shape) and landing signed in; the login form's `AUTH_EMAIL_UNVERIFIED` copy with a resend link; both locales. `apps/customer/e2e/support/mail.ts` reading Mailpit's API; the local compose and the nightly workflow's `MAIL_TRANSPORT=smtp` for the tier, Mailpit as a service in `.github/workflows/e2e.yml`; `organizations.spec.ts`'s registration walks the link.
      **ADRs:** 0071 (§3), 0055, 0046, 0052 (the tier), 0059 §1.
      **Done when:** gate green; `register-form` tests assert the `202` lands on the check-your-mail screen and never on `/`; a `verify-email` page test asserts the fragment is struck and the exchange lands on `/`; `pnpm test:e2e` green with `organizations.spec.ts` registering, reading the link from Mailpit and landing signed in.
- [ ] **5. Password reset, both populations, the API.** `forgot` and `reset` beside each segment's login through the auth router factory; `reset` revokes every session and answers `204`; `account.password_reset` audit row; [ADR-0027](../adr/0027-credential-self-service-and-reset.md) moves to `superseded by` at this head (the delta: the reset it left out, and §6–§7 to come). Spec requirement; Postman on both segments.
      **ADRs:** 0071 (§4), 0027, 0020, 0018, 0058.
      **Done when:** gate green; `mail-flows.int.test.ts` asserts `forgot` answers `202` for a known, an unknown, a disabled and a pending address alike and mails only the first; `reset` sets the hash, every prior refresh token answers `401 AUTH_SESSION_REVOKED`, no cookie is set, and a replay answers `401`; the fourth `forgot` in an hour answers `429`; the same on the admin segment for a staff member; the spec requirement "A password is recovered by mail on both segments".
- [ ] **6. Password reset, both apps.** "Forgot your password?" on both login pages; the request form; `/reset-password` redeeming the fragment into the new-password form and landing on login; both locales; MSW handlers and tests in both apps.
      **ADRs:** 0071 (§4), 0049, 0055, 0046.
      **Done when:** gate green; a `forgot-password` test in each app asserts the same confirmation copy for any address; a `reset-password` page test in each app asserts the token is posted from the fragment and a refused token renders the catalogue copy with a link to request again.
- [ ] **7. Invitations delivered and accepted by the link, the API.** The send at creation through the port; `POST /public/invitations/lookup` behind the login limiter, one `404` for every failure; `POST /user/invitations/accept-by-token` accepting when the caller's address is the invited one; `organizations.md` grows both; Postman.
      **ADRs:** 0071 (§5), 0067 (§2, §5 and its amendment), 0066 §1, 0020.
      **Done when:** gate green; `organizations.int.test.ts` asserts a created invitation was sent to the invited address with the token in the link's fragment, lookup answers name, address and role for a live token and `404` for an unknown, a declined and an expired one, accept-by-token joins the caller whose address matches and answers `403` for one whose address differs, and a second accept answers `404`; the spec requirement "An invitation is delivered and accepted from its link".
- [ ] **8. Invitations, the customer app.** `/invitations/accept` redeeming the fragment: signed out, a register form with the address prefilled and locked, or sign in; signed in, accept and land in the organization; a mismatched address told plainly; both locales. `organizations.spec.ts` follows the mailed link instead of the account-area accept.
      **ADRs:** 0071 (§5), 0067 §6, 0055, 0046.
      **Done when:** gate green; page tests assert the three landings — stranger, account holder, mismatched address; `pnpm test:e2e` green with the invitee joining from the Mailpit link.
- [ ] **9. A person changes their own address; the exclusion.** `POST /user/profile/change-email` and `POST /public/auth/confirm-email`; the old address notified; `refuseImpersonated` on the route ([ADR-0057](../adr/0057-impersonation-sessions.md) moves to its fourth successor delta at this head); `account.email_changed` audit row; the profile section's change-address dialog in the customer app, both locales; spec; Postman.
      **ADRs:** 0071 (§6), 0027, 0057 §5, 0058, 0053.
      **Done when:** gate green; `mail-flows.int.test.ts` asserts a change mails the new address and changes nothing, confirm swaps the address and stamps verification, a taken address answers `409 USER_EMAIL_TAKEN` at request and again at confirm, an impersonated session answers `403 AUTH_IMPERSONATION_REFUSED`, and the old address received a notice; `impersonation-exclusions.int.test.ts` grows the route; a `change-email-dialog` test asserts the current password is required; the spec requirement "An address changes when the new one is proven".
- [ ] **10. A super admin sets any account's address.** `POST /admin/{staff,users}/:id/email` behind `authorize("super_admin")`, the acting operator's password in the body, the address asserted and audited; `RESOURCE_POLICY` rows `changeEmail: ["super_admin"]` on both resources with the fixture test grown; a change-email dialog on both record surfaces, visible to a super admin only; `users-and-profile.md` and `staff.md` grow the requirement; Postman.
      **ADRs:** 0071 (§7), 0027, 0019, 0042, 0058.
      **Done when:** gate green; `users-admin.int.test.ts` and `staff-admin.int.test.ts` assert an `admin` answers `403`, a `super_admin` with the wrong own password answers `403 AUTH_CURRENT_PASSWORD_INVALID`, a taken address answers `409`, and a success stamps `email_verified_at` on a user and writes the audit row naming both addresses; `policy.test.ts` asserts the row; a record-surface test in `apps/admin` asserts the action is absent for an admin and present for a super admin.
- [ ] **11. Staff onboarding by invitation.** `POST /admin/staff` with the password optional, `invited` and a null hash, the link mailed to the admin app; `POST /admin/auth/onboarding/accept` and `/admin/staff/:id/onboarding/resend`; the create surface's password field optional with "send an invitation" as the default; a "Resend invitation" row action for `invited` rows; `/onboarding` in the admin app redeeming the fragment into a set-password form and landing signed in; `staff.md` grows the requirement; Postman; the admin browser tier walks it from Mailpit.
      **ADRs:** 0071 (§8), 0017, 0027, 0049, 0042.
      **Done when:** gate green; `staff-admin.int.test.ts` asserts a create without a password answers an `invited` row that cannot log in and mails a link, accept sets the password and signs the device in, a second accept answers `401`, resend on an `active` row answers `409`; `create-staff-surface` tests assert both shapes of the body; `pnpm test:e2e` green in the admin app with a new operator onboarded from the Mailpit link.
- [ ] **12. Close-out.** The window floors of both tiers re-measured, not adjusted; the Postman counts in both READMEs; `docs/deploy.md`'s checklist naming the mail transport as required for these flows; then the definition of done, top to bottom.
      **ADRs:** 0071, 0069, 0059 §6.
      **Done when:** the definition of done below run and its output in the notes.

## Definition of done

Run at `D18.12` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO` (ADR-0026 as carried).
3. `pnpm test:postman` exit `0`, with the request and assertion counts `README.md` and `docs/postman/README.md` state.
4. `pnpm test:e2e` green in both apps with `MAIL_TRANSPORT=smtp` against the local compose: registration verified from Mailpit, an invitee joining from the link, an operator onboarded from the link.
5. `pnpm rules:digest` writes nothing on a second run and `pnpm docs:check` reports the inherited documents and the specs clean.
6. `pnpm db:seed -- --dev` twice against the dev database, identical output, every fixture user verified.
7. `pnpm db:sessions:prune` against a database holding one consumed and one live token row deletes the first and keeps the second.
8. **Operator, browser:** register, read the mail in Mailpit, land signed in; forget and reset a password in each app; invite a stranger and join from the link; change an address and confirm it; as a super admin set another operator's address and see the audit row; create an operator without a password and onboard from the link; every refusal's copy in both locales.

## Not in D18

Latvian templates (one later step on §2's seam); Google sign-in ([D19](0019-google-sign-in.md)); a change of address on `/admin/profile` for non-super-admin staff (an admin asks a super admin, ADR-0071 §7); a customer-facing "sessions" list; expiring invitation rows by sweep beyond what `db:sessions:prune` gains here; delivery of anything through a third-party mail API (ADR-0066's SMTP adapter is the seam).
