# Postman

The manual/smoke tier of ADR-0021, and the API's living documentation until
OpenAPI is generated. Built in implementation step 10 (see
`../implementation-plan.md`).

- `machxi-api.postman_collection.json` — 63 requests in 10 folders: `Health`,
  `Admin Auth`, `Admin › Staff`, `Admin › Users`, `Admin › Role guards`,
  `User Auth`, `User › Profile`, `Public`, `Errors & routing`, `Teardown`.
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
second run does not collide with the first; the one password it changes belongs
to an account the same run created, never to a fixture. What it leaves behind is
one staff account, one user and one self-registered user per run — v1 has no
delete endpoint. `pnpm db:reset` clears them.

**Negative paths are deliberate, not accidental.** `403` for a manager writing to
`/admin/users`, `409 CONFLICT` (never `USER_EMAIL_TAKEN`) for a duplicate public
registration, `401 UNAUTHENTICATED` for an unknown path in a guarded segment. Each
of those requests carries a description saying which ADR decided it.

**Rate limits bound how often it runs** (ADR-0020). One pass spends 1 of the 5
failed refreshes per 15 minutes per IP, and ~63 of the 300 global requests —
roughly five consecutive runs per window against one API process. A `429
RATE_LIMITED` in the middle of a run means the window, not a regression.

## Changing it

Endpoints and their requests move together (`/postman-sync`). Put a request in the
folder for its segment, in flow order; give it a description that says _why_ the
API answers the way it does, not what the URL already says; and assert the status
and the `error.code`, since `code` is the contract and `message` is not
(ADR-0013).
