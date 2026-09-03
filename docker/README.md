# Docker setups

Container definitions live here, one directory per setup (ADR-0007). Everything
is driven from the repo root through `pnpm` scripts, so the compose files always
get the root `.env` as their variable source.

| Setup                | Path                           | Contents                                                                                                             |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Local development    | [`local/`](local/compose.yaml) | Postgres 16 for the API, the drizzle tooling and the integration tests, and Mailpit for the mail port (ADR-0066 §1). |
| Reference deployment | [`prod/`](prod/compose.yaml)   | `migrate` (one-shot), `api`, `admin`, `customer`. Postgres and Redis are **external** (ADR-0059 §6).                 |

The two are siblings and neither is the other's environment: `local/` runs the
one dependency a developer needs so the apps themselves stay on the host with
hot reload and a debugger (ADR-0007), and `prod/` runs the built images with no
database beside them at all. The per-app `Dockerfile`s live with their apps
(`apps/*/Dockerfile`, ADR-0059 §4), because a build context is the repository
root and the file belongs to the thing it builds.

CI is not a third setup: the gate workflow uses a GitHub Actions service
container and runs `local/postgres/init` against it, so there is one definition
of the test database (`.github/workflows/gate.yml`, ADR-0059 §1).

## Local development

### First run

```sh
cp .env.example .env      # edit if port 5432 is taken
pnpm docker:up            # blocks until the healthcheck passes
pnpm db:setup             # migrate + seed the super admin (ADR-0008)
pnpm dev --filter api     # http://localhost:4000
```

`docker:up` gives you two empty databases; `db:setup` applies the committed
migrations to `machxi` and seeds the super admin from `SEED_SUPER_ADMIN_*`.
Add `pnpm db:seed -- --dev` for the local fixture accounts. `machxi_test` is
rebuilt by the integration suites themselves (ADR-0021), not by `db:setup`.

`docker:up` passes `--wait`, so `pnpm docker:up && pnpm db:setup && pnpm dev`
is a reliable one-liner — the next command only starts once Postgres accepts
connections.

### Scripts

| Script              | What it does                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm docker:up`    | Starts the stack detached and waits for health.                                                      |
| `pnpm docker:down`  | Stops and removes the containers. **Data survives.**                                                 |
| `pnpm docker:reset` | `down -v` (drops the volume, so both databases and all data) then `up`. Follow with `pnpm db:setup`. |
| `pnpm docker:logs`  | Tails every service's log.                                                                           |

Each is `docker compose --env-file .env -f docker/local/compose.yaml …`. Run
those flags yourself if you need a subcommand the scripts do not wrap, e.g.

```sh
docker compose --env-file .env -f docker/local/compose.yaml ps
```

### What you get

- **Containers** `machxi-postgres` and `machxi-mailpit`, **project**
  `machxi-local`, **network** `machxi-local` (named, so later services join it
  by name).
- **A local inbox** at <http://localhost:8025>, and SMTP on 1025. The API does
  **not** use it by default: `MAIL_TRANSPORT` defaults to `log`, which writes a
  line per message and delivers nothing (ADR-0066 §1). Set `MAIL_TRANSPORT=smtp`
  to read messages here — the `SMTP_*` defaults already point at this service,
  which accepts any credentials or none. Mailpit has no volume, so the inbox is
  empty after every `docker:down`.
- **Volume** `machxi-local_postgres-data` — data survives `down`; `docker:reset`
  is the only documented way to wipe it.
- **Two databases**: `machxi` (dev) and `machxi_test`. The test database is
  created by `local/postgres/init/01-test-db.sql` and is migrated, truncated and
  re-seeded by the integration run (ADR-0021), which is why it must not be the
  same database you develop against.
- **No extensions** are created by the init script. `citext` comes from
  migration 0000, so dev, test, CI and production all get it the same way
  (ADR-0008).

Init scripts under `local/postgres/init/` run **once**, on first start of an
empty volume. Editing them later does nothing until `pnpm docker:reset`.

### Connecting with a client

```
host     localhost
port     POSTGRES_PORT (default 5432)
user     POSTGRES_USER      (default machxi)
password POSTGRES_PASSWORD  (default machxi)
database machxi | machxi_test
```

Or open a shell in the container:

```sh
docker exec -it machxi-postgres psql -U machxi -d machxi
```

## Configuration

Credentials live in the root `.env` only (ADR-0004) — compose reads
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `POSTGRES_PORT`, and the
API and drizzle read `DATABASE_URL` / `DATABASE_URL_TEST` built from the same
values. Keep them in sync by hand: nothing derives one from the other.

- Changing `POSTGRES_PORT` also means changing the host and port inside both
  `DATABASE_URL` and `DATABASE_URL_TEST`.
- Changing `POSTGRES_USER`/`PASSWORD`/`DB` after the volume exists has **no
  effect** — those only seed a fresh data directory. Change them, then
  `pnpm docker:reset`.
- Renaming `POSTGRES_DB` also means editing the literal database name in
  `local/postgres/init/01-test-db.sql`; a plain `.sql` init file cannot read the
  compose variables.

## Troubleshooting

**`pnpm docker:up` hangs, then fails on the health check.** Look at
`pnpm docker:logs`. A data directory created by a different Postgres major
version, or with different credentials, will refuse to start — `pnpm docker:reset`.

**`bind: address already in use` on 5432.** Another Postgres (a host install, or
another project's container) owns the port. Either stop it, or set
`POSTGRES_PORT=5433` in `.env` and update the two `DATABASE_URL*` values.

**`ECONNREFUSED 127.0.0.1:5432` from the API or drizzle.** The container is not
up (`docker compose … ps`), or `.env` points at a different port than compose
published.

**`database "machxi_test" does not exist`.** The volume predates the init script
(or the script was added/edited after first start). `pnpm docker:reset`, then
`pnpm db:setup`.

**`role "machxi" does not exist`.** The volume was created with different
credentials than the ones now in `.env`. `pnpm docker:reset`.

**Windows.** Docker Desktop must be running with the WSL2 backend; the compose
file uses no host bind mounts other than the read-only init directory, so no
file-sharing configuration is needed.

**Start over completely.**

```sh
pnpm docker:reset && pnpm db:setup
```

## Reference deployment

[`prod/compose.yaml`](prod/compose.yaml) is the deployable shape: four services
from three images, with `DATABASE_URL` and `REDIS_URL` injected because
Postgres and Redis are managed resources on the platform (ADR-0059 §6).
[`docs/deploy.md`](../docs/deploy.md) walks it on Coolify end to end.

```sh
cp docker/prod/.env.example docker/prod/.env      # then edit it
docker compose -f docker/prod/compose.yaml build  # all four services
docker compose -f docker/prod/compose.yaml up -d
```

Compose reads `docker/prod/.env` automatically — it sits beside the compose
file — so unlike the local scripts there is no `--env-file` flag to pass. The
release order is in the file rather than in a runbook: `migrate` applies the
committed migrations under a `pg_advisory_lock` and exits, and `api` starts
only once it has exited zero. The API never migrates itself (ADR-0008).
