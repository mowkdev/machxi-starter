# ADR-0070: Impersonation opens the customer app in a new tab (supersedes ADR-0057 in part — a delta)

- Status: proposed
- Date: 2026-09-09
- Supersedes: [ADR-0057](0057-impersonation-sessions.md) (delta: §7's "means _this_ tab" bullet — the admin half opens the customer app in a tab of its own, pre-opened on the confirm click, with its opener disowned, and falls back to the same tab only when the open is refused; and §3's "its session row is not touched" is narrowed to a **real** customer session — the exchange ends an **impersonated** session whose refresh cookie accompanies it, on the trail. The mint, the handoff, the fragment, the fixed session life, the exclusions, the banner, the exit and every other decision stand — its third partial successor, after [0067](0067-organizations.md) and beside [0064](0064-brand-seams.md)'s delta on 0018)

> Written 2026-09-09 by `/scope` for D17 ([`docs/plan/0017-impersonation-new-tab.md`](../plan/0017-impersonation-new-tab.md)) — writing is not opening, opening is not accepting. `proposed` at writing; **accepted at the head of `D17.1`**, where ADR-0057 gains its third successor delta. Amendable in place, labelled, while D17 is `in progress` ([the ledger](../plan/README.md#the-window)).

## Context

[ADR-0057](0057-impersonation-sessions.md) §7, as amended at `D13.8`, decided that "opens `VITE_CUSTOMER_APP_URL` at `/impersonate#token=…`" means the tab the operator is in. The reason it gave was mechanical and correct for the sequence it assumed: a tab opened _after_ the mint's round trip is a popup a blocker refuses silently, leaving an operator with a success toast, no tab and a sixty-second credential they can neither spend nor see. So the admin panel leaves, and the operator's context — the row they were reading, the record beside it — is one Back press away.

The operator's question on 2026-09-09 was whether the panel should stay visible. It should: the reason impersonation exists is to see what a customer sees while holding what the panel knows about them, and a same-tab navigation makes those two views alternate rather than sit side by side. What §7 did not consider is the ordinary way a page opens a tab after an awaited request — **open the tab on the click, navigate it when the answer arrives.** The click on Confirm is the user gesture; a `window.open` inside it is never the popup-blocker case, and the mint still happens only after the operator confirms, so §1's budget and the credential-behind-a-cancelled-dialog concern are exactly where 0057 left them.

Two things the same-tab choice had quietly bought have to be bought again, and one is a decision rather than a mechanic.

- **The opener.** A same-tab navigation leaves no `window.opener` on the customer origin. A pre-opened tab does, unless it is disowned. In production the admin origin already sends `Cross-Origin-Opener-Policy: same-origin` ([`apps/admin/nginx.conf`](../../apps/admin/nginx.conf), helmet's default restated per ADR-0059 §4), which severs a cross-origin popup's opener on its own; the Vite dev server sends no such header.
- **One impersonation per browser.** The user population's cookies are one jar. Today the admin panel is gone when the customer app is open, so a second mint means walking Back first. With the panel still on screen, a second Impersonate is one click away, and its exchange overwrites the first tab's cookies — the first tab's next refresh answers with the **second** customer's principal, the banner swaps names, and the first session lives out its thirty minutes with no `ended` row. The browser cannot enforce one tab: a named target would be reused across mints, but a Cross-Origin-Opener-Policy browsing-context-group switch clears the context's name, so the production headers that sever the opener also defeat that reuse. The API can see it instead — the refresh cookie is scoped to `/api/v1/user/auth`, and the exchange is a route under that path.

## Decision

### 1. The tab is opened on the click and navigated on the answer

The confirm dialog's `onConfirm` opens a blank tab **synchronously**, inside the click, and keeps the handle; then it mints; on success it builds the handoff URL exactly as before and assigns it to the handle's location. The order is a decision: the open must precede the awaited request or it is the case §7 of 0057 rejected, and the mint must follow the confirm or it is the case §7 of 0057 was right about. The dialog closes once the handle has been navigated and the mutation is reset — the panel stays, so `D13.8`'s "no `onClose()` first" no longer applies, and its `leaving` latch becomes the interval between the open and the navigation rather than the life of the document.

A refused mint closes the tab it opened and leaves the confirm open with its toast, which is `ConfirmDialog`'s contract; a blank tab left behind a refusal would be the operator's only evidence that something happened, and the toast is the better one.

### 2. The opener is disowned twice

Before the handle is navigated, the dialog sets its `opener` to `null` — the tab is `about:blank` and same-origin at that moment, so the write is permitted, and a disowned browsing context stays disowned across the navigation that follows. Production's `Cross-Origin-Opener-Policy: same-origin` severs it a second time for the deployment that has it. Neither replaces the other: the header is a property of one deployment's static server and the dev server does not send it, while the client-side write is a property of the code every deployment runs. The customer app is not asked to check — a page cannot make its own opener less trusted than it arrives.

### 3. A refused open falls back to the same tab

`window.open` returns `null` when a browser refuses even a click-initiated open — an extension, a policy, a kiosk profile. The fallback is the behaviour this record replaces: navigate `_self`, exactly as `D13.8` built it, with the mint still after the confirm. The operator loses the panel and keeps the credential, which is the right way round; a toast that says "allow pop-ups" is the wrong way round, because the mint has already spent a budget entry and minted a live credential by the time anything could be said. The fallback is a branch a test names, not a comment.

### 4. The exchange ends the impersonated session it replaces

When `POST /user/auth/impersonate` arrives with the user population's refresh cookie, and that cookie resolves to a live session whose `impersonated_by_staff_id` is set, the exchange **revokes that session inside its own transaction** and writes its `impersonation.ended` audit row, whose `data` says it was replaced — which separates it from the exit control's row and from a revocation for cause, the distinction 0057 §6 asks the row to carry. The new session is minted in the same transaction, so the trail reads `ended` then `exchanged` with no gap in which both were live. The stale tab meets `401 AUTH_SESSION_REVOKED` on its next refresh and signs out through the path it already has — a signed-out screen, not a silently swapped banner.

A cookie that resolves to a **real** customer session is left exactly as 0057 §3 decided: overwritten in the jar, alive in the database, other devices untouched. The carve-out is one predicate on one column, and it is the operator's 2026-09-09 decision that the old impersonation should end rather than be warned about or left to expire. A cookie that resolves to nothing — expired, revoked, unknown — is ignored, as it is on any other request; the exchange's refusals are unchanged and still one indistinguishable `401`.

### 5. What stands

Everything else in 0057: the mint and its per-actor budget, the handoff in the fragment and its single use, the `401` posture, the fixed end without extension, the actor claim, the exclusions as carried by 0067, the banner and its exit, the attribution. The `_self` form of `window.open` stays the navigation call in the fallback, for the reason `D13.8` gave.

## Consequences

- The admin panel stays on screen while the operator acts as the customer, which is what the feature was for.
- One more session-ending path joins the exit control and the revoke-all sweep, and it is inside the exchange's transaction, so `impersonation.int.test.ts` grows a case and [`docs/specs/impersonation.md`](../specs/impersonation.md) grows a scenario in the same diff.
- The browser tier's impersonation spec drives a second page rather than one, and asserts the opener is absent in it. The tier's measured floor moves by whatever the second mint costs; `D17.3` re-measures rather than adjusts, the `D15.9` discipline.
- The exit screen still says "sign in" rather than "close this tab": whether a disowned auxiliary context is script-closable is left unverified here and is on D17's out list.
- A deployment whose static server drops the Cross-Origin-Opener-Policy header still disowns the opener, by §2's client-side write. A deployment that drops both has a customer tab that can navigate the admin tab — the tabnabbing shape — and that is the reason the write is not optional.

## Alternatives considered

- **A named target, one customer tab reused across mints.** Would have given one impersonation per browser without any API change. Defeated by the production headers, as §Context says, and a design that works only where the security headers are missing is not one.
- **An admin-side warning on a second mint.** The admin app remembers it minted recently and the confirm says so. Cheap, no API change — and the first session still lives out its thirty minutes with no `ended` row, in a browser whose first tab has changed identity. Rejected for §4, at the operator's decision.
- **Leaving the hazard recorded and unbuilt.** The same as above without the warning. Rejected for the same reason.
- **Keeping the same tab.** The record this one supersedes, and a defensible one; its reason was a sequencing assumption this record removes.
