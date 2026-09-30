# Deploying

The reference deployment is [`docker/prod/compose.yaml`](../docker/prod/compose.yaml) — five services built from three images, with Postgres and Redis **external** ([ADR-0059](adr/0059-ci-containers-and-deployment.md) §6). This page walks it on [Coolify](https://coolify.io), which is what the starter's own deployment runs on. Nothing here is Coolify-specific except the click path: the compose file is the description, and any platform that reads one will take it.

## What gets deployed

| Service    | Image                      | What it is                                                               |
| ---------- | -------------------------- | ------------------------------------------------------------------------ |
| `migrate`  | `apps/api/Dockerfile`      | One-shot. Applies the committed migrations and exits. The release gate.  |
| `api`      | `apps/api/Dockerfile`      | Express 5 on Node 24, port 4000. Starts only after `migrate` exits zero. |
| `prune`    | `apps/api/Dockerfile`      | The retention sweep, on a loop. Deletes rows nothing can use any more.   |
| `admin`    | `apps/admin/Dockerfile`    | Static SPA on unprivileged nginx, port 8080. Built per environment.      |
| `customer` | `apps/customer/Dockerfile` | Static SPA on unprivileged nginx, port 8080. Built per environment.      |

The facts to have in mind before the click path:

- **Postgres and Redis are not in the compose file.** They are managed resources on the platform, so their backups, restores, upgrades and monitoring are the platform's; the deployment is handed `DATABASE_URL`, `DATABASE_URL_OWNER` and `REDIS_URL`. Since `D14.6` the last of those is read: it is the rate limiters' shared store (ADR-0066 §4).
- **The two SPA images are environment-specific.** Vite inlines `VITE_*` at build time, so they are build arguments, not environment variables. Changing an API URL means rebuilding, and an image built for staging cannot be promoted to production. That is a property of the tool.
- **Both SPA images send a `Content-Security-Policy`** (ADR-0073 §9): `script-src 'self'`, `frame-ancestors 'none'`, and a `connect-src` that names the API origin — the same `VITE_*_API_URL` the bundle was built with, read a second time by the image's runtime stage, so there is nothing extra to set. An origin the bundle must reach beyond the API — an error reporter's ingest address, if you wire one (ADR-0066 §3) — is added to `connect-src` in that app's `nginx.conf`, and the build refuses an image whose origin is empty.
- **Every service states its limits and a bounded log** (ADR-0078 §5). The compose file gives each one a CPU and memory limit under `deploy.resources.limits` — 1 CPU and 1 GiB for the API, sized by argon2 (`ARGON2_MEMORY_KIB` times `AUTH_MAX_CONCURRENT_HASHES`, beside the heap), half a CPU and 128 MiB for each SPA — and the `json-file` log driver capped at three files of 10 MB per container. They are starting points, not measurements of your traffic: raise the API's memory with either argon2 variable and its CPU with the concurrent hashes, and if the platform ships logs elsewhere, the cap is how much stays on the host. Coolify and `docker compose` both honour the limits; a platform that sets its own replaces them.
- **Nothing in the three images runs as root.** The API runs as `node`, and the two SPA images run nginx's unprivileged image as uid 101, which is why they listen on 8080 rather than 80 — a platform's proxy that pointed at port 80 on the SPA containers points at 8080 from `D29.5`. Each image declares a `HEALTHCHECK`: the API's polls `/health/live`, each SPA's polls `/healthz`, which nginx answers itself.
- **Rolling back means rolling back the image.** It does not mean rolling back a migration: migrations are forward-only and hand-written (ADR-0008). A release that has to be undone is undone by deploying the previous commit, and by writing a new migration if the schema has to move back.

## Before the first deploy

A managed Postgres 16, a managed Redis (optional for one instance, required in effect for two — see below), and a domain per SPA plus one for the API. Three domains, because the two SPAs are two origins and the API is a third; `CORS_ORIGINS` names the first two exactly.

Generate a signing key. Every key committed to this repository — the root `.env.example`'s, `apps/api/.env.test`'s and the placeholder in `docker/prod/.env.example` — is enumerated in the config schema and refused outright in production, so this is not optional even for a local trial of the images:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Coolify, end to end

1. **New resource → Docker Compose**, pointed at this repository, branch `main`, compose file `docker/prod/compose.yaml`. Coolify builds the images itself from the Dockerfiles the file names; there is no registry step in this setup.

2. **Add the managed Postgres** (Resources → Database → PostgreSQL 16) in the same project, then **create the two roles** the deployment connects as (ADR-0061 §1). The compose file does not create them, and migration `0008` refuses to run if the application role is missing — deliberately, because a migration that could create roles would need `CREATEROLE`, which is most of the privilege this split exists to take away. Once, against the new database as its administrative user:

   ```sql
   CREATE ROLE machxi_owner LOGIN PASSWORD '…';
   CREATE ROLE machxi_app   LOGIN PASSWORD '…';
   GRANT CONNECT, CREATE ON DATABASE machxi TO machxi_owner;
   GRANT CONNECT ON DATABASE machxi TO machxi_app;
   ALTER SCHEMA public OWNER TO machxi_owner;
   GRANT USAGE ON SCHEMA public TO machxi_app;
   ```

   **`machxi_app` must be an ordinary role: not a superuser, without `BYPASSRLS`, and owning no table** (ADR-0078 §4, row-level security). The tenant-owned tables carry row-level security policies (migration `0019`), and Postgres skips every one of them for a superuser, for a `BYPASSRLS` role and for a table's owner or a role that inherits the owner's privileges — so an API connected as any of those would keep working and isolate no tenant. **The API refuses to start in production when its role is one of them**, with a line naming the role and the reason; the fix is a `DATABASE_URL` that names `machxi_app`, never a grant. A managed platform's default user is usually privileged, which is why the snippet above creates a role of its own rather than reusing it, and why the application role is never made a member of `machxi_owner`.

   Table privileges are not granted here: migration `0008` grants them, and its `ALTER DEFAULT PRIVILEGES` is what makes every table a later migration creates usable without a grant nobody remembers to write. Copy both connection strings — the owner's is only ever used by the one-shot `migrate` service, and the API never receives it.

   **On an existing database** — one that already ran D1–D13 — the snippet above is not enough, and this is the one upgrade step that bites. `ALTER SCHEMA public OWNER` moves the schema; it does not move the **tables**, which are still owned by whatever role created them, and migration `0008` grants on tables. It fails loudly rather than quietly: on PostgreSQL 16 the `GRANT` raises `permission denied for table users` and the whole migration rolls back, and `0008` also asserts its own post-condition for the partial case Postgres answers with a warning instead. The fix, run once as the current administrative role:

   ```sql
   REASSIGN OWNED BY <the role that created the tables> TO machxi_owner;
   ```

3. **Environment variables**, on the compose resource. [`docker/prod/.env.example`](../docker/prod/.env.example) is the checklist; the ones with no safe default are:

   | Variable                                      | Value                                                                    |
   | --------------------------------------------- | ------------------------------------------------------------------------ |
   | `DATABASE_URL`                                | the **`machxi_app`** string from step 2 — the API's connection           |
   | `DATABASE_URL_OWNER`                          | the **`machxi_owner`** string — read only by the `migrate` service       |
   | `JWT_ACCESS_SECRET`                           | the key generated above, ≥ 32 characters                                 |
   | `TRUST_PROXY`                                 | `1` — Coolify puts one Traefik hop in front of you                       |
   | `HTTP_KEEP_ALIVE_TIMEOUT`                     | `65s` — above your proxy's idle timeout (ADR-0073 §4)                    |
   | `CORS_ORIGINS`                                | `https://admin.example.com,https://app.example.com` — exact, no wildcard |
   | `VITE_ADMIN_API_URL`, `VITE_CUSTOMER_API_URL` | `https://api.example.com`                                                |
   | `VITE_CUSTOMER_APP_URL`                       | `https://app.example.com`                                                |
   | `CUSTOMER_APP_URL`, `ADMIN_APP_URL`           | the same two origins, read by the **API** (ADR-0071 §1)                  |
   | `API_PUBLIC_URL`                              | `https://api.example.com` — the API's own origin (ADR-0072 §2)           |
   | `MAIL_TRANSPORT`                              | `log` or `smtp` — production must state one (ADR-0066 §1)                |
   | `MAIL_FROM`, `SMTP_*`                         | the relay and its sender, whenever the transport is `smtp` (step 8)      |
   | `METRICS_TOKEN`                               | ≥ 32 random characters — `GET /metrics` is open without it               |

   **`MAIL_TRANSPORT` and `METRICS_TOKEN` are required in production** (ADR-0066 §1–§2). `log` writes a line per message and delivers nothing, and it has to be _stated_ rather than inherited, because a deployment that inherited it would silently swallow every message it sends. **Once D18's flows are deployed, `log` also means the deployment has no registration**: a customer whose address cannot be verified cannot sign in at all (ADR-0071 §3), and neither can an operator onboarded by invitation. `METRICS_TOKEN` is a bearer credential: without one, `GET /metrics` answers anybody, and its body names every route the API has.

   **`CUSTOMER_APP_URL` and `ADMIN_APP_URL` are required in production too** (ADR-0071 §1), and they are the API's own variables rather than the `VITE_` twins beside them — the SPAs inline theirs into a browser bundle at build time, the API reads these at startup to build the links it mails. The schema refuses the committed development defaults (`http://localhost:3002`, `http://localhost:3001`) exactly as it refuses both `TRUST_PROXY` constants, and for the same class of reason: a deployment that inherited them would mail every verification, reset, invitation and onboarding link into the recipient's own machine, with nothing in a response or a log to say so. The recipient is the one who finds out.

   **`API_PUBLIC_URL` is required in production as well** (ADR-0072 §2), by the same check: `https`, and not a loopback address. It is the one origin the API has to know about _itself_ — the redirect URI it sends Google is composed from it — and it is refused at the development default whether or not Google is configured, so a deployment that turns sign-in on later cannot inherit `http://localhost:4000` into the one URL the identity provider sends a browser back to. Setting up Google itself is optional and is [its own section below](#sign-in-with-google-optional).

   **`REDIS_URL` is optional and stops being so at two instances** (ADR-0066 §4). Unset, every rate limiter counts in process memory, so N instances admit N times every limit in ADR-0020 — the login limiter included. Set, they share one budget. A configured Redis that cannot be reached stops the API from starting, and refuses requests rather than admitting them if it goes away later.

   **The three budgets that ration a stranger's inbox** (ADR-0071 §4) are `RATE_LIMIT_PASSWORD_RESET_MAX` (`3 / hour`, keyed on the source address **and** the email — what one sender may mail one mailbox), `RATE_LIMIT_MAILBOX_MAX` (`5 / hour`, keyed on the **mailbox alone** — what that mailbox receives from everybody) and `RATE_LIMIT_MAIL_SOURCE_MAX` (schema default `20 / hour`, keyed on the **source alone** — what one sender may mail in total, however many addresses it names). The first two are anti-abuse numbers and default safely: raising either is a decision about somebody else's inbox. **The third is a capacity number and is the one to size against your own traffic** — its key is a source address, which behind a carrier-grade NAT or a corporate egress is a great many people, and its counter is shared by `password/forgot` on both segments, `resend-verification` and `register`. **`docker/prod/.env.example` therefore sets it explicitly at `150` rather than leaving it commented out**, because a deployment that inherits the schema's 20 gives every person behind one NAT a twentieth of a shared budget and finds out from a `429`. Raise it further if legitimate sign-ups or recovery requests start answering `429`; what a spent budget costs is every mail flow at once from that source until the window turns. `RATE_LIMIT_MAILBOX_MAX` is also the budget on every **authenticated** sender — **creating an organization invitation** (ADR-0071 §5), **`POST /user/profile/change-email`** (§6), and **staff onboarding** (§8: `POST /admin/staff` when it invites, and `POST /admin/staff/:id/onboarding/resend`) — the same number keyed on the address the message is going to, so reaching many different people is many budgets while reaching one address over and over is one. The first two take a counter each; the two onboarding senders share one, because they mail one message to one mailbox. On the address change a refused request keeps its share, because that route can refuse for reasons that mail nothing. Two honest limits: the resend has no address in its request, so it keys on the **subject's id** instead — one mailbox is therefore reachable under two keys and its real ceiling across the pair is twice the number; and what no number here bounds is an _authenticated_ sender walking a list of distinct addresses, because every one of these counters keys on the recipient. That is left to `RATE_LIMIT_GLOBAL_MAX`, and to the fact that each sender is a named account: the invitation records its `invited_by`, the address change lands in `audit_events`, and an invited operator is a row in `staff` with `staff_roles.granted_by` on it.

   **The three socket deadlines are stated rather than inherited** (ADR-0073 §4). `HTTP_REQUEST_TIMEOUT` (`30s`) and `HTTP_HEADERS_TIMEOUT` (`10s`) replace Node's own 300 and 60 seconds, which are a slow-loris budget on an API whose slowest handler is one argon2 hash. **`HTTP_KEEP_ALIVE_TIMEOUT` is the one to check against your proxy**, and it is the only one `docker/prod/.env.example` sets rather than comments out: Node's default is five seconds, a reverse proxy typically holds an idle connection for sixty, and an API on the default therefore closes connections the proxy is about to reuse — which reaches you as intermittent `502`s in front of a perfectly healthy process. The default here is `65s`, above the common sixty; if your proxy holds longer, raise this above it. The rule is one sentence: the proxy is always the end that closes.

   **`AUTH_MAX_SESSIONS_PER_PRINCIPAL` bounds how many devices one account stays signed in on** (ADR-0073 §3), at `10` unless you state otherwise. The eleventh sign-in revokes that account's oldest live session with `revoked_reason = 'session_cap'` rather than refusing the new one — a person whose device was stolen is signing in from the replacement. An impersonated session counts against the customer and is never the one revoked; it ends on its own fixed clock (ADR-0057 §4). `0` turns the cap off, which leaves session growth to the `prune` service alone. The cap is a ceiling on the **live** rows, not a substitute for the prune: expired rows still accumulate until something deletes them.

   **`RATE_LIMIT_PRINCIPAL_HASH_MAX` is the budget on every authenticated route that verifies a password** (ADR-0073 §1) — the four on `/user/profile` (`change-password`, the self-service delete, the identity unlink and `change-email`) and the four `POST /admin/{staff,users}/:id/{password,email}` — at `10` per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW` (`15m`), keyed on the **caller's account**. Unlike the three above it rations nobody's inbox: what it protects is the `AUTH_MAX_CONCURRENT_HASHES` pool that login shares, so a handful of authenticated clients can no longer make the API shed logins for everybody, and it bounds the actor's own guessing at their own password on the two administrative resets, whose `403` was otherwise an unbounded oracle. It is an anti-abuse number and defaults safely — nobody changes their password ten times in a quarter of an hour — so raise it only if a legitimate flow starts answering `429`.

   **`TRUST_PROXY` is required and both constants are refused** (ADR-0059 §7). `true` makes Express take the left-most `X-Forwarded-For` entry verbatim, so `req.ip` becomes attacker-controlled; `false` behind a proxy makes every request report the proxy's address, so the login limiter, the refresh limiter and the audit trail collapse onto one key. Neither failure shows up in a response, which is why the API refuses to start rather than guess.

4. **Domains**, one per service: the API's on `api`, the admin's on `admin`, the customer's on `customer`. Coolify's proxy terminates TLS and forwards to the container port each service exposes (4000, 8080, 8080 — the SPA images moved off 80 at `D29.5`, so a domain that names the port states 8080).

5. **Deploy.** The order is enforced by the compose file, not by you: `migrate` runs `node dist/migrate.js`, takes a `pg_advisory_lock` so two overlapping releases serialise, applies whatever is pending and exits; `api` starts only once it has exited zero. A failed migration therefore fails the deploy with the old API still running.

   **A migration can lock a table, and the old API is what waits** — worth knowing before the first release against a database with real rows in it. `0017_users_active_email_verified_check.sql` is the example in the tree: it adds a validated `CHECK` to `users`, which holds `ACCESS EXCLUSIVE` while Postgres scans the table, and every login blocks for that scan. Milliseconds on a small table, longer on a large one. If that is not acceptable for your deployment, apply such a migration in a maintenance window rather than in the release.

   **Upgrading across `0019` (row-level security): code first, then the migration.** Code from `D29.4` on runs correctly on a database that has not applied `0019` — it places settings nothing reads yet — but code from before it, against a database that has, fails closed: organization routes answer `404` and registration and team creation answer `500` (a `42501` from the policies), because that code places no setting and the policies admit nothing by omission. It leaks nothing, but the compose file's order — `migrate` exits, then the new `api` starts — leaves the old API serving against the migrated database for the seconds in between. To close that window on a deployment with traffic, release the new image once with the `migrate` service's command replaced by a no-op, then release again as normal; or take the upgrade in a maintenance window. `0020` (the invitation's column grant) needs no such care: no release ever updated an invitation's other columns.

   **`prune` comes up beside `api` and is the one long-lived job** (ADR-0073 §3). It is the same image with a third command — `node dist/prune-sessions.js` in a `sleep` loop — connecting as the application role, and it deletes the rows that have been unusable for thirty days: revoked and expired `sessions`, spent `impersonation_handoffs`, spent and expired `account_tokens`. A row that is still redeemable is never touched, which is why the service can restart mid-sweep and why it is safe to run against a live database. `PRUNE_INTERVAL` is how long it waits between passes — whole seconds or a whole number of `s`, `m`, `h` or `d`, defaulting to `24h`, floored at a minute, and read as a day when the loop cannot parse it, so `0` or `daily` never becomes a continuous sweep; it prunes once on the way up rather than waiting out the first interval, so a redeploy is also how you force a sweep. The line it writes names the three counts separately, so a table that is growing is visible without a query. **If your platform runs scheduled jobs**, run the same command on its scheduler and delete this service — that is the better shape, and the reason it is a service here is that a compose file is the one description every platform accepts. Nothing bad happens if you drop it and run nothing: the database grows, which is exactly the finding this service closes.

   **Do not mistake it for a queue drain or a scheduler.** It sweeps three tables on a fixed interval and does nothing else; invitation expiry is a state read from `expires_at` and is never swept, audit retention is a reviewed migration and never a job ([ADR-0058](adr/0058-append-only-audit-log.md) — the table refuses `DELETE` twice over), and an in-process scheduler is a later decision ([ADR-0066](adr/0066-infrastructure-seams.md)'s seam shape).

6. **Seed the first super admin, once.** The image carries the migration runner and the prune, and deliberately not the seeder: seeding is not a release step or a recurring one, it is a first-run one, and `SEED_SUPER_ADMIN_*` never reaches the API's request path (ADR-0008). Run it from a checkout against the managed database, once, with the two variables set for that command only:

   ```sh
   DATABASE_URL_OWNER='postgres://machxi_owner:…' NODE_ENV=production \
   SEED_SUPER_ADMIN_EMAIL=you@example.com SEED_SUPER_ADMIN_PASSWORD='…' \
     pnpm db:seed
   ```

   The **owner's** connection string, like every other `packages/db` CLI entry point (ADR-0061 §1).

   A password committed anywhere in this repository is refused here (ADR-0020 §Known-public secrets): the account holds `super_admin`, which bypasses every staff role check.

7. **Check it.** `GET https://api.example.com/health/ready` answers `200` with every check `up`; both SPAs reach their login page. `/health/live` is what the container's own `HEALTHCHECK` polls — liveness only, so a database blip never restarts a healthy process (ADR-0016).

8. **Send one message, and read it in a real mailbox.** Nothing above proves the deployment can mail, and from D18 on a deployment that cannot mail has no registration, no password recovery, no invitations and no way to onboard an operator (ADR-0071 §3–§8). **The check is the mailbox, never the status code**: every one of those endpoints answers the same thing whether it sent, failed or found nobody, because that is what stops it from telling a stranger which addresses exist (ADR-0020 §Enumeration), and a delivery failure is swallowed and logged rather than returned (ADR-0071 §4). So: `POST https://api.example.com/api/v1/admin/auth/password/forgot` with the seeded super admin's own address — the customer segment's twin is `/api/v1/user/auth/password/forgot` — then open that mailbox. The link should be an `https://` address on the origin you gave `ADMIN_APP_URL` (`CUSTOMER_APP_URL` for the other segment), and following it should land on a screen that lets you set a password. **Finish the reset rather than abandoning it**: the link is a live credential for the one account that bypasses every staff role check, it stays good for `PASSWORD_RESET_TOKEN_TTL`, and following it through to a new password is what spends it. On a deployment you would rather not aim that at, run the probe on the customer segment with a throwaway account first and repeat it for the admin origin once the relay is proven.
   - **A `202` proves nothing at all, so read the logs beside the mailbox.** Four lines discriminate the four outcomes, and only the last is a broken relay: `mail sent` (the relay accepted it — look in the spam folder next), `mail not sent (log transport)` (`MAIL_TRANSPORT` is still `log`, which is what `docker/prod/.env.example` ships), `password reset answered without a message` (no active account holds that address — check it against `SEED_SUPER_ADMIN_EMAIL`, since a mistyped address answers `202` exactly like a delivered one) and `mail delivery failed` (the relay refused). The last is written twice under one message: the SMTP transport's own line comes first and carries the recipient and the driver's error, and the handler's line follows with the error's class and code alone (ADR-0071 §4) — so **treat the API's logs as holding recipients' addresses**, which the `mail sent` line already means on every successful send.
   - **`MAIL_TRANSPORT=smtp` on its own is not a configured relay.** The whole `SMTP_*` group defaults to the local compose's Mailpit — `localhost:1025`, no TLS, no credentials — which is exactly right on a laptop and is nothing at all inside a container. `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` and, where the relay authenticates, `SMTP_USER` and `SMTP_PASSWORD` are stated in `docker/prod/.env.example` beside it; the schema does not refuse the development defaults here as it does for the two app URLs, because a relay reachable at `localhost` is a legitimate deployment (a sidecar) rather than a mistake. **`SMTP_SECURE=false` does not mean "upgrade to TLS", it means "do not start in TLS"**: the transport passes the flag to nodemailer and requires nothing, so on 587 the upgrade is opportunistic and a relay that fails to advertise STARTTLS gets the credential and a single-use account-takeover link in the clear, with a successful send and nothing in a log to say so. Use `SMTP_SECURE=true` on 465, or a relay on 587 you have confirmed advertises STARTTLS.
   - **`MAIL_FROM` is the envelope sender the relay will judge you by.** It defaults to `no-reply@machxi.local`, which no managed relay will accept and no recipient's spam filter will like; it must be an address on a domain whose SPF and DKIM records name the relay you are sending through. That is the half of "mail works" no request against this API can check for you.

## Rotating the signing secret

The access token is signed under `JWT_ACCESS_SECRET` and names the key in its header; `JWT_ACCESS_SECRET_PREVIOUS` is the one other key the API will still verify (ADR-0078 §2). Rotating is three moves, and nobody is signed out:

1. **Move the current secret to `JWT_ACCESS_SECRET_PREVIOUS`, set a new `JWT_ACCESS_SECRET`, and redeploy.** New tokens are signed under the new key; tokens already issued name the old one and keep verifying. The two must differ — the API refuses to start otherwise — and a value committed in this repository is refused in production in either variable.
2. **Wait one `JWT_ACCESS_TTL`** (`15m` unless you changed it). Every token signed under the old key has expired by then; refresh tokens are opaque rows, not signed, so they are untouched by any of this.
3. **Remove `JWT_ACCESS_SECRET_PREVIOUS` and redeploy.** A token naming the old key is refused from then on.

After a **leak**, skip the wait: set the new secret and deploy with no previous one at all. Every access token in flight is refused, each client refreshes once on its refresh token, and the leaked key signs nothing this API accepts. A token issued by a release before the ring carries no key id and verifies under the current secret alone, which is what lets a deployment take this release without signing anybody out.

**The sign-in transaction has a key of its own.** `OIDC_TRANSACTION_SECRET` signs the cookie that carries a Google sign-in between its start and its callback. Unset, it is derived from `JWT_ACCESS_SECRET` under a label of its own, so it rotates when the access secret does; set, the two rotate independently. Either way, changing it fails only the sign-ins in flight at that moment — the person clicks "Continue with Google" again.

## Sign in with Google (optional)

Customers can sign in, or create an account, through Google (ADR-0072). It is off until the API is given an OAuth client, and the API is the control: without one, the three sign-in routes are not mounted and answer `404`.

1. **Create the client** in the Google Cloud console — _APIs & Services → Credentials → Create credentials → OAuth client ID_, type **Web application**. The consent screen needs only the default `openid`, `email` and `profile` scopes; nothing here asks for more.
2. **Register exactly one authorized redirect URI**, which is `API_PUBLIC_URL` followed by the callback path:

   ```text
   https://api.example.com/api/v1/public/auth/google/callback
   ```

   The API composes the same string from `API_PUBLIC_URL` and sends it on every authorization request, and Google refuses any request whose URI does not match a registered one character for character — scheme, host, port and path, with no trailing slash. A local client registers `http://localhost:4000/api/v1/public/auth/google/callback` — Google accepts plain `http` for `localhost` and nowhere else. **No authorized JavaScript origin is needed**: the flow is a server-side redirect, and no Google script runs in either SPA.

3. **Give the API both halves**, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, on the compose resource. Both or neither — half a pair stops the API at startup. The secret is a credential: it belongs in the platform's secret store, never in `docker/prod/.env.example`, a commit or a `VITE_` variable, and nothing sends it to a browser, because the code exchange happens between the API and Google.
4. **Turn the button on in the customer app**: `VITE_FEATURE_GOOGLE_SIGN_IN=true` among the SPAs' build arguments in `docker/prod/.env` (the section `docker/prod/.env.example` heads "The two SPAs"), then rebuild the customer image — Vite inlines the value, so a running container cannot change it. It only puts "Continue with Google" on the sign-in and sign-up screens; the API is still the control, and a button built against an API without the client meets `404` and tells the person so. Set it in the same change as step 3, never instead of it.

## Running the reference stack locally

Useful for checking the images before a real deploy, and the shape the definition of done uses:

```sh
cp docker/prod/.env.example docker/prod/.env     # then edit the two DATABASE_URL* values
                                                # and the key (the committed
                                                # placeholder is refused)
docker compose -f docker/prod/compose.yaml build
docker compose -f docker/prod/compose.yaml up -d
curl -s localhost:4000/health/ready
curl -sI localhost:3002/ | grep -i content-security-policy   # the policy, with your API origin in connect-src
```

Point both `DATABASE_URL*` values at the local compose Postgres with `host.docker.internal` rather than `localhost` — the API is in a container now, and `localhost` is the container. The published ports bind to `127.0.0.1`, so the stack is reachable from the host and from nowhere else; a platform routes to it over the compose network instead and needs no published port at all.

## What this does not decide

Image registry and tagging, secret storage and log shipping. Each is a deployment's own choice and none of them is in the repository; ADR-0059 §Consequences lists them so their absence is deliberate rather than forgotten. **Running the prune on a schedule was on this list until `D20.5`** and is now the `prune` service above — what is still a deployment's own choice is whether to keep that service or hand the same command to the platform's scheduler.
