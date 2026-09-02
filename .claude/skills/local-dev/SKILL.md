---
name: local-dev
description: Run and troubleshoot the local stack — Docker Postgres, migrations, seeds, API dev server, tests, Postman/newman. Use for "start the stack", "db won't connect", "reset the database", "run integration tests".
---

# Local development runbook (ADR-0007, ADR-0008, ADR-0021)

## First run

```
corepack enable && pnpm i
cp .env.example .env            # edit SEED_SUPER_ADMIN_EMAIL / _PASSWORD, ports
pnpm docker:up                  # waits for healthcheck
pnpm db:setup                   # migrate + seed super admin
pnpm db:seed -- --dev           # optional fixtures for Postman/dev
pnpm dev --filter api           # :4000  → GET http://localhost:4000/health/ready
```

## Daily

- `pnpm dev` (all) or `pnpm dev --filter api`
- `pnpm check` (fast loop, cached) · `pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` (the gate, needs docker; `size` builds each SPA and weighs it against its committed budget, `format:check` is prettier over the tree) · `pnpm test:int --filter api` · `pnpm test:postman`
- Schema changed? `/db-schema-change`. Logs: `pnpm docker:logs`.

## Troubleshooting

| Symptom                            | Check                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API exits "database unreachable"   | `pnpm docker:up`; `DATABASE_URL` host/port match `POSTGRES_PORT`; `docker ps` healthy                                                                                                  |
| `relation … does not exist`        | `pnpm db:migrate`; for tests ensure `DATABASE_URL_TEST` DB exists (init script creates `machxi_test` only on first volume init → `pnpm docker:reset` if volume predates it)            |
| `role "machxi_app" does not exist` | migration 0008 refusing (ADR-0061): the two roles come from `docker/local/postgres/init/00-roles.sql`, which runs only on a fresh volume → `pnpm docker:reset`, or create them by hand |
| `permission denied for …`          | you are on the application role where DDL is needed: `db:migrate`, `db:seed`, `db:reset`, `drizzle-kit` and the test harness read `DATABASE_URL_OWNER` (ADR-0061 §1)                   |
| `citext` type missing              | migration 0000 not applied on that DB                                                                                                                                                  |
| Login 401 for seeded admin         | seed skipped because `SEED_SUPER_ADMIN_*` unset → set + `pnpm db:seed`                                                                                                                 |
| Config validation error on boot    | read the listed keys; compare with `.env.example` and ADR-0004                                                                                                                         |
| Port in use                        | change `PORT` / `POSTGRES_PORT` in `.env`                                                                                                                                              |
| Wipe everything                    | `pnpm docker:reset && pnpm db:setup` (asks; destroys the volume)                                                                                                                       |

Never read `.env` values into chat; refer to keys only.
