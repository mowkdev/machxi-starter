import type { IsoDateTime } from "./primitives.js";

/**
 * The health resource returned by `/health`, `/health/live` and `/health/ready`
 * (ADR-0016). It travels in the normal success envelope when the API is
 * healthy, and is replaced by a `SERVICE_UNAVAILABLE` error envelope when it
 * is not — so a client sees the standard two shapes and never a third.
 */

/**
 * `ok` — every indicator passed. `degraded` — a non-critical indicator failed
 * but traffic can still be served. `down` — a critical dependency is
 * unreachable; readiness answers 503.
 */
export const HEALTH_STATUSES = ["ok", "degraded", "down"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** The outcome of one indicator (`database`, later `cache`, `queue`, …). */
export interface HealthCheckResource {
  readonly status: HealthStatus;
  readonly latencyMs: number;
  /** Sanitised failure reason — never a host, DSN or credential (ADR-0016). */
  readonly message?: string;
}

export interface HealthResource {
  readonly status: HealthStatus;
  /** `APP_VERSION`, falling back to the API's `package.json` version. */
  readonly version: string;
  /** `GIT_SHA` when the build injected one. */
  readonly commit?: string;
  readonly uptimeSeconds: number;
  readonly timestamp: IsoDateTime;
  /** Keyed by indicator name; `/health/live` reports no checks at all. */
  readonly checks: Readonly<Record<string, HealthCheckResource>>;
}
