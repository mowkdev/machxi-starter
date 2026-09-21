# The invitation link

Where a mailed invitation lands: `/invitations/accept` in the customer app. What the API answers to the lookup and to acceptance by token is [`organizations.md`](organizations.md) and [`mail-flows.md`](mail-flows.md); this states what a person sees and what the app sends, as a browser observes it.

The token arrives in the URL **fragment** and, unlike the other two credentials this app reads from an address, arriving does not spend it: an offer is read and then decided on. So the strike matters most here — the token is out of the address before the offer is rendered, and by replacement, so no history entry holds it while somebody thinks.

## Requirement: One screen reads the link, whoever opens it

The link is a single address the API mints with no way of knowing who will open it, so one screen answers for the three readers there are. It spends the link's lookup once per arrival — once even under a double-invoked mount — and renders one sentence naming the organization and the role for all three, differing only in what can be done next: the invited account holder is offered acceptance; a browser signed in as another address is told plainly, with both addresses, and offered a way to sign out rather than a way to accept; a stranger is offered the way in below. Acceptance lands the person **in** the organization rather than on a screen saying it happened, and replaces the entry it came from.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0067](../adr/0067-organizations.md), [ADR-0055](../adr/0055-customer-app.md)
Proved by: `apps/customer/src/app/__tests__/accept-invitation.test.tsx`, `apps/customer/e2e/organizations.spec.ts`

### Scenario: The credential leaves the address before the offer is read

- **WHEN** a link is opened
- **THEN** the offer is rendered with no fragment in the address and one history entry, which is the arrival itself

### Scenario: One arrival, one lookup

- **WHEN** the screen mounts twice for one arrival, as a strict double invocation does
- **THEN** the lookup is asked exactly once, and nothing is spent — reading an offer is a read

### Scenario: The invited account holder accepts

- **WHEN** the reader is signed in as the invited address and accepts
- **THEN** acceptance is posted once with the token, the person is on the organization they joined, and Back cannot return to the screen that held the link

### Scenario: A browser signed in as somebody else

- **WHEN** the reader is signed in as an address the offer is not addressed to
- **THEN** the offer is shown with both addresses named, no control accepts it, and the way forward is to sign out

## Requirement: A link the lookup cannot read says one thing, and a check that fails says another

Unknown, accepted, declined, revoked, expired and organization-deleted are one indistinguishable `404` on the wire, so this screen offers one sentence for all of them rather than inventing a distinction the API declines to make — and no control, because nothing here can mint another offer. An address carrying no link at all reads the same way and asks the API nothing. A check that failed for a reason that is **not** the link's — the lookup's source-keyed budget answering `429` above all, which behind one office egress is a colleague's request rather than the reader's — is a different sentence with a control that asks again, because the link is still held and still good. Both are alerts, because each replaces the pending sentence — itself a status — with no navigation; the failed check is one alert carrying the screen's sentence and the code's, and the spinner beside the pending sentence is hidden from a screen reader so the status is not read twice.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0067](../adr/0067-organizations.md), [ADR-0034](../adr/0034-server-state-and-notifications.md)
Proved by: `apps/customer/src/app/__tests__/accept-invitation.test.tsx`

### Scenario: A link that is no longer good

- **WHEN** the lookup answers `404` for the token in the address
- **THEN** one sentence says the link cannot be used, and no sign-up form is drawn

### Scenario: No link at all

- **WHEN** the address carries no fragment
- **THEN** the same sentence is shown and no lookup is asked for

### Scenario: The check itself failed

- **WHEN** the lookup answers something that is not a refusal of the link
- **THEN** the screen says so, keeps the link, and offers a control that asks again

### Scenario: What a screen reader hears

- **WHEN** the lookup is in flight, and then when it answers a refusal or fails
- **THEN** the pending sentence is the one status on the screen, and the refusal or the failed check is one alert

## Requirement: A stranger is offered the way in the deployment has

A reader with no session is offered a sign-up fixed to the **invited address** — any other address makes an account this invitation cannot reach — and under it, the way for somebody who already has an account, which sends them to sign in and on to their own invitation list rather than back to a spent link. Where the deployment has closed self-registration the sign-up is absent, the sentence changes with it, and that link is the only way forward: this screen never re-opens an affordance the API has turned off.
Records: [ADR-0071](../adr/0071-mail-flows.md), [ADR-0067](../adr/0067-organizations.md), [ADR-0055](../adr/0055-customer-app.md)
Proved by: `apps/customer/src/app/__tests__/accept-invitation.test.tsx`, `apps/customer/e2e/organizations.spec.ts`

### Scenario: A stranger, where sign-ups are open

- **WHEN** a reader with no session opens a good link on a build with self-registration on
- **THEN** the offer is shown above a sign-up whose address is the invited one and cannot be typed over

### Scenario: A stranger, where sign-ups are closed

- **WHEN** the same reader opens the same link on a build with self-registration off
- **THEN** no sign-up is drawn, the sentence says so, and the way to sign in is the only control left
