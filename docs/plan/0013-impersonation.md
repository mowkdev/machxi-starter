# D13 — Customer impersonation

> **Renumbered from D12 on 2026-08-29**, when the account area ([D11](0011-account-area.md)) was inserted ahead of the customer app — a ledger decision, the D5 precedent; see `docs/plan/README.md` §How D11 was inserted.

- Status: **planned** — opens when [D12](0012-customer-app.md) ships
- Steps: written when the deliverable opens; this file carries scope, order rationale and the assumptions taken
- Ledger: [`docs/plan/README.md`](README.md)

Scope: staff open the customer app **as a chosen customer**. An admin endpoint mints an impersonated `user`-population session; the customer app runs on it exactly as it would on a real one, with a persistent banner naming both identities and an explicit exit; every impersonated request is attributable to the staff member behind it. This is deliberately **last in the customer-app cluster**: it needs the app it signs into ([D12](0012-customer-app.md)), the settings and locale that app runs on (D6/D7), and it is the highest-risk security surface in the ledger — everything it touches must already stand still.

## Design sketch (the ADR decides; these are the constraints it starts from)

- **The mint**: `POST /admin/users/:id/impersonate` (staff-guarded; ADR-0042's policy table decides which roles are _offered_ it — the API decides which are _allowed_, and `manager` is expected to be neither). The session it creates is a `user` session with extras: it records the impersonating staff id, carries a shortened TTL, and does not refresh — an impersonation that needs more time is re-minted, on the audit trail, not silently extended.
- **The hard problem is the handoff, and the ADR must own it**: sessions live in cookies on the API host, and minting must not destroy the staff session that requested it, nor clobber a real customer session already in that browser. The expected shape is a one-time handoff token the customer app exchanges on arrival — but that mechanism, its cookie interplay and its failure modes are the core of the ADR, not a detail of it.
- **Server-side exclusions**: an impersonated session is refused credential and security operations — change password, change email, account deletion, session management — with their own error codes. The refusal lives in the API, not in hidden buttons; the customer app renders it like any other refusal.
- **Audit**: `ctx` already carries the principal on every request (ADR-0010); an impersonated session makes every log line carry both identities (ADR-0005 fields), and mint/exit are audit events in their own right.
- **The two clients**: the customer app shows an unremovable banner — who you are, who you are acting as, one exit control that revokes the session server-side. The admin app grows the entry point on the user row, capability-gated per ADR-0038/0042.

## Decisions this deliverable needs

- **One new ADR**: impersonation sessions — the mint, the handoff, the TTL/no-refresh rule, the exclusion list, the audit events, and which staff roles hold the capability. Written as an **additive** decision beside frozen ADR-0017/0018/0019; if any of the three needs to say something different, that is a superseding ADR, discovered at writing time rather than during implementation.
- **What the principal carries, and therefore what the banner reads.** [D8](0008-app-shell-and-record-surfaces.md) ships the shell's `banner` slot and a generic `Banner` component, deliberately knowing nothing about impersonation; this deliverable adds the fact they render — an `impersonatedBy` shape on the principal resource in `@repo/contracts`, set by the mint and carried by the session — and the thin `ImpersonationBanner` in each app that reads it and renders into the slot with `dismissible={false}`. **The fact must come from the session, not from a URL parameter, `localStorage` or app state**: it has to survive a reload, it must not be forgeable by the client, and it must be the same fact the API refuses the excluded operations on. The contracts change is small and is this deliverable's, not D8's.
- `security-reviewer` is mandatory on every step of this deliverable, not just the PR gate — this is the feature the agent exists for.

## Assumptions taken 2026-08-20 (revisable until the deliverable opens)

- **Full access minus credential operations** — the standard support-tooling shape: staff can do what the customer can do _except_ the operations that would let an impersonator quietly take the account over, and everything is logged as staff-X-as-user-Y. The alternatives (read-only; completely unrestricted) were considered in scoping and rejected as respectively unable to fix anything and unable to be trusted, but the operator can overturn this before the ADR is written.

## Acceptance sketch

Mint against a seeded customer and walk the customer app: the banner names both identities on every screen; profile edits succeed and land in the audit log with both ids; each excluded operation is refused with its own code and lands as operator-facing copy, not a raw error; exit revokes the session server-side and a replayed token is dead; the staff session survives the whole exercise untouched; a `manager` is neither offered nor allowed the mint; the gate is green, the Postman collection covers mint/exit/refusals, and `security-reviewer` signs off with no BLOCKER.
