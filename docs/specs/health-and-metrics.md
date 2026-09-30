# Health and metrics

Two unversioned operational endpoints, mounted before the `/api/v1` segments and outside every rate limiter, so a probe or a scrape can never take a working instance out of rotation.

## Requirement: Liveness never touches a dependency; readiness does

`GET /health/live` answers `200` whenever the process can answer at all. `GET /health/ready` — and `GET /health`, which is the same view — runs every registered indicator and answers `200` with the version, uptime and each check when all pass, or `503 SERVICE_UNAVAILABLE` naming the failing check when one does not. Both are unauthenticated, `no-store`, and reachable when the limiters are exhausted.
Records: [ADR-0016](../adr/0016-health-checks.md), [ADR-0020](../adr/0020-security-baseline.md)
Proved by: `apps/api/test/health.int.test.ts`, `apps/api/src/modules/health/__tests__/health.service.test.ts`

### Scenario: The database is down

- **WHEN** the readiness probe runs against a database that does not answer
- **THEN** `/health/ready` answers `503 SERVICE_UNAVAILABLE` with a `database` detail, and `/health/live` still answers `200`

### Scenario: Rate limited elsewhere

- **WHEN** a client has exhausted the global limit on `/api`
- **THEN** its probes still answer

## Requirement: The version and the commit are the image's

`version` in every `/health` view, liveness included, is the `APP_VERSION` the image was built with, and `commit` is its `GIT_SHA`, both stamped at image build and never read from a `package.json`. Unset or empty, `version` is `dev` and `commit` is left out of the body, never answered as an empty string. The shape of the response does not change.
Records: [ADR-0081](../adr/0081-build-versions.md), [ADR-0016](../adr/0016-health-checks.md)
Proved by: `apps/api/src/core/config/__tests__/config.test.ts`, `apps/api/test/health.int.test.ts`

### Scenario: A build nobody labelled

- **WHEN** the image was built with neither build argument, or with either one empty
- **THEN** `/health` answers `version: "dev"` and carries no `commit` field

### Scenario: A labelled build

- **WHEN** the image was built with `APP_VERSION=9.9.9` and a `GIT_SHA`
- **THEN** `/health` answers `version: "9.9.9"` and that commit in full

## Requirement: Metrics are behind a token, and required in production

`GET /metrics` answers `200` with a Prometheus text body labelled by route pattern. With `METRICS_TOKEN` set it requires `Authorization: Bearer <token>`, compared in constant time, and answers `401 UNAUTHENTICATED` otherwise; in production an unset token refuses to start.
Records: [ADR-0066](../adr/0066-infrastructure-seams.md)
Proved by: `apps/api/test/observability.int.test.ts`, `apps/api/src/core/config/__tests__/config.test.ts`

### Scenario: With the token

- **WHEN** a scraper presents the configured bearer token
- **THEN** the answer is `200` in the Prometheus exposition format

### Scenario: Without it

- **WHEN** the token is configured and the request carries none, or a wrong one
- **THEN** the answer is `401 UNAUTHENTICATED` in the ordinary error envelope

## Requirement: Server failures reach the reporter; client failures do not

A `5xx` response is reported through the error-reporting seam with the request id, route, status and principal and never the body; a `4xx` is not reported.
Records: [ADR-0066](../adr/0066-infrastructure-seams.md), [ADR-0013](../adr/0013-error-model.md)
Proved by: `apps/api/test/observability.int.test.ts`

### Scenario: A validation failure

- **WHEN** a request answers `400`
- **THEN** the reporter is not called

### Scenario: An unexpected failure

- **WHEN** a request answers `500`
- **THEN** the reporter receives one report carrying the request id and no request body
