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

## `D19.3` — Sign-in: the customer app

**Against the record as it now stands.** The operator's context for this step accepted `D19.2`'s amendments to ADR-0072, and the step was built against the record and plan as they stand after the between-steps decision above: the landing route renders a code's sentence and does not know the resolution rule, so nothing here depends on whether creation reads authority, and `AUTH_FEDERATED_LINK_REQUIRED`'s sentence is left as `D19.2` worded it for `D19.4` to reword. No record moved at this head and none was amended.

**Built.**

- **`@repo/api-client`** gained `startGoogleSignIn` (public segment, JSON body, writes nothing, no segment guard) and `exchangeGoogleSignIn` (public segment, `requireUserSegment`, writes the store on success only). `/auth/google/exchange` joined `COOKIE_TRANSPORT_PATHS`; both paths joined `UNAUTHENTICATED_PATHS`, which by prefix does not catch `D19.4`'s authenticated link start. **The exchange travels with credentials** — the step 3 amendment from `D19.2` — because every request on the instance does (`withCredentials: true`); the package suite asserts it at the wire as MSW's `request.credentials === "include"`, and an isolation run with `withCredentials: false` on that one call failed the assertion (`same-origin`).
- **`VITE_FEATURE_GOOGLE_SIGN_IN`** (default `false`, the API being off until it has a client) through `shared/config` and `FEATURES.googleSignIn`, `apps/customer/turbo.json`'s `build` and `dev`, `apps/customer/.env.example`, `docker/prod/.env.example` with the compose build argument and the Dockerfile `ARG`, a pointer in the root `.env.example`'s Google section, `vitest.config.ts` pinned to the schema default, and `docs/deploy.md`'s Google section as step 4 — the flag's twin on the SPA, which `D19.6` reads as a stranger would.
- **"Continue with Google"** (`features/auth/google-sign-in/continue-with-google.tsx`) under the sign-in card, and under the sign-up card behind both flags: posts `start` with the reader's locale, fences the answer to an `https:` URL, and navigates with `window.open(url, "_self")` — the admin impersonation dialog's choice, so the suite can spy the navigation without a module mock. No Google script; the "G" is inline SVG in Google's four colours, the one literal colour in the app, with the reason written beside it. A refusal renders the catalogue's sentence (`404 ROUTE_NOT_FOUND` against an API without a client).
- **`/auth/google`** (`app/routes/auth.google.tsx`, `pages/auth-google`, `features/auth/google-sign-in/use-google-landing.ts`): guard-free, composes `AuthLayout` itself, `useVerifyEmail`'s twin. `#token=` is struck and exchanged, or held behind "Continue and switch account" when the browser has a session; success lands on `/`. `#linked=google` navigates `replace` to `/account/security` carrying `identityLinked` history state for `D19.5`'s notice. `#error=<code>` renders the errors catalogue's sentence (an unknown code degrades to the fallback) with a link to `/login` — except the callback's `UNAUTHENTICATED`, which renders the screen's own "that sign-in did not work" sentence, because the catalogue's sentence for that code is about a session having ended (§2's `D19.2` precision names it "that sign-in did not work, try again").
- **Copy**: nine `auth:google.*` strings in `en` and `lv`.
- **Tests**: `pages/login/__tests__/login.test.tsx` (flag off and on, start posted with the locale and the URL assigned, the button kept disabled while leaving, the back/forward-cache restore, the `404` sentence, the `https:` fence); `pages/register/__tests__/register.test.tsx` (both flags); `pages/auth-google/__tests__/auth-google.test.tsx` (the fragment struck **before** the exchange, read from inside the exchange's own handler; one exchange under `StrictMode`, with credentials and cookie transport; ask-first; a refused exchange; the pseudo lens on the held state; `#linked=google`; the catalogue sentence for `AUTH_FEDERATED_SIGNUP_CLOSED` with its `/login` link; `UNAUTHENTICATED`; an unknown code; nothing to finish; a token that arrives after mount); `pseudo-locale.test.tsx` walks `/auth/google` anonymous and renders every flagged surface on; the api-client suite's "signing in with Google" block. Isolation runs confirmed the strike, the latch, the late-token latch and the back/forward-cache listener each fail their test when removed. The MSW exchange handler refuses a request without credentials, the way the real endpoint refuses an unbound token.
- **No spec change**: `docs/specs/` covers the API's wire behaviour first and an SPA spec arrives when a step names one; this one does not.

**Size — measured, not raised.** Customer `js` 305932 B (298.8 kB printed) of 317000, `entry` 111318 B (108.7 kB) of 114000, `css` 14004, vendor chunks unmoved. `size-budget.json` records it in a note and moves its baseline to `D19.3`; entry headroom is now 2.7 kB, which `D19.5` is measured against.

**Review — `security-reviewer` and `code-reviewer`, one pass each, no re-review.** Seven findings: three fixed, four logged.

- **Fixed — the ask-first rule could be skipped by a token arriving after mount** (medium, security). The latch was set only for an arrival with a fragment, so a tab on `/auth/google` with nothing to finish, whose address later gained `#token=…` without a reload, would exchange with `signedIn` computed for the first address. The latch is now set on the first run whatever the fragment held; a test navigates a signed-in tab to a token and asserts nothing is spent.
- **Fixed — the button stayed disabled after Back from Google** (low; both reviewers). A `pageshow` listener releases it when `persisted` is true; tested by dispatching both kinds.
- **Fixed, in words — the `identityLinked` history state was described as unshareable** (low, security). The fragment that produces it can be planted, so the comment now says the reader must confirm the provider against the server's identities before claiming a link. **For `D19.5`**: draw the notice only when `identities` lists the provider.
- **Logged — the sign-in screen's `redirect` is not carried through Google** (`code-reviewer`). A person turned away by the guard, or sent from the invitation screen to `/login?redirect=…`, lands on `/` after continuing with Google. The plan says "landing home" and the done-when asserts `/`; carrying a location across a round trip to another origin is a decision of its own. The comment that claimed nothing turned the person away was corrected.
- **Logged — the register page's `userRegistration &&` is unreachable** (`code-reviewer`): the route renders not-found first, so the conjunct documents the record's rule rather than a branch a test can reach; the test's comment now says which of the two it proves.
- **Logged for `D19.4`/`D19.5` — the landing route assumes a sign-in** (`code-reviewer`). Every callback refusal lands here, link refusals included once `D19.4` builds the link start; for a signed-in person whose link failed, the "sign-in did not work" sentence and the `/login` link (which `_auth` bounces home) are wrong. Unreachable today — there is no link start yet.
- **Logged, the security residuals**: a switch through the ask-first confirmation (here and on `/verify-email`) overwrites the refresh cookie without revoking the previous session server-side; and the `https:` fence accepts any host rather than the provider's authorization origin. Either is a decision for a record, not this step.

**The gate — `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`, exit `0`, run twice: before the review and after its fixes, `test` at 0 cached both times.** Figures from the second run:

| Link           | Result                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint`         | 17/17                                                                                                                                                                                |
| `check-types`  | 16/16                                                                                                                                                                                |
| `test`         | 15/15 at **0 cached**. customer **257** (237 at `D19.2`); `@repo/api-client` **55** (51); api 755 unit and 789 integration; admin 534; `@repo/contracts` 245; `@repo/db` 101 and 104 |
| `size`         | 4/4, no budget raised. Customer `js` 298.8 of 309.6 kB, `entry` 108.7 of 111.3 kB; admin unchanged at 353.8 of 371.1 kB                                                              |
| `format:check` | "All matched files use Prettier code style!"                                                                                                                                         |

Beside the gate: `pnpm check` green; `pnpm docs:check` clean (13 spec files). `pnpm test:scripts` has one failure, **"the committed digests are what the generator produces"** (`api-and-data`), which this step did not cause — no record changed here; the digest drifted with `D19.1`/`D19.2`'s status moves and `/ship` regenerates it (ADR-0065, the digests).

**Pending the operator.**

- **Browser-only, not machine-verified**: the button's look (outline, 38px, the colour mark in light and dark), a real Back from Google's account chooser restoring the page with the button live again, and the whole round trip with real credentials — definition of done item 8.
- **Google's branding for the mark**: drawn in Google's colours as its sign-in guidelines ask; if the design would rather a monochrome mark, that is a one-file change and a decision against Google's guidance.
- **The `redirect` logged above**: whether a Google sign-in should return a person to where the guard or the invitation screen was sending them.

## `D19.4` — Credentials: link, unlink, set a password — the API

**The head.** Three records moved to `superseded by` 0072, each a delta with its status line, a paragraph of its own, its index row and the topic table updated, and the ledger's §The window recording it:

- [ADR-0057](../adr/0057-impersonation-sessions.md) — its **fifth** partial successor. §5's list grows the link start, unlink and the set-password link.
- [ADR-0071](../adr/0071-mail-flows.md) — its **first**. §4's reset by mail removes every federated identity, and the reset link gains a session-minted form that keeps them.
- [ADR-0027](../adr/0027-credential-self-service-and-reset.md) — its **second**. The administrative reset removes the identities too.

All five of 0072's parents have now moved. The index diff is again mostly whitespace: 0057's status cell became the widest, so prettier re-padded the table (the `D19.1` precedent).

**Built.**

- **The link.**
  - `POST /user/profile/identities/google/start` (`startLink`) is authenticated and `refuseImpersonated`. It takes JSON only, and it is mounted only when the Google client is configured.
  - It seals `intent: "link"` with the caller's **account and session** into `__Host-<APP_ID>.oidc`. The transaction codec's claims are now a discriminated union, and a link without `uid` and `sid` opens to nothing.
  - The callback's `linkTo` handles the link intent. It refuses with `UNAUTHENTICATED` when the sealed session has been revoked or has expired, is another account's, or was minted by impersonation, and when the account is not `active`.
  - A subject held by another account is `AUTH_IDENTITY_TAKEN`. One the caller already holds is a no-op that still answers `#linked=google`. A second Google account is `CONFLICT`.
  - A successful link writes `account.identity_linked { provider, via: "link" }` and redirects to `302 …/auth/google#linked=google` with the cookie cleared and no token.
- **The resolution (a).** The authority check moved from the head of the resolution to the address match alone. A verified claim nobody holds now creates the account whether or not Google hosts the address, and a held non-authoritative address is still `AUTH_FEDERATED_LINK_REQUIRED`.
  - The API message and the customer app's sentences (`en`/`lv`) are back to offering sign-in and linking.
- **Unlink.** `DELETE /user/profile/identities/:provider { currentPassword }` (users service) is `refuseImpersonated` and mounted whether or not the client is configured. It answers:
  - `409 AUTH_LAST_CREDENTIAL` for an account with no password, before any password is asked for;
  - `403 AUTH_CURRENT_PASSWORD_INVALID` for a wrong password;
  - `404 NOT_FOUND` when nothing of that provider is linked;
  - `204` otherwise, with `account.identity_unlinked { provider, via: "unlink" }`. No session changes.
- **The resets (b).**
  - `resetPassword` (the reset by mail) calls `federated.unlinkAll` in the hash's transaction and writes one `account.identity_unlinked { provider, via: "reset" }` row each, with the account as actor. It keeps the identities only when the claimed token's payload says `requestedBy: "session"` (`requestedBySession`). The staff service has no `federated` dependency, so its reset removes nothing.
  - The administrative `setPassword` calls `repository.unlinkIdentities`. Its rows are in `setEmail`'s shape: the operator is the actor, and `subjectId` is in the data.
  - `change-password` is untouched and removes nothing.
- **The set-password link (c).** `POST /user/profile/password/set-link` is `refuseImpersonated` and answers `202 { accepted: true }`.
  - It mints the caller's own `reset_password` token with `payload: { requestedBy: "session" }` and mails `passwordReset` in the account's locale to its own address.
  - Its limiter is `createSetPasswordLinkRateLimiter`: `RATE_LIMIT_PASSWORD_RESET_MAX` per password-reset window, keyed on the principal, in its own counter (`set-password-link`).
- **Contracts and catalogues.**
  - `@repo/contracts` gains `AUTH_IDENTITY_TAKEN` and `AUTH_LAST_CREDENTIAL`, `identityProviderParams` and `unlinkIdentityBody`.
  - Both apps' catalogues gain the two sentences in `en` and `lv`.
- **Tests.**
  - `federated-identity.int.test.ts` gains the link start and the link intent (including the no-op, `CONFLICT`, `IDENTITY_TAKEN`, and the ended session). It also covers the three unlink answers plus the `404`, and impersonation refusing all three routes while the owner's own session succeeds.
  - It covers the anonymous reset, the administrative reset, `change-password` keeping the identity, and `set-link` keeping it, plus the link start `404` without a client while unlink still answers. The `D19.2` "creates nothing for a non-hosted address" case is inverted.
  - `rate-limit.int.test.ts` gains the set-link limiter.
  - The unit tier covers the link intent's edges and the moved authority check (`auth.federated.service.test.ts`), and the codec's link round trip and its refusal of a link without an account (`transaction.test.ts`).
  - Isolation runs confirmed that the "session ended" and "set-link keeps" integration cases each fail when their check is removed.
- **Specs.**
  - `federated-identity.md`: the creation clause is rewritten, the non-hosted scenario is split in two, and two requirements are new — "An account keeps its ways in under its owner's control" and "A reset recovers the account from every way in".
  - `mail-flows.md` gains two recovery scenarios.
  - `users-and-profile.md`: the administrative reset removes identities, and a change of password keeps them.
- **Postman**: 207 requests and 631 assertions, 0 failed, run twice. Both READMEs are updated; the global-limiter figure is now 191.

**Amendments.**

- **ADR-0072 §3, `Amended 2026-09-11 (D19.4)`** — one rule and four precisions:
  1. **A link completes only while the session that asked is live.** Without this, a link started by a session in somebody else's hands could complete after the owner's reset had ended that session and removed every identity — reopening the class the operator's decision closed.
  2. "CSRF-guarded" on a bearer route is the bearer token (ADR-0029). The double-submit guard would be inert on `/user/profile`, so it is not mounted, and the link start has no limiter of its own.
  3. Unlink's order of answers, and unlink mounted without a client.
  4. The administrative reset's audit shape. It writes no row of its own, so the record's "beside the row it already writes" was inexact.
  5. The set-password link's budget.
- **The plan's step 4, Postman.** The collection never changes a fixture's credentials, and only Google can restore an identity. So the fixture's identity is only read and refused: `me`, a wrong-password unlink, and a read showing it stayed. The run's own account covers the `404`, the link start (either answer) and `set-link`. The `204` unlink and the resets' removal are the integration tier's.

**Review.** The step asks for `security-reviewer` plus one bounded diff review. Both were launched as agents, but their results never reached this session: the agent calls returned asynchronously and the session could not wait on them. On the coordinator's instruction, the bounded pass was **done by the builder over the diff, not by an independent reviewer**. The operator may want an independent `security-reviewer` pass before `/ship`. Findings:

- **Fixed — two spec claims had no test.** The requirement named `#error=CONFLICT` for a second Google account and the no-op re-link; there are now integration cases for both, with matching scenarios.
- **Logged, pending the operator — a stolen session can pre-empt a recovery with `set-link`.** A session in somebody else's hands can link their Google account; that is §3's design, since link needs only the session. The owner then asks `forgot`. Before the owner follows that link, the same session calls `set-link`, whose mint supersedes the owner's anonymous link (ADR-0071 §1's rule). If the owner then follows the newest message, the reset keeps the identities, and the other person keeps signing in by subject.
  - It needs a live stolen session and an owner who follows the second of two identical-looking mails.
  - Closing it is a decision on 0071 §1's supersession rule. For example, `set-link` could decline to supersede a live mailbox-minted link, or a session-minted consume could keep only when no anonymous link was superseded. That is not a build step's to make.
- **Logged — a narrow race between a link callback and a reset.** The link's transaction reads the session as live, and a reset committing in the same milliseconds deletes the identities before the link's insert commits (READ COMMITTED), so the identity survives. Closing it means locking the account row in both transactions, or having the reset revoke sessions before it unlinks.
- **Carried to `D19.5`, from `D19.3`'s log.** Link refusals now reach `/auth/google#error=…`, which renders the sign-in's "that did not work" sentence and a `/login` link. For a signed-in person whose link failed (`AUTH_IDENTITY_TAKEN`, `CONFLICT`, an ended session), the landing route should offer the way back to Security instead. Draw the `#linked` notice only when `identities` lists the provider, as `D19.3` noted.

**The gate — `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.**

- **The first run failed once**, on `apps/admin` `users-manage.test.tsx`, "keeps the operator where they are when the mint is refused". It is a `findByText` that took 4.9 s under the parallel load. This step does not touch the file, and it passed alone (39/39).
- **The second run, and a third after the review's tests, exited `0`.** Figures are from the third:

| Link           | Result                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`         | 17/17                                                                                                                                                                                           |
| `check-types`  | 16/16                                                                                                                                                                                           |
| `test`         | 15/15 at **0 cached**. api **766** unit (755 at `D19.3`) and **805** integration (789); `@repo/contracts` **246** (245); customer 257; admin 534; `@repo/api-client` 55; `@repo/db` 101 and 104 |
| `size`         | 4/4, no budget raised. Customer `js` 298.9 of 309.6 kB, `entry` 108.8 of 111.3 kB; admin `js` 353.9 of 371.1 kB                                                                                 |
| `format:check` | "All matched files use Prettier code style!"                                                                                                                                                    |

Beside the gate: `pnpm check` green; `pnpm docs:check` clean (13 spec files); `pnpm test:postman` 207 requests, 631 assertions, 0 failed, against the dev stack with no Google client.

**Pending the operator.**

- **An independent review.** The bounded pass was the builder's own, as above.
- **The `set-link` supersession finding above**, which is a decision on ADR-0071 §1.
- **Existence signal on a non-hosted address.** Now that creation is open again, a verified but non-hosted claim answers `LINK_REQUIRED` when an account holds the address and creates one when nobody does. This is what the operator's decision accepted; the `D19.2` amendment's "no existence signal" no longer holds, which §1's last amendment implies but does not spell out.
- **Browser-only**: nothing in this step. The SPA half is `D19.5`.

## Between `D19.4` and `D19.5` — the operator's answers to `D19.3` and `D19.4`

Taken on the desktop 2026-09-11 and written into the plan's steps 5 and 6, the definition of done and ADR-0072 §1, §3 and §4 as labelled amendments; no code touched. **From `D19.3`'s log**: the sign-in screen's `redirect` survives the round trip, carried by the SPA under its device key and accepted only as an app-relative path; the mark keeps Google's colours; a link refusal lands on Security with the sentence as a notice, and the `#linked` notice is drawn only when the server lists the provider. **From `D19.4`'s log**: `set-link` is refused `409` while a mailbox-minted reset link is live, so a stolen session cannot supersede a recovery in flight, and the link callback and the reset lock the account row (both built at `D19.5`, its API half); the existence signal an open creation carries is spelled out in §1 and accepted on 0071 §6's terms. **Carried to `D19.6`**: the digests regenerated and `pnpm test:scripts` green before the definition of done, and the logged residuals recorded in §Consequences as accepted. An independent `security-reviewer` pass over `D19.4`'s diff was started from the desktop at the same time; its findings, if any, follow here.

**The independent review of `D19.4` (`security-reviewer`, one pass, read-only, from the desktop).** Three findings and a clean bill on the rest — the payload flag server-written and read off the consumed row, `refuseImpersonated` first on all three routes, consume-then-refuse inside the transaction, the audit actors as §3 names them, no password fact on the admin resource, `set-link` behind its own hourly counter, `strictObject` bodies. **High**: `D19.4`'s own set-link finding is wider than logged — no `forgot` in flight is needed; a stolen session links its own Google account, calls `set-link`, the owner follows what is byte-for-byte the recovery mail, and the consume keeps the intruder's identity while revoking the sessions. **The rule written after `D19.4` (refuse while a mailbox link is live) closed the narrower case and not this one, and is withdrawn unbuilt**; ADR-0072 §3's paragraph is rewritten the same day: `set-link` is for a passwordless account alone, its mint seals the asking session's id, and the consume keeps only identities linked before that session began. **Medium**: the link-versus-reset race, verified; both resets and the link callback lock the account row, as already planned. **Low**: the trail could not tell a session-minted reset from a mailbox one; `account.password_reset` gains `{ requestedBy, unlinked }`. Four residuals named by the reviewer join `D19.6`'s accepted list: unlink as a password oracle under the global limiter alone, the Google round trip spent before the link's session check, a link completed by a browser whose bearer is not the sealed session, and the administrative address change leaving identities in place. All of it is in the plan's step 5 (the API half) and step 6.

## `D19.5` — Credentials: the customer app's sign-in methods, and the API half

**Against the record as it now stands.** Built against ADR-0072 §3 and §4 and the plan's step 5 as `866916b` left them: `7dea7cd`'s "refuse `set-link` while a mailbox-minted link is live" was withdrawn unbuilt and is not in the code. No record moved at this head. The run was interrupted once by an infrastructure stall (no progress for 600 s) with the API half uncommitted in the tree; it resumed from the tree as it stood.

**Built — the API half (e).**

- **`set-link` is for a passwordless account alone.** `requestPasswordSetLink` answers `409 CONFLICT` (`passwordAlreadySet`, the generic code, a stale screen's only way to meet it) when the row has a hash, before anything is minted or mailed.
- **Its mint seals the asking session.** The payload is `{ requestedBy: "session", sessionId: principal.sessionId }`, server-written and read back off the consumed row only.
- **The consume keeps only what is older than that session.** `readResetRequest` replaces `requestedBySession`: anything but exactly `requestedBy: "session"` is the mailbox; a session payload whose id is absent or not a UUID reads as a session that is gone. `removeIdentitiesFor` (auth service) removes every identity for the mailbox, and for a session reads `sessions.findStartedAt` — a narrow probe of its own, revoked rows included — and removes the identities whose `linked_at` is later than its `created_at` (`unlinkLinkedAfter`, the repository's `unlinkIdentities` with a `linkedAfter` bound). A missing row, or one of another principal or population, removes all.
- **The trail.** `account.password_reset` carries `data: { requestedBy: "session" | "mailbox", unlinked: [<provider>…] }` — providers, never subjects; staff resets say `mailbox` and `[]`.
- **The lock.** `users.repository.lockById` (`select … for update`) is `FederatedAccounts.lockAccount`. The link callback takes it **before** it reads the sealed session; the reset by mail takes it after the claim and the `change_email` sweep, before it reads the account; the administrative reset takes it after its `change_email` sweep, before it writes. A link that waits on a reset reads the revocation and refuses; a reset that waits on a link sees, and removes, the identity it committed. Since the review (below), the sign-in callback takes it too — by subject before it touches the identity, and by address before it links — and both resets spend the account's live `federated_login` handoffs after it.
- **Tests.** `federated-identity.int.test.ts`: `set-link` `409` on a password account with nothing mailed; the existing set-link case now also asserts `{ requestedBy: "session", unlinked: [] }`; an identity linked after the asking session began is removed (its `linked_at` is moved past the session on the row — with one provider a passwordless account cannot reach that state by a flow, which is why the record says the first rule suffices today); every identity goes when the session row is deleted; a mailbox reset's row says `{ requestedBy: "mailbox", unlinked: ["google"] }`; and two serialisation cases that hold the account row in a transaction of the suite's own, observe the request waiting in `pg_locks`, then commit what a reset (sessions revoked) or a link (an identity) would have — the callback answers `#error=UNAUTHENTICATED` and links nothing, the reset removes the identity. The impersonation case now asks `set-link` of a Google-only account. `rate-limit.int.test.ts`'s set-link budget nulls the signed-in fixture's hash first. Unit: the link intent locks before it reads the session (`auth.federated.service.test.ts`); the fakes grew `lockAccount`, `unlinkLinkedAfter`, `lockById` and `findStartedAt`. **Isolation**: with the callback's lock commented out, "leaves no identity behind when a link callback waits on a reset of the account" fails (`expected null to be 'UNAUTHENTICATED'`); restored.
- **Specs.** `federated-identity.md`'s reset requirement is rewritten for the three rules and gains six scenarios; `mail-flows.md`'s two recovery scenarios say what the row records and what a session-minted consume keeps.
- **Postman.** The run's own account has a password, so its set-password request is now **"Ask for a set-password link with a password already set"** asserting `409 CONFLICT`; a passwordless account exists only through Google, so the `202` and what its consume keeps are the integration tier's. Counts unchanged: 207 requests, 631 assertions.

**Built — the customer app (a)–(c) and the step's own scope.**

- **The redirect through Google (a).** `relativePath` moved from `_auth.login.tsx` to `shared/lib/relative-path.ts`, one fence for both readers. `ContinueWithGoogle` takes the sign-in screen's `redirect` and, once the start has answered with an `https:` URL, writes it to session storage under `${DEVICE_KEY_PREFIX}.googleRedirect` — or clears the key when the screen has none. The landing hook takes it once, inside the latched effect beside the token (so `StrictMode`'s second run cannot find it gone), re-fences it, and navigates there after the exchange; `/` otherwise. The fragment is never consulted for a location.
- **Link refusals land on Security (b).** A new `returning` status: `#error=` in a browser that held a session at mount navigates `replace` to `/account/security` with `identityLinkRefused: { code }`; the section renders the catalogue sentence as a warning banner (`UNAUTHENTICATED` as its own "linking did not finish" sentence, an unknown code as the fallback). Signed out, the sign-in copy stands.
- **The `#linked` notice (c)** is drawn only when the profile's `identities` list the provider.
- **Sign-in methods** (`features/auth/sign-in-methods`): the password row (Change password, or Set a password → `set-link` → the check-your-mail sentence), the Google row (Link Google → the link start, `https:`-fenced; Unlink → a dialog asking the current password, `403` under the box, `409 AUTH_LAST_CREDENTIAL` as the dialog's sentence, `204` closes and the profile's invalidation takes the row away). A Google-only account is offered no unlink — the row says Google is its only way in. A build without the flag offers no link but still shows, and unlinks, a linked identity. It replaces the old Password card; `password.description` left both catalogues.
- **Set a password first.** While `hasPassword` is false, "Change email" on the profile section and "Delete account" on the security section are replaced by one sentence and the Set a password control; nothing is offered while the profile is loading.
- **The reset's outcome sentence.** The reset now goes through a `useMutation` (`CREDENTIAL_MUTATION`, `errorToast: false`, `meta.success: "auth:reset.done"`), so ADR-0034's handler leaves the sentence on `/login`, where the reset lands: the password is saved, and Google _may_ have been unlinked — link it again from Security.
- **Entity and mocks.** The profile API is typed `UserProfileResource` and gains `requestPasswordSetLink`, `startGoogleLink`, `unlinkIdentity`, with three hooks; the MSW profile handlers carry `hasPassword`, a nullable password, and the three endpoints in the API's order.
- **Copy**: about thirty strings in `en` and `lv` (`profile:methods.*`, `profile:outcomes.identityUnlinked`, `auth:google.returning`, `auth:reset.done`).
- **Tests.** New `pages/account/__tests__/security.test.tsx` (15): the three states, the flag, set-link and its refusal, the link start, the notice on arrival, the unlink dialog's `403`, `409` and `204`, and the three ceremonies absent with the sentence present while `hasPassword` is false and present when true (profile, security, deletion). `login.test.tsx` (+5): the redirect stored and landed on, cleared when the screen has none, `https://…` and `//…` land on `/`, nothing stored lands on `/`. `auth-google.test.tsx` (+4): the notice with and without the provider listed, `AUTH_IDENTITY_TAKEN` and `UNAUTHENTICATED` reaching Security as notices. `reset-password.test.tsx` (+1): the outcome sentence on `/login`. `pseudo-locale.test.tsx` (+2): `/account/profile` and `/account/security` walked again as a Google-only account.

**Amendment.** The plan's step 5, `Amended 2026-09-12 (D19.5)`: "when `me` lists the provider" reads the profile's `identities` (the customer app never calls `me`; §4 says "the server's `identities`"), and the reset-password success copy is the reset's outcome sentence on `/login`, worded "may have been unlinked" because a session-minted consume keeps what is older than its session.

**Size — measured, not raised.** Customer `js` 309767 B (302.5 kB printed) of 317000, `entry` 111879 B (109.3 kB) of 114000, `css` 14026; vendor chunks unmoved to the byte. `size-budget.json` records it and moves its baseline to `D19.5`. Headroom: entry 2.1 kB (1.9%), js 7.1 kB (2.3%).

**Review — `security-reviewer`, one pass over the diff, waited on directly; no re-review.** Each of the diff's eight claims was checked against the code and holds. Four findings, all fixed; one test caveat and two residuals logged.

- **Fixed — a Google handoff outlived a reset** (high; adjacent to this step rather than introduced by it). The resets swept sessions and identities but not a live sixty-second `federated_login` token, and a sign-in by subject that found its identity just before a reset committed went on to mint one after it: the person the reset recovers the account from signs in a moment later and may re-link. Both resets now supersede the account's `federated_login` tokens, after the account lock — the order a sign-in takes, account then handoff, so the two cannot deadlock. The sign-in by subject takes the account lock and refuses `UNAUTHENTICATED` when `touchLogin` (which now returns whether it touched a row) finds the identity gone; the by-address link takes the lock before it inserts, for the link callback's reason. Two integration cases: a handoff minted before a reset answers the exchange `401`, and a sign-in by subject that waits on a reset removing its identity answers `#error=UNAUTHENTICATED` with no token. **Isolation**: with the reset's `federated_login` supersede disabled, the first fails (`expected 401, got 200`); restored. `federated-identity.md` gains the scenario and says the resets spend handoffs.
- **Fixed — two clocks** (low). `linked_at` was the API's `at` and `sessions.created_at` the database's `now()`, so a skewed API host could misorder a link and the session that asked. `linkIdentity` no longer writes `linked_at`; the column's database default stamps it, one clock for both sides of the comparison.
- **Fixed — raw control bytes in the fence** (low). Moving `relativePath` to `shared/lib` wrote the `\u0000-\u001f` range as literal bytes, so git read the file as binary, and an editor stripping NULs would have reopened the `/<TAB>/evil.com` bypass. The escapes are back, and every changed file was scanned for control bytes: clean.
- **Fixed — a lock cycle with the address change's confirm** (low; the order predates this step, and the lock made it longer). The confirm claims its `change_email` row and then writes the account, while both resets held the account and then swept `change_email`. Both now sweep `change_email` **before** the account lock. The partial order is: the `reset_password` claim, the `change_email` rows, the account row, the `federated_login` rows.
- **Logged — the "reset waits on a link" case does not prove the reset's own lock.** `updatePasswordHash` already waits on a held row before the identities are removed, so that case shows the two serialise, not that the reset's lock is needed. The callback-waits case does prove the callback's lock (isolation above).
- **Pending the operator — residuals for ADR-0072 §Consequences (`D19.6`):**
  1. **§3's "keeps it sufficient when a second provider arrives" does not hold as written.** With two providers, an intruder on a passwordless account links provider B, signs in through B to get a session younger than that link, and asks for the set-password link from that session; B is older than the asking session and is kept. And `set-link` supersedes a live `forgot` link with a byte-identical mail, so the intruder can quietly turn the owner's mailbox recovery into a session-minted one. Unreachable today (the `409` rule and one identity per provider). Before a second provider, the rule has to trace which identity a session was minted through.
  2. A password sign-in that verified the old password just before a reset commits can still issue a session after it — the handoff finding's shape on the password path, and older than D19.

**The gate — `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`, run after the review's fixes.**

| Link           | Result                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`         | 17/17                                                                                                                                                                                                                                        |
| `check-types`  | 16/16                                                                                                                                                                                                                                        |
| `test`         | 15/15 at **0 cached** (6 min). api **767** unit (766 at `D19.4`) and **813** integration (805); customer **284** (257); admin 534; `@repo/contracts` 246; `@repo/api-client` 55; `@repo/db` 101 and 104                                      |
| `size`         | 4/4, no budget raised. Customer `js` 302.5 of 309.6 kB, `entry` 109.3 of 111.3 kB; admin unchanged at 353.9 of 371.1 kB                                                                                                                      |
| `format:check` | **Red on one file this step did not write**: `Claude outputs/data-model-and-quote-flow.md`, untracked, which appeared in the working tree at 00:34 from another session. Left untouched and uncommitted; with it excluded, every file passes |

The full gate run before the review was green on all five links; the stray file did not exist yet. Beside the gate: `pnpm check`'s links green; `pnpm docs:check` clean (13 spec files); `pnpm test:postman` 207 requests, 631 assertions, 0 failed, against the dev stack with no Google client. That run was before the review's fixes, none of which touches a request the collection makes. `pnpm test:scripts` was not run: the digest drift `D19.3` logged is `D19.6`'s first item.

**Pending the operator.**

- **The stray `Claude outputs/` folder** turns `format:check` red in this working tree. It is not in the commit.
- **The two residuals above**, for `D19.6`'s accepted list. The first is a correction to §3's last amendment rather than a cost.
- **Browser-only, not machine-verified**: the Sign-in methods card's layout in the 720px pane and on a phone (the row wraps its control under the label), the Google mark's size in the row, the two banners in light and dark, and the whole link, unlink and set-a-password walk with real credentials (definition of done item 8).
