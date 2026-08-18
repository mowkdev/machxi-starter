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

export interface HealthCheckOutcome {
  readonly status: HealthStatus;
  readonly message?: string;
}
