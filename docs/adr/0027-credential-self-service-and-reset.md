# ADR-0027: Credential self-service and administrative password reset

- Status: accepted
- Date: 2026-08-18

## Context

[ADR-0018](0018-authentication-sessions-and-tokens.md) §Staff onboarding decides how a staff account gets its first password: "Staff accounts are created by an admin via `POST /admin/staff` with an initial password (status `active`); the invite-by-email flow (status `invited`, set-password link) is a later feature."

It does not decide how that password is ever changed, and D1 built no way to change it.

`POST /api/v1/user/profile/change-password` exists for the `users` population. Staff have nothing equivalent: `updateStaffBody` has no password field, `StaffColumnPatch` has no `passwordHash`, and there is no staff counterpart to `/user/profile`. `staff.password_hash` is `NOT NULL` and written exactly once, at creation, from a password handed over out of band. So today an operator's initial password is permanent, and a forgotten one is recoverable only by connecting to Postgres and writing an argon2 digest by hand.

This is not deferred scope. The endpoint scope table in D1's plan simply never listed it, no ADR mentions it, and the review that found it found it by comparing the two populations rather than by reading anything. The write itself already exists — `staffRepository.updatePasswordHash` was built for the transparent argon2 parameter upgrade on login — so what is missing is a route, not a capability.

Two adjacent gaps have the same shape and are decided here rather than found again later:

- **Neither population has an administrative reset.** Recovery for a user is no better than for a staff member: there is no email delivery, so `POST /public/auth/register` and the admin create endpoints are the only paths that ever set a password, and neither is available to somebody who has forgotten one.
- **[ADR-0017](0017-identity-model-populations-and-roles.md) §Invariants anticipated this.** Its rank rule — "a target that outranks you is protected from you" — closes with: "will also cover password reset and deletion when those arrive, and belongs here rather than being restated in each service." Reset is arriving, so the rule has to be applied rather than restated.

The forces are: the admin panel's first authenticated screen will want a password change; a credential-setting endpoint is the highest-value thing an attacker can reach with a stolen access token; and this repository has no step-up authentication category, so whatever protects these endpoints has to be built from what exists.

## Decision

Three endpoints for a principal acting on itself, mirroring `/api/v1/user/profile` exactly, and one endpoint per population for a staff member acting on somebody else.

### Staff self-service — `/api/v1/admin/profile`

```
GET   /api/v1/admin/profile                    (auth: staff)
PATCH /api/v1/admin/profile                    (auth: staff)   names only
POST  /api/v1/admin/profile/change-password    (auth: staff)   revokes other sessions
```

Mounted in the `admin` segment after `authenticate("staff")` and **without `authorize`**, for the reason `/user/profile` carries none ([ADR-0019](0019-authorization-guards.md) §3): every handler reads its subject from `ctx.principal`, there is no `:id` to compare, and every staff role — `editor` included — may change its own password. A role guard here would be a guard on an ownership question that cannot be answered wrongly.

The three functions live on the existing staff service and are exposed through a second controller, `createStaffProfileController`, which is exactly how the users module already separates `/admin/users` from `/user/profile`: one service because they are two views of one aggregate, two controllers so the admin handlers are not reachable from the self-service router even by a routing mistake ([ADR-0009](0009-api-modular-layering.md), and the note in `core/container.ts` that says so).

`change-password` keeps the three decisions `/user/profile/change-password` already made and states them once here for both populations:

- **The current password is required**, even though the caller holds a valid session. A stolen access token is worth fifteen minutes; a stolen access token that can set a new password is worth the account.
- **Every other session is revoked; the caller's is not.** A password change is how somebody ends a session they no longer control, so sparing the others would defeat it — and logging the caller out of the device they are holding is worse for no gain, since that session is the one they just proved they own.
- **An account with no password may not use it.** Only `users.password_hash` is nullable, and `null` means "no password login" (ADR-0017), never "any password matches"; the check fails through the same answer a wrong password gets.

### Administrative reset — `POST /api/v1/admin/{staff,users}/:id/password`

```
POST /api/v1/admin/staff/:id/password    (role admin)
POST /api/v1/admin/users/:id/password    (role admin)
```

Body: `{ password, currentPassword }` — the new password for the subject, and **the acting staff member's own current password**.

A sub-resource rather than a field on `PATCH /:id`, for the reason `/:id/sessions/revoke` is one: setting somebody else's credential is an action with side effects, not an attribute of the account, and `POST` is what says so. It also keeps `updateStaffBody` and `updateUserBody` free of a password field, so no code path exists where a profile edit can silently rotate a credential.

Four rules govern it:

1. **The actor re-presents their own password.** This is the cheapest form of step-up authentication available in a repository that has no re-authentication category, and it is what stops a stolen access token from being an account-takeover engine: without it, fifteen minutes of a compromised admin token is enough to set a new password on every non-super-admin operator and every customer. It costs one additional argon2 verify per call, which is accounted for below. A wrong actor password answers `AUTH_CURRENT_PASSWORD_INVALID` (403) — the same code the self-service endpoints use, because it is the same question about the same caller.

2. **The ADR-0017 rank rule applies to the staff endpoint.** Setting a super admin's password is removing their standing in the most complete way available, so it is refused to anybody who is not one — the existing `assertMayActOnSuperAdmin` guard, unchanged, for the same reason it already guards `disable` and `sessions/revoke`. A privilege everyone it outranks can seize by rewriting its credential is not a privilege.

3. **Every session of the subject is revoked**, with no exception, in the same transaction as the password write. The self-service case spares the caller because the caller proved ownership; here the subject proved nothing, and the plausible reason for a reset is that the account is compromised. The revocation reason is `password_reset`, distinct from `password_changed`, because the audit trail's job is to tell "the holder changed it" apart from "somebody else changed it for them".

4. **No forced change at next sign-in.** That needs a `must_change_password` column and a branch in every authenticated path, which is a schema and middleware decision this ADR is not making. The consequence is stated rather than hidden: a password set by an administrator stays valid until the holder changes it, and the operational instruction is to hand it over out of band and ask them to change it — the same posture ADR-0018 §Staff onboarding already takes for the initial password.

### Contracts

- `changePasswordBody` moves to `packages/contracts/src/auth/` and is re-exported by both `staff` and `users`. It is a credential shape, not a users-module shape, and now that two populations use an identical body [ADR-0023](0023-shared-contracts-package.md)'s "defined once" rule decides where it lives.
- `setPasswordBody` — `{ password: passwordSchema, currentPassword: presentedPasswordSchema }` — is added alongside it. `password` is held to the policy because it is a new password; `currentPassword` is only bounded, for the reason `presentedPasswordSchema` exists: applying the policy to a credential being *verified* answers "is this long enough to be one of ours?" before any check runs.
- `USER_CURRENT_PASSWORD_INVALID` is **renamed to `AUTH_CURRENT_PASSWORD_INVALID`** and keeps its `403`. The condition it reports — "you presented your own current password and it did not verify" — now occurs in four endpoints across two populations, and is a property of the credential check rather than of the users module. Renaming it is a client-visible change and is therefore made now, while ADR-0022's two apps are unbuilt and the only consumer is a Postman collection in this repository; the same rename after a client exists costs a coordinated release.
- `REVOKE_REASONS` gains `passwordReset: "password_reset"`.

**Amended 2026-08-19 (D2.3).** The list above is what the implementation moved and added, plus one shape it did not anticipate and one placement question it left open.

_`updateStaffProfileBody` was missing from it._ `PATCH /api/v1/admin/profile` is decided above as "names only", and no body existed for that: `updateStaffBody` carries `roles` and `status`, which are the two fields this endpoint must not have. It is declared in `contracts/staff/schemas.ts` as a strict object of `firstName` and `lastName`, neither nullable — the `staff` columns are `NOT NULL` (ADR-0017), so unlike the user profile's patch there is no "clear it" case to express. This is what makes an unguarded router safe rather than merely convenient: an `editor` sending `roles` is refused as an unknown key, so the escalation fails on the schema instead of on a rule somebody has to remember to write.

_Both credential bodies are re-exported by `staff/` and `users/`._ The rule above named only `changePasswordBody`; `setPasswordBody` is re-exported the same way, because it is used by exactly those two modules' endpoints and by none of `auth/`'s. Re-exporting a binding twice is free — ES modules deduplicate identical bindings, so the root `export *` stays unambiguous.

_Where the check itself lives._ `AUTH_CURRENT_PASSWORD_INVALID` is an auth code because the condition belongs to the credential check, and the factory that raises it follows the code: `currentPasswordInvalid` is declared once in `modules/auth/auth.errors.ts` and imported by both feature modules. A copy per module would have reproduced, in the error layer, the asymmetry this ADR exists to remove.

### Out of scope, and what it will need

**Email-based password reset — "forgot my password" — is not built.** Every endpoint here requires an authenticated caller, so none of them helps somebody locked out. That is a real hole and it is left open deliberately, because closing it needs three things this repository does not have: email delivery (a planned ADR), a single-use reset-token table with its own expiry and reuse semantics, and the `3 / hour` reset limiter [ADR-0020](0020-security-baseline.md) §Rate limiting already reserved a row for. Half-building it — a token column on `staff` with no delivery — would produce an unused attack surface.

Until it exists, the recovery path for a staff member is another admin using `POST /admin/staff/:id/password`, and the recovery path for the last super admin is `pnpm db:seed`, which is idempotent and re-sets that account's password from `SEED_SUPER_ADMIN_*` (ADR-0008). That second path is worth knowing before it is needed.

## Consequences

- The two populations stop being asymmetric about credentials, which removes the class of bug this ADR came from: a rule that holds for `users` and silently not for `staff`.
- A deployment gains a recovery path that does not involve writing an argon2 digest into Postgres by hand.
- Four endpoints now buy argon2 operations from the `AUTH_MAX_CONCURRENT_HASHES` pool that login shares, and the administrative reset buys two per call. This lands squarely in the gap ADR-0020 §Residual risks already names as a missing *category*: "a per-principal budget for expensive routes". This ADR does not close it and deliberately does not half-close it with a fifth limiter; it adds `/admin/profile/change-password` and both `/:id/password` endpoints to the list of routes that will be covered when that category is built. All four require a valid session, and the global limiter caps each caller.
- Requiring the actor's own password on a reset will be reported as friction. It is the intended cost, and the note to keep with it is that it becomes redundant — and should be revisited — the day a real step-up or re-authentication category exists.
- `AUTH_CURRENT_PASSWORD_INVALID` is one more code clients branch on, and one fewer that names a population it no longer belongs to.
- The rank rule is now applied in four places in the staff service. If a fifth arrives, the guard is a candidate for the mount point rather than the function body.

**Amended 2026-08-19 (D2.3).** Two consequences the implementation surfaced, both about rule 1.

_The users module now depends on the staff service._ `POST /api/v1/admin/users/:id/password` has a **staff** actor and a **user** subject, and `usersService` is bound to the `user` population — it cannot verify the caller's own password, because the caller is not one of its accounts. So `staffService` exposes `verifyActorPassword(ctx, currentPassword)`, the same function its own reset uses, and `usersService` takes it as `actors: Pick<StaffService, "verifyActorPassword">` from the container. This is the first cross-module service dependency in `core/container.ts`, and it is the shape [ADR-0009](0009-api-modular-layering.md) prescribes: a module reaches another module through its service, never its repository. The alternative — reading the `staff` table from the users repository — would have put one population's storage inside the other's module for one question.

_The actor is verified before the subject is read._ Rule 1 fixes *that* the actor re-presents their password, not *when*. Doing it first has two properties worth keeping: a wrong actor password answers the same `403` whether or not the id exists, so somebody who cannot use the endpoint cannot use it to enumerate accounts either; and a refused request buys no argon2 hash of a new password it is about to discard, which matters because these routes draw on the `AUTH_MAX_CONCURRENT_HASHES` pool login shares. The rank rule runs second, and the hash third.

_The rank rule needs the transaction, not just the read._ Rule 2 says `assertMayActOnSuperAdmin`, "unchanged, for the same reason it already guards `disable` and `sessions/revoke`" — but `disable` reaches that guard from inside `update`'s transaction, after `lockRoleInvariant`, and a first draft of the reset checked it on the pooled client instead. A rank decision taken against a snapshot the write does not share is not a decision: a target promoted to `super_admin` between the read and the commit has its credential rewritten by a plain `admin`. The reset therefore checks twice — cheaply outside, so a refusal costs no hash, and again inside the transaction after the lock, which is the one that counts. The general form is ADR-0017 §Serialising the invariant: any rule that reads the staff table and then writes it belongs behind that lock.

_The "nothing is left to brute-force" reasoning covers self-service and **not** the reset._ The bullet above says the four endpoints "all require a valid session, and the global limiter caps each caller", and offers that as why no fifth limiter is added. For `change-password` it holds: the caller already holds a session for the account whose password they are guessing, so a successful guess buys the plaintext rather than the account. For `POST /admin/{staff,users}/:id/password` it does not. There the caller presents a password they may well not know — that is the entire point of rule 1 — so the `403` is a clean oracle against the one credential standing between a stolen admin token and every account it outranks, bounded only by ADR-0020's `300 / 15 min / IP` and by argon2's own cost. There is no failure counter, no lockout, and nothing that distinguishes a typo from a hundred attempts.

This ADR still does not build the limiter, and the reason has changed from "not worth it" to "not ours to build": rate limiting is [ADR-0020](0020-security-baseline.md) §Rate limiting, which belongs to shipped D1 and is frozen, so a fifth limiter is a superseding ADR rather than a line of code (ADR-0024 rule 1). What this amendment does is correct the record — the missing per-principal budget is no longer only a *cost* category, it is a brute-force gap against a step-up credential — so that the ADR which builds it knows what it is closing. Until then the operational statement is: an administrative reset is only as strong as the acting administrator's own password, and nothing throttles guesses at it beyond the global per-IP cap.

## Alternatives considered

- **A `password` field on `PATCH /admin/staff/:id`.** One fewer route, and it puts credential rotation on the same request as a name edit, where no guard distinguishes them and an over-broad client `PATCH` can rotate a password by accident. The sub-resource precedent (`/:id/sessions/revoke`) was set for this reason.
- **Administrative reset without the actor's own password.** Simpler, one fewer hash, and it makes a stolen admin access token sufficient for account takeover across the whole staff table. Rejected on that alone.
- **Force a change at next sign-in.** The right end state, and it needs a column, a migration, and a branch in `authenticate` — a schema decision that would arrive half-made if it were bolted on here.
- **Give staff a full `/admin/profile` with email change.** Changing the identifier a session was established with is its own flow with its own verification step, which is why `updateStaffBody` already excludes `email`. Nothing here changes that.
- **Reuse `/api/v1/user/profile` for both populations by making it population-agnostic.** It reads `ctx.principal`, so it looks parameterisable. It sits in the `user` segment, which mounts `authenticate("user")` — serving staff from it would mean a staff token accepted in the user segment, which is the exact cross-population confusion [ADR-0015](0015-route-segments-and-versioning.md) and ADR-0019 §1 separate the segments to prevent.
