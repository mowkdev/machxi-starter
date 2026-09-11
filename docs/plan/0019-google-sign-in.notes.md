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
