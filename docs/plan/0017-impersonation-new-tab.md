# D17 — Impersonation in a new tab

- Status: **planned** — scoped 2026-09-09 by `/scope`, on the operator's question of the same day; opens when D15 ships (ADR-0025 rule 5). Built before D16, whose row says "built last".
- Records: [ADR-0070](../adr/0070-impersonation-in-a-new-tab.md) (impersonation opens the customer app in a new tab; a delta on ADR-0057 §3 and §7) — written `proposed` at scoping and accepted at `D17.1`'s head; a step whose record is still `proposed` is gated
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0017-impersonation-new-tab.notes.md`](0017-impersonation-new-tab.notes.md)

## Goal

The admin panel stays on screen while an operator acts as a customer: the Impersonate confirm opens the customer app in a tab of its own, pre-opened on the click so no popup blocker can refuse it, with its opener disowned, and falls back to the same tab only when the open itself is refused. Because the panel now stays one click from a second mint, the exchange ends the impersonated session it replaces in the same browser, on the trail, so a stale tab signs out rather than silently changing identity. ADR-0070 decides all of it; ADR-0057 stands for everything else.

## Constraints

- `security-reviewer` reads every step's diff — the handoff is a bearer credential in a link and the exchange is an unauthenticated session mint (ADR-0057 §2, §3; D13's first constraint carried).
- The mint follows the confirm and the open precedes the mint; the order is the decision, not an implementation detail (ADR-0070 §1).
- The opener is disowned client-side on every path, whether or not the deployment sends `Cross-Origin-Opener-Policy` (ADR-0070 §2; ADR-0059 §4 for where the header lives).
- A real customer session in the minting browser is still overwritten in the jar and left alive; only an impersonated one is ended (ADR-0057 §3 as carried by ADR-0070 §4).
- The exchange's refusals stay one indistinguishable `401 UNAUTHENTICATED` (ADR-0057 §3, `D13.4` amendment).
- A behaviour change updates [`docs/specs/impersonation.md`](../specs/impersonation.md) in the same diff as the code and the test (ADR-0068 §1).
- The admin harness has no `vi.mock`; the tab is observed through a spy on the real `window.open` (ADR-0036; `apps/admin/src/test/render.tsx`).
- The gate: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.

## Decisions taken at scoping (operator, 2026-09-09)

- **The exchange ends the impersonated session it replaces** (ADR-0070 §4) — chosen over an admin-side warning and over recording the hazard unbuilt.
- **D15 ships first, then this row opens** — one deliverable in progress at a time.
- **Numbered D17, built before D16.** The marketing site keeps its number and its "built last".

## Steps

Each step: implement, gate green, one bounded diff review **plus `security-reviewer`**, commit (ADR-0050). ADRs listed are what the builder reads first.

- [ ] **1. Accept ADR-0070; the exchange ends the impersonated session it replaces.** Accept 0070 at the head, where [ADR-0057](../adr/0057-impersonation-sessions.md) gains its third successor delta (§3 narrowed to a real customer session; §7's same-tab bullet replaced) and the index's session row names 0070 beside 0067. In `auth.service.ts`'s `exchange`: read the user population's refresh cookie through the controller as `refresh` does (`cookies.readRefreshCookie`), resolve it to a session, and when that session is live and impersonated, revoke it with reason `impersonation_ended` and write its `impersonation.ended` row with `data` saying it was replaced — inside the exchange's own transaction, before the new session is minted. A real customer session or an unresolvable cookie changes nothing.
      **ADRs:** 0070 (§4, §5), 0057 (§3, §4, §6), 0058, 0056, 0029.
      **Done when:** gate green; `apps/api/test/impersonation.int.test.ts` gains three cases — an exchange carrying an impersonated session's refresh cookie makes that session's refresh token answer `401 AUTH_SESSION_REVOKED` and leaves an `impersonation.ended` row for it whose `data` names the replacement; an exchange carrying a real customer session's refresh cookie leaves that session refreshing; an exchange carrying an unknown cookie mints as before; `docs/specs/impersonation.md`'s exchange requirement gains the scenario "A second impersonation in the same browser" and its `Proved by:` line still resolves under `pnpm docs:check`; the Postman exchange request's assertions still pass under `pnpm test:postman`.
- [ ] **2. The admin half: the tab opened on the click.** In `impersonate-user-dialog.tsx`: open a blank tab synchronously in `onConfirm` and keep the handle; mint; on success disown the handle's opener, assign the handoff URL, reset the mutation and close the dialog; on a refusal close the handle and leave the confirm open with its toast; when the open returned `null`, navigate `_self` after the mint as today. The `leaving` latch covers the open-to-navigation interval. `handoffUrl` and its test are untouched.
      **ADRs:** 0070 (§1–§3), 0057 (§2, §7), 0036, 0042.
      **Done when:** gate green; in `apps/admin/src/features/users-manage/__tests__/users-manage.test.tsx`, the "opening the customer app as a user" block's spy returns a stub handle and asserts, in order: the open happened before the mint request was answered and without a URL; the handle's `opener` was set to `null` before its location received the fragment URL, with the token in the fragment as before; the dialog is closed and the mutation cache holds no handoff after the navigation; a refused mint closed the handle and the confirm is still open; a test named for the fallback asserts that an open returning `null` leads to one `window.open(url, "_self")` after the mint and none before it.
- [ ] **3. The browser tier, and close-out.** `apps/customer/e2e/impersonation.spec.ts` drives the customer app as a second page obtained from the context's `page` event: the admin tab still shows the users grid after the confirm; in the customer page `window.opener` is `null`; the banner, the excluded operation, the allowed write and the exit run as today in that page. A second mint from the admin tab, with the first customer page still open, makes the first page's next refresh land on the signed-out screen and the second page carry the banner. The suite's window floor re-measured, not adjusted. Then the definition of done, top to bottom.
      **ADRs:** 0070, 0052 (the browser tier), 0069 (the window).
      **Done when:** `pnpm test:e2e` green in both apps with the scenario above among the customer's; `assertApiWindowClear`'s floor in `impersonation.spec.ts` states the re-measured cost; the definition of done below run and its output in the notes.

## Definition of done

Run at `D17.3` and again by `/ship` on the committed tree.

1. The gate green, every task cold: `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check`.
2. `pnpm test:unit` twice, the second `FULL TURBO` (ADR-0026 as carried).
3. `pnpm test:postman` exit `0`, with the request and assertion counts `README.md` and `docs/postman/README.md` state.
4. `pnpm test:e2e` green in both apps, `impersonation.spec.ts` among the customer's with the second-mint scenario.
5. `pnpm rules:digest` writes nothing on a second run and `pnpm docs:check` reports the inherited documents and the specs clean.
6. **Operator, browser:** Impersonate from the users grid opens the customer app beside the panel, the grid still on screen; in the customer tab's console `window.opener` is `null` and Back does not reach the admin panel; a second Impersonate from the panel ends the first customer tab's session on its next screen and opens the second; with pop-ups blocked for the admin origin, Impersonate lands in the same tab as before; on the production compose ([`docker/prod/compose.yaml`](../../docker/prod/compose.yaml)) the customer tab opened from the admin image is likewise opener-less.

## Not in D17

A "close this tab" affordance on the exit screen — whether a disowned auxiliary context is still script-closable is unverified, and the signed-out screen stands; `Cross-Origin-Opener-Policy` on the Vite dev server, which §2 of the record makes unnecessary for correctness; staff impersonating staff (ADR-0057's own loose end); the "who minted" versus "who acted" question ADR-0057 §7 leaves with the operator; a Content-Security-Policy for the static images (ADR-0059 §4's nginx comment, worth a record of its own).
