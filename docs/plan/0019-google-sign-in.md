# D19 — Sign in with Google

- Status: **planned** — a row with its decisions, not yet a plan. Scoped in full by `/scope D19` when [D18](0018-mail-flows.md) ships, because its linking rule leans on D18's invariant that every active user has a verified address (ADR-0071 §3). Built before D16, whose row says "built last".
- Records: none yet — `/scope D19` writes the federated-identity record, a delta on ADR-0017 (an identities table) and on ADR-0057 §5 (linking and unlinking join the exclusions).
- Ledger: [`docs/plan/README.md`](README.md)

## Decisions taken at scoping (operator, 2026-09-09 and 2026-09-10)

- **Users only.** Staff get no Google sign-in in this deliverable; the question of how a staff row is matched to a Google account is left for its own row.
- **Linking only to a verified address.** A Google identity attaches to an existing local account only when that account's address is verified — which, after D18, is every active account — and to nothing else; a new account created by Google counts as verified from Google's claim. This is why D19 waits for D18.
- **The issuer is stubbed in unit tests only.** No mock OpenID container and no dev-only issuer route; the provider client is tested against a stubbed issuer and the UI in jsdom, and the browser tier does not drive the flow.
- **Plain OpenID Connect with PKCE, verified with `jose`, no new auth library.** The callback lands on the API as a navigation, so it mints a single-use handoff and redirects the customer app to a fragment URL that is exchanged on cookie transport — the impersonation handoff's shape (ADR-0057 §2), which keeps ADR-0029's cookie discipline untouched.

## Shape sketched at scoping, to be decided by the record

A `federated_identities` table on the `sessions` discriminator shape; the start, callback and exchange endpoints on the public segment behind a limiter; the button on the customer app's login and register screens behind a `VITE_` flag; "set a password" for a passwordless account and a connected-accounts section with unlink that refuses to remove the last credential.
