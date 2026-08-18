import type { HealthStatus } from "@repo/contracts";

/**
 * One dependency the API can report on (ADR-0016).
 *
 * `check` answers a status and, when it is not `ok`, a **sanitised** reason:
 * these responses are unauthenticated, so a driver message carrying a host,
 * a DSN or a role name must never reach one.
 *
 * Latency and the per-check timeout are the service's job, not the
 * indicator's — it measures what an operator actually waits for, and a check
 * that times out has to be given a duration by whoever gave up on it.
 */
export interface HealthIndicator {
  /** Key under `data.checks`, e.g. `database`. */
  readonly name: string;
  /**
   * Whether a failure means the API cannot serve traffic. Critical failures
   * make the whole report `down` (readiness answers 503); a non-critical one
   * makes it `degraded` and readiness still answers 200.
   */
  readonly critical?: boolean;
  readonly check: () => Promise<HealthCheckOutcome>;
}

/**
 * What one indicator reports.
 *
 * `ok` or `down` only — deliberately narrower than `HealthStatus`. `degraded`
 * is a property of the *report*, derived from whether the failing indicator was
 * critical; an indicator that returned `degraded` would be treated as a failure
 * by the aggregation and, if critical, would answer 503 for a dependency that
 * said it was still working (ADR-0016).
 */
export interface HealthCheckOutcome {
  readonly status: Extract<HealthStatus, "ok" | "down">;
  readonly message?: string;
}
