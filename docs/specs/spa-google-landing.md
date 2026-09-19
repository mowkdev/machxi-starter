# The Google landing

The customer app's half of signing in with Google: the control on the sign-in screen that starts the flow, and `/auth/google`, the one address the API's callback ever sends a browser to. What the API answers at each step is [`federated-identity.md`](federated-identity.md); this states what a person sees and what the app sends, as a browser observes it.

Everything the callback has to say arrives in the URL **fragment** — `#token=…`, `#linked=…` or `#error=…` and nothing else — which reaches no server log and no `Referer` header. The app's first act on every arrival is to strike it out of the address, by replacement, so the entry that carried a credential cannot be walked back to.

## Requirement: The sign-in screen offers Google only where the deployment has it

The "Continue with Google" control is rendered only when this build's `googleSignIn` feature is on. Pressing it posts the start with the reader's locale and sends this same browsing context to the `authorizationUrl` the API answers — never a second tab, and nowhere that is not an `https` address — and the control stays pressed out while the page is leaving, so one press is one transaction. A page restored from the browser's back/forward cache is pressable again; a fresh load is not a restore and does not re-enable it. A start the API refuses — an API with no Google client answers `404 ROUTE_NOT_FOUND` — renders the errors catalogue's sentence for the code and leaves the control pressable. Where the screen was carrying a destination, the app remembers it under its own device key before leaving and reads it back once after the exchange, fenced to a path on this origin.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0055](../adr/0055-customer-app.md), [ADR-0034](../adr/0034-server-state-and-notifications.md)
Proved by: `apps/customer/src/pages/login/__tests__/login.test.tsx`

### Scenario: A build without the flag

- **WHEN** the sign-in screen renders with `googleSignIn` off
- **THEN** the sign-in form is there and no "Continue with Google" control is

### Scenario: Starting

- **WHEN** the reader presses the control
- **THEN** exactly one start is posted carrying the reader's locale, this browsing context is sent to the URL it answers, and the control is pressed out

### Scenario: A start that answers an address this screen will not open

- **WHEN** the start answers an `authorizationUrl` that is not an `https` address
- **THEN** nothing is opened and nothing is navigated, and the catalogue's generic sentence is shown instead

### Scenario: Back from the account chooser

- **WHEN** the browser restores the sign-in screen from its back/forward cache
- **THEN** the control is pressable again, while a plain load leaves it as it was

### Scenario: An API with no Google client

- **WHEN** the start answers `404 ROUTE_NOT_FOUND`
- **THEN** the catalogue's sentence for that code is shown and the control is pressable again

### Scenario: The destination survives the round trip

- **WHEN** the reader presses the control on a sign-in screen carrying a redirect, and comes back with a handoff
- **THEN** the exchange lands them on that destination, and nothing is left for a later sign-in to inherit

## Requirement: The landing spends a handoff once, and asks first in a browser that already holds a session

An arrival carrying `#token=…` is exchanged once — the fragment struck before the credential leaves, the exchange asking for cookie transport and carrying the browser's own credentials, and one arrival meaning one exchange even under a double-invoked mount. It then lands the person on the destination the sign-in screen stored, or home. In a browser that already holds a session nothing is spent until the person confirms, because a client that spends a fragment on mount is a forced-login primitive; the fragment is struck while it waits. A refusal renders the catalogue's sentence for the code the callback sent, with the way back to sign in, and starts no session. An address carrying nothing to finish says so and asks for nothing — including when a fragment appears on it afterwards without a reload, which one mount does not act on.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0071](../adr/0071-mail-flows.md), [ADR-0029](../adr/0029-browser-token-transport.md), [ADR-0055](../adr/0055-customer-app.md)
Proved by: `apps/customer/src/pages/auth-google/__tests__/auth-google.test.tsx`, `apps/customer/src/pages/login/__tests__/login.test.tsx`

### Scenario: The fragment is struck before the credential leaves

- **WHEN** a handoff arrives in the fragment
- **THEN** the address carries no fragment at the moment the exchange is sent, and it replaced the entry rather than adding one

### Scenario: One arrival, one exchange

- **WHEN** the landing mounts twice for one arrival, as a strict double invocation does
- **THEN** the handoff is exchanged exactly once, with cookie transport asked for and the browser's credentials carried, and the person lands signed in

### Scenario: A browser that already holds a session

- **WHEN** a handoff arrives in a browser signed in as somebody else
- **THEN** nothing is exchanged and the resident session is untouched until the person confirms, and the confirmation then exchanges it and switches the account

### Scenario: The exchange is refused

- **WHEN** the handoff is spent, expired, unknown or unbound, and the exchange answers `401`
- **THEN** the screen says the sign-in did not work, offers the link to sign in, and no session is started

### Scenario: A code this build has never heard of

- **WHEN** the fragment names an error code the bundle has no sentence for
- **THEN** one written sentence is shown and the raw code is not

### Scenario: Nothing to finish

- **WHEN** the landing is opened with an empty fragment, and a handoff is then put in the address without a reload
- **THEN** it says there is nothing to finish, and it spends nothing that arrives after it

## Requirement: A link finished, and a link refused, end on the account's security section

A signed-in browser reaches the callback only from the link start, so both of its answers belong on the security section rather than on a sign-in screen. `#linked=<provider>` navigates there, carrying which provider was linked as history state rather than as an address anybody could plant; the notice is drawn only when the account's own methods, read from the server, list that provider. A refusal navigates to the same place with the catalogue's sentence for the code as a notice, and offers no way back to sign in.
Records: [ADR-0072](../adr/0072-federated-identity-google-sign-in.md), [ADR-0053](../adr/0053-account-area.md), [ADR-0055](../adr/0055-customer-app.md)
Proved by: `apps/customer/src/pages/auth-google/__tests__/auth-google.test.tsx`

### Scenario: A link that finished

- **WHEN** `#linked=google` arrives in a signed-in browser and the server lists Google among the account's methods
- **THEN** the person is on the security section with no fragment left, one history entry, and the notice saying Google is linked

### Scenario: A fragment anybody could plant

- **WHEN** `#linked=google` arrives and the server lists no Google identity for the account
- **THEN** the security section renders with no such notice — the server's list is the fact and the fragment only a hint

### Scenario: A link the callback refused

- **WHEN** `#error=AUTH_IDENTITY_TAKEN` arrives in a signed-in browser
- **THEN** the security section renders the catalogue's sentence for that code and no "go to sign in" link
