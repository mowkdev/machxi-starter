# D19 — Sign in with Google: build notes

The per-step build record of [D19](0019-google-sign-in.md) — what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator — kept apart from the executable plan so a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## `D19.1` — Accept ADR-0072; the table, the enums, the config, the port

**The head.** [ADR-0072](../adr/0072-federated-identity-google-sign-in.md) moved `proposed` → `accepted` and [ADR-0017](../adr/0017-identity-model-populations-and-roles.md) moved to `superseded by` — its **third** partial successor, beside 0067 and 0071 — with the delta stated on its status line and in a paragraph of its own. [0029](../adr/0029-browser-token-transport.md) (at `D19.2`) and [0057](../adr/0057-impersonation-sessions.md) (at `D19.4`) are untouched, the `D10.5` precedent. The ADR index gained a topic row for federated identity, both record rows were updated, and the "no window is open" sentence D18's close left in the index conventions was replaced; the ledger's §The window records the acceptance and the two amendments below.

**Built.**

- **`federated_identities`** (`packages/db/src/schema/federated-identities.ts`): a real foreign key to `users` (cascade), `provider`, `subject`, an informational nullable `citext` `email`, `linked_at`, `last_login_at`; named unique constraints on (`provider`, `subject`) and (`user_id`, `provider`), the second leading with the reference so it doubles as the foreign key's index.
- **The two enums, declared once** in `@repo/contracts`. `FEDERATED_PROVIDERS = ["google"]` feeds `pgEnum("federated_provider")` and `z.enum`. `federated_login` is appended to `TOKEN_PURPOSES`.
- **Two migrations, not one.** `0015_token_purpose_federated_login` holds the `ADD VALUE` alone, because ADR-0060 §5 requires that migration to ship alone and `migrate()` runs every pending file in one transaction. `0016_federated_identities` holds the rest. Both are generated, and each carries a header comment on what it locks.
- **The enumerations grown**: `TRUNCATED_TABLES`, `RESTRICTED_SCHEMA_TABLE_IMPORTS` and the lint enum list. `schema.int.test.ts`'s exact table, enum and `citext` lists grew with them.
- **The `federated_login` TTL** is in the composition root's total `Record<TokenPurpose, number>` as `config.tokens.federatedHandoffTtlSec`. The `TOKEN_PURPOSES` loops in `users.service` and `staff.service` now also supersede a live handoff on an address or password change, which is the safe direction.
- **Config**:
  - `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` must be set together or not at all, and a blank value reads as absent. `config.federated.google` is present only when both are set, which is the routes' whole precondition.
  - `API_PUBLIC_URL` is a bare origin. It is refused in production at a loopback or plain-http value, by the app URLs' own parsed check.
  - `FEDERATED_HANDOFF_TTL` defaults to 60s, with the impersonation handoff's 5m ceiling.
  - All of these are in `.env.example`, `apps/api/.env.test` (placeholder client), `docker/prod/.env.example`, `docker/prod/compose.yaml` (`${API_PUBLIC_URL}` with no fallback, the Google keys bare) and a new **Sign in with Google (optional)** section of `docs/deploy.md`. That section states the console's redirect URI once.
- **`core/oidc`**:
  - The `OidcProvider` port.
  - `createAuthorizationRequest`, which draws three `randomToken(32)` values.
  - `createGoogleOidcProvider`:
    - Discovery is cached only on success. The document must name the issuer it was fetched for, and all three endpoints must be `https`.
    - PKCE `S256`, with the challenge proved against RFC 7636's own vector.
    - `client_secret_post`.
    - `jose` `jwtVerify` checks `iss`, `aud`, `exp`, `iat` and `sub` and allows RS256 only. Google's documented bare-host issuer is accepted for Google alone.
    - `nonce` and `azp` are checked by hand.
    - Every failure is returned as a value, with a named reason.
  - `createFakeOidcProvider`, which enforces PKCE, the nonce and single-use codes, so a flow that threads the wrong value fails against it as it would against Google.
- **Logger**: `clientSecret`, `codeVerifier` and `idToken` are redacted ahead of use, as `link` was.
- **Dev seed** `104-dev-federated-identities`: one Google identity on `customer@machxi.local`. Its subject is deliberately non-numeric, so no real Google `sub` can resolve to the fixture on a clone configured with real credentials. The account keeps its password.

**Amendments — two, both to ADR-0072 §1, both on this step's reviewers, and one plan amendment that inherits them.**

- **Linking by address requires the provider to be _authoritative_ for the address** (`security-reviewer`, medium). §1 read `email_verified: true` as proof of control today. Google documents it as that only for an address Google hosts: `gmail.com`/`googlemail.com`, or a Workspace address whose `hd` is its own domain. For any other address Google checked the mailbox once, when the Google account was made. The port now reports `emailAuthoritative` beside `emailVerified`, computed from `hd` in the adapter. §1's second condition becomes four, and a verified but non-authoritative address held by a live user is refused `AUTH_FEDERATED_LINK_REQUIRED`, to be linked from the security section instead. Creation is unchanged.
  - **This is a decision taken in the window on a reviewer's finding, the `D18.4` precedent, and it is flagged for the operator below.**
- **Deleting an account deletes its identities** (`code-reviewer`). "The row outlives nothing it should not" was true of the foreign key and missed the constraint: (`provider`, `subject`) has no predicate, so an identity on a soft-deleted account would hold the Google account for ever. `users.repository.softDelete` now hard-deletes the rows on the same executor, which covers both deletion paths. Each path has an integration test, and `docs/specs/users-and-profile.md` states it on both requirements with a new scenario.
- **The plan's step 2 is amended**, labelled, to carry both: the `AUTH_FEDERATED_LINK_REQUIRED` code and its scenario, and address-match scripted with `emailAuthoritative: true`.

**Review — `security-reviewer` and `code-reviewer`, one pass each, no re-review.** Seven findings across the two. Six were fixed and one declined in part.

- **Fixed — `email_verified` alone was read as current control of a non-Google address** (medium, `security-reviewer`). This is the amendment above: the adapter reads `hd`, and the tests cover gmail, googlemail, a matching `hd` (case-insensitive), a mismatched `hd`, a look-alike `gmail.com.example.org`, and unverified gmail.
- **Fixed — a token with several audiences and no `azp` was accepted** (low, `security-reviewer`). `jose` passes any list containing our id. It is now `claims_invalid` unless `azp` names us, and a test covers each way round.
- **Fixed — the fake defaulted `emailVerified` to `true`** (low, `security-reviewer`), the opposite of the real adapter's reading of an absent claim. `emailVerified` and `emailAuthoritative` are now both required on `FakeOidcClaims`.
- **Fixed — a deleted account held its Google subject for ever** (`code-reviewer`). This is the second amendment above.
- **Fixed — two tests asserted less than their names** (`code-reviewer`). `result.ok && …emailVerified` is falsy for a refusal too. Both now assert `toMatchObject({ ok: true, identity: { emailVerified: false } })`, and the malformed-address case also asserts `email: undefined`.
- **Fixed — a malformed `email_verified` refused the whole token as `claims_invalid "subject"`** (`code-reviewer`). Every claim but `sub` and `aud` now falls back with `.catch(undefined)`, and the log detail is `claims`. `null` and `1` are tested.
- **Fixed — the acceptance note cited §5 for the enumerations** (`code-reviewer`). §5 is "What stands". It is reworded in the record's header and in its index row.
- **Also taken, from the security residuals, as notes for `D19.2` rather than code:**
  - The container must never choose the fake by configuration. A lint restriction outside tests would enforce that.
  - The `federated_login` exchange must re-read the principal and refuse a non-`active` one, because a disable does not supersede live handoffs. The `verify-email` consume already has this shape.
  - The access log strips query strings (`core/middleware/http-logger.ts`), so the callback's `?code=&state=` never reaches a log line. The reviewer checked this.
- **Logged, not changed:**
  - `isLocalOrInsecureAppUrl` knows three loopback spellings. It predates this step, and `https` is required anyway.
  - Discovery is trusted for the life of the process, with the key-set host not pinned to Google's.

**The gate — `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`, exit `0`, run twice: before the review and again after its fixes.** Figures are from the second run:

| Link           | Result                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`         | 17/17                                                                                                                                                                                                                      |
| `check-types`  | 16/16                                                                                                                                                                                                                      |
| `test`         | 15/15 at **0 cached**. api **735** unit (695 at D18's close) and **758** integration (756); admin 534; customer 237; `@repo/contracts` 242; `@repo/db` **101** unit and **104** integration (92 and 97); `@repo/logger` 19 |
| `size`         | 4/4, unchanged. No SPA byte moved: customer `js` 295.3 of 309.6 kB, admin 353.4 of 371.1 kB                                                                                                                                |
| `format:check` | "All matched files use Prettier code style!"                                                                                                                                                                               |

Beside the gate:

- `pnpm check` green.
- `pnpm docs:check` reports the inherited documents clean and the behaviour specs clean (12 files).
- **The dev database is migrated** to `0016`: 17 journal rows, and `token_purpose` ends in `federated_login`. `pnpm db:seed -- --dev` was run twice with identical output, and `federated_identities` holds the fixture once.

**Spec.** `users-and-profile.md` changed because account deletion now deletes identities, on both requirements. Nothing else on the wire moved: the routes, `me`'s new fields and `docs/specs/federated-identity.md` are `D19.2`'s.

**Pending the operator.**

- **The authoritative-address amendment (ADR-0072 §1).** It narrows the operator's scoping decision "linking only to an `active` account" by one condition. Its cost is that a person whose Google account uses a non-Google, non-Workspace address, and who already has an account here, cannot link on first sign-in. They sign in with their password and link from the security section (D19.4). The window is open, so reverting it is an in-place edit before `D19.2` builds the resolution. Accepting it needs nothing.
- **`API_PUBLIC_URL` is required in production whether or not Google is configured.** The record says "refused at that value in production the way `CUSTOMER_APP_URL` is", and it was built as written. A deployment upgrading past this commit must set it or the API refuses to start. `docs/deploy.md` and `docker/prod/.env.example` say so.
- **The ADR index diff is mostly whitespace.** The 0017 topic row became the widest cell, so prettier re-padded the whole topic table.

## `D19.2` — Sign-in: start, callback, exchange — the API

**The head.** [ADR-0029](../adr/0029-browser-token-transport.md) moved to `superseded by` 0072. This is its **third** partial successor, beside 0056 and 0064. The delta is the `__Host-<APP_ID>.oidc` cookie; the transport of sessions and both CSRF cookies stand. The status line, a paragraph of its own, both index rows, the topic table and the ledger's §The window record it. [0057](../adr/0057-impersonation-sessions.md) waits for `D19.4`.

**Built.**

- **Three routes on the public segment**, `/auth/google/{start,callback,exchange}`. The public router mounts them only when the container built the controller, which it does only when `config.federated.google` is present. Without the client, all three answer `404 ROUTE_NOT_FOUND`.
- **`core/oidc/transaction.ts`** is the cookie's codec: an HS256 JWT under `JWT_ACCESS_SECRET` with audience `<APP_ID>-oidc`, a `k` claim, and short claim names. It has two kinds of value:
  - the **transaction** (`state`, `nonce`, verifier, `intent: "signin"`, locale), ten minutes;
  - the **handoff binding** (the token's SHA-256), sixty seconds.

  Neither kind opens as the other. An access token does not open as either, and neither verifies as an access token; both directions are tested.

- **`auth.federated.service.ts`** holds the start and the callback.
  - The callback opens the cookie and compares `state` in constant time **before** anything reaches the provider.
  - It redeems the code with the cookie's verifier and nonce, then resolves per §1 inside one transaction, with the handoff mint in that same transaction.
  - Refusals are thrown `AppError`s inside the transaction, so a refusal after a write rolls back, and one catch turns them into `{ ok: false, code }`. `INTERNAL_ERROR` and anything that is not an `AppError` propagate to the error handler.
- **`auth.federated.controller.ts`**:
  - The callback writes exactly one `Set-Cookie`: a clear on refusal, the binding on a sign-in.
  - The redirect goes to `${CUSTOMER_APP_URL}/auth/google#…`, with the origin taken from configuration only.
  - The exchange checks the binding, clears the cookie, then calls `userAuth.exchangeFederatedHandoff`. That function claims the token, re-reads the account and **requires `active`** (the D19.1 carry-forward), issues the session and stamps the login, all in one transaction.
- **`respond.redirect`** is the one non-envelope answer a controller may give. The oidc cookie writers live in `auth.cookies.ts` beside the others.
- **Limiters.** `federatedStart` and `federatedCallback` are both `createTokenRouteRateLimiter`: login's number, keyed on the source, each in a counter of its own.
- **The fake is never chosen from configuration** (the D19.1 carry-forward).
  - `ContainerDeps.oidc` is the only door. `main.ts` passes nothing, and `container.ts` does not import the fake.
  - A `no-restricted-syntax` rule in `@repo/eslint-config/api` refuses `createFakeOidcProvider` anywhere in `src/` outside tests, `core/http` included. It catches imports, member access and destructuring, and was verified on probe files.
  - `createTestApp` hands the container a fake built from the configuration's client id and redirect URI, and exposes its `consent`.
- **`@repo/contracts`**:
  - two codes, `AUTH_FEDERATED_SIGNUP_CLOSED` and `AUTH_FEDERATED_LINK_REQUIRED`;
  - `federatedStartBody`, `federatedExchangeBody`, and `federatedCallbackQuery`, whose every field falls back to `undefined` so the callback never answers a JSON 400;
  - `FederatedStartResource`, `FederatedIdentityResource`, and `UserProfileResource` (`hasPassword`);
  - `UserResource.identities`, and `UserPrincipalResource.hasPassword?` / `identities?` (on `me` only).
- **Resources.**
  - `/user/profile` answers `hasPassword` and `identities`, and so does the user segment's `me`.
  - The admin user resource carries `identities` with no password fact.
  - Identities are read with one statement per page (`users.repository.identitiesOf`), not joined into the principal read that login and refresh use.
- **Audit.**
  - Creation writes `account.verified { provider }` and `account.identity_linked { provider, via: "signup" }`.
  - A link by address writes `account.identity_linked { via: "address" }`.
  - The subject is never in the details.
- **Both apps' catalogues** gained the two codes in both locales. The customer app's `js` moved from 295.3 to 295.7 kB of 309.6, and `entry` is 108.4 of 111.3. No budget was raised.
- **Postman**: `Public › Start a sign-in with Google` accepts either answer — `404 ROUTE_NOT_FOUND` on a default clone, or `200` with the cookie. There are now **199 requests and 606 assertions**; a configured API runs one more. Both READMEs are updated.
- **Specs**:
  - `docs/specs/federated-identity.md` is new, with three requirements.
  - `auth-sessions.md` covers the passwordless login case and `me`'s two fields.
  - `users-and-profile.md` covers the profile's `hasPassword` and `identities`, and the admin resource's `identities`.
  - The specs README gains a row.

**Amendments — six to ADR-0072 in place, labelled, plus one to the plan.**

- **§2, precision (in the build).** It now names the code for each refusal §1 did not name:
  - `UNAUTHENTICATED` when the browser did not start this callback, the person declined, the code or token was bad, or the claim was unverified — the last answered alike whether or not an account holds the address;
  - `SERVICE_UNAVAILABLE` when the provider is down;
  - `CONFLICT` when a race was lost, or the account already has a different Google identity.

  The catalogue grows by §1's two codes alone.

- **§3, precision (in the build).** "What registration writes" means `account.verified` plus `account.identity_linked`, as above.
- **§1, on the `security-reviewer` (medium): creation reads authority too.** The D19.1 amendment left creation on a verified claim alone, and said a wrongly owned address "is recovered by its mailbox, through the reset link". The reviewer showed that does not hold: a reset leaves the identity in place, so whoever held the mailbox before keeps signing in by subject.
  - A verified address that Google does not host now neither links nor creates. It is refused `AUTH_FEDERATED_LINK_REQUIRED` **whether or not an account holds it**. The check runs before the address lookup, which also removes the existence signal between `LINK_REQUIRED` and `SIGNUP_CLOSED`.
  - Both apps' sentences now also offer registering with a password.
  - **Flagged for the operator below.**
- **§2, on the `security-reviewer` (medium): the handoff is bound to the browser.** Before this, the token was a relayable bearer credential: someone could run the flow in their own browser, lift `#token=`, and send a victim to the landing route, which signs a browser that has no session into the relayer's account.
  - The callback now leaves the handoff binding in the cookie, and the exchange refuses an unbound token before spending it.
  - The plan's step 3 is amended, labelled: the landing route's exchange must travel with credentials.
- **§2, on the `security-reviewer` (low): the callback has a limiter.** The sealed transaction is single-use only in an honest browser, and each replay with invented codes is a request to Google's token endpoint. This replaces "no limiter beyond the global one".
- **§2, on the `security-reviewer` (low): the start takes JSON only.** A cross-site `text/plain` form reached the start as `{}` and overwrote a victim's in-flight transaction. It now gets `400 VALIDATION_ERROR` and no cookie.

**Review — `security-reviewer` and `code-reviewer`, one pass each, no re-review.** There were nine findings. Eight were fixed and one was logged; the reviewer's two residual risks are logged beside it.

- **Fixed — relayable handoff** (medium, security). This is the binding amendment above. Tests: the codec's binding cases, an exchange with no binding or another sign-in's binding answers `401`, and the token stays spendable afterwards.
- **Fixed — creation on a non-authoritative address was a pre-hijack** (medium, security). This is the creation amendment above. Tests: an unknown lapsed-domain address answers `LINK_REQUIRED` with no row, and a unit case shows the lookup never runs.
- **Fixed — unlimited callbacks with a replayed cookie** (low, security). The `federatedCallback` limiter, with an integration case.
- **Fixed — no preflight on the start** (low, security). JSON only, with an integration case.
- **Fixed — gaps in the lint rule** (low, security). `core/http` had lost the rule to the test override, and destructuring was not caught. Both are covered now, verified on probes.
- **Fixed — nothing proved the rollback after a write** (`code-reviewer`). A unit case: `createFederated` succeeds, `link` loses the race, the outcome is `CONFLICT`, the organization call received the transaction, and the transaction rolled back.
- **Fixed — the rate-limit test's second half could not fail** (`code-reviewer`). It now asserts the invitation lookup — the same number and key — is not `429` after the start's `429`. The spec was reworded to match.
- **Fixed — the "did not start" scenario claimed more than its tests showed** (`code-reviewer`). The declined case asserts the cookie is cleared, and the missing-cookie case asserts no user row.
- **Logged — a Google-only account cannot delete itself or change its address** (`code-reviewer`). Both demand the current password, and the answer is a misleading `403 AUTH_CURRENT_PASSWORD_INVALID`. ADR-0072 §5 keeps the current-password rule, so this is deliberate by inheritance, but nothing says so. It belongs to `D19.4`/`D19.5`: the security section should say "set a password first" while `hasPassword` is false, or the record gains one sentence.
- **Logged, the security residuals:**
  - `AUTH_EMAIL_UNVERIFIED` sends the rightful owner of a pending pre-registered address toward its verification mail, which activates the password someone else chose. This is ADR-0071 §Alternatives' pre-registration primitive, reached through a second door. Closing it — an expiry on pending registrations, or verification asking for a fresh password — needs a record of its own.
  - The transaction and binding tokens share `JWT_ACCESS_SECRET` with the access tokens. That is safe while every verifier pins its audience, and it does (tested both ways). A derived key, such as HKDF with an `oidc` label, would make the separation structural.

**The gate — `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`, exit `0`, run twice: before the review and again after its fixes, the second time at 0 cached.** Figures are from the second run:

| Link           | Result                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`         | 17/17                                                                                                                                                                                     |
| `check-types`  | 16/16                                                                                                                                                                                     |
| `test`         | 15/15 at **0 cached**. api **755** unit (735 at `D19.1`) and **789** integration (758); admin 534; customer 237; `@repo/contracts` **245** (242); `@repo/db` 101 unit and 104 integration |
| `size`         | 4/4, no budget raised. Customer `js` 295.7 of 309.6 kB (295.3 at `D19.1`), `entry` 108.4 of 111.3 kB; admin `js` 353.6 of 371.1 kB                                                        |
| `format:check` | "All matched files use Prettier code style!"                                                                                                                                              |

Beside the gate:

- `pnpm check` green.
- `pnpm docs:check` reports the inherited documents clean and the specs clean (13 files).
- `pnpm test:postman` against the dev stack (no Google client) ran **199 requests and 606 assertions with 0 failed**.

**Pending the operator.**

- **Creation now reads authority (ADR-0072 §1, amended at `D19.2`).** This narrows the scoping decision "creation where self-registration is open" by one condition. The cost: a person whose Google account uses a non-Google, non-Workspace address cannot make an account here through Google. They register with a password and link Google from the security section (`D19.4`/`D19.5`). The benefit: an account can no longer be pre-hijacked through a mailbox's previous holder, and the refusal no longer says whether the address has an account. The window is open, so reverting is an in-place edit.
- **The exchange now needs the browser's cookie (ADR-0072 §2, amended).** `D19.3` must send the exchange with credentials. The plan's step 3 carries this.
- **The callback's `429` is JSON, not a redirect.** It is the one non-redirect answer on that route, and a person following their own sign-in never meets it.

## Between `D19.2` and `D19.3` — the operator's answer

**The `D19.2` narrowing of creation is withdrawn, at `D19.4`.** The step paused on its own flag: creation had been made to read the provider's authority, which turned every Google user on a non-Google, non-Workspace address away from the sign-up button. The operator's reading, taken on the desktop 2026-09-11 and recorded in [ADR-0072](../adr/0072-federated-identity-google-sign-in.md) §1 and §3 as labelled amendments: the finding is real and the fix closes one instance of a class — an identity that survives a password reset — while §3's explicit link reopens it for any Google account, so `D19.4`'s reviewer would have met it again. The class is closed at its root instead: a reset by mail and the administrative reset remove every federated identity (a delta on 0071 §4 and 0027, both moving at `D19.4`'s head); "Set a password" becomes a session-minted reset link whose consume keeps them; a passwordless account sets one before the three current-password dialogs open. Creation returns to any verified address wherever registration is open. The code keeps `D19.2`'s behaviour until `D19.4`, and `D19.3` is untouched — the landing route renders codes. The plan's steps 3, 4 and 5 and the definition of done carry the amendments; the two residuals `D19.2` logged (the pending pre-registration door, the shared signing key) stand as logged.
