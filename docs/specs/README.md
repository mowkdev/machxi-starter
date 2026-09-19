# Behaviour specs

What the product does today, one file per capability, as a client observes it ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md), behaviour specs). A spec is **current truth**: it is edited in place by the step that changes the behaviour, in the same diff as the code and the test, and it carries no history — git does.

The API's wire behaviour is covered first, because it is the surface with a contract. An **SPA spec** arrives when a step names one, and the `spa-` files below are the ones a step has named: the flows that cross the wire and are decided on the client, where the observable thing is a browser's — a credential read out of an address and struck from it, a tab opened inside a click, what is asked of the API and what is not.

A spec is not a decision (the record in [`adr/`](../adr/README.md) says why), not a rule (the digest in [`rules/`](../rules/) says what is in force) and not a test (the file it names proves it). Its altitude is what an observer outside the code can see: for the API, statuses, codes, bodies, headers and side effects; for a screen, what is rendered, what is navigated to and what is asked of the API — never a component, a hook or a piece of state.

## Shape

```
## Requirement: <name>
<One or two sentences in the indicative.>
Records: [ADR-NNNN](../adr/NNNN-….md), …          at least one, in force
Proved by: `apps/api/test/….int.test.ts`, …          at least one, existing

### Scenario: <name>
- **WHEN** <the request, or the state before it>
- **THEN** <the observable answer>
```

`pnpm docs:check` refuses a requirement with no scenario, a scenario without a **WHEN** and a **THEN**, a record that does not exist and a test file that does not — so a deleted test reddens every spec that cited it. The specs travel into forks, so they carry no step numbers, no dates and no bare record ranges, like everything under `.claude/`.

## Capabilities

| Spec                                               | Covers                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`envelope-and-errors.md`](envelope-and-errors.md) | The response envelope, the request id, validation and the generic error codes           |
| [`auth-sessions.md`](auth-sessions.md)             | Login, refresh and rotation, the access token, logout, `me`, self-registration, limits  |
| [`csrf-and-cookies.md`](csrf-and-cookies.md)       | Cookie transport, the double-submit CSRF check, the bootstrap endpoint, CORS            |
| [`users-and-profile.md`](users-and-profile.md)     | `/admin/users` and `/user/profile`: the customer aggregate on both segments             |
| [`staff.md`](staff.md)                             | `/admin/staff` and `/admin/profile`: operators, roles and the `super_admin` invariants  |
| [`settings.md`](settings.md)                       | `/{admin,user}/settings`: the per-account display settings                              |
| [`list-queries.md`](list-queries.md)               | The list-query language every collection endpoint speaks                                |
| [`impersonation.md`](impersonation.md)             | The mint, the handoff, the impersonated session, its exclusions and its exit            |
| [`audit-log.md`](audit-log.md)                     | The append-only audit table and its two write disciplines                               |
| [`health-and-metrics.md`](health-and-metrics.md)   | `/health/*` and `/metrics`, outside the limiters                                        |
| [`organizations.md`](organizations.md)             | Organizations, memberships and invitations on both segments, and the guard              |
| [`mail-flows.md`](mail-flows.md)                   | The single-use token behind every mailed link, address verification and recovery        |
| [`federated-identity.md`](federated-identity.md)   | Sign in with Google: the start, the callback's resolution, the handoff and its exchange |

A capability with a route and no row here is the finding, and the step that touches it next writes the file.

## Flows a browser decides

| Spec                                                       | Covers                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`spa-google-landing.md`](spa-google-landing.md)           | The customer app's "Continue with Google" and `/auth/google`, where the callback lands      |
| [`spa-invitation-link.md`](spa-invitation-link.md)         | `/invitations/accept`: one screen, three readers, and the link it cannot read               |
| [`spa-impersonation-entry.md`](spa-impersonation-entry.md) | The panel's confirmation and the tab it opens, and `/impersonate`, which spends the handoff |
