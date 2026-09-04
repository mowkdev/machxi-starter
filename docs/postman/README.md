# Postman

The manual/smoke tier of ADR-0021, and the API's living documentation until
OpenAPI is generated. Built in implementation step 10 (see
`../plan/0001-api-foundation.md`).

- `machxi-api.postman_collection.json` — 165 requests in 18 folders: `Health`, `Metrics`,
  `Admin Auth`, `Admin › Staff`, `Admin › Users`, `Admin › Role guards`,
  `Admin › Profile`, `Admin › Settings`, `User Auth`, `User › Profile`,
  `User › Settings`, `Public`, `User › Organizations`, `User › Invitations`,
  `Admin › Organizations`, `Errors & routing`, `Impersonation`,
  `Teardown`.
- `local.postman_environment.json` — `baseUrl` and the dev fixture addresses.
  `superAdminEmail` / `superAdminPassword` are **empty on purpose**: they come
  from `SEED_SUPER_ADMIN_*` in your `.env` and are not committed.

## Run it

```
pnpm docker:up
pnpm db:setup && pnpm db:seed -- --dev     # the fixtures the collection expects
pnpm dev --filter api
pnpm test:postman                          # newman, exits non-zero on a failure
```

`pnpm test:postman` reads `.env` for the super admin credentials and passes them
in, so nothing has to be typed. In the Postman app, import both files, select the
`machxi — local` environment and fill those two values yourself.

## How it is put together

**It is an ordered flow, not a menu.** Run it top to bottom — with the Collection
Runner or newman. Login stores `staffAccessToken`; the staff and users folders
create records and store their ids; `Teardown` logs every session out and clears
the tokens. Running one folder in isolation will fail on a missing token.

**The envelope is asserted for every request, once.** A collection-level test
checks the ADR-0012 shape — `success`, `data`/`error` exclusivity,
`meta.requestId` — plus `Cache-Control: no-store` on every 2xx (ADR-0020). Each
request then asserts only what is specific to it, and a new request inherits the
invariants for free.

**It is repeatable.** The accounts it creates carry a timestamped address, so a
second run does not collide with the first; every password it changes or resets
belongs to an account the same run created, never to a fixture. The one password
a fixture contributes is the super admin's, and it is only ever _presented_ —
`POST /admin/{staff,users}/:id/password` requires the caller to re-present their
own, which is what stops a stolen admin token from being an account-takeover
engine (ADR-0027).

**The credential endpoints are asserted as one chain.** `Admin › Staff` resets the
staff account it created, `Admin › Profile` then signs in with that new password
and changes it again; `Admin › Users` resets the user it created, and
`User › Profile` signs in with that. A reset that silently did nothing would fail
at the next login rather than pass quietly.

**The two `Settings` folders are the same nine requests twice**, and that is the
point rather than duplication (ADR-0045): one module serves both segments, so a
collection that exercised one of them would say nothing about the other. Unlike
everything else here they act on an account the run does not create — a settings
row belongs to a principal and only a hard delete removes one — so each folder
opens by clearing the two grid ids it uses and closes by clearing them again.
That is what makes a second run start where the first did.

**The three organizations folders are one flow across two segments** (ADR-0067).
`User › Organizations` runs as the seeded customer, who owns the `acme` fixture:
it reads the switcher's list, creates a team organization, proves the guard's
two refusals — `404` for a non-member, `403` for a member whose role is too low
— and sends two invitations, one to an address with an account and one to an
address without, whose **responses are compared field for field**. That
comparison is the enumeration property of ADR-0067 §2 asserted rather than
described. `User › Invitations` then signs in as the invited account, accepts,
leaves, and deletes the organization the run made. `Admin › Organizations` is
the same tenant base as staff, where the guard is a role again and every
organization is visible, soft-deleted ones included.

**It deletes what it creates.** One staff account, one user, one
self-registered user and two organizations per run, all removed by the
teardown (the organizations by their own folders, which is where the `DELETE`
belongs since it is also the request being exercised). That is a security
step, not housekeeping: one of them holds `manager`, and all of them have a
password committed in this repository. `pnpm test:postman` can only be aimed at
`localhost`; the Postman app can be aimed anywhere.

Until D2.4 the teardown could only `PATCH` them to `disabled`, "because it
cannot delete them — v1 has no delete endpoint" (ADR-0021, D1.10 amendment). A
disabled account is a row rather than a way in, but a deleted one is neither.
ADR-0021 is frozen, so ADR-0028 §Consequences is where the change is recorded —
the collection changes, the ADR does not.

The teardown is also where both delete endpoints are documented, because it is
where the run legitimately has accounts to destroy. It shows the asymmetry
between the populations end to end: the staff row is gone and answers `404`,
the user row is still readable at `200` with `deletedAt` set, a `PATCH` at it
answers `409 USER_DELETED`, and the address it released is registered again by
the next request — the support answer the partial unique index exists to make
possible.

**Negative paths are deliberate, not accidental.** `403` for a manager writing to
`/admin/users`, `409 CONFLICT` (never `USER_EMAIL_TAKEN`) for a duplicate public
registration, `401 UNAUTHENTICATED` for an unknown path in a guarded segment. Each
of those requests carries a description saying which ADR decided it.

**Rate limits bound how often it runs** (ADR-0020). One pass spends 1 of the 5
failed refreshes per 15 minutes per IP, and — since the three organizations
folders landed — about 160 of the 300 global requests per 15 minutes (the three
health probes and the metrics scrape sit outside every limiter). That is now
**one consecutive run per window** against a single API process, where it used
to be several: the second pass trips the global limiter partway through. A `429
RATE_LIMITED` in the middle of a run means the window, not a regression —
restart `pnpm dev --filter api` to reset the in-memory counters, or wait it out.

That is the cost of covering the tenant surface here rather than only in the
integration suite, and it is worth naming rather than discovering: a collection
that has to be run twice in ten minutes now needs the API restarted between
passes.

## Changing it

Endpoints and their requests move together (`/postman-sync`). Put a request in the
folder for its segment, in flow order; give it a description that says _why_ the
API answers the way it does, not what the URL already says; and assert the status
and the `error.code`, since `code` is the contract and `message` is not
(ADR-0013).
