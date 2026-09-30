# Postman

The manual/smoke tier of ADR-0021, and the API's living documentation until
OpenAPI is generated. Built in implementation step 10 (see
`../plan/0001-api-foundation.md`).

- `machxi-api.postman_collection.json` — 213 requests and 652 assertions in 18
  folders: `Health`, `Metrics`,
  `Admin Auth`, `Admin › Staff`, `Admin › Users`, `Admin › Role guards`,
  `Admin › Profile`, `Admin › Settings`, `User Auth`, `User › Profile`,
  `User › Settings`, `Public`, `User › Organizations`, `User › Invitations`,
  `Admin › Organizations`, `Errors & routing`, `Impersonation`,
  `Teardown`.
- `local.postman_environment.json` — `baseUrl` and the dev fixture addresses.
  `superAdminEmail` / `superAdminPassword` are **empty on purpose**: they come
  from `SEED_SUPER_ADMIN_*` in your `.env` and are not committed. So does
  `metricsToken`, from `METRICS_TOKEN`: the `Health (with the metrics token)`
  request carries it, and `/health` answers the commit to it alone (ADR-0084
  §3). Unset, as it usually is locally, no request is answered the commit.

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

**The `Public` folder is the mail flows minus the mailbox** (ADR-0071 §3). A
registration answers `202` with no session at all, and the link that would sign
the new account in arrives somewhere newman cannot read — so this folder proves
everything either side of it: that nothing resembling a credential leaves the
endpoint, that the account is created `pending_verification`, that the right
password on it answers `403 AUTH_EMAIL_UNVERIFIED` and the wrong one the usual
`401`, that `resend-verification` answers **the same `202` body** for a pending
address and for one nobody holds, and that a token nobody minted is one
indistinguishable `401`. Walking an actual link is the browser tier's, which
reads it out of Mailpit.

**Recovery is the same shape, split across the two auth folders** (ADR-0071 §4).
`Admin Auth` asks for a reset link and proves the answer — `202`, no session, no
cookie — and that a token nobody minted is one indistinguishable `401`; `User
Auth` proves the enumeration property, because by then the run has created an
account of its own and can compare a live address against a stranger's **byte
for byte**. It is split rather than duplicated because `Admin Auth` runs first,
before any per-run staff account exists, and every address on this route has to
be a per-run one: two hourly counters sit on `forgot` — one per caller and
address, one per address alone — so a fixture there would answer `429` on the
fourth run of the hour. Redeeming an actual reset link is the browser tier's.

That is also why the invitee below is a **staff-created** account rather than the
self-registered one: a staff member who types an address asserts it, so that
account is `active` and can sign in, while a self-registered one cannot until
its link is followed.

**The three organizations folders are one flow across two segments** (ADR-0067).
`User › Organizations` runs as the seeded customer, who owns the `acme` fixture:
it reads the switcher's list, creates a team organization, proves the guard's
two refusals — `404` for a non-member, `403` for a member whose role is too low
— and sends two invitations, one to an address with an account and one to an
address without, whose **responses are compared field for field**. That
comparison is the enumeration property of ADR-0067 §2 asserted rather than
described. `User › Invitations` then signs in as the invited account, accepts,
leaves, is invited again so that there is an offer to **decline** — the other
consume, over `declinedAt` instead of `acceptedAt`, and the one write on an
invitation an impersonated session may make (ADR-0067 §8) — and deletes the
organization the run made.

The decline is proved by the request **after** it rather than by its own `204`,
which a route that stamped nothing would also answer: declining the same offer
twice gets `409 CONFLICT`, the one-answer-for-five-refusals `That invitation is
no longer pending`, which is the same shape as `Accepting it again is refused`
above. It is `409` and not `404` because the row is still addressed to the
caller — the invitee's read finds it and the guarded consume is what declines
to write a second stamp.

The second invitation is what makes the decline provable in a run that must be
repeatable: §2 refuses a second _outstanding_ offer to one address in one
organization, not a second offer after the first was consumed and the member
left, and the invited address is a per-run one, so its `RATE_LIMIT_MAILBOX_MAX`
counter starts fresh on every run rather than accumulating across them.

**The invitation's link is the mailbox again** (ADR-0071 §5). Creating one now
sends it, with a single-use token in the link's fragment, and newman can no more
read that mailbox than it can read a verification link — so the two folders prove
the refusals and the browser tier walks the link from Mailpit. `Public` asks the
lookup for a token nobody minted and gets the one `404` that unknown, accepted,
declined, revoked, expired and deleted all share, and an empty token gets a
`400` from the schema above the service; `User › Invitations` asks
`accept-by-token` for the same non-existent token and gets the same `404`. What
needs a live link — the lookup's three fields, and the `403
ORGANIZATION_INVITATION_ADDRESS_MISMATCH` a signed-in stranger gets — is proved
in `apps/api/test/organizations.int.test.ts` and walked in the browser tier.

Acceptance by **id**, in the requests above, is still the other path and still
supported: the invitee's own list is where an account holder who never opened the
mail finds the offer. `Admin › Organizations` is
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

The teardown is also where all three delete paths are documented, because it is
where the run legitimately has accounts to destroy. It shows the asymmetry
between the populations end to end: the staff row is gone and answers `404`; the
user row — closed by the account itself, with its own password, which is the
self-service path — is still readable at `200` with `deletedAt` set, a `PATCH` at
it answers `409 USER_DELETED`, and the address the _self-registered_ account
released is registered again by the next request, the support answer the partial
unique index exists to make possible. That second registration is then found by
its address and removed administratively, because nobody can sign in as an
account whose address has never been proven.

**The address change is proved from both ends and walked from neither**
(ADR-0071 §6). `User › Profile` asks for one — `202`, and the request after it
still reads the _old_ address back, which is the whole claim — and asks twice
more to be refused, once for an address a live account holds (`409
USER_EMAIL_TAKEN`, nameable because the caller is authenticated) and once with a
wrong password (`403`, before anything is minted or mailed). `Public` posts a
token nobody minted at `confirm-email` for the one indistinguishable `401`. The
swap itself needs the link, which arrives in a mailbox: the browser tier reads
it from Mailpit and the integration tier proves the transaction, exactly as they
do for `register` above.

**Sign in with Google is three requests, and every one of them has two right
answers** (ADR-0072 §2). `Public` posts the start, which is the only step of the
flow that can succeed here — a sign-in needs a code only Google mints — so the
other two are driven as negatives: a callback this browser never started, which
still proves the `302` and the fragment it carries, and a handoff nobody minted,
which is the one `401 UNAUTHENTICATED` that spent, expired, unknown and unbound
all share. What needs a live transaction is the integration tier's, against a
fake provider. All three routes exist only where `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are both set, so a default clone answers
`404 ROUTE_NOT_FOUND` and a configured one answers for real; each test accepts
either and asserts the shape of whichever it got. The count above is the default
clone's — a configured API runs one assertion more, on the start.

The callback is also **the one request here that does not follow its redirect,
and the other response that is not the envelope**, beside the metrics scrape.
Every outcome of it is a `302`
to the customer app with the result in the URL fragment, so there is no envelope
to assert: the collection-level test exempts a `302` the way it exempts the
metrics scrape and asserts a `Location` instead, and the request turns redirects
off, because what is under test is this API's answer rather than the page at the
other end of it. The no-store invariant still covers it.

**The ways into an account are read and refused, never removed** (ADR-0072 §3).
`User › Profile` reads the customer fixture's Google identity on `me` — the
`--dev` seeds give it one, with a synthetic subject that must never appear in a
body — and asks to unlink it with the wrong password, which is `403` and leaves
it there. It never unlinks it with the right one, and the administrative reset
never touches the fixture either: an identity can only be put back by Google, so
a run that removed it would fail the next one, and removing it (`204`, one
`account.identity_unlinked` row) is proved in the integration tier against
accounts the suite links itself. The run's own account then proves the rest of
the order — the right password on an account with nothing linked is the
caller's own `404` — posts the link start, which answers either way as the
public start does, and asks for a set-password link — `409 CONFLICT`, because
that link is for an account without a password and this one has one; a
passwordless account exists only through Google, so the `202` and what its
consume keeps are the integration tier's. `Impersonation` adds unlink and the
set-password link to the refusals.

**Negative paths are deliberate, not accidental.** `403` for a manager writing to
`/admin/users`, `409 CONFLICT` (never `USER_EMAIL_TAKEN`) for a duplicate public
registration, `401 UNAUTHENTICATED` for an unknown path in a guarded segment. Each
of those requests carries a description saying which ADR decided it.

**Rate limits bound how often it runs** (ADR-0020, as carried by ADR-0069 and
ADR-0073). One pass spends **11 of the per-principal hash budget as the seeded
super admin** — the two password resets on each of `staff` and `users`, the
three address changes on each, and the invited operator's — which is why the
committed development profile states a `RATE_LIMIT_PRINCIPAL_HASH_MAX` far
above the schema's 10 and a deployment's number is left alone. That budget is
keyed on an **account** rather than on an address, and the super admin is a
fixture, so unlike every other limiter here it does not reset between runs: a
number sized to one run only would refuse the second run of the quarter hour in
`Admin › Staff`, which has nothing to do with rate limiting. It also means the
collection deliberately **never asserts that budget's `429`** — a request that
tripped it would spend the fixture's whole window for every run after it. The
refusal is proved in `apps/api/test/rate-limit.int.test.ts`, where a limiter's
counter lives inside one app and cannot leak (ADR-0066 §4). One pass also
spends 1 of the 5 failed refreshes per 15 minutes per IP, 2 of the
verification limiter's `3 / hour / IP + email` — and only ever against
**per-run** addresses, which is why both `resend-verification` requests generate
one rather than using a fixture: a fixed address there would answer `429` on the
fourth run of the hour and the assertion is that the two answers are identical —
and, since the mail flows joined `Public` and recovery joined both auth folders, 196 of the global
`RATE_LIMIT_GLOBAL_MAX` per 15 minutes (the three health probes and the metrics scrape sit outside every
limiter). On the committed development profile that is a small share of the
window, which is the point of ADR-0069: one window holds this collection, the
whole browser tier and a retry of both. On a stock 300 it was one consecutive
run per window, and an `.env` copied before that record still behaves that way —
refresh `RATE_LIMIT_GLOBAL_MAX` from `.env.example`. A `429 RATE_LIMITED` in the
middle of a run means the window, not a regression: restart `pnpm dev --filter
api` to reset the in-memory counters, or wait it out.

That the tenant surface is covered here rather than only in the integration suite
is what put the count where it is, and it is worth naming rather than
discovering.

## Changing it

Endpoints and their requests move together (`/postman-sync`). Put a request in the
folder for its segment, in flow order; give it a description that says _why_ the
API answers the way it does, not what the URL already says; and assert the status
and the `error.code`, since `code` is the contract and `message` is not
(ADR-0013).
