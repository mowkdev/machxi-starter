# Docker setups

Container definitions live here, one directory per setup (ADR-0007). Everything
is driven from the repo root through `pnpm` scripts, so the compose files always
get the root `.env` as their variable source.

| Setup             | Path                           | Contents                                                                |
| ----------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Local development | [`local/`](local/compose.yaml) | Postgres 16 for the API, the drizzle tooling and the integration tests. |

Future setups (`ci/`, `prod/`, per-app `Dockerfile`s) are added as siblings of
`local/`. Only Postgres is containerised for now: the api, admin and web apps
run on the host so hot reload and the debugger stay native.

## Local development

### First run

```sh
cp .env.example .env      # edit if port 5432 is taken
pnpm docker:up            # blocks until the healthcheck passes
pnpm db:setup             # migrate + seed the super admin (ADR-0008) — arrives with @repo/db, plan step 6
pnpm dev --filter api     # http://localhost:4000
```

Until step 6 of the implementation plan lands `@repo/db`, `pnpm db:setup` is a stub
that exits 1 — `docker:up` is the whole of the local stack today, and it gives you two
empty databases.

`docker:up` passes `--wait`, so `pnpm docker:up && pnpm db:setup && pnpm dev`
is a reliable one-liner — the next command only starts once Postgres accepts
connections.

### Scripts

| Script              | What it does                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm docker:up`    | Starts the stack detached and waits for health.                                                               |
| `pnpm docker:down`  | Stops and removes the containers. **Data survives.**                                                          |
| `pnpm docker:reset` | `down -v` (drops the volume, so both databases and all data) then `up`. Follow with `pnpm db:setup` (step 6). |
| `pnpm docker:logs`  | Tails the Postgres log.                                                                                       |

Each is `docker compose --env-file .env -f docker/local/compose.yaml …`. Run
those flags yourself if you need a subcommand the scripts do not wrap, e.g.

```sh
docker compose --env-file .env -f docker/local/compose.yaml ps
```

### What you get

- **Container** `machxi-postgres`, **project** `machxi-local`, **network**
  `machxi-local` (named, so later services join it by name).
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
pnpm docker:reset && pnpm db:setup   # db:setup from step 6 onwards
```
