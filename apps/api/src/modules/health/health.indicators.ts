import type { DbClient } from "../../core/db/index.js";
import type { HealthIndicator } from "./health.types.js";

/**
 * The database indicator (ADR-0016) — the only one registered for the first
 * deliverable. Adding Redis or a queue later means adding another factory here
 * and one more entry in `container.ts`.
 */

/**
 * Reduces a driver failure to something safe to publish.
 *
 * `ping()` rejects with the driver's own error so the *log* can carry it
 * (ADR-0006), but this response is unauthenticated: `connect ECONNREFUSED
 * 10.0.3.12:5432` names an internal host, and an authentication failure names
 * the role. The error *code* — `ECONNREFUSED`, `ETIMEDOUT`, `28P01` — carries
 * the operational signal without any of that, so it is all that is echoed.
 */
export const sanitiseDbError = (error: unknown): string => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;

  return code === undefined || code === ""
    ? "unreachable"
    : `unreachable (${code})`;
};

export const createDbIndicator = (client: DbClient): HealthIndicator => ({
  name: "database",
  critical: true,
  check: async () => {
    try {
      await client.ping();

      return { status: "ok" };
    } catch (error) {
      return { status: "down", message: sanitiseDbError(error) };
    }
  },
});
