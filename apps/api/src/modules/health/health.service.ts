import type {
  HealthCheckResource,
  HealthResource,
  HealthStatus,
} from "@repo/contracts";

import type { AppConfig } from "../../core/config/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { unavailable } from "../../core/errors/index.js";
import type { HealthIndicator } from "./health.types.js";

/**
 * Liveness and readiness (ADR-0016).
 *
 * `live()` touches nothing: a database outage must not restart the process,
 * because a restarting process cannot serve the requests that do not need the
 * database either — readiness is what takes it out of the load balancer.
 * `ready()` runs every indicator and throws `SERVICE_UNAVAILABLE` when a
 * critical one is down, so the failure travels as the standard error envelope
 * (ADR-0013) rather than a third response shape.
 */

/** Longest a single indicator may take before it counts as down (ADR-0016). */
export const DEFAULT_CHECK_TIMEOUT_MS = 2000;

export interface HealthServiceDeps {
  readonly indicators: readonly HealthIndicator[];
  readonly config: AppConfig;
  /** Injected for tests (ADR-0018 uses the same seam for token expiry). */
  readonly now?: () => Date;
  readonly uptimeSeconds?: () => number;
  readonly checkTimeoutMs?: number;
}

/**
 * Resolves to a `down` outcome instead of hanging.
 *
 * A readiness probe that never answers is worse than one that answers "down":
 * the orchestrator's own timeout fires with no diagnosis, and the request
 * holds a connection until then.
 */
const withTimeout = async (
  indicator: HealthIndicator,
  timeoutMs: number,
): Promise<HealthCheckResource> => {
  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;

  const elapsed = (): number => Math.round(performance.now() - startedAt);

  try {
    const outcome = await Promise.race([
      indicator.check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("timeout"));
        }, timeoutMs);
      }),
    ]);

    return {
      status: outcome.status,
      latencyMs: elapsed(),
      ...(outcome.message === undefined ? {} : { message: outcome.message }),
    };
  } catch {
    // Either the timeout above, or an indicator that threw instead of
    // reporting. Both are "we do not know that this dependency works", and
    // neither message is safe to echo.
    return {
      status: "down",
      latencyMs: elapsed(),
      message: `no answer within ${String(timeoutMs)}ms`,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** `down` if a critical check failed, `degraded` if only a non-critical one did. */
export const aggregateStatus = (
  results: readonly {
    indicator: HealthIndicator;
    check: HealthCheckResource;
  }[],
): HealthStatus => {
  let degraded = false;

  for (const { indicator, check } of results) {
    if (check.status === "ok") continue;
    if (indicator.critical !== false) return "down";

    degraded = true;
  }

  return degraded ? "degraded" : "ok";
};

export const createHealthService = ({
  indicators,
  config,
  now = () => new Date(),
  uptimeSeconds = () => process.uptime(),
  checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
}: HealthServiceDeps) => {
  const baseResource = (
    status: HealthStatus,
    checks: Record<string, HealthCheckResource>,
  ): HealthResource => ({
    status,
    version: config.app.version,
    ...(config.app.commit === undefined ? {} : { commit: config.app.commit }),
    uptimeSeconds: Math.round(uptimeSeconds()),
    timestamp: now().toISOString(),
    checks,
  });

  return {
    /** Process is up and the event loop answered. No dependency is touched. */
    live: (_ctx: RequestContext): HealthResource => baseResource("ok", {}),

    /**
     * Every indicator, in parallel, each bounded by `checkTimeoutMs`.
     *
     * @throws AppError `SERVICE_UNAVAILABLE` (503) when a critical indicator
     *   is down; `details` names the indicator and carries its sanitised
     *   reason (ADR-0016).
     */
    ready: async (ctx: RequestContext): Promise<HealthResource> => {
      const results = await Promise.all(
        indicators.map(async (indicator) => ({
          indicator,
          check: await withTimeout(indicator, checkTimeoutMs),
        })),
      );

      const checks = Object.fromEntries(
        results.map(({ indicator, check }) => [indicator.name, check]),
      );
      const status = aggregateStatus(results);

      if (status === "down") {
        const failed = results.filter(({ check }) => check.status !== "ok");

        ctx.logger.error(
          { checks: failed.map(({ indicator }) => indicator.name) },
          "readiness check failed",
        );

        throw unavailable(
          failed.map(({ indicator, check }) => ({
            code: indicator.name,
            message: check.message ?? "down",
          })),
        );
      }

      return baseResource(status, checks);
    },
  } as const;
};

export type HealthService = ReturnType<typeof createHealthService>;
