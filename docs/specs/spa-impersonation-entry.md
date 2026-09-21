# The impersonation entry

Two screens and one credential: the admin panel's confirmation, which opens the customer app in a tab of its own and hands it a handoff, and `/impersonate` in the customer app, which spends it. What the API answers to the mint and to the exchange is [`impersonation.md`](impersonation.md); this states what an operator sees and what each app does with the credential, as a browser observes it.

The handoff travels in the URL **fragment**, and is struck out of the address before it is spent. It is one-time and short-lived (`IMPERSONATION_HANDOFF_TTL`), so neither screen offers a retry: the only way forward from a refusal is a fresh mint.

## Requirement: The panel opens the tab inside the click and navigates it when the mint answers

The confirmation opens a blank tab **synchronously, inside the click's own call stack** — which is the one open a blocker has nothing to say about — and only then asks for the mint, so nothing is minted before an operator confirms and no credential is left behind a cancelled confirmation. Before the tab is navigated its opener is disowned, so the customer origin cannot reach the panel's; then it is sent to the customer app's `/impersonate` with the handoff percent-encoded in the fragment. The confirmation closes once the tab is on its way and keeps no handoff. A mint the API refuses closes the tab it opened and leaves the confirmation standing with the catalogue's sentence for the code; a confirmation that goes away while the mint is in flight closes the tab it opened rather than leaving a blank one behind; a browser that refuses even a click-initiated open — with nothing, or with a handle whose browsing context is already gone and every write to it a silent no-op — falls back to navigating this same tab, which is the behaviour the pre-opened tab replaced; and a second press while a tab is on its way mints nothing further.
Records: [ADR-0070](../adr/0070-impersonation-in-a-new-tab.md), [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0049](../adr/0049-admin-app-architecture.md)
Proved by: `apps/admin/src/features/users-manage/__tests__/users-manage.test.tsx`, `apps/customer/e2e/impersonation.spec.ts`

### Scenario: The open precedes the request

- **WHEN** the operator confirms
- **THEN** a blank tab carrying no URL has been opened before the click returns, and the mint that follows names that row and no other

### Scenario: Disowned, then navigated

- **WHEN** the mint answers
- **THEN** the tab's opener is set to nothing before its address is written, and the address written is the customer app's landing with the handoff in the fragment, percent-encoded so a token holding `+`, `/` or `=` survives the round trip

### Scenario: The panel stays

- **WHEN** the tab has been sent on its way
- **THEN** the confirmation closes, the panel is still on screen, and no handoff is held anywhere in it

### Scenario: A mint the API refuses

- **WHEN** the target is deleted, or present but not active, and the mint answers a refusal
- **THEN** the tab that was opened is closed, no address is written to it, and the confirmation stays with the catalogue's sentence for the code

### Scenario: The confirmation leaves while the mint is in flight

- **WHEN** the dialog is unmounted before the mint answers
- **THEN** the tab it opened is closed and nothing is ever written to it

### Scenario: A browser that refuses the open

- **WHEN** an extension or a policy answers the click-initiated open with nothing, or with a tab whose browsing context is already gone
- **THEN** this same tab is navigated to the landing instead, after the mint, and a second press while that navigation is under way mints nothing further

### Scenario: The confirmation says what a menu item cannot

- **WHEN** the confirmation is opened
- **THEN** it states that the operator's own session is untouched, that the acting staff member is on the trail, what impersonation may not do, and where it opens

## Requirement: The landing spends the handoff once and says so when it cannot

`/impersonate` is its own shell rather than a guarded one, because the operator's browser may already hold a customer session and that is the design rather than an edge case. It strikes the fragment out of the address, exchanges the handoff asking for cookie transport — without which the session would not survive the first reload — and lands on the customer's home. A real customer session already in that browser is overwritten there, which the API leaves alive elsewhere. A refusal — replayed, expired, unknown, or a target no longer active, all one `401` — says so and offers the way to sign in, and an address carrying no token asks for nothing at all. Neither of those states offers a retry, because a handoff cannot be re-spent. The sentence is a live region, because it changes with no navigation: a status while the exchange is in flight or when there is nothing to spend, and an alert on a refusal.
Records: [ADR-0057](../adr/0057-impersonation-sessions.md), [ADR-0070](../adr/0070-impersonation-in-a-new-tab.md), [ADR-0029](../adr/0029-browser-token-transport.md), [ADR-0055](../adr/0055-customer-app.md)
Proved by: `apps/customer/src/app/__tests__/impersonation-exchange.test.tsx`, `apps/customer/e2e/impersonation.spec.ts`

### Scenario: Redeemed

- **WHEN** the landing is opened with a handoff in the fragment
- **THEN** it is exchanged once with cookie transport asked for, the address is left carrying no fragment, and the person is on the customer's home as the customer

### Scenario: A customer session already in this browser

- **WHEN** the browser holds a real customer session at the moment the handoff is spent
- **THEN** the exchange replaces it in this browser, and the operator acts as the impersonated customer

### Scenario: A refusal

- **WHEN** the exchange answers `401`
- **THEN** the screen says the handoff could not be used, offers the way to sign in, and starts nothing

### Scenario: Nothing to spend

- **WHEN** the landing is opened with no token in the address
- **THEN** it says so and asks the API for nothing

### Scenario: What a screen reader hears

- **WHEN** the exchange is in flight, and then when it is refused
- **THEN** the pending sentence is a status and the refusal an alert, and an address with no token is a status rather than an alert
