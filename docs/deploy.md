# Deploying

The reference deployment is [`docker/prod/compose.yaml`](../docker/prod/compose.yaml) — four services built from three images, with Postgres and Redis **external** ([ADR-0059](adr/0059-ci-containers-and-deployment.md) §6). This page walks it on [Coolify](https://coolify.io), which is what the starter's own deployment runs on. Nothing here is Coolify-specific except the click path: the compose file is the description, and any platform that reads one will take it.

## What gets deployed

| Service    | Image                      | What it is                                                               |
| ---------- | -------------------------- | ------------------------------------------------------------------------ |
| `migrate`  | `apps/api/Dockerfile`      | One-shot. Applies the committed migrations and exits. The release gate.  |
| `api`      | `apps/api/Dockerfile`      | Express 5 on Node 22, port 4000. Starts only after `migrate` exits zero. |
| `admin`    | `apps/admin/Dockerfile`    | Static SPA on nginx, port 80. Built per environment.                     |
| `customer` | `apps/customer/Dockerfile` | Static SPA on nginx, port 80. Built per environment.                     |

Three facts to have in mind before the click path:

- **Postgres and Redis are not in the compose file.** They are managed resources on the platform, so their backups, restores, upgrades and monitoring are the platform's; the deployment is handed `DATABASE_URL`, `DATABASE_URL_OWNER` and `REDIS_URL`. Since `D14.6` the last of those is read: it is the rate limiters' shared store (ADR-0066 §4).
- **The two SPA images are environment-specific.** Vite inlines `VITE_*` at build time, so they are build arguments, not environment variables. Changing an API URL means rebuilding, and an image built for staging cannot be promoted to production. That is a property of the tool.
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
   | `CORS_ORIGINS`                                | `https://admin.example.com,https://app.example.com` — exact, no wildcard |
   | `VITE_ADMIN_API_URL`, `VITE_CUSTOMER_API_URL` | `https://api.example.com`                                                |
   | `VITE_CUSTOMER_APP_URL`                       | `https://app.example.com`                                                |
   | `MAIL_TRANSPORT`                              | `log` or `smtp` — production must state one (ADR-0066 §1)                |
   | `METRICS_TOKEN`                               | ≥ 32 random characters — `GET /metrics` is open without it               |

   **`MAIL_TRANSPORT` and `METRICS_TOKEN` are required in production** (ADR-0066 §1–§2). `log` is an honest answer for the transport while no flow sends mail — it writes a line per message and delivers nothing — but it has to be _stated_, because a deployment that inherited it would silently swallow every message the first credential flow ever sends. `METRICS_TOKEN` is a bearer credential: without one, `GET /metrics` answers anybody, and its body names every route the API has.

   **`REDIS_URL` is optional and stops being so at two instances** (ADR-0066 §4). Unset, the four rate limiters count in process memory, so N instances admit N times every limit in ADR-0020 — the login limiter included. Set, they share one budget. A configured Redis that cannot be reached stops the API from starting, and refuses requests rather than admitting them if it goes away later.

   **`TRUST_PROXY` is required and both constants are refused** (ADR-0059 §7). `true` makes Express take the left-most `X-Forwarded-For` entry verbatim, so `req.ip` becomes attacker-controlled; `false` behind a proxy makes every request report the proxy's address, so the login limiter, the refresh limiter and the audit trail collapse onto one key. Neither failure shows up in a response, which is why the API refuses to start rather than guess.

4. **Domains**, one per service: the API's on `api`, the admin's on `admin`, the customer's on `customer`. Coolify's proxy terminates TLS and forwards to the container port each service exposes (4000, 80, 80).

5. **Deploy.** The order is enforced by the compose file, not by you: `migrate` runs `node dist/migrate.js`, takes a `pg_advisory_lock` so two overlapping releases serialise, applies whatever is pending and exits; `api` starts only once it has exited zero. A failed migration therefore fails the deploy with the old API still running.

6. **Seed the first super admin, once.** The image deliberately carries only the migration runner: seeding is not a release step, it is a first-run one, and `SEED_SUPER_ADMIN_*` never reaches the API's request path (ADR-0008). Run it from a checkout against the managed database, once, with the two variables set for that command only:

   ```sh
   DATABASE_URL_OWNER='postgres://machxi_owner:…' NODE_ENV=production \
   SEED_SUPER_ADMIN_EMAIL=you@example.com SEED_SUPER_ADMIN_PASSWORD='…' \
     pnpm db:seed
   ```

   The **owner's** connection string, like every other `packages/db` CLI entry point (ADR-0061 §1).

   A password committed anywhere in this repository is refused here (ADR-0020 §Known-public secrets): the account holds `super_admin`, which bypasses every staff role check.

7. **Check it.** `GET https://api.example.com/health/ready` answers `200` with every check `up`; both SPAs reach their login page. `/health/live` is what the container's own `HEALTHCHECK` polls — liveness only, so a database blip never restarts a healthy process (ADR-0016).

## Running the reference stack locally

Useful for checking the images before a real deploy, and the shape the definition of done uses:

```sh
cp docker/prod/.env.example docker/prod/.env     # then edit the two DATABASE_URL* values
                                                # and the key (the committed
                                                # placeholder is refused)
docker compose -f docker/prod/compose.yaml build
docker compose -f docker/prod/compose.yaml up -d
curl -s localhost:4000/health/ready
```

Point both `DATABASE_URL*` values at the local compose Postgres with `host.docker.internal` rather than `localhost` — the API is in a container now, and `localhost` is the container. The published ports bind to `127.0.0.1`, so the stack is reachable from the host and from nowhere else; a platform routes to it over the compose network instead and needs no published port at all.

## What this does not decide

Image registry and tagging, secret storage, log shipping, and running `db:sessions:prune` on a schedule. Each is a deployment's own choice and none of them is in the repository; ADR-0059 §Consequences lists them so their absence is deliberate rather than forgotten.
