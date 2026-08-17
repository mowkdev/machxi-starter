# ADR-0016: Health check endpoints

- Status: accepted
- Date: 2026-08-17

## Context

Orchestrators (Docker `--wait`, Kubernetes, load balancers) and humans need to distinguish "process is up" from "process can serve traffic". The database is a hard dependency (ADR-0003), so readiness must reflect it. Health endpoints must be cheap, unauthenticated, and must not leak configuration.

## Decision

Three endpoints under `/health` (outside `/api/v1`, no auth, no rate limit, access-logged at `debug` only):

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

- `modules/health`: `createHealthService(indicators)` takes an array of indicator objects (`{ name, check: () => Promise<{ status, latencyMs, message? }> }`) and runs them with a per-check timeout; `dbIndicator(db)` is the first one. Adding Redis/queue later = adding another indicator function to the array in `container.ts`.
- Only the database indicator is registered for the first deliverable.
- `/health/live` does not touch any dependency (a bad DB must not cause a restart loop; readiness handles traffic).
- Cache-Control: `no-store`.

Container / orchestration mapping: `livenessProbe → /health/live`, `readinessProbe → /health/ready`, `startupProbe → /health/ready` with a longer window.

## Consequences

- Correct restart vs. traffic semantics from day one.
- Extending checks is additive.
- `version` requires build-time injection (`APP_VERSION`, `GIT_SHA`) — falls back to `package.json` version and `"unknown"`.

## Alternatives considered

- Single `/status` returning `{ ok: true }` (starter): conflates liveness and readiness.
- `@godaddy/terminus` or similar: fine but small enough to own; keeps envelope consistent.
