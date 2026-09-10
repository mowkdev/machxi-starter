# Behaviour specs

What the API does today, one file per capability, as a client observes it on the wire ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md), behaviour specs). A spec is **current truth**: it is edited in place by the step that changes the behaviour, in the same diff as the code and the test, and it carries no history — git does.

A spec is not a decision (the record in [`adr/`](../adr/README.md) says why), not a rule (the digest in [`rules/`](../rules/) says what is in force) and not a test (the file it names proves it). Its altitude is the wire: statuses, codes, bodies, headers and side effects a client can see.

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

| Spec                                               | Covers                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`envelope-and-errors.md`](envelope-and-errors.md) | The response envelope, the request id, validation and the generic error codes          |
| [`auth-sessions.md`](auth-sessions.md)             | Login, refresh and rotation, the access token, logout, `me`, self-registration, limits |
| [`csrf-and-cookies.md`](csrf-and-cookies.md)       | Cookie transport, the double-submit CSRF check, the bootstrap endpoint, CORS           |
| [`users-and-profile.md`](users-and-profile.md)     | `/admin/users` and `/user/profile`: the customer aggregate on both segments            |
| [`staff.md`](staff.md)                             | `/admin/staff` and `/admin/profile`: operators, roles and the `super_admin` invariants |
| [`settings.md`](settings.md)                       | `/{admin,user}/settings`: the per-account display settings                             |
| [`list-queries.md`](list-queries.md)               | The list-query language every collection endpoint speaks                               |
| [`impersonation.md`](impersonation.md)             | The mint, the handoff, the impersonated session, its exclusions and its exit           |
| [`audit-log.md`](audit-log.md)                     | The append-only audit table and its two write disciplines                              |
| [`health-and-metrics.md`](health-and-metrics.md)   | `/health/*` and `/metrics`, outside the limiters                                       |
| [`organizations.md`](organizations.md)             | Organizations, memberships and invitations on both segments, and the guard             |
| [`mail-flows.md`](mail-flows.md)                   | The single-use token behind every mailed link, address verification and recovery       |

A capability with a route and no row here is the finding, and the step that touches it next writes the file.
