# ADR-0016: Health check endpoints

- Status: accepted
- Date: 2026-08-17

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
