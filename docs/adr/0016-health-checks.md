# ADR-0016: Health check endpoints

- Status: superseded by [ADR-0066](0066-infrastructure-seams.md) (delta: `/metrics` joins `/health` as a second unversioned operational endpoint outside every limiter) and [ADR-0081](0081-build-versions.md) (delta: §Consequences' fallback — `version` is the image's label or `dev`, never a manifest's)
- Date: 2026-08-17

> **Superseded in part 2026-09-30 by [ADR-0081](0081-build-versions.md)**, accepted at the head of `D32.1`, the step that stamps the API's version into its image. A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): §Consequences said `version` "falls back to `package.json` version and `"unknown"`", and nothing ever read that file. Under 0081 §1 and §3 `version` is the `APP_VERSION` the image was built with, or `dev` when the build set none, and `commit` is the build's `GIT_SHA`, absent when unset or empty. **The response's shape does not change**, and everything else this record decides stands, together with 0066's `/metrics`.

> **Superseded in part 2026-09-03 by [ADR-0066](0066-infrastructure-seams.md)**, accepted at the head of `D14.6`. A delta supersession per [ADR-0050](0050-adr-lifecycle-and-verification.md): this record made `/health` the one unversioned, unlimited operational surface, and 0066 §2 adds a second — `GET /metrics`, mounted beside it and before the `/api/v1` limiter for the reason stated here, that an operational endpoint which can be rate-limited takes a working instance out of rotation. **The two are not the same thing and neither absorbs the other**: a probe stays cheap, unauthenticated and bounded, while a scrape is behind `METRICS_TOKEN` and answers an unbounded body of counters. **Everything this record decides stands**: the `live`/`ready` split, the indicator registry, the 200/503 mapping, the `no-store` headers and the rule that a health response leaks no configuration.

## Context

Orchestrators (Docker `--wait`, Kubernetes, load balancers) and humans need to distinguish "process is up" from "process can serve traffic". The database is a hard dependency (ADR-0003), so readiness must reflect it. Health endpoints must be cheap, unauthenticated, and must not leak configuration.

## Decision

Three endpoints under `/health` (outside `/api/v1`, no auth, no rate limit; a *successful* poll is access-logged at `debug`, and a failing one keeps its real level — corrected 2026-08-18, step 7: a probe that fails is the only time the line is worth reading):

| Path | Purpose | Checks | Success | Failure |
|---|---|---|---|---|
| `GET /health/live` | liveness | process is running & event loop responsive | `200` | (no response / timeout) |
| `GET /health/ready` | readiness | database `SELECT 1` within 2 s; (later: migrations applied, cache) | `200` | `503` |
| `GET /health` | human/aggregate | same as ready + version/uptime | `200` | `503` |

Response body (uses the standard envelope, ADR-0012):

```json
{
  "success": true,
  "data": {
    "status": "ok",                       // "ok" | "degraded" | "down"
    "version": "1.4.2",                    // from package.json / build env
    "commit": "a1b2c3d",                   // optional, from GIT_SHA env
    "uptimeSeconds": 12345,
    "timestamp": "2026-08-17T10:00:00.000Z",
    "checks": {
      "database": { "status": "ok", "latencyMs": 3 }
    }
  },
  "meta": { "requestId": "…" }
}
```

On failure, readiness returns `503` with the **error envelope** (`SERVICE_UNAVAILABLE`, `details: [{ code: 'database', message: 'connection refused' }]`), so clients get the success shape when healthy and the standard error shape otherwise. Detail messages are sanitised (no host/credentials).

Implementation:

- `modules/health`: `createHealthService({ indicators, config })` takes an array of indicator objects and runs them, each bounded by a per-check timeout; `createDbIndicator(client)` is the first one. Adding Redis/queue later = adding another indicator function to the array in `container.ts`.
- Only the database indicator is registered for the first deliverable.
- `/health/live` does not touch any dependency (a bad DB must not cause a restart loop; readiness handles traffic).
- Cache-Control: `no-store`.

**Amended 2026-08-18 (step 7).** Three points the prose above left to the
implementation, settled where the code disagreed with it:

- An indicator is `{ name, critical?, check: () => Promise<{ status: 'ok' | 'down', message? }> }`.
  Its status is deliberately narrower than the report's: `degraded` is a property
  of the *report*, derived from `critical`, and an indicator that returned
  `degraded` would be aggregated as a failure — answering `503` for a dependency
  that said it was still working.
  It does **not** report `latencyMs`: the service measures it. The service has to
  synthesise a duration anyway for a check that times out — it is the side that
  gave up, so it is the side that knows how long it waited — and measuring in one
  place also means the number is the wall time an operator actually waited for,
  not the part of it an indicator chose to time.
- `critical` (default `true`) is what separates `down` from `degraded`. A failing
  critical indicator makes the report `down` and readiness answers `503`; a
  failing non-critical one makes it `degraded` and readiness still answers `200`,
  which is what the `degraded` status in the table above is for. The default is
  `true` so a dependency nobody classified is assumed to matter.
- `GET /health` answers exactly what `GET /health/ready` answers. The resource
  already carries version, uptime and every check, so the "aggregate" view in the
  table is the readiness view; a second shape would only be a second thing to
  keep in sync. The distinction that carries weight is `live` (touches nothing)
  versus `ready` (touches everything).

**Sanitisation is by error code, not by filtering the message.** `ping()` rejects
with the driver's own error so the log can carry it, but the response is
unauthenticated: `connect ECONNREFUSED 10.0.3.12:5432` names an internal host and
`password authentication failed for user "machxi"` names a role. The indicator
therefore echoes only the error *code* — `unreachable (ECONNREFUSED)`,
`unreachable (28P01)` — which carries the operational signal and nothing else.
Building the message by removing the sensitive parts of the driver's would mean
guessing, in advance, every shape a driver message can take.

Container / orchestration mapping: `livenessProbe → /health/live`, `readinessProbe → /health/ready`, `startupProbe → /health/ready` with a longer window.

## Consequences

- Correct restart vs. traffic semantics from day one.
- Extending checks is additive.
- `version` requires build-time injection (`APP_VERSION`, `GIT_SHA`) — falls back to `package.json` version and `"unknown"`.

## Alternatives considered

- Single `/status` returning `{ ok: true }` (starter): conflates liveness and readiness.
- `@godaddy/terminus` or similar: fine but small enough to own; keeps envelope consistent.
