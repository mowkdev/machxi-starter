# D13 — Customer impersonation

> **Renumbered from D12 on 2026-08-29**, when the design foundations and account area ([D11](0011-design-foundations-and-account-area.md)) were inserted ahead of the customer app — a ledger decision, the D5 precedent; see `docs/plan/README.md` §How D11 was inserted.

- Status: **in progress** — opened 2026-09-01, the day D12 shipped; scoped by `/scope` the same day
- Records: [ADR-0057](../adr/0057-impersonation-sessions.md) (impersonation sessions; accepted at `D13.1`'s head, where ADR-0018 and ADR-0052 take deltas) and [ADR-0058](../adr/0058-append-only-audit-log.md) (the append-only audit log; accepted at `D13.2`'s head) — both written `proposed` at scoping; a step whose ADR is still `proposed` is gated
- Ledger: [`docs/plan/README.md`](README.md)

## Goal

Staff open the customer app **as a chosen customer**: an admin-guarded mint produces a one-time handoff token, the customer app exchanges it for a `user`-population session that records the impersonating staff id, carries a fixed end and refuses the takeover-enabling operations, and every impersonated request is attributable — in the logs and in a new append-only audit table. The customer app shows an unremovable banner naming both identities with one exit; the admin app grows the entry point on the user row. The design is ADR-0057's; the audit mechanism is ADR-0058's.

## Constraints

- **`security-reviewer` runs on every step of this deliverable**, not just the PR gate — this is the feature the agent exists for. A BLOCKER stops the step.
- The mint sets no cookies and the exchange sets only the user population's (ADR-0056 as inherited; ADR-0057 §1/§3) — the staff session is never touched by the flow.
- The impersonation fact lives on the session and reaches the client on the principal resource — never a URL parameter, `localStorage` or app state (ADR-0057 §4; the handoff fragment is the one-time credential, not the fact).
- The exclusion list is enforced in the API by named middleware, and the customer app renders the refusal like any other (ADR-0057 §5; ADR-0042's posture).
- Ordinary sessions are untouched: every ADR-0018 behaviour outside the two named deltas must show no diff in behaviour or tests (ADR-0057's supersession terms).
- The gate is five links from `D13.1` on: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` (ADR-0057 §8).

## Decisions taken at scoping (operator, 2026-09-01)

- **Audit is an append-only table** (ADR-0058), not structured logs alone — the bigger of the two options, chosen knowingly.
- **A pre-existing real customer session in the minting browser**: the exchange overwrites its cookies and leaves its session row alive — other devices unaffected, this browser signs back in afterwards.
- **Settings writes are allowed under impersonation**, audited; the exclusion list stays exactly the takeover-enabling operations.
- The 2026-08-20 assumption — **full access minus credential operations** — is confirmed.
- The row opened at scoping (this file's status), the D12 same-day rhythm.

## Inherited from D12's close (2026-09-01) — where each lands

- **Settings-query eviction on principal change** → `D13.6`, before the banner work as assigned.
- **`format:check` as the gate's fifth link** → ADR-0057 §8, built at `D13.1`.
- **Unknown-error-code degradation** (D12 finding 3) → `D13.1`, because ADR-0057 §5 adds a code an already-shipped bundle could meet.

## Steps

Each step: implement, gate green, one bounded diff review **plus `security-reviewer`**, commit (ADR-0050). ADRs listed are what the builder reads first.

- [ ] **1. Accept ADR-0057; the fifth link; the unknown-code fix.** Accept 0057 at the head (ADR-0018 to `superseded by`; ADR-0052 — already carrying 0054's partial supersession — gains its second successor delta; every gate-stating document sweeps to five links — the D10.5 mechanics). Fix the closed-enum degradation: the envelope schema accepts unknown `code` strings and `@repo/api-client` degrades them to a generic failure **of the HTTP status that carried them** — the property `errors.ts`'s own comment states — never to `SERVICE_UNAVAILABLE`.
      **ADRs:** 0057 (§8, §Consequences), 0050, 0052 (as parent), 0013.
      **Done when:** `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` green; a `packages/api-client` unit test named for the property — an unknown, well-formed code on a `403` produces the forbidden-family generic `ApiClientError`, not the transport code — passes, and fails against the pre-step client (isolation check).
- [ ] **2. Accept ADR-0058; the audit log.** `audit_events` in `packages/db` with its migration; the container-wired `audit` writer in the API core with the two write disciplines (transactional lifecycle, best-effort trail); no read surface.
      **ADRs:** 0058, 0006, 0008, 0009.
      **Done when:** gate green; `apps/api` integration test `audit-events.int.test.ts` asserts a lifecycle write inside a rolled-back transaction leaves no row and a committed one round-trips with actor, acting-as and `data`; migration applies from nothing on the integration run.
- [ ] **3. Schema and contracts for impersonation.** `sessions.impersonated_by_staff_id` (nullable, no FK) and the `impersonation_handoffs` table, one migration; `impersonatedBy` on `UserPrincipalResource`; `AUTH_IMPERSONATION_REFUSED` in the error codes **with both apps' `errors` catalogue entries (`en`, `lv`) in the same step — each app's compile-time completeness check over `ErrorCode` refuses to build without them, so they cannot wait for `D13.7`** (ADR-0057 §5); config keys `IMPERSONATION_SESSION_TTL`, `IMPERSONATION_HANDOFF_TTL`, `RATE_LIMIT_IMPERSONATION_MAX` through ADR-0004's schema, `.env.example` and `turbo.json`.
      **ADRs:** 0057 (§2, §4), 0058, 0004, 0023, 0017.
      **Done when:** gate green; contracts unit tests cover the widened principal parse both ways (present, absent); `.env.example` and `turbo.json` diffs carry exactly the three keys.
- [ ] **4. API: mint, handoff, exchange.** `POST /admin/users/:id/impersonate` (`authorize("admin")`, own limiter keyed on staff id, active target only, lifecycle audit events `minted`/`exchanged`) and `POST /user/auth/impersonate` (atomic single-use consume, session with fixed end, login-shaped cookies and `AuthResource`, pre-existing session row untouched); rotation-without-extension and the capped access `exp`; Postman folder.
      **ADRs:** 0057 (§1–§4), 0018 (as parent — the untouched flows), 0056, 0020, 0015.
      **Done when:** gate green; `apps/api` `impersonation.int.test.ts` covers: manager `403`; disabled and deleted targets refused; exchange succeeds and the response sets only user-population cookies; a replayed handoff is `401` with no session; an expired handoff is `401`; rotation does not move the session's end; an existing customer session row is unrevoked after an exchange; `pnpm test:postman` green with the new requests.
- [ ] **5. API: exclusions, attribution, exit.** `refuseImpersonated` on `change-password`, `DELETE /user/profile` and `logout-all` answering `AUTH_IMPERSONATION_REFUSED`; `impersonatedBy` on `ctx.principal`, the auth logger child and `principalProps`; logout on an impersonated session revokes with `impersonation_ended` and audits it; `impersonation.refused` and the per-mutation trail rows.
      **ADRs:** 0057 (§5–§6), 0058, 0019, 0010, 0005.
      **Done when:** gate green; `impersonation-exclusions.int.test.ts` asserts each excluded route answers `403 AUTH_IMPERSONATION_REFUSED` impersonated and succeeds on a real session; an integration test asserts a settings `PATCH` under impersonation succeeds and leaves a trail row with both identities; a unit test on the http logger asserts `impersonatedBy` on the completion props.
- [ ] **6. Settings-query eviction on principal change** (inherited, jointly owned since `D11.11`). Both apps: a boot or sign-in that resolves a different principal id than the cache's owner drops the settings query and the preference caches instead of adopting them, at whatever seam the builder finds honest.
      **ADRs:** 0045 (as carried by 0053), 0053, 0033 (as carried by 0051).
      **Done when:** `pnpm check` green; a test per app, named for the property (a second principal's session does not adopt the first's settings), passes in both `apps/admin` and `apps/customer`, and fails on the pre-step seam (isolation check).
- [ ] **7. Customer app: exchange route, banner, exit, copy.** `redeemHandoff(token)` in `@repo/api-client` beside `login` (the store's writer set grows by one, inside the package, and `COOKIE_TRANSPORT_PATHS` gains `/auth/impersonate` — without it the exchange sets no cookies and the session dies on first reload); the `/impersonate` route reading the fragment and landing home; `ImpersonationBanner` from `principal.impersonatedBy` into the `banner` slot (`warning`, non-dismissible), exit through logout to a signed-out screen; the refusal rendering over the catalogue entries `D13.3` added.
      **ADRs:** 0057 (§7), 0048 (banner slot, as carried), 0033 (as carried by 0051), 0046, 0055.
      **Done when:** gate green; customer-app tests assert the banner names both identities on every `_dashboard` route (the pseudo-locale walk's route list), that exit calls logout and renders the signed-out screen, and that a refused excluded operation renders the catalogue copy; the pseudo-locale suite stays green with the new strings.
- [ ] **8. Admin app: the entry point.** `impersonate: ["admin"]` in `RESOURCE_POLICY.users` with the fixture test grown; the Impersonate row action and its confirm dialog opening `VITE_CUSTOMER_APP_URL` + `/impersonate#token=…`; the env var through the admin config reader, `.env.example`, `turbo.json`.
      **ADRs:** 0042, 0057 (§7), 0038 (as carried by 0054), 0004.
      **Done when:** gate green; the ADR-0042 test pattern extended — a `manager` principal renders no Impersonate action, an `admin` does; the policy fixture test pins the new row against the `authorize(` transcription; an MSW test asserts a successful mint opens the customer origin with the token in the fragment.
- [ ] **9. The browser tier, and close-out.** `impersonation.spec.ts` in the customer e2e suite on the dual-session harness: operator signs into the admin panel, mints against the seeded customer, the banner names both identities in the customer app, an excluded operation is refused with rendered copy, a settings write lands, exit revokes (a replayed refresh is dead), and the staff session survives untouched. Then the definition of done, top to bottom.
      **ADRs:** 0052 (e2e conventions, as carried), 0057, 0020 (the request window).
      **Done when:** `pnpm test:e2e` green in both apps including the named spec; every definition-of-done item below run and recorded.

## Definition of done

1. `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` green on the committed tree — the five-link gate, run as the gate for the first time.
2. `pnpm test:unit` twice, the second fully cached (the ADR-0026-as-carried property).
3. `pnpm test:postman` green, previous requests untouched, the mint/exchange/refusal requests present.
4. `pnpm test:e2e` green in both apps, `impersonation.spec.ts` among them, on a clear request window.
5. The acceptance walk, in a browser against the dev stack: mint against a seeded customer; the banner names both identities on every screen; a profile edit succeeds and its audit trail row carries both ids; each excluded operation refused with operator-facing copy; exit revokes server-side and a replayed token is dead; the staff session survives the whole exercise; a `manager` is neither offered nor allowed the mint.
6. `security-reviewer` has signed off every step with no BLOCKER, recorded per step.
7. The window-describing documents agree (ledger, ADR index, `docs/README.md`, `CLAUDE.md`, `.claude/rules/frontend.md`, `/frontend-conventions` — the D7 list of six).

## Loose ends this deliverable does not take

- **An `/admin/audit` read surface** for the audit table — a future deliverable (a grid, retention, guards); ADR-0058 §No-read-surface is the record.
- **Audit write points beyond impersonation** (role grants, resets, deletions) — join when a deliverable takes them.
- **Staff impersonating staff** — out of scope; the mint is `/admin/users/:id` only.
