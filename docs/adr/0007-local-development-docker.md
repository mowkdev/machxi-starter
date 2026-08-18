# ADR-0007: Local development infrastructure with Docker Compose

- Status: accepted
- Date: 2026-08-17

## Context

Developers need a reproducible Postgres for local work and for running integration tests, without installing Postgres on the host. The repo should be able to host several Docker setups over time (local dev, CI, full-stack preview, production images), so the layout must leave room for them.

For the first deliverable only Postgres runs in Docker; the API, `web` and `admin` run on the host with hot reload.

## Decision

### Layout

```
docker/
├── README.md               # how to run each setup
└── local/
    ├── compose.yaml        # postgres (+ optional pgadmin/adminer profile)
    └── postgres/
        └── init/           # *.sql / *.sh run once on first container start
            └── 01-test-db.sql      # CREATE DATABASE machxi_test; (extensions are created by migrations, ADR-0008)
```

Future setups (`docker/ci/`, `docker/prod/`, per-app `Dockerfile`s) sit as siblings of `local/`.

### `docker/local/compose.yaml`

```yaml
name: machxi-local
services:
  postgres:
    image: postgres:16-alpine
    container_name: machxi-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [machxi]

volumes:
  postgres-data:

networks:
  machxi:
    name: machxi-local
```

- Credentials come from the **root `.env`** (ADR-0004); compose is invoked from the repo root with `--env-file .env -f docker/local/compose.yaml` (wrapped in the root scripts, below), so the same values feed `DATABASE_URL`.
- Named network `machxi-local` so future services (api container, mailhog, redis) join it by name.
- Named volume so data survives `down`; `docker compose down -v` is the documented reset.
- A second database `machxi_test` is created by the init script for integration tests (ADR-0021), keeping test data separate from dev data. Postgres extensions (`citext`) are **not** created by init scripts — the first migration does `CREATE EXTENSION IF NOT EXISTS citext;` so every environment (test DB, CI, production) gets them the same way.

### Root scripts

```json
{
  "docker:up":   "docker compose --env-file .env -f docker/local/compose.yaml up -d --wait",
  "docker:down": "docker compose --env-file .env -f docker/local/compose.yaml down",
  "docker:reset":"docker compose --env-file .env -f docker/local/compose.yaml down -v && pnpm docker:up",
  "docker:logs": "docker compose --env-file .env -f docker/local/compose.yaml logs -f"
}
```

`--wait` blocks until the healthcheck passes, so `pnpm docker:up && pnpm db:migrate && pnpm db:seed && pnpm dev` is a reliable first-run sequence.

### Developer flow

1. `cp .env.example .env` (edit if ports clash)
2. `pnpm docker:up`
3. `pnpm db:migrate` then `pnpm db:seed` (ADR-0008)
4. `pnpm dev --filter api` (or `pnpm dev`)

## Consequences

- Zero host dependencies besides Docker, Node and pnpm.
- Single source of DB credentials.
- The API itself is not containerised for local dev — hot reload and debugging stay native. A `docker/local/compose.full.yaml` profile can add it later.

## Alternatives considered

- Per-app `docker-compose.yml`: scatters infra config; conflicts with the requirement to keep setups under `docker/`.
- Running the API in a container in dev: slower feedback loop on Windows/macOS file systems; unnecessary for the first deliverable.
- Testcontainers for tests: good option later; for now the compose test DB is simpler and works with Postman too.
